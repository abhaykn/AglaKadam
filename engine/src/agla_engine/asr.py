"""Speech recognisers: Whisper for English, IndicConformer for reading in Hindi.

The reading part needs a recogniser that writes what was said, not what should have been said:
IndicConformer's CTC decoder transcribes sound by sound, so a misread word stays misread. Whisper,
used for English, is given no hint of the expected words for the same reason. Whisper runs on a
GPU when one is asked for; IndicConformer always runs on the CPU.
"""

from __future__ import annotations

import json
import math
import os
import shutil
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np

#: AI4Bharat's multilingual Conformer, pinned to a reviewed revision of its files.
INDIC_CONFORMER = "ai4bharat/indic-conformer-600m-multilingual"
INDIC_CONFORMER_REVISION = "2a77d305038dfc502fd9464e7d028b90381976cb"
#: Index of the CTC blank among each language's tokens (the model's `BLANK_ID`).
CTC_BLANK = 256
#: Marks the start of a word in the model's tokens.
_WORD_START = chr(0x2581)
#: Written in the model's folder once it has loaded from it, listing the files it held.
_LOADED = ".loaded"
#: The files the recogniser opens by name; the encoder's weights lie in many more beside them.
_CONFORMER_FILES = (
    "preprocessor.ts",
    "encoder.onnx",
    "ctc_decoder.onnx",
    "vocab.json",
    "language_masks.json",
)
WHISPER_MODELS = {
    "small": ("Systran/faster-whisper-small", "536b0662742c02347bc0e980a01041f333bce120"),
}
#: Below this probability of English, the English part is transcribed in the language heard, so
#: that a child answering in Hindi is not credited with a translation.
ENGLISH_LIKELY = 0.3


@dataclass(frozen=True)
class Recognition:
    text: str
    #: From 0 to 1; None when the recogniser gives no confidence.
    confidence: float | None = None
    #: How likely the speech was English; None when not measured.
    english_probability: float | None = None


class Recogniser(Protocol):
    #: Short name, stored in the engine version.
    name: str

    def recognise(
        self, samples: np.ndarray, language: str, detect_language: bool = False
    ) -> Recognition:
        """The text of the speech in `language`. With `detect_language`, speech found to be in
        another language is written in that language instead."""
        ...


class WhisperRecogniser:
    """faster-whisper (CTranslate2), int8 on a CPU and float16 on a GPU."""

    def __init__(self, size: str = "small", device: str = "cpu") -> None:
        from faster_whisper import WhisperModel
        from huggingface_hub import snapshot_download

        repository, revision = WHISPER_MODELS[size]
        path = snapshot_download(repository, revision=revision)
        self.model = WhisperModel(
            path,
            device=device,
            compute_type="float16" if device == "cuda" else "int8",
        )
        self.name = f"whisper-{size}"

    def _transcribe(self, samples: np.ndarray, language: str) -> Recognition:
        segments, _ = self.model.transcribe(
            samples,
            language=language,
            beam_size=5,
            condition_on_previous_text=False,
            vad_filter=False,
        )
        segments = list(segments)
        texts = [segment.text.strip() for segment in segments if segment.text.strip()]
        weight = sum(max(segment.end - segment.start, 0.01) for segment in segments)
        confidence = (
            sum(
                math.exp(segment.avg_logprob)
                * (1 - segment.no_speech_prob)
                * max(segment.end - segment.start, 0.01)
                for segment in segments
            )
            / weight
            if segments
            else None
        )
        return Recognition(
            text=" ".join(texts),
            confidence=None if confidence is None else min(max(confidence, 0.0), 1.0),
        )

    def recognise(
        self, samples: np.ndarray, language: str, detect_language: bool = False
    ) -> Recognition:
        # Reading is always heard in the language of the text; only the answer about the pictures
        # may come in another language than the one asked for.
        if not detect_language:
            return self._transcribe(samples, language)
        heard, _, probabilities = self.model.detect_language(samples)
        english = dict(probabilities).get("en", 0.0)
        result = self._transcribe(samples, language if english >= ENGLISH_LIKELY else heard)
        return Recognition(
            text=result.text,
            confidence=result.confidence,
            english_probability=float(english),
        )


def ctc_greedy(scores: np.ndarray, vocabulary: list[str], blank: int = CTC_BLANK) -> Recognition:
    """The text of CTC scores (frames by tokens) by greedy decoding, and its confidence.

    The scores are normalised over the given tokens. The confidence is the mean probability of the
    token chosen at the frames where one was emitted; it is None when nothing was.
    """
    if scores.size == 0:
        return Recognition(text="")
    shifted = scores - scores.max(axis=1, keepdims=True)
    log_probabilities = shifted - np.log(np.exp(shifted).sum(axis=1, keepdims=True))
    best = log_probabilities.argmax(axis=1)
    emitted = best != blank
    # A token held over several frames is written once; a blank between two separates them.
    first = np.concatenate(([True], best[1:] != best[:-1]))
    tokens = (vocabulary[index] for index in best[first & emitted])
    # Special tokens such as <unk> stand for a sound the model could not write.
    text = "".join(" " if token.startswith("<") else token for token in tokens)
    confidence = (
        float(np.exp(log_probabilities[emitted, best[emitted]]).mean()) if emitted.any() else None
    )
    return Recognition(text=" ".join(text.replace(_WORD_START, " ").split()), confidence=confidence)


