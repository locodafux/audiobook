"""Read an EPUB into book metadata, a cover and a chapter list. Pure: no network, no database."""

from __future__ import annotations

import hashlib
import io
import re
import warnings
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from urllib.parse import unquote

import ebooklib
from bs4 import BeautifulSoup, Comment, NavigableString, XMLParsedAsHTMLWarning
from ebooklib import epub
from PIL import Image

from .rules import EpubError, Rules, load_rules
from .text import accent_key, clean, hard_cut, split_sentences

# Bump when the same EPUB could produce different chapters or sentences. It feeds each
# chapter's input_hash, so a bump makes every chapter regenerate.
PARSER_VERSION = "1"

COVER_MAX_PX = 600
COVER_JPEG_QUALITY = 82
TITLE_MAX_CHARS = 120

_JUNK_TITLES = {"", "unknown", "untitled", "book", "story", "audiobook", "title"}
_JUNK_AUTHORS = {"", "unknown", "unknown author", "author", "anonymous", "calibre", "python-docx"}
# Front matter that is never narrated: by document name, by epub:type, or by heading.
_FRONT_FILES = {
    "cover",
    "titlepage",
    "title-page",
    "front-cover",
    "toc",
    "table-of-contents",
    "nav",
}
_FRONT_TYPES = {"cover", "titlepage", "toc"}
_FRONT_TITLES = {"cover", "title page", "table of contents", "contents", "document outline"}
_BLOCKS = {
    "p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote",
    "td", "th", "dd", "dt", "pre", "figcaption", "caption",
}  # fmt: skip
_SKIPPED = {"head", "script", "style", "svg", "nav"}


@dataclass(frozen=True)
class Chapter:
    n: int  # 1-based, stable for a given EPUB and PARSER_VERSION
    title: str
    sentences: tuple[str, ...]  # the spoken title first, then the body
    source_ref: str  # document path, plus "#anchor" for a table-of-contents section
    text_sha256: str  # fingerprint of the sentences, for the numbering guard
    error: str | None = None  # set when this chapter could not be read; sentences are empty


@dataclass(frozen=True)
class Book:
    title: str
    author: str | None
    description: str | None
    language: str
    series: str | None
    volume: int | None
    cover: bytes | None  # JPEG, longest side at most 600 px
    chapters: tuple[Chapter, ...]


def parse(path: str | Path, *, rules: Rules | None = None) -> Book:
    """Read the EPUB at ``path``. Raises ``EpubError`` if it cannot be used at all."""
    path = Path(path)
    rules = rules or load_rules()
    book = _read(path)
    cover = _cover(book)
    sections = _toc_sections(book)
    book_title = _title(book, path)

    chapters: list[Chapter] = []
    for doc in _spine_documents(book):
        for ref, title, fragment, continuation in _segments(doc, sections):
            if continuation:
                _append_continuation(chapters, fragment, rules)
                continue
            try:
                chapter = _chapter(len(chapters) + 1, ref, title, fragment, rules)
            except Exception as exc:  # one bad chapter must not cost the whole book
                n = len(chapters) + 1
                chapter = _chapter_record(n, ref, title or f"Chapter {n}", (), repr(exc))
            if chapter is None or _is_front_title(chapter.title, book_title, "#" in ref):
                continue
            chapters.append(chapter)
    if not chapters:
        raise EpubError(f"no readable chapters in {path.name}")

    series, volume = _series(book)
    return Book(
        title=book_title,
        author=_author(book),
        description=_description(book),
        language=_meta(book, "language") or "en",
        series=series,
        volume=volume,
        cover=cover,
        chapters=tuple(chapters),
    )


# --- reading and path confinement -------------------------------------------------------


def _unsafe(name: str) -> bool:
    name = name.replace("\\", "/")
    return (
        name.startswith("/")
        or bool(re.match(r"[A-Za-z]:", name))
        or (".." in PurePosixPath(name).parts)
    )


def _read(path: Path) -> epub.EpubBook:
    try:
        with zipfile.ZipFile(path) as zf:
            bad = next((n for n in zf.namelist() if _unsafe(n)), None)
        if bad is not None:
            raise EpubError(f"refusing {path.name}: entry {bad!r} escapes the archive folder")
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            book = epub.read_epub(str(path), options={"ignore_ncx": False})
    except EpubError:
        raise
    except Exception as exc:
        raise EpubError(f"cannot read {path.name}: {exc}") from exc
    bad = next((i.file_name for i in book.get_items() if _unsafe(unquote(i.file_name))), None)
    if bad is not None:
        raise EpubError(f"refusing {path.name}: item {bad!r} escapes the archive folder")
    return book


