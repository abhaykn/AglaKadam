"""The scoring engine: one recording and what was shown in, one score out."""

from __future__ import annotations

import sys
from dataclasses import dataclass
from typing import Any

import numpy as np

from . import ENGINE_VERSION
from .asr import Recogniser, Recognition
from .audio import NOTE_SECONDS, SAMPLE_RATE, cut, decode, speech_activity, split_at_pauses
from .item import parse_item
from .scoring import Hearing, Score, score_check, steps_to_hear


@dataclass(frozen=True)
class CheckToScore:
    """A recorded check as the database lists it for scoring."""

    check_id: str
    audio_path: str
    item: Any
    grade: int
    reading_language: str
    #: The child had been given this passage or prompt in an earlier check.
    item_seen_before: bool = False

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> CheckToScore:
        return cls(
            check_id=str(row["check_id"]),
            audio_path=str(row["audio_path"]),
            item=row.get("item"),
            grade=int(row["grade"]),
            reading_language=str(row["reading_language"]),
            item_seen_before=bool(row.get("item_seen_before", False)),
        )


class Engine:
    """Scores recordings with the given recognisers."""

    def __init__(self, hindi_reading: Recogniser, english: Recogniser) -> None:
        self.hindi_reading = hindi_reading
        self.english = english
        #: Hindi reading heard by Whisper, for want of IndicConformer.
        self.hindi_fallback = hindi_reading is english
        # Scores of different recognisers are not mixed: a change of recogniser rescores.
        self.version = f"{ENGINE_VERSION} ({hindi_reading.name}; {english.name})"

    def _reading_recogniser(self, language: str) -> Recogniser:
        return self.hindi_reading if language == "hi" else self.english

    def hear(self, samples: np.ndarray, check: CheckToScore) -> dict[str, Hearing]:
        """What was heard in each step of the recording."""
        item = parse_item(check.item, check.grade, check.reading_language)
        hearings: dict[str, Hearing] = {}
        for step in steps_to_hear(item, len(samples) / SAMPLE_RATE):
            assert step.end is not None
            piece = cut(samples, step.start, step.end)
            speech = speech_activity(piece)
            english = step.level == "english"
            if speech.seconds > 0:
                if english:
                    recognition = self.english.recognise(piece, "en", detect_language=True)
                else:
                    recogniser = self._reading_recogniser(item.language)
                    recognition = recogniser.recognise(piece, item.language)
            else:
                recognition = None
            hearings[step.level] = Hearing(
                level=step.level,
                text=recognition.text if recognition else "",
                duration=step.end - step.start,
                speech_seconds=speech.seconds,
                speech_start=speech.start,
                speech_end=speech.end,
                confidence=recognition.confidence if recognition else None,
                english_probability=recognition.english_probability if recognition else None,
                speech_dbfs=speech.dbfs,
            )
        return hearings

    def transcribe(self, recording: bytes, language: str) -> Recognition:
        """The text of a CRP's voice note: Hindi with the reading recogniser, English with Whisper.

        A note of two minutes is heard in pieces cut at pauses; pieces without speech are skipped.
        """
        samples = decode(recording, max_seconds=NOTE_SECONDS)
        recogniser = self.hindi_reading if language == "hi" else self.english
        texts: list[str] = []
        weighted = 0.0
        heard = 0
        for piece in split_at_pauses(samples):
            if speech_activity(piece).seconds == 0:
                continue
            result = recogniser.recognise(piece, language)
            if result.text:
                texts.append(result.text)
            if result.confidence is not None:
                weighted += result.confidence * len(piece)
                heard += len(piece)
        return Recognition(text=" ".join(texts), confidence=weighted / heard if heard else None)

    def score(self, recording: bytes, check: CheckToScore) -> Score:
        """The score of a recorded check."""
        samples = decode(recording)
        item = parse_item(check.item, check.grade, check.reading_language)
        return score_check(
            item,
            self.hear(samples, check),
            seen_before=check.item_seen_before,
            fallback_recogniser=self.hindi_fallback,
        )


def _notice(message: str) -> None:
    print(message, file=sys.stderr)


def load_engine(device: str = "cpu", hindi: str = "auto", log: Any = _notice) -> Engine:
    """The engine with its recognisers loaded: IndicConformer for Hindi when it can be had, else
    Whisper for both."""
    from .asr import IndicConformerRecogniser, WhisperRecogniser, indic_conformer_available

    english = WhisperRecogniser("small", device=device)
    if hindi in ("auto", "indicconformer") and indic_conformer_available():
        hindi_reading: Recogniser = IndicConformerRecogniser()
    else:
        if hindi == "indicconformer":
            raise RuntimeError(
                "IndicConformer is not on this machine and cannot be fetched. Accept its terms on "
                "Hugging Face and sign in once (see the setup guide)."
            )
        if hindi == "auto":
            log("IndicConformer is not available; Hindi reading is transcribed with Whisper.")
        hindi_reading = english
    return Engine(hindi_reading=hindi_reading, english=english)
