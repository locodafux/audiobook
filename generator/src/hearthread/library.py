"""The book-level commands: add, status, retry, cancel, publish, regen, backup-retry, remove."""

from __future__ import annotations

import asyncio
import shutil
import tempfile
from collections.abc import Callable
from pathlib import Path

from .book import (
    chapter_keys,
    cover_key,
    parse_range,
    slugify,
    source_key,
    text_sha256,
)
from .deps import Deps
from .pipeline import fetch_and_parse, refresh_totals
from .store import sha256_file
from .telegram import Sent, TelegramError

CHARS_PER_SECOND = 14.5  # rough narration pace at +0%, only for the estimate shown by `add`


class CommandError(Exception):
    """A readable refusal (printed, exit code 1)."""


class RenumberRefused(CommandError):
    pass


def _fmt_duration(seconds: float) -> str:
    h, rem = divmod(int(seconds), 3600)
    return f"{h}h {rem // 60:02d}m" if h else f"{rem // 60}m {rem % 60:02d}s"


def _get_book(deps: Deps, book_id: str) -> dict:
    book = deps.db.one("SELECT * FROM books WHERE id = %s", (book_id,))
    if not book:
        raise CommandError(f"no book with id {book_id!r} (see `hearthread status`)")
    return book


# --- add --------------------------------------------------------------------------------------


def add(
    deps: Deps,
    epub: Path,
    book_id: str | None = None,
    confirm: Callable[[str], bool] = lambda _msg: True,
    say: Callable[[str], None] = print,
) -> str | None:
    """Read the EPUB, show a summary, and after confirmation create the draft book + one job
    per chapter. Returns the book id, or None if declined / already added."""
    if not epub.is_file():
        raise CommandError(f"{epub} is not a file")
    db = deps.db
    try:
        parsed = deps.parse(epub)
    except Exception as exc:  # noqa: BLE001 - any parser failure should read as a message, not a traceback
        raise CommandError(f"could not read {epub.name}: {exc}") from exc
    if not parsed.chapters:
        raise CommandError("no chapters found in that EPUB")
    sha = sha256_file(epub)
    twin = db.one("SELECT id FROM books WHERE source_sha256 = %s", (sha,))
    if twin:
        say(f"already added as {twin['id']!r}; nothing to do")
        return None
    book_id = book_id or slugify(parsed.title)
    if db.one("SELECT 1 FROM books WHERE id = %s", (book_id,)):
        raise CommandError(f"book id {book_id!r} is taken by a different EPUB; pass --id")

    chars = sum(len(s) for c in parsed.chapters for s in c.sentences)
    say(f"title:    {parsed.title}")
    say(f"author:   {parsed.author or '-'}")
    say(f"chapters: {len(parsed.chapters)}")
    say(f"length:   about {_fmt_duration(chars / CHARS_PER_SECOND)} of audio (estimate)")
    say(f"id:       {book_id}   voice: {deps.settings.voice} {deps.settings.rate}")
    if not confirm("Add this book and queue every chapter?"):
        say("cancelled, nothing was changed")
        return None

    skey = source_key(book_id)
    deps.store.put_file(skey, epub, "application/epub+zip")
    if parsed.cover:  # kept in the library folder; phones show a gradient until covers are served
        deps.store.put_bytes(cover_key(book_id), parsed.cover, "image/jpeg")
    cover_sent = _telegram_extras(deps, book_id, epub, parsed.cover, say)

    with db.tx() as conn:
        conn.execute(
            """INSERT INTO books (id, title, author, description, language, series_title, volume,
                                  cover_file_id, voice, rate, status, source_key, source_sha256,
                                  parser_version, chapter_count)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'draft', %s, %s, %s, %s)""",
            (
                book_id,
                parsed.title,
                parsed.author,
                parsed.description,
                parsed.language,
                parsed.series_title,
                parsed.volume,
                cover_sent.file_id if cover_sent else None,
                deps.settings.voice,
                deps.settings.rate,
                skey,
                sha,
                parsed.parser_version,
                len(parsed.chapters),
            ),
        )
        cur = conn.cursor()
        cur.executemany(
            """INSERT INTO chapters (book_id, n, title, status, sentence_count, source_ref, text_sha256)
               VALUES (%s, %s, %s, 'pending', %s, %s, %s)""",
            [
                (book_id, i, c.title, len(c.sentences), c.source_ref, text_sha256(c.sentences))
                for i, c in enumerate(parsed.chapters, 1)
            ],
        )
        conn.execute(
            "INSERT INTO jobs (book_id, chapter_n, kind) SELECT book_id, n, 'chapter'"
            " FROM chapters WHERE book_id = %s",
            (book_id,),
        )
    say(f"added {book_id!r}: {len(parsed.chapters)} chapters queued. Run `hearthread run`.")
    return book_id


