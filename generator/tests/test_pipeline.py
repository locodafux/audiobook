"""Whole chapter jobs and book commands with fakes for voice, library folder and Telegram (local database)."""

from __future__ import annotations

import asyncio
import json
from dataclasses import replace

import pytest

from fakes import FakeBackup, FakeVoice, make_book, needs_ffmpeg
from hearthread import jobs, library
from hearthread.library import CommandError, RenumberRefused
from hearthread.worker import WorkerBusy, run_worker, worker_lock

pytestmark = needs_ffmpeg


def run_once(deps, poll=0.05):
    asyncio.run(run_worker(deps, once=True, poll_s=poll))


def run_draining(deps):
    """Like run_once, but back-off waits are skipped so the test does not sit out real minutes."""

    async def go():
        t = asyncio.create_task(run_worker(deps, once=True, poll_s=0.05))
        while not t.done():
            await asyncio.sleep(0.05)
            await asyncio.to_thread(fast_backoff, deps.db)
        await t

    asyncio.run(go())


def chapters(db):
    return {r["n"]: r for r in db.q("SELECT * FROM chapters ORDER BY n")}


def fast_backoff(db):
    db.x("UPDATE jobs SET run_after = now() WHERE status = 'queued'")


def test_add_then_run_makes_every_chapter_ready_and_cleans_up(deps, epub):
    assert library.add(deps, epub, confirm=lambda m: True, say=lambda m: None) == "made-up-tale"
    b = deps.db.one("SELECT * FROM books")
    assert (b["status"], b["voice"], b["rate"]) == ("draft", "en-US-BrianNeural", "+0%")
    assert deps.db.one("SELECT count(*) AS n FROM jobs")["n"] == 3
    assert "sources/made-up-tale.epub" in deps.store.objects
    assert "books/made-up-tale/cover.jpg" in deps.store.objects

    run_once(deps)

    ch = chapters(deps.db)
    assert {c["status"] for c in ch.values()} == {"ready"}
    c1 = ch[1]
    assert c1["audio_key"] == "books/made-up-tale/ch-0001.mp3" and c1["bytes"] > 0
    assert c1["sentence_count"] == 4 and c1["telegram_audio_file_id"]
    assert len(deps.store.objects[c1["audio_key"]][0]) == c1["bytes"]
    timing = json.loads(deps.store.objects[c1["timing_key"]][0])
    assert timing["v"] == 1 and len(timing["sentences"]) == 4
    assert timing["sentences"][0]["s"] == 0.0
    assert timing["sentences"][-1]["e"] == pytest.approx(float(c1["duration_s"]), abs=0.3)
    # the last chapter made the book publish itself, with totals filled
    b = deps.db.one("SELECT * FROM books")
    total = sum(c["bytes"] for c in ch.values())
    assert (b["status"], b["chapter_count"], int(b["total_bytes"])) == ("published", 3, total)
    assert {j["status"] for j in deps.db.q("SELECT status FROM jobs")} == {"done"}
    # Telegram: epub + cover at add, then audio + timings per chapter
    assert len(deps.backup.sent) == 2 + 3 * 2
    assert not any(deps.tmp_base.iterdir())  # nothing left on the Mac


def test_add_twice_and_id_clash(deps, epub):
    library.add(deps, epub, say=lambda m: None)
    msgs = []
    assert library.add(deps, epub, say=msgs.append) is None and "already added" in msgs[0]
    other = epub.with_name("other.epub")
    other.write_bytes(b"different")
    with pytest.raises(CommandError, match="--id"):
        library.add(deps, other, say=lambda m: None)


def test_add_declined_changes_nothing(deps, epub):
    assert library.add(deps, epub, confirm=lambda m: False, say=lambda m: None) is None
    assert deps.db.one("SELECT count(*) AS n FROM books")["n"] == 0 and not deps.store.objects


def test_add_survives_telegram_outage(deps, epub):
    deps.backup = FakeBackup(fail_times=99)
    msgs = []
    assert library.add(deps, epub, say=msgs.append)
    assert any("Telegram copy" in m for m in msgs)


