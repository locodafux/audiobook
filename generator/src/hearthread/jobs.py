"""The Postgres job queue (plan section 6).

Every state change is saved in the database. Claims last 5 minutes and are extended by a
heartbeat; a sweep returns expired claims to the queue; failures back off 30 s * 2^attempts
and become `failed` (reason stored) after max_attempts. Every write is guarded by `locked_by`
so a worker whose claim expired cannot overwrite the job's new owner.
"""

from __future__ import annotations

from typing import Any

from .db import Db

LEASE_S = 300
HEARTBEAT_S = 60
BACKOFF_BASE_S = 30

Job = dict[str, Any]


def enqueue(db: Db, book_id: str, chapter_n: int, kind: str = "chapter", delay_s: int = 0) -> bool:
    """False when an active (queued/running) job for this chapter+kind already exists."""
    return bool(
        db.x(
            """INSERT INTO jobs (book_id, chapter_n, kind, run_after)
               VALUES (%s, %s, %s, now() + make_interval(secs => %s))
               ON CONFLICT DO NOTHING""",
            (book_id, chapter_n, kind, delay_s),
        )
    )


def claim(db: Db, worker_id: str, lease_s: int = LEASE_S) -> Job | None:
    return db.one(
        """UPDATE jobs SET status = 'running', locked_by = %(w)s, attempts = attempts + 1,
               locked_until = now() + make_interval(secs => %(lease)s), started_at = now()
           WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND run_after <= now()
                       ORDER BY book_id, chapter_n, kind FOR UPDATE SKIP LOCKED LIMIT 1)
           RETURNING *""",
        {"w": worker_id, "lease": lease_s},
    )


def heartbeat(db: Db, job_id: Any, worker_id: str, lease_s: int = LEASE_S) -> bool:
    """False means the claim was lost (expired and swept); the worker must stop the job."""
    return bool(
        db.x(
            """UPDATE jobs SET locked_until = now() + make_interval(secs => %s)
               WHERE id = %s AND locked_by = %s AND status = 'running'""",
            (lease_s, job_id, worker_id),
        )
    )


def complete(db: Db, job_id: Any, worker_id: str) -> bool:
    return bool(
        db.x(
            """UPDATE jobs SET status = 'done', finished_at = now(), error = NULL,
                   locked_by = NULL, locked_until = NULL
               WHERE id = %s AND locked_by = %s AND status = 'running'""",
            (job_id, worker_id),
        )
    )


def fail(db: Db, job: Job, worker_id: str, error: str, permanent: bool = False) -> str | None:
    """Back off and requeue, or mark failed. Returns the new status (None if claim was lost)."""
    row = db.one(
        """UPDATE jobs SET error = %(err)s, locked_by = NULL, locked_until = NULL,
               status = CASE WHEN %(perm)s OR attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
               finished_at = CASE WHEN %(perm)s OR attempts >= max_attempts THEN now() END,
               run_after = now() + make_interval(secs => %(base)s * power(2, attempts))
           WHERE id = %(id)s AND locked_by = %(w)s AND status = 'running'
           RETURNING status""",
        {
            "err": error[:2000],
            "perm": permanent,
            "base": BACKOFF_BASE_S,
            "id": job["id"],
            "w": worker_id,
        },
    )
    return row["status"] if row else None


def release(db: Db, job_id: Any, worker_id: str) -> None:
    """Give a claim back untouched (worker shutting down): not a failure, so no attempt is spent."""
    db.x(
        """UPDATE jobs SET status = 'queued', locked_by = NULL, locked_until = NULL,
               attempts = greatest(attempts - 1, 0), run_after = now()
           WHERE id = %s AND locked_by = %s AND status = 'running'""",
        (job_id, worker_id),
    )


def sweep(db: Db) -> int:
    """Expired claims (worker crashed, Mac slept) go back to the queue, or fail if out of tries."""
    return db.x(
        """UPDATE jobs SET locked_by = NULL, locked_until = NULL,
               status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
               finished_at = CASE WHEN attempts >= max_attempts THEN now() END,
               error = 'claim expired (worker crashed or the Mac slept)',
               run_after = now()
           WHERE status = 'running' AND locked_until < now()"""
    )


def pending_count(db: Db) -> int:
    row = db.one("SELECT count(*) AS n FROM jobs WHERE status IN ('queued', 'running')")
    return int(row["n"]) if row else 0


def sync_chapter_failures(db: Db) -> int:
    """Chapters whose only job ended `failed` show as failed (never touches a ready chapter)."""
    return db.x(
        """UPDATE chapters c SET status = 'failed'
           WHERE c.status = 'pending'
             AND EXISTS (SELECT 1 FROM jobs j WHERE j.kind = 'chapter' AND j.status = 'failed'
                         AND j.book_id = c.book_id AND j.chapter_n = c.n)
             AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.kind = 'chapter'
                             AND j.status IN ('queued', 'running')
                             AND j.book_id = c.book_id AND j.chapter_n = c.n)"""
    )
