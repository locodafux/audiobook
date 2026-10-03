"""Thin Postgres wrapper. Sync on purpose; async code calls it through asyncio.to_thread."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool


class Db:
    def __init__(self, url: str, max_size: int = 8) -> None:
        # prepare_threshold=None: safe behind any pooler (the 6543 pooler breaks prepared statements)
        self._pool = ConnectionPool(
            url,
            min_size=1,
            max_size=max_size,
            kwargs={"row_factory": dict_row, "prepare_threshold": None},
            open=False,
        )

    def _open(self) -> None:
        if self._pool.closed:
            self._pool.open(wait=True, timeout=30)

    @contextmanager
    def tx(self) -> Iterator[psycopg.Connection]:
        """One transaction: commits on success, rolls back on error."""
        self._open()
        with self._pool.connection() as conn:
            yield conn

    def q(self, sql: str, params: Any = None) -> list[dict[str, Any]]:
        with self.tx() as conn:
            cur = conn.execute(sql, params)
            return cur.fetchall() if cur.description else []

    def one(self, sql: str, params: Any = None) -> dict[str, Any] | None:
        rows = self.q(sql, params)
        return rows[0] if rows else None

    def x(self, sql: str, params: Any = None) -> int:
        with self.tx() as conn:
            return conn.execute(sql, params).rowcount

    def close(self) -> None:
        if not self._pool.closed:
            self._pool.close()