def test_failed_sentence_retries_whole_chapter_then_succeeds(deps, epub, clip):
    library.add(deps, epub, say=lambda m: None)
    deps.voice = FakeVoice(clip, fail={"Sentence 2 of invented chapter 2.": 1})
    run_draining(deps)  # chapter 2 fails once, backs off, then succeeds
    assert {c["status"] for c in chapters(deps.db).values()} == {"ready"}
    assert deps.db.one("SELECT attempts FROM jobs WHERE chapter_n = 2")["attempts"] == 2
    assert not any(deps.tmp_base.iterdir())


def test_chapter_fails_after_three_tries_with_reason_and_others_continue(deps, epub, clip):
    library.add(deps, epub, say=lambda m: None)
    deps.voice = FakeVoice(clip, fail={"Sentence 0 of invented chapter 2.": 99})
    run_draining(deps)
    ch = chapters(deps.db)
    assert (ch[1]["status"], ch[2]["status"], ch[3]["status"]) == ("ready", "failed", "ready")
    j = deps.db.one("SELECT * FROM jobs WHERE chapter_n = 2")
    assert j["status"] == "failed" and j["attempts"] == 3 and "No audio was received" in j["error"]
    assert deps.db.one("SELECT status FROM books")["status"] == "draft"  # not all ready
    assert "FAILED chapter made-up-tale#2" in library.status(deps)
    assert not any(deps.tmp_base.iterdir())

    # retry puts it back; with a healthy voice it completes and the book publishes itself
    deps.voice = FakeVoice(deps.voice.clip)
    assert library.retry(deps, "made-up-tale") == 1
    run_once(deps)
    assert chapters(deps.db)[2]["status"] == "ready"
    assert deps.db.one("SELECT status FROM books")["status"] == "published"


def test_telegram_is_a_hard_gate_before_a_chapter_is_ready(deps, epub):
    library.add(deps, epub, say=lambda m: None)
    deps.backup = FakeBackup(fail_times=999, permanent=True)  # every send fails
    run_draining(deps)
    ch = chapters(deps.db)
    assert {c["status"] for c in ch.values()} == {"failed"}  # nothing listenable without Telegram
    assert {c["telegram_audio_file_id"] for c in ch.values()} == {None}
    jb = deps.db.q("SELECT status, error FROM jobs WHERE kind = 'chapter'")
    assert len(jb) == 3 and all(
        j["status"] == "failed" and "network down" in j["error"] for j in jb
    )
    assert deps.db.one("SELECT status FROM books")["status"] == "draft"
    assert not any(deps.tmp_base.iterdir())

    deps.backup = FakeBackup()
    assert library.retry(deps, "made-up-tale") == 3
    run_draining(deps)
    assert {c["status"] for c in chapters(deps.db).values()} == {"ready"}
    assert deps.db.one("SELECT status FROM books")["status"] == "published"


def test_a_passing_telegram_outage_is_retried_not_failed(deps, epub):
    library.add(deps, epub, say=lambda m: None)
    deps.backup = FakeBackup(fail_times=2)  # not permanent: the job backs off and tries again
    run_draining(deps)
    assert {c["status"] for c in chapters(deps.db).values()} == {"ready"}


def test_chapter_records_where_telegram_holds_each_file(deps, epub):
    library.add(deps, epub, say=lambda m: None)
    run_once(deps)
    c1 = chapters(deps.db)[1]
    assert c1["telegram_audio_file_id"] and c1["telegram_timing_file_id"]
    assert c1["telegram_audio_file_id"] != c1["telegram_timing_file_id"]
    assert c1["telegram_audio_file_unique_id"] and c1["telegram_timing_file_unique_id"]
    assert c1["backup_status"] == "done" and c1["telegram_audio_msg"] >= 1000
    assert deps.db.one("SELECT cover_file_id FROM books")["cover_file_id"] == "file-id-2"


