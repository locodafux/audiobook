"""Speaking: edge-tts, one mp3 per sentence, with retries and a global socket ceiling."""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Protocol


class Voice(Protocol):
    async def synth(self, text: str, dest: Path) -> None: ...


class EdgeVoice:
    """Cautious by default: the old tool saw throttling around 120 simultaneous requests."""

    def __init__(
        self,
        voice: str,
        rate: str = "+0%",
        volume: str = "+0%",
        max_retries: int = 5,
        concurrency: int = 80,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self.voice, self.rate, self.volume = voice, rate, volume
        self.max_retries = max(1, max_retries)
        self._sem = asyncio.Semaphore(concurrency)
        self._sleep = sleep

    async def _once(self, text: str, dest: Path) -> None:
        import edge_tts

        part = dest.with_suffix(".part")
        try:
            comm = edge_tts.Communicate(text, self.voice, rate=self.rate, volume=self.volume)
            with open(part, "wb") as fh:
                async for chunk in comm.stream():
                    if chunk["type"] == "audio":
                        fh.write(chunk["data"])
            if part.stat().st_size == 0:
                raise RuntimeError("edge-tts returned no audio")
            part.replace(dest)
        finally:
            with contextlib.suppress(FileNotFoundError):
                part.unlink()

    async def synth(self, text: str, dest: Path) -> None:
        async with self._sem:
            for attempt in range(self.max_retries):
                try:
                    return await self._once(text, dest)
                except Exception as exc:  # noqa: BLE001 - throttling shows up as many error types
                    if attempt == self.max_retries - 1:
                        raise RuntimeError(
                            f"speech failed after {self.max_retries} tries: {exc}"
                        ) from exc
                    await self._sleep(min(0.5 * 2**attempt, 15))
