"""Matching what the child read against what was shown.

A passage is read in order, so its words and the recognised words are aligned with an
edit-distance alignment: each expected word is read correctly, read as something else, or left
out, and anything else the child said (repeats, self-corrections, a word of praise from the
teacher) is an insertion. The alignment may end anywhere in the passage: the words after the last
one the child reached were not attempted, because the time ran out first.

Step-down words and letters are shown in a grid, which a child may read along the rows or down the
columns, so they are matched in any order.

A recognised word counts as the expected one only when it is spelt the same, after the
normalisation in `text`: a vowel sign read wrongly (कल for काल, मेरी for मेरा) is the commonest
error of early readers, and must not be forgiven. Only long words, which recognisers sometimes
misspell, may differ by one character.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from .text import aksharas, is_devanagari, normalise_word

#: Words at least this long (in characters) may differ by one character.
LONG_WORD = 8


@dataclass(frozen=True)
class Alignment:
    """The outcome of matching the recognised items against the expected ones."""

    expected: int
    correct: int
    substituted: int
    omitted: int
    inserted: int
    #: Expected items up to the last one the child reached (read correctly or as something else).
    attempted: int
    #: For each expected item, whether it was read correctly.
    marks: tuple[bool, ...]

    @property
    def accuracy(self) -> float:
        """Correct items among those attempted, from 0 to 1."""
        return self.correct / self.attempted if self.attempted else 0.0


def edit_distance(a: str, b: str) -> int:
    """Levenshtein distance between two strings, in characters."""
    if a == b:
        return 0
    previous = list(range(len(b) + 1))
    for i, char_a in enumerate(a, start=1):
        current = [i]
        for j, char_b in enumerate(b, start=1):
            current.append(
                min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (char_a != char_b))
            )
        previous = current
    return previous[-1]


def words_match(expected: str, heard: str) -> bool:
    """Whether a recognised word counts as the expected word."""
    if expected == heard:
        return True
    if max(len(expected), len(heard)) < LONG_WORD:
        return False
    return edit_distance(expected, heard) <= 1


def align(
    expected: list[str],
    heard: list[str],
    matches: Callable[[str, str], bool] = words_match,
) -> Alignment:
    """Aligns recognised items with expected items read in order, and counts the outcome.

    Of the alignments with the fewest edits, the one with the most items read correctly is taken,
    and then the one that reached the fewest items: a child is never marked down by an arbitrary
    choice between equal alignments, nor by a last stray word counted against a word not reached.
    """
    rows, columns = len(expected), len(heard)
    # best[i][j]: (edits, -correct) for the first i expected and the first j recognised items.
    best = [[(0, 0)] * (columns + 1) for _ in range(rows + 1)]
    # step[i][j]: how cell (i, j) was reached: "match", "substitute", "omit" or "insert".
    step = [[""] * (columns + 1) for _ in range(rows + 1)]
    for i in range(1, rows + 1):
        best[i][0] = (i, 0)
        step[i][0] = "omit"
    for j in range(1, columns + 1):
        best[0][j] = (j, 0)
        step[0][j] = "insert"
    for i in range(1, rows + 1):
        for j in range(1, columns + 1):
            edits, negative_correct = best[i - 1][j - 1]
            if matches(expected[i - 1], heard[j - 1]):
                options = [((edits, negative_correct - 1), "match")]
            else:
                options = [((edits + 1, negative_correct), "substitute")]
            above, left = best[i - 1][j], best[i][j - 1]
            options.append(((above[0] + 1, above[1]), "omit"))
            options.append(((left[0] + 1, left[1]), "insert"))
            # Lowest edits, then most correct; the diagonal wins remaining ties (listed first).
            best[i][j], step[i][j] = min(options, key=lambda option: option[0])

    # The words after the end of the alignment were not reached, and cost nothing.
    end = min(range(rows + 1), key=lambda i: (*best[i][columns], i))

    marks = [False] * rows
    reached = [False] * rows
    correct = substituted = omitted = inserted = 0
    i, j = end, columns
    while i > 0 or j > 0:
        move = step[i][j]
        if move in ("match", "substitute"):
            if move == "match":
                correct += 1
                marks[i - 1] = True
            else:
                substituted += 1
            reached[i - 1] = True
            i, j = i - 1, j - 1
        elif move == "omit":
            omitted += 1
            i -= 1
        else:
            inserted += 1
            j -= 1

    attempted = max((index + 1 for index, value in enumerate(reached) if value), default=0)
    # Words left out at the very end of the alignment were not attempted either.
    omitted -= end - attempted
    return Alignment(
        expected=rows,
        correct=correct,
        substituted=substituted,
        omitted=max(0, omitted),
        inserted=inserted,
        attempted=attempted,
        marks=tuple(marks),
    )


def match_any_order(
    expected: list[str],
    heard: list[str],
    matches: Callable[[str, str], bool] = words_match,
) -> Alignment:
    """Matches items shown together (a grid of words or letters), read in any order.

    Each recognised item can account for one expected item at most. Every item shown counts as
    attempted: the child had all of them in front of them.
    """
    marks = [False] * len(expected)
    inserted = 0
    for word in heard:
        position = next(
            (
                index
                for index, item in enumerate(expected)
                if not marks[index] and matches(item, word)
            ),
            None,
        )
        if position is None:
            inserted += 1
        else:
            marks[position] = True
    correct = sum(marks)
    return Alignment(
        expected=len(expected),
        correct=correct,
        substituted=0,
        omitted=len(expected) - correct,
        inserted=inserted,
        attempted=len(expected),
        marks=tuple(marks),
    )


# How children name English letters, and how recognisers write those names.
_LETTER_NAMES = {
    "ay": "a", "eh": "a", "bee": "b", "be": "b", "see": "c", "sea": "c", "dee": "d", "ee": "e",
    "ef": "f", "eff": "f", "gee": "g", "aitch": "h", "edge": "h", "eye": "i", "jay": "j",
    "kay": "k", "el": "l", "elle": "l", "em": "m", "en": "n", "oh": "o", "pee": "p", "cue": "q",
    "queue": "q", "are": "r", "ar": "r", "es": "s", "ess": "s", "tee": "t", "tea": "t",
    "you": "u", "vee": "v", "double": "w", "ex": "x", "why": "y", "zed": "z", "zee": "z",
}  # fmt: skip


def letter_units(text_words: list[str]) -> list[str]:
    """Recognised words as the letters they name, one unit per letter read.

    A Devanagari word is split into its written syllables and each is reduced to its first
    character (the consonant or vowel said aloud, without the vowel sign a recogniser may add). An
    English word is a letter when it is a single letter or the name of one.
    """
    units: list[str] = []
    for word in text_words:
        if is_devanagari(word):
            units.extend(syllable[0] for syllable in aksharas(word))
        elif len(word) == 1:
            units.append(word)
        elif word in _LETTER_NAMES:
            units.append(_LETTER_NAMES[word])
    return units


def match_letters(expected_letters: list[str], text_words: list[str]) -> Alignment:
    """Matches letters read one by one with the letters shown, in any order."""
    expected = [normalise_word(letter)[:1] for letter in expected_letters]
    return match_any_order(expected, letter_units(text_words), matches=lambda a, b: a == b)