def _telegram_extras(deps: Deps, book_id: str, epub: Path, cover: bytes | None, say) -> Sent | None:
    """EPUB and cover copies to the chat. Best effort: a Telegram outage never blocks `add`.
    Returns the cover's upload (its file id is kept on the book), or None."""

    async def go() -> Sent | None:
        await deps.backup.send_document(epub, f"{book_id} source EPUB")
        if not cover:
            return None
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / f"{book_id}-cover.jpg"
            p.write_bytes(cover)
            return await deps.backup.send_document(p, f"{book_id} cover")

    try:
        return asyncio.run(go())
    except (TelegramError, OSError) as exc:
        say(f"warning: Telegram copy of the EPUB/cover failed ({exc}); continuing")
        return None


# --- status -----------------------------------------------------------------------------------


def status(deps: Deps, book_id: str | None = None) -> str:
    db = deps.db
    where, args = ("WHERE b.id = %s", (book_id,)) if book_id else ("", ())
    books = db.q(
        f"""SELECT b.id, b.title, b.status AS book_status, count(c.n) AS total,
               count(*) FILTER (WHERE c.status = 'ready') AS ready,
               count(*) FILTER (WHERE c.status = 'failed') AS failed,
               count(*) FILTER (WHERE c.backup_status = 'done') AS backed_up,
               count(*) FILTER (WHERE c.backup_status = 'failed') AS backup_failed,
               coalesce(sum(c.bytes), 0) AS bytes
            FROM books b LEFT JOIN chapters c ON c.book_id = b.id {where}
            GROUP BY b.id, b.title, b.status ORDER BY b.id""",
        args,
    )
    if book_id and not books:
        raise CommandError(f"no book with id {book_id!r}")
    if not books:
        return "no books yet. Add one with `hearthread add book.epub`."
    jwhere, jargs = ("AND book_id = %s", (book_id,)) if book_id else ("", ())
    live = db.q(
        f"""SELECT book_id, kind, status, count(*) AS n FROM jobs
            WHERE status IN ('queued', 'running') {jwhere} GROUP BY book_id, kind, status""",
        jargs,
    )
    out: list[str] = []
    for b in books:
        mine = {(r["kind"], r["status"]): r["n"] for r in live if r["book_id"] == b["id"]}
        working, waiting = mine.get(("chapter", "running"), 0), mine.get(("chapter", "queued"), 0)
        out.append(
            f'{b["id"]}  "{b["title"]}"  [{b["book_status"]}]  {float(b["bytes"]) / 1e6:.1f} MB\n'
            f"  chapters: {b['ready']}/{b['total']} ready, {working} working, "
            f"{waiting} waiting, {b['failed']} failed\n"
            f"  telegram: {b['backed_up']} done, {b['backup_failed']} failed, "
            f"{mine.get(('backup', 'queued'), 0) + mine.get(('backup', 'running'), 0)} in progress"
        )
    for f in db.q(
        f"""SELECT j.book_id, j.kind, j.chapter_n, j.error FROM jobs j
            JOIN chapters c ON c.book_id = j.book_id AND c.n = j.chapter_n
            WHERE j.status = 'failed' {jwhere.replace("book_id", "j.book_id")}
              AND ((j.kind = 'chapter' AND c.status <> 'ready')
                   OR (j.kind = 'backup' AND c.backup_status = 'failed'))
            ORDER BY j.book_id, j.chapter_n LIMIT 30""",
        jargs,
    ):
        out.append(f"  FAILED {f['kind']} {f['book_id']}#{f['chapter_n']}: {f['error']}")
    left = db.one(
        """SELECT count(*) FILTER (WHERE kind = 'chapter' AND status IN ('queued', 'running')) AS todo,
                  (SELECT avg(extract(epoch FROM finished_at - started_at)) FROM
                     (SELECT finished_at, started_at FROM jobs WHERE kind = 'chapter'
                      AND status = 'done' ORDER BY finished_at DESC LIMIT 50) r) AS avg_s
           FROM jobs"""
    )
    if left and left["todo"] and left["avg_s"]:
        eta = left["todo"] * float(left["avg_s"]) / max(deps.settings.chapter_concurrency, 1)
        out.append(f"rough time left: {_fmt_duration(eta)} ({left['todo']} chapters to go)")
    return "\n".join(out)