def test_upload_again_replaces_file_ids_from_the_library_folder(deps, epub):
    library.add(deps, epub, say=lambda m: None)
    run_once(deps)
    before = chapters(deps.db)[2]["telegram_audio_file_id"]
    assert library.backup_retry(deps) == 0  # nothing failed
    assert library.backup_retry(deps, everything=True) == 3  # Telegram lost the files
    sent = len(deps.backup.sent)
    run_draining(deps)
    assert len(deps.backup.sent) == sent + 6  # audio + timings, taken from the library folder
    after = chapters(deps.db)[2]
    assert after["telegram_audio_file_id"] != before and after["backup_status"] == "done"
    assert not any(deps.tmp_base.iterdir())


def test_idempotent_rerun_is_a_noop_and_unfinished_backup_is_queued(deps, epub, clip):
    library.add(deps, epub, say=lambda m: None)
    run_once(deps)
    calls = len(deps.voice.calls)
    jobs.enqueue(deps.db, "made-up-tale", 1)  # same inputs, objects exist
    run_once(deps)
    assert len(deps.voice.calls) == calls  # nothing re-spoken
    # lose an object: now it is not a no-op
    del deps.store.objects["books/made-up-tale/ch-0001.timing.json"]
    jobs.enqueue(deps.db, "made-up-tale", 1)
    run_once(deps)
    assert len(deps.voice.calls) == calls + 4
    assert "books/made-up-tale/ch-0001.timing.json" in deps.store.objects


def test_changed_text_fails_at_once_with_a_clear_reason(deps, epub):
    library.add(deps, epub, say=lambda m: None)
    deps.parse = lambda _p: make_book(sentences=5)  # parser now reads different text
    run_once(deps)
    j = deps.db.one("SELECT * FROM jobs WHERE chapter_n = 1")
    assert j["status"] == "failed" and j["attempts"] == 1 and "regen" in j["error"]


def test_cancel_removes_waiting_chapters(deps, epub):
    library.add(deps, epub, say=lambda m: None)
    assert "removed 3 waiting" in library.cancel(deps, "made-up-tale")
    run_once(deps)
    assert {c["status"] for c in chapters(deps.db).values()} == {"pending"}
    assert library.retry(deps, "made-up-tale", chapter=2) == 1  # cancelled chapters can come back


def test_publish_and_unpublish(deps, epub):
    library.add(deps, epub, say=lambda m: None)
    with pytest.raises(CommandError, match="not ready"):
        library.publish(deps, "made-up-tale")
    library.publish(deps, "made-up-tale", force=True)
    assert deps.db.one("SELECT status FROM books")["status"] == "published"
    library.unpublish(deps, "made-up-tale")
    assert deps.db.one("SELECT status FROM books")["status"] == "draft"


def test_regen_numbering_guard_refuses_then_accepts(deps, epub):
    library.add(deps, epub, say=lambda m: None)
    run_once(deps)
    before = chapters(deps.db)

    deps.parse = lambda _p: make_book(n_chapters=2)  # a chapter vanished: numbers would shift
    with pytest.raises(RenumberRefused, match="chapter count 3 -> 2"):
        library.regen(deps, "made-up-tale", say=lambda m: None)
    assert chapters(deps.db)[3]["status"] == "ready"  # nothing touched
    assert deps.db.one("SELECT count(*) AS n FROM jobs WHERE status = 'queued'")["n"] == 0

    library.regen(deps, "made-up-tale", accept_renumber=True, say=lambda m: None)
    assert set(chapters(deps.db)) == {1, 2}
    assert not any(k.startswith("books/made-up-tale/ch-0003") for k in deps.store.objects)
    assert (
        before[1]["input_hash"]
        and deps.db.one("SELECT input_hash FROM chapters WHERE n = 1")["input_hash"] is None
    )


def test_regen_same_list_remakes_only_requested_chapters(deps, epub):
    library.add(deps, epub, say=lambda m: None)
    run_once(deps)
    spoken = len(deps.voice.calls)
    library.regen(deps, "made-up-tale", chapters="2-3", say=lambda m: None)
    assert chapters(deps.db)[1]["status"] == "ready"  # still listenable while others redo
    run_once(deps)
    assert len(deps.voice.calls) == spoken + 8  # two chapters x four sentences
    with pytest.raises(CommandError, match="outside"):
        library.regen(deps, "made-up-tale", chapters="1-9", say=lambda m: None)


