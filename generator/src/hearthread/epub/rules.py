"""Watermark and credit rules.

Only generic rules live here. This repo is public, so names of specific scanlation or
piracy sites go in a git-ignored local file the parser loads when it exists:

* path: ``$HEARTHREAD_EPUB_RULES`` if set, else ``rules.local.json`` next to this file
* format: ``{"watermarks": ["regex", ...], "credits": ["regex", ...]}``, both optional,
  matched case-insensitively
* ``watermarks`` are cut out of a sentence in place (the sentence around them is real text);
  ``credits`` drop the whole sentence
* ``rules.example.json`` is the committed empty example; copy it to ``rules.local.json``

Patterns run on text folded to plain letters (see ``text.fold_lookalikes``), so write them in
plain lowercase letters; styled and look-alike spellings are caught by the folding.
Changing the rules can change narration, so bump ``PARSER_VERSION`` when generic rules change.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path

LOCAL_RULES_ENV = "HEARTHREAD_EPUB_RULES"
DEFAULT_LOCAL_RULES = Path(__file__).with_name("rules.local.json")


class EpubError(ValueError):
    """The EPUB (or a rules file) cannot be used."""


@dataclass(frozen=True)
class Rules:
    watermarks: tuple[re.Pattern[str], ...] = ()
    credits: tuple[re.Pattern[str], ...] = ()

    def extended(self, watermarks: list[str], credits: list[str]) -> Rules:
        def compile_all(patterns: list[str]) -> tuple[re.Pattern[str], ...]:
            return tuple(re.compile(p, re.IGNORECASE) for p in patterns)

        return Rules(self.watermarks + compile_all(watermarks), self.credits + compile_all(credits))


_TLDS = "com|net|org|cc|co|io|me|xyz|info|site|club|online"

GENERIC = Rules().extended(
    watermarks=[
        r"https?://\S+",
        r"\bwww\.\S+",
        rf"\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:{_TLDS})\b\.?",
        r"@@[^@\s]+@@",
    ],
    credits=[
        r"^(?:translator|editor|proofreader)\s*[:：]",
        # An all-caps "TRANSLATED BY RICHARD HOWARD" is a printed epigraph, not a scanlator's
        # typed note: require a real lowercase letter. A sentence opening with a quote mark
        # never matches ^, which is how a quoted epigraph survives.
        r"^translated by\b(?=.*(?-i:[a-z]))",
        r"^tl note\s*[:：]",
        r"support the translat",
        r"subscribe to us on",
        r"read more chapters",
        r"check out the discord",
        r"patreon",
    ],
)


def load_rules(path: Path | str | None = None) -> Rules:
    """Generic rules plus the local file (explicit ``path``, env var, or the default)."""
    if path is None and os.environ.get(LOCAL_RULES_ENV):
        path = os.environ[LOCAL_RULES_ENV]
    local = Path(path) if path else DEFAULT_LOCAL_RULES
    if not local.exists():
        if path:
            raise EpubError(f"rules file not found: {local}")
        return GENERIC
    try:
        data = json.loads(local.read_text(encoding="utf-8"))
        return GENERIC.extended(data.get("watermarks", []), data.get("credits", []))
    except (OSError, ValueError, AttributeError, TypeError, re.error) as exc:
        raise EpubError(f"bad rules file {local}: {exc}") from exc