# --- retry / cancel / publish -----------------------------------------------------------------


def retry(deps: Deps, book_id: str, chapter: int | None = None) -> int:
    """Put failed (and cancelled) chapters back on the list. Returns how many were queued."""
    _get_book(deps, book_id)
    only, args = ("AND n = %s", (book_id, chapter)) if chapter else ("", (book_id,))
    with deps.db.tx() as conn:
        conn.execute(
            f"UPDATE chapters SET status = 'pending' WHERE book_id = %s AND status = 'failed' {only}",
            args,
        )
        cur = conn.execute(
            f"""INSERT INTO jobs (book_id, chapter_n, kind) SELECT book_id, n, 'chapter'
                FROM chapters WHERE book_id = %s AND status = 'pending' {only}
                ON CONFLICT DO NOTHING""",
            args,
        )
        return cur.rowcount


def cancel(deps: Deps, book_id: str) -> str:
    """Remove waiting chapters from the list. A chapter already running finishes (one chapter)."""
    _get_book(deps, book_id)
    n = deps.db.x(
        "DELETE FROM jobs WHERE book_id = %s AND kind = 'chapter' AND status = 'queued'", (book_id,)
    )
    running = deps.db.one(
        "SELECT count(*) AS n FROM jobs WHERE book_id = %s AND status = 'running'", (book_id,)
    )["n"]
    return f"removed {n} waiting chapters" + (f"; {running} running will finish" if running else "")


def publish(deps: Deps, book_id: str, force: bool = False) -> str:
    _get_book(deps, book_id)
    todo = deps.db.one(
        "SELECT count(*) AS n FROM chapters WHERE book_id = %s AND status <> 'ready'", (book_id,)
    )["n"]
    if todo and not force:
        raise CommandError(f"{todo} chapters are not ready yet (use --force to publish anyway)")
    with deps.db.tx() as conn:
        refresh_totals(conn, book_id)
        conn.execute("UPDATE books SET status = 'published' WHERE id = %s", (book_id,))
    return f"{book_id} is published"


def unpublish(deps: Deps, book_id: str) -> str:
    _get_book(deps, book_id)
    deps.db.x("UPDATE books SET status = 'draft' WHERE id = %s", (book_id,))
    return f"{book_id} is hidden from the app"


# --- regen ------------------------------------------------------------------------------------


