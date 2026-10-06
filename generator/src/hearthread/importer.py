"""import-voiced: bring chapters voiced by the previous app into the library, Telegram and the database.

Reads a folder of `chapter_NN.mp3` + `chapter_NN_timing.json` (never modified or committed), keeps a
copy in the library folder, uploads both files to Telegram, and records the file ids. Safe to run
again: chapters already recorded with the same size are skipped, so a stopped run continues.
"""

from __future__ import annotations

import asyncio
import json
import re
from collections.abc import Callable
from pathlib import Path

from . import audio
from .book import chapter_keys
from .deps import Deps
from .library import CommandError
from .pipeline import mark_ready, refresh_totals, send_chapter, telegram_fields
from .store import sha256_file
from .telegram import TelegramError

CHAPTER = re.compile(r"^chapter_(\d+)\.mp3$")


def convert_timing(old: object) -> dict:
    """Old `[{index,text,startTime,endTime,paragraphId}]` into the app's `{"v":1,"sentences":[...]}`."""
    if not isinstance(old, list) or not old:
        raise ValueError("timing file is not a list of sentences")
    items = []
    for i, row in enumerate(old):
        try:
            items.append(
                {
                    "i": int(row.get("index", i)),
                    "t": row["text"],
                    "s": round(float(row["startTime"]), 2),
                    "e": round(float(row["endTime"]), 2),
                }
            )
        except (KeyError, TypeError, ValueError, AttributeError) as exc:
            raise ValueError(f"sentence {i} of the timing file is unreadable") from exc
    return {"v": 1, "sentences": items}


def find_chapters(folder: Path) -> list[tuple[int, Path, Path]]:
    found = []
    for mp3 in sorted(folder.glob("chapter_*.mp3")):
        m = CHAPTER.match(mp3.name)
        timing = mp3.with_name(mp3.stem + "_timing.json")
        if m and timing.is_file():
            found.append((int(m[1]), mp3, timing))
    if not found:
        raise CommandError(f"no chapter_NN.mp3 + chapter_NN_timing.json pairs in {folder}")
    return sorted(found)


def member_id(deps: Deps, email: str) -> str:
    row = deps.db.one("SELECT user_id FROM members WHERE email = %s", (email.strip().lower(),))
    if not row:
        raise CommandError(f"{email} is not a member yet (`hearthread invite add {email}` first)")
    return str(row["user_id"])


def import_voiced(
    deps: Deps,
    folder: Path,
    book_id: str,
    title: str,
    author: str | None = None,
    series: str | None = None,
    volume: int | None = None,
    first_chapter: int = 1,
    private_to: str | None = None,
    limit: int | None = None,
    say: Callable[[str], None] = print,
) -> bool:
    """Returns True when every chapter is in, False when some failed (they are listed).

    One event loop for the whole run, because the Telegram client is tied to the loop it first used."""
    return asyncio.run(
        _import_voiced(
            deps,
            folder,
            book_id,
            title,
            author,
            series,
            volume,
            first_chapter,
            private_to,
            limit,
            say,
        )
    )


async def _import_voiced(
    deps: Deps,
    folder: Path,
    book_id: str,
    title: str,
    author: str | None,
    series: str | None,
    volume: int | None,
    first_chapter: int,
    private_to: str | None,
    limit: int | None,
    say: Callable[[str], None],
) -> bool:
    if not folder.is_dir():
        raise CommandError(f"{folder} is not a folder")
    chapters = find_chapters(folder)
    owner = member_id(deps, private_to) if private_to else None
    db = deps.db
    db.x(
        """INSERT INTO books (id, title, author, series_title, volume, private_to)
           VALUES (%s, %s, %s, %s, %s, %s)
           ON CONFLICT (id) DO UPDATE SET private_to = excluded.private_to""",
        (book_id, title, author, series, volume, owner),
    )
    say(f"{title}: {len(chapters)} chapters" + (f", private to {private_to}" if owner else ""))

    # every chapter is listed first, so the book only publishes once all of them are really in
    for n, _mp3, _timing in chapters:
        db.x(
            """INSERT INTO chapters (book_id, n, title) VALUES (%s, %s, %s)
               ON CONFLICT (book_id, n) DO NOTHING""",
            (book_id, n, f"Chapter {first_chapter + n - 1}"),
        )
    failed: list[str] = []
    done = 0
    for n, mp3, timing in chapters:
        if limit is not None and done >= limit:
            say(f"stopping after {limit} (--limit); run again to continue")
            break
        existing = db.one("SELECT * FROM chapters WHERE book_id = %s AND n = %s", (book_id, n))
        size = mp3.stat().st_size
        if (
            existing
            and existing["status"] == "ready"
            and existing["telegram_audio_file_id"]
            and existing["bytes"] == size
        ):
            continue
        try:
            await _import_one(deps, book_id, n, f"Chapter {first_chapter + n - 1}", mp3, timing)
        except (TelegramError, ValueError, RuntimeError, OSError, json.JSONDecodeError) as exc:
            failed.append(f"chapter {n}: {exc}")
            say(f"  chapter {n} FAILED: {exc}")
            continue
        done += 1
        say(f"  chapter {n}/{len(chapters)} uploaded")
    with db.tx() as conn:
        refresh_totals(conn, book_id)
        conn.execute(
            """UPDATE books SET status = 'published' WHERE id = %s AND status = 'draft'
                 AND NOT EXISTS (SELECT 1 FROM chapters WHERE book_id = %s AND status <> 'ready')
                 AND EXISTS (SELECT 1 FROM chapters WHERE book_id = %s)""",
            (book_id, book_id, book_id),
        )
    state = db.one("SELECT status FROM books WHERE id = %s", (book_id,))["status"]  # type: ignore[index]
    say(f"{done} uploaded this run, {len(failed)} failed; book is {state}")
    return not failed


async def _import_one(
    deps: Deps, book_id: str, n: int, title: str, mp3: Path, timing: Path
) -> None:
    new_timing = audio.timing_bytes(convert_timing(json.loads(timing.read_text("utf-8"))))
    duration = audio.ffprobe_length(mp3)
    audio_key, timing_key = chapter_keys(book_id, n)
    sentence_count = len(json.loads(new_timing)["sentences"])
    tmp = deps.tmp_base / f"import-{book_id}-{n}"
    tmp.mkdir(parents=True, exist_ok=True)
    try:
        converted = tmp / "chapter.timing.json"
        converted.write_bytes(new_timing)
        # the library folder is the real backup, so the copy is made before anything is uploaded
        sha = deps.store.put_file(audio_key, mp3, "audio/mpeg")
        deps.store.put_file(timing_key, converted, "application/json")
        if sha != sha256_file(mp3):
            raise RuntimeError("the copy in the library folder does not match the original")
        audio_sent, timing_sent = await send_chapter(deps, book_id, n, title, mp3, converted)
        mark_ready(
            deps,
            book_id,
            n,
            dict(
                duration_s=round(duration, 2),
                bytes=mp3.stat().st_size,
                sentence_count=sentence_count,
                audio_sha256=sha,
                audio_key=audio_key,
                timing_key=timing_key,
                input_hash="imported",
                **telegram_fields(audio_sent, timing_sent),
            ),
        )
    finally:
        for f in tmp.glob("*"):
            f.unlink()
        tmp.rmdir()
