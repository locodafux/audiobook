"""EPUB reading for the generator: ``parse(path)`` returns a ``Book``."""

from .parser import PARSER_VERSION, Book, Chapter, parse
from .rules import EpubError, Rules, load_rules

__all__ = ["PARSER_VERSION", "Book", "Chapter", "EpubError", "Rules", "load_rules", "parse"]
