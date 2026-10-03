"""The Postgres job queue, against the local database."""

from __future__ import annotations

import threading

from hearthread import jobs


def seed(db, n=3, book="b"):
    db.x("INSERT INTO books (id, title, status) VALUES (%s, 't', 'draft')", (book,))
    for i in range(1, n + 1):
        db.x("INSERT INTO chapters (book_id, n, title) VALUES (%s, %s, 'c')", (book, i))
        jobs.enqueue(db, book, i)


def row(db, n, kind="chapter"):
    return db.one(
        "SELECT * FROM jobs WHERE chapter_n = %s AND kind = %s ORDER BY started_at", (n, kind)
    )


def test_enqueue_is_idempotent(db):
    seed(db, 1)
    assert jobs.enqueue(db, "b", 1) is False  # adding twice cannot double the work
    assert db.one("SELECT count(*) AS n FROM jobs")["n"] == 1


def test_claim_in_order_and_sets_lease(db):
    seed(db, 3)
    j = jobs.claim(db, "w1")
    assert (j["chapter_n"], j["status"], j["attempts"], j["locked_by"]) == (1, "running", 1, "w1")
    lease = db.one(
        "SELECT extract(epoch FROM locked_until - now()) AS s FROM jobs WHERE id = %s", (j["id"],)
    )
    assert 290 < float(lease["s"]) <= 300


def test_concurrent_workers_never_share_a_job(db):
    seed(db, 12)
    got, lock = [], threading.Lock()

    def work(name):
        while (j := jobs.claim(db, name)) is not None:
            with lock:
                got.append(j["chapter_n"])

    ts = [threading.Thread(target=work, args=(f"w{i}",)) for i in range(4)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sorted(got) == list(range(1, 13))  # each exactly once


def test_run_after_is_respected(db):
    seed(db, 1)
    db.x("UPDATE jobs SET run_after = now() + interval '1 hour'")
    assert jobs.claim(db, "w") is None


def test_heartbeat_extends_and_detects_lost_claim(db):
    seed(db, 1)
    j = jobs.claim(db, "w1", lease_s=10)
    assert jobs.heartbeat(db, j["id"], "w1", lease_s=300)
    assert not jobs.heartbeat(db, j["id"], "someone-else")
    db.x("UPDATE jobs SET locked_until = now() - interval '1 second'")
    assert jobs.sweep(db) == 1
    assert not jobs.heartbeat(db, j["id"], "w1")  # swept: the worker learns it lost the claim


def test_sweep_requeues_expired_claim_and_fails_when_out_of_tries(db):
    seed(db, 1)
    jobs.claim(db, "w1")
    db.x("UPDATE jobs SET locked_until = now() - interval '1 second'")
    assert jobs.sweep(db) == 1
    assert row(db, 1)["status"] == "queued"
    for _ in range(2):  # attempts 2 and 3, each crashing
        jobs.claim(db, "w1")
        db.x("UPDATE jobs SET locked_until = now() - interval '1 second'")
        jobs.sweep(db)
    j = row(db, 1)
    assert j["status"] == "failed" and "expired" in j["error"]


def test_failure_backs_off_30s_times_2_to_attempts_then_fails_with_reason(db):
    seed(db, 1)
    expected = [60, 120]  # 30 * 2^1, 30 * 2^2
    for wait in expected:
        j = jobs.claim(db, "w")
        assert jobs.fail(db, j, "w", "boom") == "queued"
        s = db.one("SELECT extract(epoch FROM run_after - now()) AS s, error FROM jobs")
        assert wait - 3 < float(s["s"]) <= wait and s["error"] == "boom"
        db.x("UPDATE jobs SET run_after = now()")
    j = jobs.claim(db, "w")
    assert j["attempts"] == 3
    assert jobs.fail(db, j, "w", "still broken") == "failed"
    done = row(db, 1)
    assert (done["status"], done["error"]) == ("failed", "still broken") and done["finished_at"]
    assert jobs.claim(db, "w") is None


def test_permanent_failure_skips_retries(db):
    seed(db, 1)
    j = jobs.claim(db, "w")
    assert jobs.fail(db, j, "w", "chapter text changed", permanent=True) == "failed"


def test_guarded_writes_ignore_a_worker_that_lost_its_claim(db):
    seed(db, 1)
    j = jobs.claim(db, "w1")
    assert jobs.complete(db, j["id"], "intruder") is False
    assert jobs.fail(db, j, "intruder", "x") is None
    assert jobs.complete(db, j["id"], "w1") is True
    assert row(db, 1)["status"] == "done"


def test_release_does_not_spend_an_attempt(db):
    seed(db, 1)
    j = jobs.claim(db, "w")
    jobs.release(db, j["id"], "w")
    r = row(db, 1)
    assert (r["status"], r["attempts"]) == ("queued", 0)
    assert jobs.claim(db, "w")["attempts"] == 1


def test_done_job_does_not_block_a_new_one(db):
    seed(db, 1)
    j = jobs.claim(db, "w")
    jobs.complete(db, j["id"], "w")
    assert jobs.enqueue(db, "b", 1) is True  # e.g. regen


def test_failed_chapters_are_marked_failed_unless_ready_or_requeued(db):
    seed(db, 3)
    for _ in range(3):
        j = jobs.claim(db, "w")
        jobs.fail(db, j, "w", "x", permanent=True)
    db.x("UPDATE chapters SET status = 'ready' WHERE n = 2")
    jobs.enqueue(db, "b", 3)  # a retry is already queued
    jobs.sync_chapter_failures(db)
    st = {r["n"]: r["status"] for r in db.q("SELECT n, status FROM chapters")}
    assert st == {1: "failed", 2: "ready", 3: "pending"}