def _conformer_home() -> Path:
    from huggingface_hub import constants

    return Path(constants.HF_HOME) / "agla-engine" / f"indic-conformer-{INDIC_CONFORMER_REVISION}"


def _gathered(folder: Path) -> bool:
    """Whether the folder still holds every file it held when the model last loaded from it."""
    try:
        names = (folder / _LOADED).read_text(encoding="utf-8").split()
    except OSError:
        return False
    return bool(names) and all((folder / name).is_file() for name in names)


def _mark_loaded(folder: Path) -> None:
    names = sorted(
        entry.name
        for entry in folder.iterdir()
        if entry.is_file() and entry.name != _LOADED and not entry.name.endswith(".partial")
    )
    (folder / _LOADED).write_text("\n".join(names) + "\n", encoding="utf-8")


def _conformer_folder() -> Path:
    """IndicConformer's files at the pinned revision, gathered in one folder.

    The download cache keeps each file as a link into a shared store, and ONNX Runtime refuses an
    encoder whose weights lie outside the encoder's own folder. The files are therefore linked
    (copied where a link is not possible) into a folder of their own, beside the cache.
    """
    from huggingface_hub import snapshot_download

    folder = _conformer_home()
    if _gathered(folder):
        return folder
    # Completes any file missing from an interrupted download, or removed since.
    snapshot = Path(snapshot_download(INDIC_CONFORMER, revision=INDIC_CONFORMER_REVISION))
    folder.mkdir(parents=True, exist_ok=True)
    for source in (snapshot / "assets").iterdir():
        target = folder / source.name
        if target.exists():
            continue
        original = source.resolve()
        try:
            os.link(original, target)
        except FileExistsError:
            # Another run gathered the same file meanwhile.
            continue
        except OSError:
            partial = target.with_name(target.name + ".partial")
            shutil.copyfile(original, partial)
            partial.replace(target)
    return folder


class IndicConformerRecogniser:
    """AI4Bharat IndicConformer 600M with greedy CTC decoding, on the CPU.

    Only the model's files are used, not the loading code published with them, which ignores the
    pinned revision and loads a second decoder for each of 22 languages. The feature extractor is
    TorchScript; the encoder and the CTC decoder are ONNX.
    """

    def __init__(self) -> None:
        import onnxruntime
        import torch

        folder = _conformer_folder()
        self._torch = torch
        with warnings.catch_warnings():
            # The feature extractor is published as TorchScript, which PyTorch now marks as
            # deprecated but still loads; the pinned PyTorch version keeps it working.
            warnings.simplefilter("ignore", FutureWarning)
            features = torch.jit.load(str(folder / "preprocessor.ts"), map_location="cpu")
        self._features = features.eval()
        cpu = ["CPUExecutionProvider"]
        self._encoder = onnxruntime.InferenceSession(str(folder / "encoder.onnx"), providers=cpu)
        self._ctc = onnxruntime.InferenceSession(str(folder / "ctc_decoder.onnx"), providers=cpu)
        self._vocabulary: dict[str, list[str]] = json.loads(
            (folder / "vocab.json").read_text(encoding="utf-8")
        )
        masks = json.loads((folder / "language_masks.json").read_text(encoding="utf-8"))
        # Each language's tokens among all the model's tokens.
        self._tokens = {
            language: np.flatnonzero(np.asarray(mask, dtype=bool))
            for language, mask in masks.items()
        }
        _mark_loaded(folder)
        self.name = "indicconformer-600m-ctc"

    def recognise(
        self, samples: np.ndarray, language: str, detect_language: bool = False
    ) -> Recognition:
        # Used for reading only, in the language of the text.
        if len(samples) == 0:
            return Recognition(text="")
        torch = self._torch
        audio = torch.from_numpy(np.ascontiguousarray(samples, dtype=np.float32)).unsqueeze(0)
        with torch.inference_mode():
            features, length = self._features(
                input_signal=audio, length=torch.tensor([audio.shape[-1]])
            )
        encoded, _ = self._encoder.run(
            ["outputs", "encoded_lengths"],
            {"audio_signal": features.numpy(), "length": length.numpy()},
        )
        scores = self._ctc.run(["logprobs"], {"encoder_output": encoded})[0][0]
        return ctc_greedy(scores[:, self._tokens[language]], self._vocabulary[language])


def indic_conformer_available() -> bool:
    """Whether IndicConformer can be loaded: its files are on this machine or can be fetched.

    The model is gated on Hugging Face: it is fetched once with an account that accepted its
    terms (see the setup guide), after which it is read from this machine.
    """
    try:
        from huggingface_hub import snapshot_download
        from huggingface_hub.errors import GatedRepoError, LocalEntryNotFoundError
    except ImportError:
        return False
    if _gathered(_conformer_home()):
        return True
    try:
        snapshot = Path(
            snapshot_download(
                INDIC_CONFORMER, revision=INDIC_CONFORMER_REVISION, local_files_only=True
            )
        )
        if all((snapshot / "assets" / name).is_file() for name in _CONFORMER_FILES):
            return True
    except LocalEntryNotFoundError:
        pass
    try:
        snapshot_download(INDIC_CONFORMER, revision=INDIC_CONFORMER_REVISION)
        return True
    except (GatedRepoError, OSError):
        return False
