"""One chapter job (plan section 6): fetch EPUB, speak, join, upload, verify, ready, back up, wipe."""

from __future__ import annotations

import asyncio
import logging
import shutil
from pathlib import Path
from typing import Any

from . import audio, jobs
from .book import Book, chapter_keys, input_hash, source_key, text_sha256
from .deps import Deps
from .telegram import TelegramError

log = logging.getLogger("hearthread")


class PermanentError(Exception):
    """Retrying cannot help (changed text, missing rows): the job fails at once."""


class BookCache:
    """Keeps the last parsed book in memory so a 1,300-chapter book is parsed once per run,
    not once per job. Memory only: nothing is kept on disk between chapters."""

    def __init__(self) -> None:
        self._key: tuple[str, str] | None = None
        self._book: Book | None = None
        self._lock = asyncio.Lock()

    async def get(self, deps: Deps, book_row: dict[str, Any]) -> Book:
        key = (book_row["id"], book_row["source_sha256"])
        async with self._lock:
            if self._key != key or self._book is None:
                self._book = await fetch_and_parse(deps, book_row)
                self._key = key
            return self._book


async def fetch_and_parse(deps: Deps, book_row: dict[str, Any]) -> Book:
    tmp = deps.tmp_base / f"epub-{book_row['id']}"
    tmp.mkdir(parents=True, exist_ok=True)
    try:
        path = tmp / "source.epub"
        await asyncio.to_thread(
            deps.store.get_file, book_row["source_key"] or source_key(book_row["id"]), path
        )
        return await asyncio.to_thread(deps.parse, path)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


async def run_job(deps: Deps, job: jobs.Job, cache: BookCache) -> None:
    if job["kind"] == "backup":
        await backup_job(deps, job)
    else:
        await chapter_job(deps, job, cache)


async def chapter_job(deps: Deps, job: jobs.Job, cache: BookCache) -> None:
    db, s = deps.db, deps.settings
    book_id, n = job["book_id"], job["chapter_n"]
    book = await asyncio.to_thread(db.one, "SELECT * FROM books WHERE id = %s", (book_id,))
    ch = await asyncio.to_thread(
        db.one, "SELECT * FROM chapters WHERE book_id = %s AND n = %s", (book_id, n)
    )
    if not book or not ch:
        raise PermanentError(f"{book_id} chapter {n} no longer exists")

    parsed = await cache.get(deps, book)
    if n > len(parsed.chapters):
        raise PermanentError(f"EPUB has {len(parsed.chapters)} chapters, no chapter {n}")
    chapter = parsed.chapters[n - 1]
    if chapter.error:
        raise PermanentError(f"the EPUB reader could not read this chapter: {chapter.error}")
    sentences = chapter.sentences
    if not sentences:
        raise PermanentError("chapter has no text")
    if ch["text_sha256"] and ch["text_sha256"] != text_sha256(sentences):
        raise PermanentError(
            "chapter text no longer matches what `add` recorded (parser or EPUB changed); "
            "run `hearthread regen` to re-read the book"
        )

    voice, rate = book["voice"] or s.voice, book["rate"] or s.rate
    ihash = input_hash(book["parser_version"] or parsed.parser_version, sentences, voice, rate)
    audio_key, timing_key = chapter_keys(book_id, n)

    # Idempotent: already ready with the same inputs and both objects present => nothing to do.
    if ch["status"] == "ready" and ch["input_hash"] == ihash:
        a, t = await asyncio.gather(
            asyncio.to_thread(deps.store.head, audio_key),
            asyncio.to_thread(deps.store.head, timing_key),
        )
        if a and t and a["size"] == ch["bytes"]:
            log.info("%s ch %d already ready, skipping", book_id, n)
            if ch["backup_status"] != "done":
                await asyncio.to_thread(jobs.enqueue, db, book_id, n, "backup")
            return

    tmp = deps.tmp_base / f"job-{job['id']}"
    tmp.mkdir(parents=True, exist_ok=True)
    try:
        sem = asyncio.Semaphore(s.tts_chapter_concurrency)
        clips = [tmp / f"s{i:05d}.mp3" for i in range(len(sentences))]

        async def speak(i: int) -> None:
            async with sem:
                await deps.voice.synth(sentences[i], clips[i])

        async with asyncio.TaskGroup() as tg:  # first failure cancels the rest
            for i in range(len(sentences)):
                tg.create_task(speak(i))

        lengths = [audio.mp3_length(c) for c in clips]
        mp3 = tmp / "chapter.mp3"
        await asyncio.to_thread(audio.concat_mp3, clips, mp3)
        duration = await asyncio.to_thread(audio.check_join, mp3, lengths)
        timing = tmp / "chapter.timing.json"
        timing.write_bytes(audio.timing_bytes(audio.build_timing(sentences, lengths)))
        for c in clips:
            c.unlink()

        sha = await asyncio.to_thread(deps.store.put_file, audio_key, mp3, "audio/mpeg")
        await asyncio.to_thread(deps.store.put_file, timing_key, timing, "application/json")

        await asyncio.to_thread(
            mark_ready,
            deps,
            book_id,
            n,
            dict(
                duration_s=round(duration, 2),
                bytes=mp3.stat().st_size,
                sentence_count=len(sentences),
                audio_sha256=sha,
                audio_key=audio_key,
                timing_key=timing_key,
                input_hash=ihash,
            ),
        )
        log.info("%s ch %d ready (%.0fs)", book_id, n, duration)

        try:  # a Telegram failure never un-readies the chapter
            await send_backup(deps, book_id, n, ch["title"], mp3, timing)
        except (TelegramError, OSError) as exc:
            log.warning("%s ch %d backup failed: %s", book_id, n, exc)
            await asyncio.to_thread(
                db.x,
                "UPDATE chapters SET backup_status = 'failed' WHERE book_id = %s AND n = %s",
                (book_id, n),
            )
            await asyncio.to_thread(jobs.enqueue, db, book_id, n, "backup", 60)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def mark_ready(deps: Deps, book_id: str, n: int, f: dict[str, Any]) -> None:
    """Flip the chapter to ready, refresh the book totals, auto-publish when it was the last one."""
    with deps.db.tx() as conn:
        conn.execute(
            """UPDATE chapters SET status = 'ready', duration_s = %(duration_s)s, bytes = %(bytes)s,
                   sentence_count = %(sentence_count)s, audio_sha256 = %(audio_sha256)s,
                   audio_key = %(audio_key)s, timing_key = %(timing_key)s, input_hash = %(input_hash)s,
                   backup_status = 'none', telegram_audio_msg = NULL, telegram_timing_msg = NULL
               WHERE book_id = %(b)s AND n = %(n)s""",
            {**f, "b": book_id, "n": n},
        )
        refresh_totals(conn, book_id)
        # ponytail: unpublish sets draft, so a later regen finishing re-publishes the book
        conn.execute(
            """UPDATE books SET status = 'published' WHERE id = %s AND status = 'draft'
                 AND NOT EXISTS (SELECT 1 FROM chapters WHERE book_id = %s AND status <> 'ready')""",
            (book_id, book_id),
        )


