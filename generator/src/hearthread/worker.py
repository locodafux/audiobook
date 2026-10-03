"""The worker: claims jobs, keeps their claims alive, records every outcome in the database."""

from __future__ import annotations

import asyncio
import contextlib
import fcntl
import logging
import os
import shutil
import signal
import socket
from collections.abc import Iterator
from pathlib import Path

from . import jobs
from .deps import Deps
from .pipeline import BookCache, PermanentError, run_job

log = logging.getLogger("hearthread")


class WorkerBusy(Exception):
    pass


@contextlib.contextmanager
def worker_lock(state_dir: Path) -> Iterator[None]:
    """One worker per Mac: an exclusive file lock the OS drops if the process dies."""
    state_dir.mkdir(parents=True, exist_ok=True)
    fh = open(state_dir / "worker.lock", "w")  # noqa: SIM115 - held for the whole run
    try:
        fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError as exc:
        fh.close()
        raise WorkerBusy("another hearthread worker is already running on this Mac") from exc
    try:
        yield
    finally:
        fcntl.flock(fh, fcntl.LOCK_UN)
        fh.close()


def wipe_tmp(tmp_base: Path) -> int:
    """Delete leftover temp folders (crash leftovers). Only call while holding the worker lock."""
    if not tmp_base.exists():
        return 0
    n = 0
    for child in tmp_base.iterdir():
        if child.is_dir():
            shutil.rmtree(child, ignore_errors=True)
        else:
            child.unlink(missing_ok=True)
        n += 1
    return n


def _reason(exc: BaseException) -> str:
    while isinstance(exc, BaseExceptionGroup):
        exc = exc.exceptions[0]
    return f"{type(exc).__name__}: {exc}"


def _is_permanent(exc: BaseException) -> bool:
    if isinstance(exc, BaseExceptionGroup):
        return any(_is_permanent(e) for e in exc.exceptions)
    return isinstance(exc, PermanentError)


async def _heartbeat(
    deps: Deps, job: jobs.Job, wid: str, work: asyncio.Future, lost: list[bool], every: float
) -> None:
    while True:
        await asyncio.sleep(every)
        try:
            ok = await asyncio.to_thread(jobs.heartbeat, deps.db, job["id"], wid)
        except Exception as exc:  # noqa: BLE001 - a DB blip must not kill the job; claim lasts 5 min
            log.warning("heartbeat failed: %s", exc)
            continue
        if not ok:
            lost.append(True)
            work.cancel()
            return


async def run_one(
    deps: Deps, job: jobs.Job, wid: str, cache: BookCache, heartbeat_s: float = jobs.HEARTBEAT_S
) -> None:
    db = deps.db
    tag = f"{job['kind']} {job['book_id']}#{job['chapter_n']}"
    work = asyncio.ensure_future(run_job(deps, job, cache))
    lost: list[bool] = []
    hb = asyncio.ensure_future(_heartbeat(deps, job, wid, work, lost, heartbeat_s))
    try:
        await work
        await asyncio.to_thread(jobs.complete, db, job["id"], wid)
    except asyncio.CancelledError:
        if lost:
            log.error("%s: claim lost, abandoning", tag)
            return
        await asyncio.shield(asyncio.to_thread(jobs.release, db, job["id"], wid))
        raise
    except Exception as exc:  # noqa: BLE001 - every failure is recorded, never swallowed
        reason = _reason(exc)
        status = await asyncio.to_thread(jobs.fail, db, job, wid, reason, _is_permanent(exc))
        log.error("%s failed (%s): %s", tag, status, reason)
        if status == "failed" and job["kind"] == "backup":
            await asyncio.to_thread(
                db.x,
                "UPDATE chapters SET backup_status = 'failed' WHERE book_id = %s AND n = %s",
                (job["book_id"], job["chapter_n"]),
            )
        await asyncio.to_thread(jobs.sync_chapter_failures, db)
    finally:
        hb.cancel()


async def run_worker(
    deps: Deps, once: bool = False, poll_s: float = 5.0, stop: asyncio.Event | None = None
) -> None:
    """Run until stopped (or, with once=True, until nothing is queued or running)."""
    stop = stop or asyncio.Event()
    wid = f"{socket.gethostname()}:{os.getpid()}"
    cache = BookCache()
    active: set[asyncio.Task] = set()
    limit = deps.settings.chapter_concurrency
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        with contextlib.suppress(NotImplementedError, RuntimeError, ValueError):
            loop.add_signal_handler(sig, stop.set)

    wipe_tmp(deps.tmp_base)  # crash leftovers
    try:
        while not stop.is_set():
            if await asyncio.to_thread(jobs.sweep, deps.db):
                await asyncio.to_thread(jobs.sync_chapter_failures, deps.db)
            while len(active) < limit and not stop.is_set():
                job = await asyncio.to_thread(jobs.claim, deps.db, wid)
                if not job:
                    break
                t = asyncio.create_task(run_one(deps, job, wid, cache))
                active.add(t)
                t.add_done_callback(active.discard)
            if once and not active and not await asyncio.to_thread(jobs.pending_count, deps.db):
                break
            if active:
                await asyncio.wait(active, timeout=poll_s, return_when=asyncio.FIRST_COMPLETED)
            else:
                # ponytail: polling, not LISTEN/NOTIFY; fine for one worker and minutes-long jobs
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(stop.wait(), poll_s)
    finally:
        for t in active:
            t.cancel()  # each releases its claim, so the next run picks it up straight away
        await asyncio.gather(*active, return_exceptions=True)
        wipe_tmp(deps.tmp_base)
