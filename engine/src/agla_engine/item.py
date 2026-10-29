"""What a check showed, as the app stored it with the check, and when the screen changed.

The app stores the passage, the step-down words and letters, the English prompt, and the moments
(in milliseconds into the recording) when the teacher stepped down or moved on to English. These
moments divide the recording into steps, so that each part is scored against what was on screen.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

READING_LEVELS = ("passage", "words", "letters")
LEVELS = (*READING_LEVELS, "english")


class ItemError(ValueError):
    """The stored item cannot be scored (it is missing what was shown)."""


@dataclass(frozen=True)
class Step:
    """A part of the recording during which one level was on screen."""

    level: str
    #: Seconds into the recording when the level appeared.
    start: float
    #: Seconds into the recording when the next level appeared; None for the last step.
    end: float | None


@dataclass(frozen=True)
class CheckItem:
    language: str
    grade: int
    passage: str
    words: tuple[str, ...]
    letters: tuple[str, ...]
    keywords: tuple[str, ...]
    #: The question the teacher reads out in the English part (empty when not stored).
    question: str
    steps: tuple[Step, ...]
    #: Whether the item said when the screen changed; without it the steps are only a guess.
    shown_known: bool

    @property
    def reading_steps(self) -> tuple[Step, ...]:
        return tuple(step for step in self.steps if step.level in READING_LEVELS)

    @property
    def english_step(self) -> Step | None:
        return next((step for step in self.steps if step.level == "english"), None)

    @property
    def reached_level(self) -> str:
        """The easiest reading level the child was shown."""
        steps = self.reading_steps
        return steps[-1].level if steps else "passage"


def _strings(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(entry for entry in value if isinstance(entry, str) and entry.strip())


def parse_item(item: Any, grade: int, language: str) -> CheckItem:
    """The check's item as stored by the app; raises ItemError when it cannot be scored."""
    if not isinstance(item, dict):
        raise ItemError("The item is not an object.")
    reading = item.get("reading")
    speaking = item.get("speaking")
    if not isinstance(reading, dict) or not isinstance(reading.get("passage"), str):
        raise ItemError("The item has no reading passage.")
    passage = reading["passage"].strip()
    if not passage:
        raise ItemError("The reading passage is empty.")

    shown: list[tuple[str, float]] = []
    for entry in item.get("shown") or []:
        if not isinstance(entry, dict):
            continue
        level, at_ms = entry.get("level"), entry.get("atMs")
        if level in LEVELS and isinstance(at_ms, int | float) and at_ms >= 0:
            shown.append((level, at_ms / 1000))
    shown.sort(key=lambda pair: pair[1])
    shown_known = bool(shown)
    if not shown or shown[0][0] != "passage":
        # Every recording starts with the passage on screen.
        shown.insert(0, ("passage", 0.0))

    steps = tuple(
        Step(level=level, start=start, end=shown[index + 1][1] if index + 1 < len(shown) else None)
        for index, (level, start) in enumerate(shown)
    )
    return CheckItem(
        language=language,
        grade=grade,
        passage=passage,
        words=_strings(reading.get("words")),
        letters=_strings(reading.get("letters")),
        keywords=_strings(speaking.get("keywords")) if isinstance(speaking, dict) else (),
        question=(
            speaking["question"]
            if isinstance(speaking, dict) and isinstance(speaking.get("question"), str)
            else ""
        ),
        steps=steps,
        shown_known=shown_known,
    )