def test_remove_asks_twice_and_deletes_everything_in_the_library_and_db(deps, epub):
    library.add(deps, epub, say=lambda m: None)
    run_once(deps)
    answers = iter([True, False])
    assert (
        library.remove(deps, "made-up-tale", lambda m: next(answers), say=lambda m: None) is False
    )
    assert deps.db.one("SELECT count(*) AS n FROM books")["n"] == 1
    assert library.remove(deps, "made-up-tale", lambda m: True, say=lambda m: None) is True
    assert deps.store.objects == {}
    assert (
        deps.db.one(
            "SELECT (SELECT count(*) FROM books) + (SELECT count(*) FROM chapters) + (SELECT count(*) FROM jobs) AS n"
        )["n"]
        == 0
    )


def test_remove_refuses_while_a_chapter_is_running(deps, epub):
    library.add(deps, epub, say=lambda m: None)
    jobs.claim(deps.db, "w")
    with pytest.raises(CommandError, match="being worked on"):
        library.remove(deps, "made-up-tale", lambda m: True)


def test_status_for_unknown_book_and_empty(deps):
    assert "no books" in library.status(deps)
    with pytest.raises(CommandError):
        library.status(deps, "nope")


def test_status_shows_progress(deps, epub):
    library.add(deps, epub, say=lambda m: None)
    out = library.status(deps, "made-up-tale")
    assert "0/3 ready" in out and "3 waiting" in out
    run_once(deps)
    assert "3/3 ready" in library.status(deps)


def test_one_worker_lock_per_mac(tmp_path):
    with worker_lock(tmp_path), pytest.raises(WorkerBusy):
        with worker_lock(tmp_path):
            pass
    with worker_lock(tmp_path):  # free again after release
        pass


def test_crash_leftover_temp_is_wiped_when_the_worker_starts(deps, epub):
    leftover = deps.tmp_base / "job-crashed"
    leftover.mkdir(parents=True)
    (leftover / "s00001.mp3").write_bytes(b"x")
    run_once(deps)
    assert not leftover.exists()


def test_shutdown_releases_claims_so_nothing_waits_five_minutes(deps, epub, clip):
    library.add(deps, epub, say=lambda m: None)

    class Slow(FakeVoice):
        async def synth(self, text, dest):
            await asyncio.sleep(30)

    deps.voice = Slow(clip)

    async def go():
        stop = asyncio.Event()
        t = asyncio.create_task(run_worker(deps, poll_s=0.05, stop=stop))
        await asyncio.sleep(0.5)
        stop.set()
        await t

    asyncio.run(go())
    rows = deps.db.q("SELECT status, attempts, locked_by FROM jobs")
    assert {r["status"] for r in rows} == {"queued"} and {r["attempts"] for r in rows} == {0}
    assert not any(deps.tmp_base.iterdir())


def test_heartbeat_loss_abandons_the_job(deps, epub, clip):
    library.add(deps, epub, say=lambda m: None)
    deps.settings = replace(deps.settings, chapter_concurrency=1)

    class Slow(FakeVoice):
        async def synth(self, text, dest):
            await asyncio.sleep(30)

    deps.voice = Slow(clip)
    from hearthread.pipeline import BookCache
    from hearthread.worker import run_one

    async def go():
        job = await asyncio.to_thread(jobs.claim, deps.db, "w1")
        task = asyncio.create_task(run_one(deps, job, "w1", BookCache(), heartbeat_s=0.1))
        await asyncio.sleep(0.2)
        # another worker's sweep took the claim away
        await asyncio.to_thread(
            deps.db.x, "UPDATE jobs SET status='queued', locked_by=NULL WHERE id=%s", (job["id"],)
        )
        await asyncio.wait_for(task, 5)  # run_one returns instead of working on without a claim

    asyncio.run(go())
    assert not any(deps.tmp_base.iterdir())
