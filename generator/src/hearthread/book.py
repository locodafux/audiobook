"""What the generator needs from EPUB reading, plus small pure helpers.

EPUB reading itself lives in `hearthread.epub`. The generator works with the small `Book` below;
`default_parser` adapts the real parser's result to it, and tests pass a fake parser instead.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Chapter:
    title: str
    sentences: list[str]
    source_ref: str = ""  # stable identity inside the EPUB (file#anchor)
    error: str | None = None  # the parser could not read this chapter; its job fails with this


@dataclass
class Book:
    title: str
    author: str = ""
    language: str = "en"
    description: str = ""
    chapters: list[Chapter] = field(default_factory=list)
    cover: bytes | None = None  # JPEG, already shrunk by the parser
    parser_version: str = "0"
    series_title: str | None = None
    volume: int | None = None


Parser = Callable[[Path], Book]


def default_parser(path: Path) -> Book:
    from . import epub

    b = epub.parse(path)
    return Book(
        title=b.title,
        author=b.author or "",
        language=b.language,
        description=b.description or "",
        chapters=[Chapter(c.title, list(c.sentences), c.source_ref, c.error) for c in b.chapters],
        cover=b.cover,
        parser_version=epub.PARSER_VERSION,
        series_title=b.series,
        volume=b.volume,
    )


def text_sha256(sentences: list[str]) -> str:
    return hashlib.sha256("\n".join(sentences).encode("utf-8")).hexdigest()


def input_hash(parser_version: str, sentences: list[str], voice: str, rate: str) -> str:
    """Same text, parser, voice and rate => same audio, so the job can be skipped."""
    text = "\n".join(sentences)
    return hashlib.sha256(f"{parser_version}|{text}|{voice}|{rate}".encode()).hexdigest()


def slugify(title: str, limit: int = 40) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:limit].strip("-")
    return s or "book"


def parse_range(spec: str | None, total: int) -> list[int]:
    """'3-5,9' -> [3, 4, 5, 9]; None -> every chapter. Raises ValueError when out of range."""
    if not spec:
        return list(range(1, total + 1))
    out: set[int] = set()
    for part in spec.split(","):
        lo, _, hi = part.strip().partition("-")
        a, b = int(lo), int(hi or lo)
        if a < 1 or b < a or b > total:
            raise ValueError(f"chapter range {part!r} is outside 1-{total}")
        out.update(range(a, b + 1))
    return sorted(out)


def chapter_keys(book_id: str, n: int) -> tuple[str, str]:
    return f"books/{book_id}/ch-{n:04d}.mp3", f"books/{book_id}/ch-{n:04d}.timing.json"


def cover_key(book_id: str) -> str:
    return f"books/{book_id}/cover.jpg"


def source_key(book_id: str) -> str:
    return f"sources/{book_id}.epub"