def regen(
    deps: Deps,
    book_id: str,
    chapters: str | None = None,
    accept_renumber: bool = False,
    say: Callable[[str], None] = print,
) -> str:
    """Re-make chapters. The numbering guard re-reads the EPUB and refuses if the chapter list
    would change, unless --accept-renumber: friends' downloads are keyed by chapter number."""
    book = _get_book(deps, book_id)
    db = deps.db
    parsed = asyncio.run(fetch_and_parse(deps, book))
    old = db.q(
        "SELECT n, title, source_ref FROM chapters WHERE book_id = %s ORDER BY n", (book_id,)
    )
    new = [(c.title, c.source_ref) for c in parsed.chapters]
    changes = _renumber_changes(old, new)
    if changes and not accept_renumber:
        lines = "\n  ".join(changes[:15]) + (
            f"\n  ... and {len(changes) - 15} more" if len(changes) > 15 else ""
        )
        raise RenumberRefused(
            f"re-reading the EPUB would change the chapter list:\n  {lines}\n"
            "Refusing: it would orphan downloads. Pass --accept-renumber if that is intended."
        )
    try:
        wanted = parse_range(chapters, len(new))
    except ValueError as exc:
        raise CommandError(str(exc)) from exc

    dropped = [r["n"] for r in old if r["n"] > len(new)]
    for n in dropped:
        deps.store.delete_prefix(chapter_keys(book_id, n)[0].rsplit(".", 1)[0] + ".")
    with db.tx() as conn:
        conn.execute("DELETE FROM jobs WHERE book_id = %s AND chapter_n > %s", (book_id, len(new)))
        conn.execute("DELETE FROM chapters WHERE book_id = %s AND n > %s", (book_id, len(new)))
        cur = conn.cursor()
        cur.executemany(
            """INSERT INTO chapters (book_id, n, title, status, sentence_count, source_ref, text_sha256)
               VALUES (%s, %s, %s, 'pending', %s, %s, %s)
               ON CONFLICT (book_id, n) DO UPDATE SET title = excluded.title,
                   sentence_count = excluded.sentence_count, source_ref = excluded.source_ref,
                   text_sha256 = excluded.text_sha256""",
            [
                (book_id, i, c.title, len(c.sentences), c.source_ref, text_sha256(c.sentences))
                for i, c in enumerate(parsed.chapters, 1)
            ],
        )
        conn.execute(
            "UPDATE books SET parser_version = %s, chapter_count = %s WHERE id = %s",
            (parsed.parser_version, len(new), book_id),
        )
        # input_hash NULL = "not what is in the library folder any more": the job re-makes it. Ready chapters stay
        # ready (and listenable) until the new audio overwrites the same keys.
        conn.execute(
            "UPDATE chapters SET input_hash = NULL, status = CASE WHEN status = 'failed'"
            " THEN 'pending' ELSE status END WHERE book_id = %s AND n = ANY(%s)",
            (book_id, wanted),
        )
        cur = conn.execute(
            """INSERT INTO jobs (book_id, chapter_n, kind)
               SELECT %s, n, 'chapter' FROM unnest(%s::int[]) AS n ON CONFLICT DO NOTHING""",
            (book_id, wanted),
        )
        queued = cur.rowcount
    say(
        f"queued {queued} chapters for regeneration"
        + (f"; removed {len(dropped)} chapters" if dropped else "")
    )
    return book_id


def _renumber_changes(old: list[dict], new: list[tuple[str, str]]) -> list[str]:
    """Differences between the stored chapter list and a fresh read (empty = numbering is safe)."""
    changes = []
    if len(old) != len(new):
        changes.append(f"chapter count {len(old)} -> {len(new)}")
    for row, (title, ref) in zip(old, new, strict=False):
        same = (
            (row["source_ref"] == ref) if (row["source_ref"] and ref) else (row["title"] == title)
        )
        if not same:
            changes.append(f"chapter {row['n']}: {row['title']!r} -> {title!r}")
    return changes


# --- backup-retry / remove --------------------------------------------------------------------


def backup_retry(deps: Deps, everything: bool = False) -> int:
    """Queue a re-upload for every ready chapter whose Telegram copy failed (taken from the library folder)."""
    return deps.db.x(
        """INSERT INTO jobs (book_id, chapter_n, kind)
           SELECT book_id, n, 'backup' FROM chapters
           WHERE status = 'ready' AND (%s OR backup_status = 'failed') ON CONFLICT DO NOTHING""",
        (everything,),
    )


def remove(
    deps: Deps, book_id: str, confirm: Callable[[str], bool], say: Callable[[str], None] = print
) -> bool:
    """Delete the book from the list and the library folder (Telegram copies stay). Asks twice."""
    book = _get_book(deps, book_id)
    live = deps.db.one(
        "SELECT count(*) AS n FROM jobs WHERE book_id = %s AND status = 'running'"
        " AND locked_until > now()",
        (book_id,),
    )["n"]
    if live:
        raise CommandError(
            f"{live} chapters are being worked on; stop the worker or wait, then retry"
        )
    if not confirm(f"Delete {book['title']!r} ({book_id}) from the list and the library folder?"):
        return False
    if not confirm(f"Really delete {book_id}? This cannot be undone (Telegram copies stay)"):
        return False
    deps.store.delete_prefix(f"books/{book_id}/")
    deps.store.delete_prefix(source_key(book_id))
    with deps.db.tx() as conn:
        conn.execute("DELETE FROM jobs WHERE book_id = %s", (book_id,))
        conn.execute("DELETE FROM chapters WHERE book_id = %s", (book_id,))
        conn.execute("DELETE FROM books WHERE id = %s", (book_id,))
    say(f"removed {book_id}")
    return True


def free_disk_gb(path: Path) -> float:
    p = path
    while not p.exists():
        p = p.parent
    return shutil.disk_usage(p).free / 1e9
