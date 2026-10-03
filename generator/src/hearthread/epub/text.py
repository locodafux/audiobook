"""Sentence-level cleaning: invisible characters, watermark recognition, splitting."""

from __future__ import annotations

import re
import unicodedata
from functools import cache

from .rules import Rules

MAX_SENTENCE_CHARS = 900

# Zero-width and bidi control characters. They sit inside words ("lig<ZWNJ>ht"), where they
# upset speech and hide watermarks from matching.
_INVISIBLE = re.compile("[­​-‏‪-‮⁠-⁤⁦-⁩﻿]")
_WS = re.compile(r"\s+")
_SPACE_BEFORE_PUNCT = re.compile(r" +([,.;:!?])")
# Up to a terminator (plus closing quotes) that is followed by whitespace or the end, so
# "3.14" and "example.com" stay whole; or whatever is left.
_SENTENCE = re.compile(r".+?[.!?…]+[\"'”’)\]»]*(?=\s|$)|.+$", re.DOTALL)
_TITLE_ABBREVIATION = re.compile(r"\b(?:Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr|Mt)\.$")

# Letters that imitate a Latin one but whose Unicode name does not say which.
_CONFUSABLES = {
    **dict(zip("асеорхуіјѕԁһӏ", "aceopxyijsdhl", strict=False)),
    **dict(zip("АВЕКМНОРСТХ", "ABEKMHOPCTX", strict=False)),
    **dict(zip("αονρεικ", "aovpeik", strict=False)),
    **dict(zip("ΑΒΕΖΗΙΚΜΝΟΡΤΥΧ", "ABEZHIKMNOPTYX", strict=False)),
}


@cache
def _fold_char(ch: str) -> str:
    if ch.isascii():
        return ch
    if ch in _CONFUSABLES:
        return _CONFUSABLES[ch]
    base = "".join(c for c in unicodedata.normalize("NFKD", ch) if not unicodedata.combining(c))
    out = []
    for c in base:
        name = unicodedata.name(c, "")
        # Small caps and other Latin look-alikes name the letter they copy as the only
        # single-letter word: "LATIN LETTER SMALL CAPITAL C".
        letters = re.findall(r"\b([A-Z])\b", name) if name.startswith("LATIN") else []
        out.append(letters[0].lower() if letters and not c.isascii() else c)
    return "".join(out)


def fold_lookalikes(text: str) -> tuple[str, list[int]]:
    """Fold styled, accented and look-alike letters to plain ones, for recognition only.

    Returns the folded text and, for each folded character, the index of the character it
    came from, so a match can be cut out of the original. The folded text is never narrated:
    real Cyrillic or Greek in the book stays as written.
    """
    out: list[str] = []
    origin: list[int] = []
    for i, ch in enumerate(text):
        folded = _fold_char(ch)
        out.append(folded)
        origin.extend([i] * len(folded))
    return "".join(out), origin


def accent_key(text: str) -> str:
    """Lowercase, accent-free, punctuation-free form for comparing two titles."""
    folded = "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))
    return _WS.sub(" ", re.sub(r"[\W_]+", " ", folded)).strip().casefold()


def clean(text: str, rules: Rules) -> str:
    """Drop invisible characters, cut inline watermarks, normalise whitespace."""
    text = _WS.sub(" ", _INVISIBLE.sub("", text)).strip()
    folded, origin = fold_lookalikes(text)
    cuts = sorted(
        m.span() for p in rules.watermarks for m in p.finditer(folded) if m.end() > m.start()
    )
    if not cuts:
        return text
    kept: list[str] = []
    pos = 0
    for start, end in cuts:
        a, b = origin[start], origin[end - 1] + 1
        kept.append(text[pos:a])
        pos = max(pos, b)
    kept.append(text[pos:])
    return _SPACE_BEFORE_PUNCT.sub(r"\1", _WS.sub(" ", "".join(kept))).strip()


def is_credit(sentence: str, rules: Rules) -> bool:
    folded, _ = fold_lookalikes(sentence)
    return any(p.search(folded) for p in rules.credits)


def hard_cut(sentence: str) -> list[str]:
    """Cut an over-long sentence into pieces of at most 900 characters, on a space."""
    pieces: list[str] = []
    while len(sentence) > MAX_SENTENCE_CHARS:
        cut = sentence.rfind(" ", 1, MAX_SENTENCE_CHARS + 1)
        if cut <= 0:
            cut = MAX_SENTENCE_CHARS
        pieces.append(sentence[:cut].rstrip())
        sentence = sentence[cut:].lstrip()
    if sentence:
        pieces.append(sentence)
    return pieces


def split_sentences(block: str, rules: Rules) -> list[str]:
    """Clean one block of text and split it into sentences ready for narration."""
    block = clean(block, rules)
    merged: list[str] = []
    carry = ""
    for match in _SENTENCE.finditer(block):
        piece = f"{carry} {match.group(0).strip()}".strip()
        # "Mr." is not the end of a sentence.
        carry = piece if _TITLE_ABBREVIATION.search(piece) else ""
        if not carry:
            merged.append(piece)
    if carry:
        merged.append(carry)
    return [
        part
        for sentence in merged
        if any(c.isalnum() for c in sentence) and not is_credit(sentence, rules)
        for part in hard_cut(sentence)
    ]
