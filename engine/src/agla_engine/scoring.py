"""From what was heard in each part of a recording to the score stored with the check.

This module depends on no speech model: the recognisers produce a `Hearing` for each step of the
recording, and the scores follow from those and from what was shown. It can therefore be tested
on its own.

The English part also holds the teacher's voice reading the question. The question's words are
taken out of the transcript before the child's answer is measured; a teacher who says more than
the question can still lift the result, which the agreement with the teachers' own levels shows.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from .align import Alignment, align, match_any_order, match_letters
from .item import CheckItem, Step
from .levels import english_level, reading_level
from .text import is_devanagari, normalise_word, words_of

#: Below this, a reading time is too short to give a meaningful speed.
MIN_READING_SECONDS = 5.0
#: The engine's confidence below which a score is flagged for a person to check.
LOW_CONFIDENCE = 0.5
#: Confidence of a score the engine itself has reason to doubt.
DOUBTFUL_CONFIDENCE = 0.45
#: Speech shorter than this in the reading part counts as no reading.
MIN_SPEECH_SECONDS = 0.5
#: Room left in the stored transcript, which must stay below 16 KB.
TRANSCRIPT_LIMIT = 12_000
#: Where one utterance ends: the end of a sentence, a comma, or a danda.
_UTTERANCE_BREAKS = re.compile("[.,!?;:" + chr(0x0964) + chr(0x0965) + "]+")
_SENTENCE_BREAKS = re.compile("[.?!]+")
#: Contractions a recogniser may write for the words of the question or of the answer, spelt out
#: so that "What's this?" is recognised as the question and "it's a cat" counts as three words.
_CONTRACTIONS = {
    "what's": ("what", "is"),
    "it's": ("it", "is"),
    "that's": ("that", "is"),
    "there's": ("there", "is"),
    "here's": ("here", "is"),
    "he's": ("he", "is"),
    "she's": ("she", "is"),
    "i'm": ("i", "am"),
    "they're": ("they", "are"),
    "we're": ("we", "are"),
    "you're": ("you", "are"),
}


@dataclass(frozen=True)
class Hearing:
    """What a recogniser heard during one step of the recording."""

    level: str
    text: str
    #: Length of the step's audio, in seconds.
    duration: float
    #: Seconds of speech detected in the step.
    speech_seconds: float
    #: Seconds from the start of the step to the first and the last speech.
    speech_start: float | None = None
    speech_end: float | None = None
    #: The recogniser's own confidence, from 0 to 1, when it gives one.
    confidence: float | None = None
    #: How likely the speech is English, from 0 to 1, when the recogniser can tell (English only).
    english_probability: float | None = None
    #: Loudness of the speech in dBFS, when measured.
    speech_dbfs: float | None = None


@dataclass(frozen=True)
class ReadingScore:
    reached_level: str
    items: int
    correct: int
    attempted: int
    seconds: float
    wcpm: float | None
    level: str


@dataclass(frozen=True)
class EnglishScore:
    words: int
    keyword_hits: int
    other_language_share: float
    seconds: float
    longest_utterance: int
    level: str
    #: Whether the child said anything at all once the teacher's question is taken out.
    answered: bool


@dataclass(frozen=True)
class Score:
    reading: ReadingScore
    english: EnglishScore
    confidence: float
    flags: tuple[str, ...]
    transcript: dict[str, Any] = field(default_factory=dict)

    def row(self, check_id: str, engine_version: str) -> dict[str, Any]:
        """The score as a row of `pulse_scores`."""
        return {
            "check_id": check_id,
            # The database takes the class from the check; any valid value satisfies the shape.
            "class_section_id": "00000000-0000-0000-0000-000000000000",
            "engine_version": engine_version,
            "reading_level": self.reading.level,
            "reached_level": self.reading.reached_level,
            "reading_items": self.reading.items,
            "reading_correct": self.reading.correct,
            "reading_seconds": round(self.reading.seconds, 2),
            "wcpm": None if self.reading.wcpm is None else round(self.reading.wcpm, 1),
            "english_level": self.english.level,
            "english_words": self.english.words,
            "english_seconds": round(self.english.seconds, 2),
            "keyword_hits": self.english.keyword_hits,
            "other_language_share": round(self.english.other_language_share, 3),
            "confidence": round(self.confidence, 3),
            "flags": list(self.flags),
            "transcript": self.transcript,
        }


def _reading_alignment(item: CheckItem, level: str, text: str) -> Alignment:
    heard = words_of(text)
    if level == "words":
        return match_any_order([normalise_word(word) for word in item.words], heard)
    if level == "letters":
        return match_letters(list(item.letters), heard)
    return align(words_of(item.passage), heard)


def _reading_time(hearing: Hearing, finished: bool) -> float:
    """The time the child spent on the step, from the first speech.

    A child who read to the end is timed to the last word. A child who stopped before the end used
    the time up to the end of the step: the time the words were on screen.
    """
    start = hearing.speech_start or 0.0
    end = hearing.speech_end if finished and hearing.speech_end is not None else hearing.duration
    return max(0.0, end - start)


def score_reading(item: CheckItem, hearings: dict[str, Hearing]) -> ReadingScore:
    """The reading measures at the easiest step shown."""
    level = item.reached_level
    hearing = hearings.get(level)
    result = _reading_alignment(item, level, hearing.text if hearing else "")
    seconds = _reading_time(hearing, result.attempted >= result.expected) if hearing else 0.0
    wcpm: float | None = None
    if level == "passage":
        minutes = max(seconds, MIN_READING_SECONDS) / 60
        wcpm = result.correct / minutes if result.correct else 0.0
    correct_share = result.correct / result.expected if result.expected else 0.0
    return ReadingScore(
        reached_level=level,
        items=result.expected,
        correct=result.correct,
        attempted=result.attempted,
        seconds=min(seconds, 61.0),
        wcpm=None if wcpm is None else min(wcpm, 400.0),
        level=reading_level(level, item.grade, wcpm, result.accuracy, correct_share),
    )


def _without(words: list[str], phrase: list[str]) -> list[str]:
    """The words with every occurrence of a phrase taken out."""
    if not phrase:
        return words
    kept: list[str] = []
    index = 0
    while index < len(words):
        if words[index : index + len(phrase)] == phrase:
            index += len(phrase)
        else:
            kept.append(words[index])
            index += 1
    return kept


def _spelt_out(text: str) -> list[str]:
    """The words of a text, with contractions written in full."""
    return [part for word in words_of(text) for part in _CONTRACTIONS.get(word, (word,))]


def child_utterances(item: CheckItem, text: str) -> list[list[str]]:
    """The child's utterances in the English part, without the teacher's question."""
    phrases = [_spelt_out(part) for part in _SENTENCE_BREAKS.split(item.question)]
    phrases = [phrase for phrase in phrases if phrase]
    utterances: list[list[str]] = []
    for chunk in _UTTERANCE_BREAKS.split(text):
        words = _spelt_out(chunk)
        for phrase in phrases:
            words = _without(words, phrase)
        if words:
            utterances.append(words)
    return utterances


def score_english(item: CheckItem, hearing: Hearing | None) -> EnglishScore:
    """The English measures from what the child said about the pictures."""
    utterances = child_utterances(item, hearing.text) if hearing else []
    english = [word for words in utterances for word in words if not is_devanagari(word)]
    other = [word for words in utterances for word in words if is_devanagari(word)]
    if hearing is None or not utterances:
        return EnglishScore(0, 0, 0.0, 0.0, 0, "no_response", answered=False)
    spoken = len(english) + len(other)
    share = len(other) / spoken if spoken else 0.0
    if hearing.english_probability is not None:
        # Another language may also be written in the Latin alphabet by the recogniser.
        share = max(share, 1.0 - hearing.english_probability)
    keywords = {normalise_word(keyword) for keyword in item.keywords}
    said = set(english) | {word.removesuffix("s") for word in english}
    longest = max(
        (sum(not is_devanagari(word) for word in words) for words in utterances), default=0
    )
    start = hearing.speech_start or 0.0
    end = hearing.speech_end if hearing.speech_end is not None else hearing.duration
    return EnglishScore(
        words=min(len(english), 400),
        keyword_hits=min(len(keywords & said), 50),
        other_language_share=min(max(share, 0.0), 1.0),
        seconds=min(max(0.0, end - start), 61.0),
        longest_utterance=longest,
        level=english_level(len(english), longest, share),
        answered=True,
    )


def _transcript(hearings: dict[str, Hearing]) -> dict[str, Any]:
    reading = [
        {"level": level, "text": hearing.text}
        for level, hearing in hearings.items()
        if level != "english" and hearing.text
    ]
    english = hearings["english"].text if "english" in hearings else ""
    transcript: dict[str, Any] = {"reading": reading, "english": english}
    # Long transcripts are cut, never refused: the measures matter more than the words.
    while len(json.dumps(transcript, ensure_ascii=False).encode()) > TRANSCRIPT_LIMIT:
        transcript["english"] = transcript["english"][: len(transcript["english"]) // 2]
        for part in transcript["reading"]:
            part["text"] = part["text"][: len(part["text"]) // 2]
    return transcript


def score_check(
    item: CheckItem,
    hearings: dict[str, Hearing],
    *,
    seen_before: bool = False,
    fallback_recogniser: bool = False,
) -> Score:
    """The complete score of a check from what was heard in each of its steps.

    `seen_before`: the child had been given this passage or prompt in an earlier check.
    `fallback_recogniser`: Hindi reading was transcribed by Whisper, which tends to write the
    expected words rather than the words read; such a score is doubtful.
    """
    reading = score_reading(item, hearings)
    english = score_english(item, hearings.get("english"))
    reading_speech = sum(
        hearing.speech_seconds for level, hearing in hearings.items() if level != "english"
    )
    read_aloud = reading_speech >= MIN_SPEECH_SECONDS

    flags: list[str] = []
    if not read_aloud and not english.answered:
        flags.append("no_speech")
    else:
        if not read_aloud:
            flags.append("no_reading")
        if not english.answered:
            flags.append("no_english")
    loudness = [hearing.speech_dbfs for hearing in hearings.values() if hearing.speech_dbfs]
    if loudness and max(loudness) < -40:
        flags.append("quiet")
    if english.answered and english.other_language_share > 0.5:
        flags.append("other_language")
    if not item.shown_known:
        flags.append("unknown_item")
    if seen_before:
        flags.append("seen_before")
    if fallback_recogniser and item.language == "hi":
        flags.append("fallback_recogniser")

    known = [hearing.confidence for hearing in hearings.values() if hearing.confidence is not None]
    confidence = sum(known) / len(known) if known else 0.7
    if "no_speech" in flags:
        confidence = min(confidence, 0.2)
    elif set(flags) & {"no_reading", "no_english", "quiet", "unknown_item", "fallback_recogniser"}:
        confidence = min(confidence, DOUBTFUL_CONFIDENCE)
    if confidence < LOW_CONFIDENCE:
        flags.append("low_confidence")

    return Score(
        reading=reading,
        english=english,
        confidence=min(max(confidence, 0.0), 1.0),
        flags=tuple(flags),
        transcript=_transcript(hearings),
    )


def steps_to_hear(item: CheckItem, recording_seconds: float) -> list[Step]:
    """The steps of a recording, each cut to the recording's length; empty steps are dropped."""
    steps: list[Step] = []
    for step in item.steps:
        end = recording_seconds if step.end is None else min(step.end, recording_seconds)
        if end - step.start > 0.05:
            steps.append(Step(level=step.level, start=step.start, end=end))
    return steps