# --- metadata ---------------------------------------------------------------------------


def _meta(book: epub.EpubBook, name: str) -> str | None:
    try:
        values = book.get_metadata("DC", name)
    except Exception:
        return None
    text = str(values[0][0]).strip() if values and values[0][0] else ""
    return text or None


def _title(book: epub.EpubBook, path: Path) -> str:
    raw = _meta(book, "title")
    if (
        raw
        and accent_key(raw) not in _JUNK_TITLES
        and not raw.lower().endswith((".epub", ".docx", ".pdf"))
    ):
        return raw
    stem = re.sub(r"\s+", " ", re.sub(r"[_-]+", " ", path.stem)).strip()
    return " ".join(w[:1].upper() + w[1:] for w in stem.split()) or "Untitled"


def _author(book: epub.EpubBook) -> str | None:
    raw = _meta(book, "creator")
    return None if raw is None or accent_key(raw) in _JUNK_AUTHORS else raw


def _description(book: epub.EpubBook) -> str | None:
    raw = _meta(book, "description")
    if raw is None:
        return None
    text = BeautifulSoup(raw, "lxml").get_text(" ", strip=True)  # often HTML
    return re.sub(r"\s+", " ", text) or None


def _series(book: epub.EpubBook) -> tuple[str | None, int | None]:
    """Series from Calibre's meta tags or EPUB 3 collections."""
    series = position = None
    try:
        entries = book.get_metadata("OPF", "meta")
    except Exception:
        entries = []
    for text, attrs in entries:
        name, prop = attrs.get("name"), attrs.get("property")
        if name == "calibre:series":
            series = attrs.get("content") or series
        elif name == "calibre:series_index":
            position = attrs.get("content") or position
        elif prop == "belongs-to-collection" and text and series is None:
            series = text
        elif prop == "group-position" and text and position is None:
            position = text
    series = series.strip() if series else None
    try:
        number = float(position) if position else None
    except ValueError:
        number = None
    volume = int(number) if number is not None and number == int(number) and number > 0 else None
    return (series or None), (volume if series else None)


# --- cover ------------------------------------------------------------------------------


def _cover(book: epub.EpubBook) -> bytes | None:
    """The declared cover, else an image named "cover"; never a guess at some other image."""
    items = list(book.get_items_of_type(ebooklib.ITEM_COVER))
    items += [
        i for i in book.get_items_of_type(ebooklib.ITEM_IMAGE) if "cover" in i.get_name().lower()
    ]
    for item in items:
        try:
            image = Image.open(io.BytesIO(item.get_content()))
            image.load()
            if image.mode in ("RGBA", "LA", "P"):  # flatten transparency onto white
                image = image.convert("RGBA")
                flat = Image.new("RGBA", image.size, "white")
                image = Image.alpha_composite(flat, image)
            image = image.convert("RGB")
            image.thumbnail((COVER_MAX_PX, COVER_MAX_PX), Image.Resampling.LANCZOS)
            out = io.BytesIO()
            image.save(out, format="JPEG", quality=COVER_JPEG_QUALITY)
            return out.getvalue()
        except Exception:  # unreadable image: try the next candidate, else no cover
            continue
    return None


# --- chapters ---------------------------------------------------------------------------


def _spine_documents(book: epub.EpubBook):
    for idref, _linear in book.spine:
        item = book.get_item_with_id(idref)
        if (
            item is not None
            and item.get_type() == ebooklib.ITEM_DOCUMENT
            and not isinstance(item, epub.EpubNav)
            and item.content
            and Path(item.get_name()).stem.lower() not in _FRONT_FILES
        ):
            yield item


def _toc_sections(book: epub.EpubBook) -> dict[str, list[tuple[str, str]]]:
    """Document name -> [(anchor id, title)] for table-of-contents entries that point inside it."""
    out: dict[str, list[tuple[str, str]]] = {}

    def walk(entries) -> None:
        for entry in entries:
            if isinstance(entry, (list, tuple)):
                walk(entry)
                continue
            doc, _, anchor = unquote(getattr(entry, "href", "") or "").partition("#")
            title = (getattr(entry, "title", "") or "").strip()
            if doc and anchor and title:
                out.setdefault(Path(doc).name.lower(), []).append((anchor, title))

    try:
        walk(book.toc)
    except Exception:  # a broken table of contents falls back to one chapter per document
        return {}
    return out


_ANCHOR = re.compile(rb"""<[A-Za-z][^>]*?\b(?:id|name)\s*=\s*["']([^"']+)["']""")


