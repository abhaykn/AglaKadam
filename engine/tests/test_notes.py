import numpy as np
import pytest

from agla_engine.asr import Recognition
from agla_engine.audio import SAMPLE_RATE, Speech
from agla_engine.engine import Engine


class FakeRecogniser:
    def __init__(self, name: str) -> None:
        self.name = name
        self.heard: list[tuple[int, str]] = []

    def recognise(self, samples: np.ndarray, language: str, detect_language: bool = False):
        self.heard.append((len(samples), language))
        return Recognition(text=f"{self.name}-{len(self.heard)}", confidence=0.8)


def tone(seconds: float) -> np.ndarray:
    time = np.arange(int(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    return (0.3 * np.sin(2 * np.pi * 220 * time)).astype(np.float32)


@pytest.fixture
def engine(monkeypatch):
    hindi, english = FakeRecogniser("hi"), FakeRecogniser("en")
    # A minute and a half of speech with a pause after 25 seconds, as decoded from the file.
    samples = np.concatenate([tone(25), np.zeros(SAMPLE_RATE, dtype=np.float32), tone(64)])
    monkeypatch.setattr("agla_engine.engine.decode", lambda data, max_seconds: samples)
    # A steady tone is not speech to the voice activity model; here any sound counts as speech.
    monkeypatch.setattr(
        "agla_engine.engine.speech_activity",
        lambda piece: Speech(float(np.any(np.abs(piece) > 0.01)), None, None, None),
    )
    return Engine(hindi_reading=hindi, english=english), hindi, english


def test_a_hindi_note_is_heard_in_pieces_by_the_reading_recogniser(engine):
    machine, hindi, english = engine
    result = machine.transcribe(b"note", "hi")
    assert english.heard == []
    assert len(hindi.heard) >= 3
    assert all(length <= 30 * SAMPLE_RATE for length, _ in hindi.heard)
    assert all(language == "hi" for _, language in hindi.heard)
    assert result.text == " ".join(f"hi-{index + 1}" for index in range(len(hindi.heard)))
    assert result.confidence == pytest.approx(0.8)


def test_an_english_note_goes_to_whisper(engine):
    machine, hindi, english = engine
    machine.transcribe(b"note", "en")
    assert hindi.heard == []
    assert english.heard and all(language == "en" for _, language in english.heard)
