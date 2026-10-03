"""Sentence splitting, invisible characters, look-alike folding, watermarks and credit lines."""

import json

import pytest

from hearthread.epub import EpubError, load_rules
from hearthread.epub.rules import GENERIC
from hearthread.epub.text import MAX_SENTENCE_CHARS, clean, fold_lookalikes, split_sentences


def test_splits_on_sentence_ends_and_keeps_closing_quotes():
    text = 'He ran. "Stop!" she cried. Was it over? Yes... It was.'
    assert split_sentences(text, GENERIC) == [
        "He ran.",
        '"Stop!"',
        "she cried.",
        "Was it over?",
        "Yes...",
        "It was.",
    ]


def test_titles_and_decimals_do_not_end_a_sentence():
    assert split_sentences("Mr. Smith paid 3.14 dollars. Then he left.", GENERIC) == [
        "Mr. Smith paid 3.14 dollars.",
        "Then he left.",
    ]


def test_long_run_on_paragraph_is_cut_on_spaces_into_pieces_of_at_most_900():
    words = ["lorem"] * 400  # one 2,399-character "sentence" with no full stop
    pieces = split_sentences(" ".join(words), GENERIC)
    assert len(pieces) == 3
    assert all(len(p) <= MAX_SENTENCE_CHARS for p in pieces)
    assert " ".join(pieces).split() == words  # nothing lost, no word cut in half


def test_a_single_token_longer_than_the_limit_is_still_cut():
    pieces = split_sentences("x" * 2000, GENERIC)
    assert [len(p) for p in pieces] == [900, 900, 200]


def test_invisible_characters_are_dropped_even_inside_words():
    text = "A lig‌ht‍weight﻿ co⁠at. Next​."
    assert split_sentences(text, GENERIC) == ["A lightweight coat.", "Next."]


def test_styled_and_lookalike_letters_fold_to_plain_for_recognition_only():
    assert fold_lookalikes("𝐧𝐨𝐯𝐞𝐥")[0] == "novel"  # mathematical bold
    assert fold_lookalikes("nоvеl")[0] == "novel"  # Cyrillic о and е
    assert fold_lookalikes("ｎovel")[0] == "novel"  # full-width


@pytest.mark.parametrize(
    "mark", ["𝐧𝐨𝐯𝐞𝐥𝐛𝐢𝐧.𝐜𝐨𝐦", "nоvеlbin.cоm", "NoVeLbIn.com", "www.novelbin.net/ch-4"]
)
def test_a_styled_watermark_is_cut_out_of_the_sentence(mark):
    got = split_sentences(f"She opened the door {mark} and walked in.", GENERIC)
    assert got == ["She opened the door and walked in."]


def test_real_cyrillic_is_kept_as_written():
    text = "Привет, как дела? Наа… Наа… Он сказал: «Да»."
    assert clean(text, GENERIC) == text
    assert split_sentences(text, GENERIC)[0] == "Привет, как дела?"


def test_a_sentence_that_is_only_a_watermark_disappears():
    assert split_sentences("www.example-site.com", GENERIC) == []


def test_credit_and_plug_lines_are_dropped():
    lines = [
        "Translator: Cucumber Strips.",
        "Translated by Cucumber Strips, forgive any errors.",
        "Support the translators on Patreon.",
        "TL Note: this pun does not work in English.",
    ]
    assert split_sentences(" ".join(lines) + " The rain fell.", GENERIC) == ["The rain fell."]


def test_a_printed_epigraph_and_a_quoted_credit_are_kept():
    kept = [
        "TRANSLATED BY RICHARD HOWARD",
        "“Translator: that was the name on his door,” she read.",
        "He was a translator: a quiet man.",
    ]
    for line in kept:
        assert split_sentences(line, GENERIC) == [line]


def test_site_names_come_only_from_the_local_rules_file(tmp_path):
    text = "Chapter 9: Rain by fakereadsite. A team of fakereads fans typed this."
    assert "fakereadsite" in split_sentences(text, GENERIC)[0]  # not in the public rules

    local = tmp_path / "rules.json"
    local.write_text(json.dumps({"watermarks": ["fakereadsite"], "credits": ["fakereads fans"]}))
    rules = load_rules(local)
    assert split_sentences(text, rules) == ["Chapter 9: Rain by."]


def test_the_committed_example_rules_file_is_empty_and_loads():
    from hearthread.epub.rules import DEFAULT_LOCAL_RULES

    example = DEFAULT_LOCAL_RULES.with_name("rules.example.json")
    assert json.loads(example.read_text()) == {"watermarks": [], "credits": []}
    assert load_rules(example) == GENERIC


def test_a_bad_rules_file_is_reported(tmp_path):
    bad = tmp_path / "rules.json"
    bad.write_text('{"watermarks": ["("]}')
    with pytest.raises(EpubError):
        load_rules(bad)
    with pytest.raises(EpubError):
        load_rules(tmp_path / "missing.json")
