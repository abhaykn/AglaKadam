"""Words as a child reads or says them, normalised so that spelling variants compare equal.

Speech recognisers and passages write the same Hindi word in more than one way: with or without a
nukta, with a chandrabindu or an anusvara, in composed or decomposed Unicode. These differences
say nothing about the child's reading, so both sides are normalised the same way before they are
compared. English is lower-cased and stripped of punctuation.
"""

from __future__ import annotations

import re
import unicodedata

_NUKTA = "\u093c"
_CHANDRABINDU = "\u0901"
_ANUSVARA = "\u0902"
_VIRAMA = "\u094d"
_JOINERS = "\u200c\u200d"
#: Single quotation marks, which are also apostrophes.
_QUOTES = "'\u2018\u2019"
_DEVANAGARI = re.compile(r"[\u0900-\u097f]")
_LATIN_WORD = re.compile(r"[a-z]+(?:'[a-z]+)?")
# Everything that separates words in a passage or a transcript. Single quotation marks are not
# among them: the same mark is an apostrophe (it's, Meera's), and is removed with the word's
# other punctuation.
_SEPARATORS = re.compile(r"[\s\u0964\u0965,.;:!?\"\u201c\u201d()\[\]{}\-\u2013\u2014/]+")


def is_devanagari(word: str) -> bool:
    """Whether a word is written in Devanagari."""
    return bool(_DEVANAGARI.search(word))


def normalise_word(word: str) -> str:
    """A word in the form used for comparison."""
    if is_devanagari(word):
        decomposed = unicodedata.normalize("NFD", word.strip(_QUOTES))
        cleaned = (
            decomposed.replace(_NUKTA, "")
            .replace(_CHANDRABINDU, _ANUSVARA)
            .translate({ord(joiner): None for joiner in _JOINERS})
        )
        return unicodedata.normalize("NFC", cleaned)
    lowered = word.lower().translate({ord(mark): "'" for mark in _QUOTES})
    match = _LATIN_WORD.search(lowered)
    return match.group(0) if match else ""


def words_of(text: str) -> list[str]:
    """The normalised words of a passage or a transcript, in order."""
    words = (normalise_word(part) for part in _SEPARATORS.split(text))
    return [word for word in words if word]


def english_words_of(text: str) -> list[str]:
    """The words of a transcript written in the Latin alphabet."""
    return [word for word in words_of(text) if not is_devanagari(word)]


def other_language_words_of(text: str) -> list[str]:
    """The words of a transcript written in Devanagari (spoken in another language)."""
    return [word for word in words_of(text) if is_devanagari(word)]


def aksharas(word: str) -> list[str]:
    """The written syllables of a Devanagari word, for comparing letters read one by one.

    A syllable is a consonant cluster (consonants joined by a virama) with its vowel sign, or an
    independent vowel. Signs that cannot start a syllable stay with the one before them.
    """
    syllables: list[str] = []
    for character in unicodedata.normalize("NFC", word):
        category = unicodedata.category(character)
        joins_previous = category in ("Mn", "Mc") or (syllables and syllables[-1].endswith(_VIRAMA))
        if joins_previous and syllables:
            syllables[-1] += character
        else:
            syllables.append(character)
    return syllables
