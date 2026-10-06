"""Everything the worker and commands talk to, in one bundle so tests can swap in fakes."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .book import Parser, default_parser
from .db import Db
from .settings import Settings
from .store import LocalStore, Store
from .telegram import Backup, Telegram
from .voice import EdgeVoice, Voice


@dataclass
class Deps:
    settings: Settings
    db: Db
    store: Store
    backup: Backup
    voice: Voice
    tmp_base: Path
    state_dir: Path
    parse: Parser = default_parser


def state_dir() -> Path:
    return Path.home() / ".hearthread"


def build(settings: Settings) -> Deps:
    s = settings
    home = state_dir()
    return Deps(
        settings=s,
        db=Db(s.db_url, max_size=s.chapter_concurrency + 4),
        store=LocalStore(Path(s.library_dir) if s.library_dir else home / "library"),
        backup=Telegram(s.telegram_token, s.telegram_chat_id, proxy=s.telegram_proxy),
        voice=EdgeVoice(
            s.voice,
            s.rate,
            s.volume,
            s.tts_max_retries,
            concurrency=s.chapter_concurrency * s.tts_chapter_concurrency,
        ),
        tmp_base=home / "tmp",
        state_dir=home,
    )
