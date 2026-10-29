"""A run of the engine over the checks waiting to be scored.

Each check is noted as attempted before the engine starts on it, so that a run that ends in the
middle (a time limit, a machine that stops) still counts the attempt, and a recording that stops the
engine every time is given up after its third attempt. A check that cannot be scored is noted with
its reason and the run goes on. A failure of the service itself (a refused key, a network that is
down) ends the run, and so do several checks failing one after another, which points to the engine
rather than to the recordings.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

import httpx

from .asr import Recognition
from .engine import CheckToScore
from .kappa import cohen_kappa
from .scoring import Score
from .service import NOTES_BUCKET, MissingRecording, Service, ServiceError

READING_LEVELS = ("needs_support", "hesitant", "fluent")
ENGLISH_LEVELS = ("no_response", "words", "sentences")
#: Agreement is measured over the checks of this many days, so that it follows recent practice.
AGREEMENT_DAYS = 90
#: Checks failing one after another that end the run.
FAILURES_IN_A_ROW = 5
#: The most checks the service lists at once.
MAX_BATCH = 500
#: The reason kept for an attempt until the engine finishes it.
STARTED = "Scoring started; the run ended before it finished."


class Scorer(Protocol):
    version: str

    def score(self, recording: bytes, check: CheckToScore) -> Score: ...


class RunAborted(RuntimeError):
    """The run stopped because the engine is failing on every recording."""


@dataclass(frozen=True)
class RunSummary:
    scored: int
    failed: int
    compared: int
    reading_kappa: float | None
    english_kappa: float | None
    stopped_early: bool


def _reason(error: Exception) -> str:
    """A short reason for the failure log, without file contents or keys."""
    return f"{type(error).__name__}: {error}"[:500]


def agreement(rows: list[dict[str, Any]]) -> tuple[int, float | None, float | None]:
    """How far the engine agreed with the teachers: the number of checks compared, and Cohen's
    kappa for reading and for English. Each row is a pair of levels and the number of checks that
    had it."""
    reading: list[tuple[str, str]] = []
    english: list[tuple[str, str]] = []
    compared = 0
    for row in rows:
        checks = max(int(row.get("checks") or 0), 0)
        compared += checks
        reading += [(str(row["teacher_reading"]), str(row["machine_reading"]))] * checks
        english += [(str(row["teacher_english"]), str(row["machine_english"]))] * checks
    return (
        compared,
        cohen_kappa(reading, READING_LEVELS),
        cohen_kappa(english, ENGLISH_LEVELS),
    )


def run(
    service: Service,
    scorer: Scorer,
    runner: str,
    batch_size: int = 100,
    max_minutes: float = 90.0,
    log: Callable[[str], None] = print,
) -> RunSummary:
    """Scores the waiting checks, oldest first, until none are left or the time is up.

    Raises `ServiceError` or an `httpx` error when the service fails, and `RunAborted` when
    `FAILURES_IN_A_ROW` checks fail one after another; the run is logged first in both cases.
    """
    started_at = datetime.now(UTC)
    deadline = time.monotonic() + max_minutes * 60
    scored = failed = in_a_row = 0
    stopped_early = False
    # A check that failed is listed again until its third attempt; each run tries it once. Such
    # checks can take up a place in the list, which is made longer by their number.
    tried: set[str] = set()

    def log_run(compared: int, reading_kappa: float | None, english_kappa: float | None) -> None:
        service.log_run(
            {
                "runner": runner,
                "engine_version": scorer.version,
                "started_at": started_at.isoformat(),
                "scored": scored,
                "failed": failed,
                "compared": compared,
                "reading_kappa": None if reading_kappa is None else round(reading_kappa, 4),
                "english_kappa": None if english_kappa is None else round(english_kappa, 4),
            }
        )

    try:
        while not stopped_early:
            wanted = min(batch_size + failed, MAX_BATCH)
            rows = service.checks_to_score(wanted, scorer.version)
            fresh = [row for row in rows if str(row["check_id"]) not in tried]
            for row in fresh:
                if time.monotonic() > deadline:
                    stopped_early = True
                    break
                check = CheckToScore.from_row(row)
                tried.add(check.check_id)
                attempt = service.record_failure(check.check_id, scorer.version, STARTED)
                try:
                    score = scorer.score(service.download(check.audio_path), check)
                except (ServiceError, httpx.HTTPError):
                    raise
                except Exception as error:
                    failed += 1
                    in_a_row += 1
                    service.record_failure(
                        check.check_id, scorer.version, _reason(error), counts_attempt=False
                    )
                    log(f"Could not score {check.check_id} (attempt {attempt}): {_reason(error)}")
                    if in_a_row >= FAILURES_IN_A_ROW:
                        raise RunAborted(
                            f"{in_a_row} checks in a row could not be scored; the engine is "
                            "failing rather than the recordings."
                        ) from error
                    continue
                service.save_score(score.row(check.check_id, scorer.version))
                scored += 1
                in_a_row = 0
                log(
                    f"Scored {check.check_id}: reading {score.reading.level}, "
                    f"English {score.english.level}."
                )
            if not fresh or len(rows) < wanted:
                break
    except Exception:
        # The run is logged with what it did, when the service still answers.
        try:
            log_run(0, None, None)
        except Exception as error:
            log(f"The run could not be logged: {_reason(error)}")
        raise

    since = (datetime.now(UTC) - timedelta(days=AGREEMENT_DAYS)).isoformat()
    compared, reading_kappa, english_kappa = agreement(service.agreement(since, scorer.version))
    log_run(compared, reading_kappa, english_kappa)
    return RunSummary(scored, failed, compared, reading_kappa, english_kappa, stopped_early)


class Transcriber(Protocol):
    version: str

    def transcribe(self, recording: bytes, language: str) -> Recognition: ...


@dataclass(frozen=True)
class NotesSummary:
    transcribed: int
    failed: int
    stopped_early: bool


def run_notes(
    service: Service,
    transcriber: Transcriber,
    batch_size: int = 50,
    max_minutes: float = 30.0,
    log: Callable[[str], None] = print,
) -> NotesSummary:
    """Writes the transcripts of the CRPs' voice notes waiting for one, oldest first.

    As with scoring, an attempt is noted before the engine starts on a note, and a note this engine
    cannot transcribe three times is left alone. The attempt is noted once the note's file is at
    hand, so that a connection that fails does not count against the note. The run ends when the
    service fails or several notes in a row cannot be transcribed.
    """
    deadline = time.monotonic() + max_minutes * 60
    transcribed = failed = in_a_row = 0
    stopped_early = False
    tried: set[str] = set()
    while not stopped_early:
        wanted = min(batch_size + failed, MAX_BATCH)
        rows = service.notes_to_transcribe(wanted, transcriber.version)
        fresh = [row for row in rows if str(row["visit_id"]) not in tried]
        for row in fresh:
            if time.monotonic() > deadline:
                stopped_early = True
                break
            visit_id, path = str(row["visit_id"]), str(row["audio_path"])
            tried.add(visit_id)
            try:
                recording = service.download(path, bucket=NOTES_BUCKET)
            except MissingRecording:
                # The file is gone: an attempt of this note, not a failure of the engine.
                service.record_note_failure(visit_id, path, transcriber.version)
                failed += 1
                log(f"The note of visit {visit_id} is not in storage.")
                continue
            service.record_note_failure(visit_id, path, transcriber.version)
            try:
                result = transcriber.transcribe(recording, str(row.get("language") or "hi"))
            except (ServiceError, httpx.HTTPError):
                raise
            except Exception as error:
                failed += 1
                in_a_row += 1
                log(f"Could not transcribe the note of visit {visit_id}: {_reason(error)}")
                if in_a_row >= FAILURES_IN_A_ROW:
                    raise RunAborted(
                        f"{in_a_row} notes in a row could not be transcribed; the engine is "
                        "failing rather than the recordings."
                    ) from error
                continue
            if service.save_note_transcript(visit_id, path, result.text, transcriber.version):
                transcribed += 1
                in_a_row = 0
                log(f"Transcribed the note of visit {visit_id}.")
        if not fresh or len(rows) < wanted:
            break
    return NotesSummary(transcribed, failed, stopped_early)
