"""Reading a recording and finding where in it someone speaks."""

from __future__ import annotations

import io
from dataclasses import dataclass
from itertools import pairwise

import numpy as np

SAMPLE_RATE = 16_000
#: A check records at most a minute; anything longer in a file is not part of it.
MAX_SECONDS = 62
#: A voice note of a visit records at most two minutes.
NOTE_SECONDS = 122
#: Pieces of a long recording given to a recogniser at once, in seconds.
PIECE_LONGEST = 30.0
PIECE_SHORTEST = 10.0
_FRAME_MS = 30
#: Pauses shorter than this inside speech are part of it; shorter bursts are noise.
_GAP_MS = 300
_MIN_SPEECH_MS = 120


@dataclass(frozen=True)
class Speech:
    """Where speech was found in a piece of audio."""

    seconds: float
    #: Seconds from the start of the piece to the first and the last speech; None without speech.
    start: float | None
    end: float | None
    #: Average loudness of the speech in dBFS; None without speech.
    dbfs: float | None


def decode(data: bytes, max_seconds: float = MAX_SECONDS) -> np.ndarray:
    """A recording (WebM, Ogg or MP4 audio, or WAV) as 16 kHz mono samples between -1 and 1, at
    most `max_seconds` long."""
    import av

    chunks: list[np.ndarray] = []
    with av.open(io.BytesIO(data), mode="r") as container:
        stream = next((entry for entry in container.streams if entry.type == "audio"), None)
        if stream is None:
            raise ValueError("The recording has no audio.")
        resampler = av.AudioResampler(format="s16", layout="mono", rate=SAMPLE_RATE)
        limit = int(max_seconds * SAMPLE_RATE)
        kept = 0
        for frame in container.decode(stream):
            for resampled in resampler.resample(frame):
                chunks.append(resampled.to_ndarray().reshape(-1))
                kept += len(chunks[-1])
            if kept >= limit:
                break
        else:
            for resampled in resampler.resample(None):
                chunks.append(resampled.to_ndarray().reshape(-1))
    if not chunks:
        return np.zeros(0, dtype=np.float32)
    return (np.concatenate(chunks)[: int(max_seconds * SAMPLE_RATE)]).astype(np.float32) / 32768.0


def cut(samples: np.ndarray, start: float, end: float) -> np.ndarray:
    """The samples between two moments, in seconds."""
    first = max(0, round(start * SAMPLE_RATE))
    last = max(first, round(end * SAMPLE_RATE))
    return samples[first:last]


def _frames_db(samples: np.ndarray) -> np.ndarray:
    frame = SAMPLE_RATE * _FRAME_MS // 1000
    count = len(samples) // frame
    if count == 0:
        return np.zeros(0, dtype=np.float64)
    frames = samples[: count * frame].astype(np.float64).reshape(count, frame)
    rms = np.sqrt(np.mean(frames**2, axis=1))
    return 20 * np.log10(np.maximum(rms, 1e-10))


def _smooth(active: np.ndarray) -> np.ndarray:
    """Joins speech across short pauses and drops bursts too short to be speech."""
    gap = _GAP_MS // _FRAME_MS
    shortest = max(1, _MIN_SPEECH_MS // _FRAME_MS)
    result = active.copy()
    indices = np.flatnonzero(result)
    for previous, current in pairwise(indices):
        if 1 < current - previous <= gap + 1:
            result[previous:current] = True
    # Remove runs of speech that are too short.
    index = 0
    while index < len(result):
        if result[index]:
            end = index
            while end < len(result) and result[end]:
                end += 1
            if end - index < shortest:
                result[index:end] = False
            index = end
        else:
            index += 1
    return result


def energy_speech(samples: np.ndarray) -> np.ndarray:
    """Frames louder than the background by a clear margin, as a boolean array."""
    db = _frames_db(samples)
    if len(db) == 0:
        return np.zeros(0, dtype=bool)
    floor = float(np.percentile(db, 10))
    threshold = max(floor + 12.0, -55.0)
    return _smooth(db > threshold)


def _model_speech(samples: np.ndarray) -> np.ndarray | None:
    """Speech frames found by the Silero voice activity model shipped with faster-whisper."""
    try:
        from faster_whisper.vad import VadOptions, get_speech_timestamps
    except ImportError:
        return None
    frame = SAMPLE_RATE * _FRAME_MS // 1000
    active = np.zeros(len(samples) // frame, dtype=bool)
    options = VadOptions(min_silence_duration_ms=_GAP_MS, speech_pad_ms=60)
    for segment in get_speech_timestamps(samples, options):
        active[segment["start"] // frame : -(-segment["end"] // frame)] = True
    return active


def speech_activity(samples: np.ndarray, use_model: bool = True) -> Speech:
    """Where speech is in a piece of audio, and how loud it is."""
    active = _model_speech(samples) if use_model else None
    if active is None:
        active = energy_speech(samples)
    if not active.any():
        return Speech(seconds=0.0, start=None, end=None, dbfs=None)
    indices = np.flatnonzero(active)
    frame_seconds = _FRAME_MS / 1000
    db = _frames_db(samples)
    loudness = float(np.mean(db[indices[indices < len(db)]])) if len(db) else None
    return Speech(
        seconds=float(len(indices) * frame_seconds),
        start=float(indices[0] * frame_seconds),
        end=float((indices[-1] + 1) * frame_seconds),
        dbfs=loudness,
    )


def split_at_pauses(
    samples: np.ndarray,
    longest: float = PIECE_LONGEST,
    shortest: float = PIECE_SHORTEST,
) -> list[np.ndarray]:
    """A long recording in pieces of at most `longest` seconds, each cut at the quietest moment
    after `shortest` seconds, so that no word is split where the speaker paused."""
    longest_samples = int(longest * SAMPLE_RATE)
    if len(samples) <= longest_samples:
        return [samples] if len(samples) else []
    frame = SAMPLE_RATE * _FRAME_MS // 1000
    db = _frames_db(samples)
    pieces: list[np.ndarray] = []
    start = 0
    while len(samples) - start > longest_samples:
        first = (start + int(shortest * SAMPLE_RATE)) // frame
        last = (start + longest_samples) // frame
        window = db[first:last]
        cut = (first + int(np.argmin(window))) * frame if len(window) else start + longest_samples
        pieces.append(samples[start:cut])
        start = cut
    pieces.append(samples[start:])
    return [piece for piece in pieces if len(piece)]
