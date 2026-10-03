"""Builds small made-up EPUBs for the parser tests. No real book text is used or stored."""

from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass
from html import escape
from pathlib import Path

import pytest
from PIL import Image

from hearthread.epub import parse as _parse
from hearthread.epub.rules import GENERIC

XHTML = (
    '<?xml version="1.0" encoding="utf-8"?>'
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">'
    "<head><title>{title}</title></head><body{body_attrs}>{body}</body></html>"
)
CONTAINER = (
    '<?xml version="1.0"?>'
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
    '<rootfiles><rootfile full-path="OEBPS/content.opf" '
    'media-type="application/oebps-package+xml"/></rootfiles></container>'
)


def png_bytes(width: int, height: int, mode: str = "RGB") -> bytes:
    buf = io.BytesIO()
    Image.new(mode, (width, height), "red").save(buf, format="PNG")
    return buf.getvalue()


@dataclass
class Doc:
    """One spine document. ``body`` is inner HTML; pass ``raw`` to control the whole file."""

    name: str
    body: str = ""
    title: str = "Doc"
    body_attrs: str = ""
    raw: bytes | None = None

    def content(self) -> bytes:
        if self.raw is not None:
            return self.raw
        attrs = f" {self.body_attrs}" if self.body_attrs else ""
        return XHTML.format(title=escape(self.title), body=self.body, body_attrs=attrs).encode()


def chapter(name: str, heading: str, *paragraphs: str, tag: str = "h2") -> Doc:
    body = f"<{tag}>{escape(heading)}</{tag}>" + "".join(f"<p>{p}</p>" for p in paragraphs)
    return Doc(name, body, title=heading)


def build_epub(
    path: Path,
    docs: list[Doc],
    *,
    title: str | None = "Test Book",
    author: str | None = "Ann Author",
    language: str | None = "en",
    description: str | None = None,
    extra_meta: str = "",
    toc: list[tuple[str, str]] | None = None,
    cover: bytes | None = None,
    cover_name: str = "images/cover.png",
    extra_entries: dict[str, bytes] | None = None,
) -> Path:
    """Write an EPUB at ``path``; ``toc`` is [(href, title)] for the navigation file."""
    meta = ['<dc:identifier id="uid">made-up-id</dc:identifier>']
    if title is not None:
        meta.append(f"<dc:title>{escape(title)}</dc:title>")
    if author is not None:
        meta.append(f"<dc:creator>{escape(author)}</dc:creator>")
    if language is not None:
        meta.append(f"<dc:language>{language}</dc:language>")
    if description is not None:
        meta.append(f"<dc:description>{escape(description)}</dc:description>")
    manifest = [
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
    ]
    spine = []
    for i, doc in enumerate(docs):
        manifest.append(f'<item id="d{i}" href="{doc.name}" media-type="application/xhtml+xml"/>')
        spine.append(f'<itemref idref="d{i}"/>')
    if cover is not None:
        mime = "image/jpeg" if cover[:2] == b"\xff\xd8" else "image/png"
        meta.append('<meta name="cover" content="cover-img"/>')
        manifest.append(
            f'<item id="cover-img" href="{cover_name}" media-type="{mime}" '
            'properties="cover-image"/>'
        )
    opf = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">'
        f'<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">{"".join(meta)}{extra_meta}'
        "</metadata>"
        f"<manifest>{''.join(manifest)}</manifest><spine>{''.join(spine)}</spine></package>"
    )
    entries = toc if toc is not None else [(d.name, d.title) for d in docs]
    links = "".join(f'<li><a href="{escape(h)}">{escape(t)}</a></li>' for h, t in entries)
    nav = Doc(
        "nav.xhtml",
        f'<nav epub:type="toc"><ol>{links}</ol></nav>',
        title="Navigation",
    )
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        zf.writestr("META-INF/container.xml", CONTAINER)
        zf.writestr("OEBPS/content.opf", opf)
        zf.writestr("OEBPS/nav.xhtml", nav.content())
        for doc in docs:
            zf.writestr(f"OEBPS/{doc.name}", doc.content())
        if cover is not None:
            zf.writestr(f"OEBPS/{cover_name}", cover)
        for name, data in (extra_entries or {}).items():
            zf.writestr(zipfile.ZipInfo(name), data)
    return path


@dataclass
class Factory:
    tmp: Path
    # Test modules cannot import each other, so the helpers ride on the fixture.
    Doc = staticmethod(Doc)
    chapter = staticmethod(chapter)
    png = staticmethod(png_bytes)

    def build(self, docs: list[Doc], filename: str = "book.epub", **kwargs) -> Path:
        return build_epub(self.tmp / filename, docs, **kwargs)

    def parse(self, docs: list[Doc], filename: str = "book.epub", **kwargs):
        return _parse(self.build(docs, filename, **kwargs), rules=GENERIC)


@pytest.fixture
def epubs(tmp_path) -> Factory:
    return Factory(tmp_path)
