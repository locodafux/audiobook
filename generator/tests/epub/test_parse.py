"""parse(): metadata, cover, chapters, front matter, table-of-contents splitting, safety."""

import io

import pytest
from PIL import Image

from hearthread.epub import PARSER_VERSION, EpubError, parse
from hearthread.epub import parser as parser_module
from hearthread.epub.rules import GENERIC


def titles(book):
    return [c.title for c in book.chapters]


# --- chapters ----------------------------------------------------------------------------


def test_chapters_are_numbered_from_one_with_title_first_and_a_fingerprint(epubs):
    book = epubs.parse(
        [
            epubs.chapter("a.xhtml", "The Storm", "Rain fell. Wind howled."),
            epubs.chapter("b.xhtml", "Calm", "Nothing moved."),
        ]
    )
    first, second = book.chapters
    assert (first.n, second.n) == (1, 2)
    assert first.title == "The Storm"
    assert first.sentences == ("The Storm", "Rain fell.", "Wind howled.")
    assert first.source_ref == "a.xhtml"
    assert len(first.text_sha256) == 64 and first.text_sha256 != second.text_sha256
    assert first.error is None
    assert PARSER_VERSION


def test_parsing_twice_gives_identical_fingerprints(epubs):
    path = epubs.build([epubs.chapter("a.xhtml", "One", "Same text.")])
    assert parse(path, rules=GENERIC) == parse(path, rules=GENERIC)


def test_front_matter_is_not_narrated_and_chapter_one_is_the_first_real_chapter(epubs):
    docs = [
        epubs.Doc("cover.xhtml", '<img src="x.png"/>', title="Cover"),
        epubs.Doc("titlepage.xhtml", "<h1>Test Book</h1><p>Ann Author</p>", title="Title Page"),
        epubs.Doc(
            "front1.xhtml", "<ul><li>One</li><li>Two</li></ul>", body_attrs='epub:type="toc"'
        ),
        epubs.chapter("zz-contents.xhtml", "Table of Contents", "One. Two."),
        epubs.chapter("c1.xhtml", "One", "First words."),
        epubs.chapter("c2.xhtml", "Two", "More words."),
        epubs.chapter("outline.xhtml", "Document Outline", "One. Two."),
    ]
    book = epubs.parse(docs)
    assert titles(book) == ["One", "Two"]
    assert [c.n for c in book.chapters] == [1, 2]


def test_title_falls_back_to_chapter_number_when_there_is_no_heading(epubs):
    book = epubs.parse([epubs.Doc("a.xhtml", "<p>Just a paragraph.</p>", title="")])
    assert book.chapters[0].title == "Chapter 1"
    assert book.chapters[0].sentences == ("Chapter 1", "Just a paragraph.")


def test_the_heading_is_not_read_twice(epubs):
    book = epubs.parse(
        [
            epubs.chapter("a.xhtml", "The Storm", "Rain fell."),  # heading is also a block
            epubs.Doc("b.xhtml", "<p>CALM!</p><p>Calm. Nothing moved.</p>", title="Calm"),
        ]
    )
    assert book.chapters[0].sentences == ("The Storm", "Rain fell.")
    # Only a first line that is the whole title is dropped, not a later sentence that repeats it.
    assert book.chapters[1].sentences == ("Calm", "Calm.", "Nothing moved.")


def test_nested_blocks_are_read_once(epubs):
    body = (
        '<div class="chapter"><div><p>Once only.</p></div></div>'
        "<div>Loose text.<p>Then a paragraph.</p>Trailing text.</div>"
        "<span><p>Inside a span.</p></span><blockquote><p>Quoted line.</p></blockquote>"
    )
    book = epubs.parse([epubs.Doc("a.xhtml", body, title="Nest")])
    assert book.chapters[0].sentences == (
        "Nest",
        "Once only.",
        "Loose text.",
        "Then a paragraph.",
        "Trailing text.",
        "Inside a span.",
        "Quoted line.",
    )


def test_comments_and_scripts_are_not_narrated(epubs):
    body = "<p>Real.<!--sse--></p><script>var x = 1;</script><p>Line<br/>break.</p>"
    book = epubs.parse([epubs.Doc("a.xhtml", body, title="T")])
    assert book.chapters[0].sentences == ("T", "Real.", "Line break.")


def test_one_big_file_is_split_at_table_of_contents_anchors(epubs):
    body = (
        '<h2 id="a">Alpha</h2><p>Alpha text.</p>'
        '<h2 id="b">Beta</h2><p>Beta text.</p>'
        '<h2 id="c">Gamma</h2><p>Gamma text.</p>'
    )
    toc = [("big.xhtml#a", "Alpha"), ("big.xhtml#b", "Beta"), ("big.xhtml#c", "Gamma")]
    book = epubs.parse([epubs.Doc("big.xhtml", body, title="Big")], toc=toc)
    assert titles(book) == ["Alpha", "Beta", "Gamma"]
    assert [c.sentences for c in book.chapters] == [
        ("Alpha", "Alpha text."),
        ("Beta", "Beta text."),
        ("Gamma", "Gamma text."),
    ]
    assert [c.source_ref for c in book.chapters] == ["big.xhtml#a", "big.xhtml#b", "big.xhtml#c"]


