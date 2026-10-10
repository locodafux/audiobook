"""Settings from .env.dev / .env.prod (dev is the default; prod needs --prod)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

GENERATOR_DIR = Path(__file__).resolve().parents[2]

REQUIRED = (
    "SUPABASE_URL",
    "SUPABASE_DB_URL",
    "SUPABASE_SERVICE_KEY",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_BACKUP_CHAT_ID",
)


class ConfigError(Exception):
    pass


def parse_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        out[key.strip().removeprefix("export ").strip()] = value
    return out


def load_env(prod: bool, env_dir: Path = GENERATOR_DIR) -> dict[str, str]:
    """File values first, then real environment variables win (handy in CI)."""
    path = env_dir / (".env.prod" if prod else ".env.dev")
    env = parse_env_file(path) if path.is_file() else {}
    env.update({k: v for k, v in os.environ.items() if k in KNOWN})
    return {k: v for k, v in env.items() if v != ""}


@dataclass(frozen=True)
class Settings:
    prod: bool
    supabase_url: str
    db_url: str
    service_key: str
    telegram_token: str
    telegram_chat_id: str
    telegram_proxy: str | None = None
    library_dir: str | None = (
        None  # the Mac's own copy of every file; default ~/.hearthread/library
    )
    voice: str = "en-US-BrianNeural"
    rate: str = "+0%"  # normal speed; the old generator used -5%
    volume: str = "+0%"
    chapter_concurrency: int = 4
    tts_chapter_concurrency: int = 20
    tts_max_retries: int = 5
    inviter: str | None = None

    @property
    def label(self) -> str:
        return "PROD" if self.prod else "DEV"

    @classmethod
    def from_env(cls, env: dict[str, str], prod: bool = False) -> Settings:
        missing = [n for n in REQUIRED if not env.get(n)]
        if missing:
            which = ".env.prod" if prod else ".env.dev"
            raise ConfigError(f"missing settings in {which}: {', '.join(missing)}")
        return cls(
            prod=prod,
            supabase_url=env["SUPABASE_URL"].rstrip("/"),
            db_url=env["SUPABASE_DB_URL"],
            service_key=env["SUPABASE_SERVICE_KEY"],
            telegram_token=env["TELEGRAM_BOT_TOKEN"],
            telegram_chat_id=env["TELEGRAM_BACKUP_CHAT_ID"],
            telegram_proxy=env.get("TELEGRAM_PROXY"),
            library_dir=env.get("HEARTHREAD_LIBRARY_DIR"),
            voice=env.get("TTS_VOICE", cls.voice),
            rate=env.get("TTS_RATE", cls.rate),
            volume=env.get("TTS_VOLUME", cls.volume),
            chapter_concurrency=int(env.get("CHAPTER_CONCURRENCY", cls.chapter_concurrency)),
            tts_chapter_concurrency=int(
                env.get("TTS_CHAPTER_CONCURRENCY", cls.tts_chapter_concurrency)
            ),
            tts_max_retries=int(env.get("TTS_MAX_RETRIES", cls.tts_max_retries)),
            inviter=env.get("HEARTHREAD_INVITER"),
        )


KNOWN = {
    *REQUIRED,
    "TELEGRAM_PROXY",
    "HEARTHREAD_LIBRARY_DIR",
    "TTS_VOICE",
    "TTS_RATE",
    "TTS_VOLUME",
    "CHAPTER_CONCURRENCY",
    "TTS_CHAPTER_CONCURRENCY",
    "TTS_MAX_RETRIES",
    "HEARTHREAD_INVITER",
}
