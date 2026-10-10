"""In-memory stand-ins for voice, library folder, Telegram and the EPUB parser. No network, no real audio."""

from __future__ import annotations

import hashlib
import shutil
import subprocess
from pathlib import Path

import pytest

from hearthread.book import Book, Chapter
from hearthread.settings import Settings
from hearthread.telegram import Sent, TelegramError

# `supabase start` default. Tests refuse to touch anything that is not a local database.
LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
needs_ffmpeg = pytest.mark.skipif(
    not (shutil.which("ffmpeg") and shutil.which("ffprobe")), reason="ffmpeg/ffprobe not installed"
)


def mk_settings(**over) -> Settings:
    base = dict(
        prod=False,
        supabase_url="http://127.0.0.1:54321",
        db_url=LOCAL_DB,
        service_key="k",
        telegram_token="t",
        telegram_chat_id="c",
        tts_chapter_concurrency=4,
        chapter_concurrency=2,
    )
    return Settings(**{**base, **over})


def make_mp3(dest: Path, seconds: float = 0.4) -> None:
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency=440:duration={seconds}",
            "-c:a",
            "libmp3lame",
            "-b:a",
            "48k",
            str(dest),
        ],
        check=True,
    )


class FakeVoice:
    """Copies one pre-made mp3 per sentence. `fail` = how many calls fail first (per text)."""

    def __init__(self, clip: Path, fail: dict[str, int] | None = None, always_fail: bool = False):
        self.clip, self.fail, self.always_fail = clip, dict(fail or {}), always_fail
        self.calls: list[str] = []

    async def synth(self, text: str, dest: Path) -> None:
        self.calls.append(text)
        if self.always_fail:
            raise RuntimeError("voice is down")
        if self.fail.get(text, 0) > 0:
            self.fail[text] -= 1
            raise RuntimeError("No audio was received")
        shutil.copyfile(self.clip, dest)


class FakeStore:
    def __init__(self) -> None:
        self.objects: dict[str, tuple[bytes, str]] = {}

    def check(self) -> None:
        pass

    def put_bytes(self, key: str, data: bytes, content_type: str) -> str:
        self.objects[key] = (data, content_type)
        return hashlib.sha256(data).hexdigest()

    def put_file(self, key: str, path: Path, content_type: str) -> str:
        return self.put_bytes(key, path.read_bytes(), content_type)

    def head(self, key: str) -> dict | None:
        if key not in self.objects:
            return None
        data = self.objects[key][0]
        return {"size": len(data), "sha256": hashlib.sha256(data).hexdigest()}

    def get_file(self, key: str, dest: Path) -> None:
        dest.write_bytes(self.objects[key][0])

    def delete_prefix(self, prefix: str) -> int:
        gone = [k for k in self.objects if k.startswith(prefix)]
        for k in gone:
            del self.objects[k]
        return len(gone)


class FakeBackup:
    def __init__(self, fail_times: int = 0, permanent: bool = False):
        self.sent: list[tuple[str, str]] = []
        self.fail_times, self.permanent = fail_times, permanent

    async def check(self) -> str:
        return "fake"

    async def send_document(self, path: Path, caption: str) -> Sent:
        if self.fail_times > 0:
            self.fail_times -= 1
            raise TelegramError("network down", permanent=self.permanent)
        self.sent.append((path.name, caption))
        n = len(self.sent)
        return Sent(1000 + n, f"file-id-{n}", f"unique-{n}")


def make_book(n_chapters: int = 3, sentences: int = 4, title: str = "Made Up Tale") -> Book:
    """Invented text only: tests never contain real book text."""
    return Book(
        title=title,
        author="A. Writer",
        chapters=[
            Chapter(
                title=f"Chapter {c}",
                sentences=[f"Sentence {s} of invented chapter {c}." for s in range(sentences)],
                source_ref=f"ch{c}.xhtml",
            )
            for c in range(1, n_chapters + 1)
        ],
        cover=b"\xff\xd8fake-jpeg",
        parser_version="test-1",
    )
