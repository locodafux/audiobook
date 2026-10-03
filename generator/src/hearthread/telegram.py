"""Telegram cold backup: documents to one private chat, rate limited, honouring retry_after."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Protocol

import httpx

BOT_UPLOAD_LIMIT = 50 * 1024 * 1024  # Bot API ceiling for sendDocument
MIN_INTERVAL_S = 3.1  # ~20 messages per minute per chat
PERMANENT = ("unauthorized", "chat not found", "bot was blocked", "forbidden", "file is too big")


class TelegramError(RuntimeError):
    def __init__(self, message: str, retry_after: float | None = None, permanent: bool = False):
        super().__init__(message)
        self.retry_after = retry_after
        self.permanent = permanent


class Backup(Protocol):
    async def send_document(self, path: Path, caption: str) -> int: ...
    async def check(self) -> str: ...


class Telegram:
    def __init__(
        self,
        token: str,
        chat_id: str,
        proxy: str | None = None,
        max_retries: int = 5,
        min_interval: float = MIN_INTERVAL_S,
        transport: httpx.AsyncBaseTransport | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.chat_id = chat_id
        self.max_retries = max(1, max_retries)
        self.min_interval = min_interval
        self._base = f"https://api.telegram.org/bot{token}"
        self._http = httpx.AsyncClient(timeout=180, proxy=proxy, transport=transport)
        self._sleep, self._clock = sleep, clock
        self._lock = asyncio.Lock()  # one send at a time keeps us under the chat rate limit
        self._last = float("-inf")

    async def aclose(self) -> None:
        await self._http.aclose()

    @staticmethod
    def _unwrap(method: str, resp: httpx.Response):
        try:
            data = resp.json()
        except ValueError as exc:
            raise TelegramError(f"{method}: HTTP {resp.status_code}, not JSON") from exc
        if data.get("ok"):
            return data["result"]
        desc = str(data.get("description", data))
        retry = (data.get("parameters") or {}).get("retry_after")
        raise TelegramError(
            f"{method} failed: {desc}",
            retry_after=float(retry) if retry else None,
            permanent=any(m in desc.lower() for m in PERMANENT),
        )

    async def check(self) -> str:
        me = self._unwrap("getMe", await self._http.get(f"{self._base}/getMe"))
        chat = self._unwrap(
            "getChat",
            await self._http.get(f"{self._base}/getChat", params={"chat_id": self.chat_id}),
        )
        return f"bot @{me.get('username', '?')} -> chat {chat.get('title') or chat.get('id')}"

    async def send_document(self, path: Path, caption: str) -> int:
        """Returns the Telegram message id. Raises TelegramError (permanent flag set when useless to retry)."""
        if path.stat().st_size > BOT_UPLOAD_LIMIT:
            raise TelegramError(f"{path.name} is over the 50 MB bot limit", permanent=True)
        async with self._lock:
            last: Exception | None = None
            for attempt in range(self.max_retries):
                wait = self._last + self.min_interval - self._clock()
                if wait > 0:
                    await self._sleep(wait)
                delay = 0.5 * 2**attempt
                try:
                    with open(path, "rb") as fh:  # reopened per try so a retry rewinds
                        resp = await self._http.post(
                            f"{self._base}/sendDocument",
                            data={"chat_id": self.chat_id, "caption": caption[:1000]},
                            files={"document": (path.name, fh)},
                        )
                    self._last = self._clock()
                    return int(self._unwrap("sendDocument", resp)["message_id"])
                except TelegramError as exc:
                    self._last = self._clock()
                    if exc.permanent:
                        raise
                    last, delay = exc, exc.retry_after or delay
                except httpx.HTTPError as exc:
                    last = exc
                if attempt < self.max_retries - 1:
                    await self._sleep(delay)
            raise TelegramError(f"sendDocument failed after {self.max_retries} tries: {last}")
