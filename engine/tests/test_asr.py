import os
from pathlib import Path

import numpy as np
import pytest

from agla_engine import asr
from agla_engine.asr import ctc_greedy

WORD = chr(0x2581)
KA, LA = chr(0x0915), chr(0x0932)
# The model's layout: each language's tokens, with the blank last.
VOCABULARY = [WORD + KA, LA, "<unk>", "|"]
BLANK = 3


def scores_for(path: list[int], margin: float = 20.0) -> np.ndarray:
    """Scores (frames by tokens) in which the given token is clearly the best at each frame."""
    scores = np.zeros((len(path), len(VOCABULARY)), dtype=np.float32)
    for frame, token in enumerate(path):
        scores[frame, token] = margin
    return scores


def test_greedy_decoding_writes_each_token_once():
    result = ctc_greedy(scores_for([0, 0, BLANK, 1, 1, BLANK, 0]), VOCABULARY, BLANK)
    assert result.text == f"{KA}{LA} {KA}"
    assert result.confidence == pytest.approx(1.0, abs=1e-6)


def test_a_blank_separates_a_token_said_twice():
    assert ctc_greedy(scores_for([1, BLANK, 1]), VOCABULARY, BLANK).text == LA + LA
    assert ctc_greedy(scores_for([1, 1, 1]), VOCABULARY, BLANK).text == LA


def test_an_unknown_sound_breaks_the_word():
    assert ctc_greedy(scores_for([0, 2, 1]), VOCABULARY, BLANK).text == f"{KA} {LA}"


def test_nothing_emitted_has_no_text_and_no_confidence():
    result = ctc_greedy(scores_for([BLANK, BLANK]), VOCABULARY, BLANK)
    assert (result.text, result.confidence) == ("", None)
    assert ctc_greedy(np.zeros((0, 4), dtype=np.float32), VOCABULARY, BLANK).text == ""


def test_an_uncertain_choice_lowers_the_confidence():
    scores = np.full((1, 4), -20.0, dtype=np.float32)
    scores[0, 0] = scores[0, 1] = 0.0  # two tokens equally likely
    result = ctc_greedy(scores, VOCABULARY, BLANK)
    assert result.confidence == pytest.approx(0.5, abs=1e-3)


def test_the_model_files_are_gathered_in_one_folder(tmp_path, monkeypatch):
    hub = pytest.importorskip("huggingface_hub")
    constants = pytest.importorskip("huggingface_hub.constants")
    assets = tmp_path / "snapshot" / "assets"
    assets.mkdir(parents=True)
    (assets / "encoder.onnx").write_bytes(b"encoder")
    (assets / "layers.0.weight").write_bytes(b"weights")
    calls: list[str] = []

    def snapshot_download(repository: str, revision: str, local_files_only: bool = False) -> str:
        calls.append("local" if local_files_only else revision)
        return str(tmp_path / "snapshot")

    monkeypatch.setattr(constants, "HF_HOME", str(tmp_path / "home"))
    monkeypatch.setattr(hub, "snapshot_download", snapshot_download)

    folder = asr._conformer_folder()
    assert calls == [asr.INDIC_CONFORMER_REVISION]
    assert folder.parent == tmp_path / "home" / "agla-engine"
    assert (folder / "layers.0.weight").read_bytes() == b"weights"
    # Linked, not copied: the weights take no second place on the disk.
    assert os.stat(folder / "encoder.onnx").st_nlink == 2
    # Once the model has loaded from the folder, the cache is not consulted again.
    asr._mark_loaded(folder)
    assert asr._conformer_folder() == folder
    assert asr.indic_conformer_available()
    assert len(calls) == 1

    # A file removed since (a disk being tidied) is gathered again.
    (folder / "layers.0.weight").unlink()
    assert not asr._gathered(folder)
    assert asr._conformer_folder() == folder
    assert (folder / "layers.0.weight").read_bytes() == b"weights"
    assert len(calls) == 2


def test_a_file_gathered_by_another_run_meanwhile_is_kept(tmp_path, monkeypatch):
    hub = pytest.importorskip("huggingface_hub")
    constants = pytest.importorskip("huggingface_hub.constants")
    assets = tmp_path / "snapshot" / "assets"
    assets.mkdir(parents=True)
    (assets / "encoder.onnx").write_bytes(b"encoder")
    monkeypatch.setattr(constants, "HF_HOME", str(tmp_path / "home"))
    monkeypatch.setattr(hub, "snapshot_download", lambda *a, **k: str(tmp_path / "snapshot"))

    def link(source: object, target: Path) -> None:
        # The other run's link appears just before this one.
        target.write_bytes(b"encoder")
        raise FileExistsError(target)

    monkeypatch.setattr(asr.os, "link", link)
    folder = asr._conformer_folder()
    assert (folder / "encoder.onnx").exists()
    assert not list(folder.glob("*.partial"))


def test_an_incomplete_download_is_not_taken_for_the_model(tmp_path, monkeypatch):
    hub = pytest.importorskip("huggingface_hub")
    constants = pytest.importorskip("huggingface_hub.constants")
    (tmp_path / "snapshot" / "assets").mkdir(parents=True)
    (tmp_path / "snapshot" / "assets" / "encoder.onnx").write_bytes(b"encoder")
    calls: list[bool] = []

    def snapshot_download(repository: str, revision: str, local_files_only: bool = False) -> str:
        calls.append(local_files_only)
        if not local_files_only:
            raise OSError("The network is not available.")
        return str(tmp_path / "snapshot")

    monkeypatch.setattr(constants, "HF_HOME", str(tmp_path / "home"))
    monkeypatch.setattr(hub, "snapshot_download", snapshot_download)
    assert not asr.indic_conformer_available()
    assert calls == [True, False]