def _segments(doc, sections: dict[str, list[tuple[str, str]]]):
    """Yield (source_ref, title, html, continuation) per chapter-sized piece of a document.

    A document the table of contents splits at two or more anchors is cut at those anchors;
    text ahead of the first anchor continues the previous chapter. Otherwise it is one piece.
    """
    html = doc.content  # get_content() rewrites the file and drops <title> and body attributes
    name = doc.get_name()
    anchors = sections.get(Path(name).name.lower(), [])
    titles = dict(anchors)
    cuts = [(m.start(), m.group(1).decode("utf-8", "replace")) for m in _ANCHOR.finditer(html)]
    cuts = [(pos, aid) for pos, aid in cuts if aid in titles]
    if len(cuts) < 2:
        yield name, anchors[0][1] if len(anchors) == 1 else "", html, False
        return
    yield name, "", html[: cuts[0][0]], True
    for i, (pos, aid) in enumerate(cuts):
        end = cuts[i + 1][0] if i + 1 < len(cuts) else len(html)
        yield f"{name}#{aid}", titles[aid], html[pos:end], False


def _soup(html: bytes) -> BeautifulSoup:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", XMLParsedAsHTMLWarning)
        soup = BeautifulSoup(html, "lxml")
    for comment in soup.find_all(string=lambda s: isinstance(s, Comment)):
        comment.extract()
    for br in soup.find_all("br"):
        br.replace_with("\n")
    return soup


def _blocks(node, out: list[str]) -> None:
    """Collect each block's own text once. Blocks nested inside a block are visited on their
    own, so ``<div><p>x</p></div>`` reads "x" a single time."""
    buf: list[str] = []

    def flush() -> None:
        text = "".join(buf)
        if text.strip():
            out.append(text)
        buf.clear()

    for child in node.children:
        if isinstance(child, NavigableString):
            buf.append(str(child))
        elif child.name in _SKIPPED:
            continue
        elif child.name in _BLOCKS or child.find(_BLOCKS):
            flush()
            _blocks(child, out)
        else:
            buf.append(child.get_text(""))
    flush()


def _is_front_doc(soup: BeautifulSoup) -> bool:
    body = soup.body
    if body is None:
        return False
    first = body.find(True)
    for node in (body, first):
        if node is not None and _FRONT_TYPES & set(str(node.get("epub:type", "")).split()):
            return True
    return False


def _heading(soup: BeautifulSoup) -> str:
    for tag in ("h1", "h2", "title"):
        node = soup.find(tag)
        if node and node.get_text(" ", strip=True):
            return node.get_text(" ", strip=True)
    return ""


def _fingerprint(sentences) -> str:
    return hashlib.sha256("\n".join(sentences).encode("utf-8")).hexdigest()


def _chapter_record(n, ref, title, sentences, error=None) -> Chapter:
    return Chapter(n, title, tuple(sentences), ref, _fingerprint(sentences), error)


def _chapter(n: int, ref: str, toc_title: str, html: bytes, rules: Rules) -> Chapter | None:
    soup = _soup(html)
    if _is_front_doc(soup):
        return None
    title = clean(toc_title or _heading(soup), rules)[:TITLE_MAX_CHARS].strip() or f"Chapter {n}"
    blocks: list[str] = []
    _blocks(soup.body or soup, blocks)
    # The heading is read once, as the title; drop it when the body repeats it.
    if blocks and accent_key(clean(blocks[0], rules)) == accent_key(title):
        blocks = blocks[1:]
    sentences = hard_cut(title)
    for block in blocks:
        sentences += split_sentences(block, rules)
    return _chapter_record(n, ref, title, sentences)


def _is_front_title(title: str, book_title: str, split_section: bool) -> bool:
    key = accent_key(title)
    # In a document cut at table-of-contents anchors, the section named after the book itself
    # is the half-title and copyright block.
    return key in _FRONT_TITLES or (split_section and key == accent_key(book_title))


def _append_continuation(chapters: list[Chapter], html: bytes, rules: Rules) -> None:
    """Text before a split document's first anchor belongs to the section that began before."""
    if not chapters or chapters[-1].error:
        return
    try:
        blocks: list[str] = []
        soup = _soup(html)
        _blocks(soup.body or soup, blocks)
        extra = [s for block in blocks for s in split_sentences(block, rules)]
    except Exception:
        return
    if extra:
        last = chapters[-1]
        sentences = last.sentences + tuple(extra)
        chapters[-1] = Chapter(
            last.n, last.title, sentences, last.source_ref, _fingerprint(sentences)
        )