def refresh_totals(conn: Any, book_id: str) -> None:
    conn.execute(
        """UPDATE books SET chapter_count = s.n, total_duration_s = s.d, total_bytes = s.b
           FROM (SELECT count(*) AS n,
                        coalesce(sum(duration_s) FILTER (WHERE status = 'ready'), 0) AS d,
                        coalesce(sum(bytes) FILTER (WHERE status = 'ready'), 0) AS b
                 FROM chapters WHERE book_id = %s) s
           WHERE books.id = %s""",
        (book_id, book_id),
    )


async def send_backup(
    deps: Deps, book_id: str, n: int, title: str, mp3: Path, timing: Path
) -> None:
    """Send audio then timings to Telegram; raises TelegramError on failure."""
    label = f"{book_id} ch {n:04d} {title}"
    a = await deps.backup.send_document(mp3, label)
    t = await deps.backup.send_document(timing, label + " (timings)")
    await asyncio.to_thread(
        deps.db.x,
        """UPDATE chapters SET backup_status = 'done', telegram_audio_msg = %s, telegram_timing_msg = %s
           WHERE book_id = %s AND n = %s""",
        (a, t, book_id, n),
    )


async def backup_job(deps: Deps, job: jobs.Job) -> None:
    """Re-send a chapter's Telegram backup, taken from R2."""
    book_id, n = job["book_id"], job["chapter_n"]
    ch = await asyncio.to_thread(
        deps.db.one, "SELECT * FROM chapters WHERE book_id = %s AND n = %s", (book_id, n)
    )
    if not ch or ch["status"] != "ready":
        raise PermanentError(f"{book_id} chapter {n} is not ready, nothing to back up")
    tmp = deps.tmp_base / f"job-{job['id']}"
    tmp.mkdir(parents=True, exist_ok=True)
    try:
        mp3, timing = tmp / "chapter.mp3", tmp / "chapter.timing.json"
        await asyncio.to_thread(deps.store.get_file, ch["audio_key"], mp3)
        await asyncio.to_thread(deps.store.get_file, ch["timing_key"], timing)
        try:
            await send_backup(deps, book_id, n, ch["title"], mp3, timing)
        except TelegramError as exc:
            if exc.permanent:
                raise PermanentError(str(exc)) from exc
            raise
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
