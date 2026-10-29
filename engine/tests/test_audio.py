import numpy as np
import pytest

from agla_engine.audio import SAMPLE_RATE, cut, energy_speech, speech_activity


def signal(*parts: tuple[float, float]) -> np.ndarray:
    """Pieces of (seconds, amplitude): a 220 Hz tone, or quiet background noise for amplitude 0."""
    rng = np.random.default_rng(7)
    pieces = []
    for seconds, amplitude in parts:
        count = int(seconds * SAMPLE_RATE)
        time = np.arange(count) / SAMPLE_RATE
        tone = amplitude * np.sin(2 * np.pi * 220 * time)
        noise = rng.normal(0, 0.001, count)
        pieces.append(tone + noise)
    return np.concatenate(pieces).astype(np.float32)


def test_finds_where_the_sound_is():
    samples = signal((1.0, 0.0), (2.0, 0.3), (1.5, 0.0))
    speech = speech_activity(samples, use_model=False)
    assert speech.seconds == pytest.approx(2.0, abs=0.1)
    assert speech.start == pytest.approx(1.0, abs=0.06)
    assert speech.end == pytest.approx(3.0, abs=0.06)
    assert speech.dbfs is not None and -16 < speech.dbfs < -8


def test_joins_short_pauses_and_ignores_clicks():
    # Two words with a 0.2 s pause count as one stretch of speech; a 60 ms click does not count.
    samples = signal(
        (0.5, 0.0), (0.6, 0.3), (0.2, 0.0), (0.6, 0.3), (1.0, 0.0), (0.06, 0.5), (1.0, 0.0)
    )
    active = energy_speech(samples)
    speech = speech_activity(samples, use_model=False)
    assert speech.end == pytest.approx(1.9, abs=0.06)
    assert active.sum() * 0.03 == pytest.approx(1.4, abs=0.1)


def test_silence_has_no_speech():
    speech = speech_activity(signal((2.0, 0.0)), use_model=False)
    assert (speech.seconds, speech.start, speech.end, speech.dbfs) == (0.0, None, None, None)
    assert speech_activity(np.zeros(0, dtype=np.float32), use_model=False).seconds == 0.0


def test_cuts_between_moments():
    samples = np.arange(5 * SAMPLE_RATE, dtype=np.float32)
    piece = cut(samples, 1.5, 2.0)
    assert len(piece) == SAMPLE_RATE // 2
    assert piece[0] == 1.5 * SAMPLE_RATE
    assert len(cut(samples, 4.5, 9.0)) == SAMPLE_RATE // 2


def wav(seconds: float, rate: int = 8000, channels: int = 2) -> bytes:
    """A WAV file holding a quiet tone."""
    import io
    import wave

    count = int(seconds * rate)
    tone = (0.2 * np.sin(2 * np.pi * 220 * np.arange(count) / rate) * 32767).astype("<i2")
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as file:
        file.setnchannels(channels)
        file.setsampwidth(2)
        file.setframerate(rate)
        file.writeframes(np.repeat(tone, channels).tobytes())
    return buffer.getvalue()


def test_decodes_to_16_khz_mono():
    pytest.importorskip("av")
    from agla_engine.audio import decode

    samples = decode(wav(2.0))
    assert samples.dtype == np.float32
    assert len(samples) == pytest.approx(2 * SAMPLE_RATE, abs=SAMPLE_RATE // 50)
    assert 0.1 < float(np.max(np.abs(samples))) < 0.3


def test_decoding_stops_after_the_longest_check():
    pytest.importorskip("av")
    from agla_engine.audio import MAX_SECONDS, decode

    assert len(decode(wav(75.0, channels=1))) == MAX_SECONDS * SAMPLE_RATE
    # A damaged file fails for that check only (a ValueError, not a failure of the service).
    with pytest.raises(ValueError):
        decode(b"not a recording")


def test_splits_a_long_note_where_the_speaker_paused():
    from agla_engine.audio import PIECE_LONGEST, split_at_pauses

    # Speech, a pause at about 22 s, speech, a pause at about 47 s, and speech to 70 s.
    samples = signal((22.0, 0.3), (0.6, 0.0), (24.4, 0.3), (0.6, 0.0), (23.0, 0.3))
    pieces = split_at_pauses(samples)
    assert sum(len(piece) for piece in pieces) == len(samples)
    assert all(len(piece) <= PIECE_LONGEST * SAMPLE_RATE for piece in pieces)
    # The cuts fall inside the pauses, not in the middle of speech.
    first = len(pieces[0]) / SAMPLE_RATE
    assert 22.0 <= first <= 22.6
    second = (len(pieces[0]) + len(pieces[1])) / SAMPLE_RATE
    assert 47.0 <= second <= 47.6
    short = split_at_pauses(samples[: 10 * SAMPLE_RATE])
    assert len(short) == 1 and np.array_equal(short[0], samples[: 10 * SAMPLE_RATE])
    assert split_at_pauses(np.zeros(0, dtype=np.float32)) == []


def test_decodes_a_voice_note_of_two_minutes():
    pytest.importorskip("av")
    from agla_engine.audio import NOTE_SECONDS, decode

    assert (
        len(decode(wav(130.0, channels=1), max_seconds=NOTE_SECONDS)) == NOTE_SECONDS * SAMPLE_RATE
    )