def test_text_before_the_first_anchor_continues_the_previous_chapter(epubs):
    big = '<p>Tail of the last one.</p><h2 id="a">Alpha</h2><p>A.</p><h2 id="b">Beta</h2><p>B.</p>'
    docs = [epubs.chapter("one.xhtml", "One", "Start."), epubs.Doc("big.xhtml", big, title="Big")]
    toc = [("one.xhtml", "One"), ("big.xhtml#a", "Alpha"), ("big.xhtml#b", "Beta")]
    book = epubs.parse(docs, toc=toc)
    assert titles(book) == ["One", "Alpha", "Beta"]
    assert book.chapters[0].sentences == ("One", "Start.", "Tail of the last one.")


def test_a_book_with_no_readable_chapter_is_an_error(epubs):
    path = epubs.build([epubs.Doc("cover.xhtml", "<p>x</p>", title="Cover")])
    with pytest.raises(EpubError):
        parse(path, rules=GENERIC)


def test_a_file_that_is_not_an_epub_is_an_error(tmp_path):
    bogus = tmp_path / "bogus.epub"
    bogus.write_bytes(b"not a zip")
    with pytest.raises(EpubError):
        parse(bogus, rules=GENERIC)


# --- safety and isolation ------------------------------------------------------------------


@pytest.mark.parametrize("name", ["../evil.xhtml", "OEBPS/../../evil.xhtml", "/abs/evil.xhtml"])
def test_an_entry_that_escapes_its_folder_is_refused(epubs, name):
    path = epubs.build([epubs.chapter("a.xhtml", "One", "Fine.")], extra_entries={name: b"x"})
    with pytest.raises(EpubError, match="escapes"):
        parse(path, rules=GENERIC)


def test_one_broken_chapter_fails_alone_and_keeps_its_number(epubs, monkeypatch):
    real = parser_module.split_sentences

    def explode_on_boom(block, rules):
        if "BOOM" in block:
            raise RuntimeError("cannot read this")
        return real(block, rules)

    monkeypatch.setattr(parser_module, "split_sentences", explode_on_boom)
    book = epubs.parse(
        [
            epubs.chapter("a.xhtml", "One", "Fine."),
            epubs.chapter("b.xhtml", "Two", "BOOM."),
            epubs.chapter("c.xhtml", "Three", "Also fine."),
        ]
    )
    one, two, three = book.chapters
    assert [c.n for c in book.chapters] == [1, 2, 3]
    assert one.error is None and three.error is None
    assert three.sentences == ("Three", "Also fine.")
    assert two.sentences == () and "cannot read this" in two.error


# --- metadata ----------------------------------------------------------------------------


def test_metadata_is_read(epubs):
    book = epubs.parse(
        [epubs.chapter("a.xhtml", "One", "Text.")],
        title="The Long Walk",
        author="Ann Author",
        language="en-GB",
        description="<p>A <b>bold</b> start.</p>",
    )
    assert (book.title, book.author, book.language) == ("The Long Walk", "Ann Author", "en-GB")
    assert book.description == "A bold start."
    assert (book.series, book.volume) == (None, None)


def test_series_from_calibre_tags_and_from_epub3_collections(epubs):
    docs = [epubs.chapter("a.xhtml", "One", "Text.")]
    calibre = epubs.parse(
        docs,
        extra_meta='<meta name="calibre:series" content="Saga"/>'
        '<meta name="calibre:series_index" content="3.0"/>',
    )
    assert (calibre.series, calibre.volume) == ("Saga", 3)
    epub3 = epubs.parse(
        docs,
        extra_meta='<meta property="belongs-to-collection" id="c">Other Saga</meta>'
        '<meta refines="#c" property="group-position">2</meta>',
    )
    assert (epub3.series, epub3.volume) == ("Other Saga", 2)


def test_junk_metadata_falls_back_to_the_file_name(epubs):
    book = epubs.parse(
        [epubs.chapter("a.xhtml", "One", "Text.")],
        filename="my_great-story.epub",
        title="Unknown",
        author="calibre",
        language=None,
    )
    assert book.title == "My Great Story"
    assert book.author is None
    assert book.language == "en"
    missing = epubs.parse(
        [epubs.chapter("a.xhtml", "One", "Text.")], filename="other_book.epub", title=None
    )
    assert missing.title == "Other Book"


# --- cover -------------------------------------------------------------------------------


def jpeg_size(data):
    image = Image.open(io.BytesIO(data))
    assert image.format == "JPEG"
    return image.size


def test_a_big_cover_is_shrunk_to_a_600_px_jpeg(epubs):
    book = epubs.parse([epubs.chapter("a.xhtml", "One", "Text.")], cover=epubs.png(1600, 2400))
    assert jpeg_size(book.cover) == (400, 600)


def test_a_small_transparent_cover_becomes_a_jpeg_without_growing(epubs):
    book = epubs.parse(
        [epubs.chapter("a.xhtml", "One", "Text.")], cover=epubs.png(100, 50, mode="RGBA")
    )
    assert jpeg_size(book.cover) == (100, 50)


def test_a_missing_or_unreadable_cover_is_allowed(epubs):
    docs = [epubs.chapter("a.xhtml", "One", "Text.")]
    assert epubs.parse(docs).cover is None
    assert epubs.parse(docs, cover=b"definitely not an image").cover is None
