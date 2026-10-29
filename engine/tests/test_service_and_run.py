import json

import httpx
import pytest

from agla_engine.asr import Recognition
from agla_engine.cli import main
from agla_engine.engine import CheckToScore
from agla_engine.item import parse_item
from agla_engine.run import (
    FAILURES_IN_A_ROW,
    STARTED,
    RunAborted,
    agreement,
    run,
    run_notes,
)
from agla_engine.scoring import Hearing, score_check
from agla_engine.service import Service, ServiceError

KEY = "sb_secret_unit_test_only"
URL = "https://project.supabase.co"
VERSION = "pulse-engine 1.0 (test)"


def check_id(number: int) -> str:
    return f"00000000-0000-4000-8000-{number:012d}"


def check_row(number: int, recording: str = "recording") -> dict:
    return {
        "check_id": check_id(number),
        "audio_path": f"class/sample/{recording} {number}.webm",
        "audio_type": "audio/webm",
        "item": {
            "reading": {"passage": "the cat sat on the mat", "words": [], "letters": []},
            "speaking": {"keywords": ["cat"], "question": "What is this?"},
            "shown": [{"level": "passage", "atMs": 0}, {"level": "english", "atMs": 30000}],
        },
        "grade": 1,
        "reading_language": "en",
        "duration_ms": 58000,
        "item_seen_before": False,
    }


AGREEMENT = [
    {
        "teacher_reading": "fluent",
        "machine_reading": "fluent",
        "teacher_english": "words",
        "machine_english": "words",
        "checks": 3,
    },
    {
        "teacher_reading": "hesitant",
        "machine_reading": "hesitant",
        "teacher_english": "sentences",
        "machine_english": "words",
        "checks": 1,
    },
]


class FakeServer:
    """The parts of the API the engine uses, kept in memory, as the database functions behave."""

    def __init__(self, waiting: list[dict]) -> None:
        self.waiting = waiting
        self.scores: dict[str, dict] = {}
        self.attempts: dict[str, int] = {}
        self.reasons: dict[str, str] = {}
        self.runs: list[dict] = []
        self.requests: list[httpx.Request] = []
        self.notes: list[dict] = []
        self.transcripts: dict[str, str] = {}
        self.note_failures: dict[str, int] = {}

    def listed(self, batch_size: int) -> list[dict]:
        rows = [
            row
            for row in self.waiting
            if row["check_id"] not in self.scores and self.attempts.get(row["check_id"], 0) < 3
        ]
        # Checks already tried come after the others.
        rows.sort(key=lambda row: self.attempts.get(row["check_id"], 0))
        return rows[:batch_size]

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        assert request.headers["apikey"] == KEY
        assert request.headers["authorization"] == f"Bearer {KEY}"
        path = request.url.path
        body = json.loads(request.content) if request.content else {}
        if path == "/rest/v1/rpc/service_pulse_checks_to_score":
            assert body["current_engine"] == VERSION
            return httpx.Response(200, json=self.listed(body["batch_size"]))
        if path == "/rest/v1/rpc/service_visit_notes_to_transcribe":
            assert body["current_engine"] == VERSION
            rows = [
                note
                for note in self.notes
                if note["visit_id"] not in self.transcripts
                and self.note_failures.get(note["visit_id"], 0) < 3
            ]
            return httpx.Response(200, json=rows[: body["batch_size"]])
        if path.startswith("/storage/v1/object/visit-notes/"):
            name = request.url.path.rsplit("/", 1)[-1]
            if name.startswith("unavailable"):
                return httpx.Response(503, text="Service unavailable")
            if name.startswith("missing"):
                return httpx.Response(404, json={"error": "not_found"})
            return httpx.Response(
                200, content=b"damaged" if name.startswith("damaged") else b"note"
            )
        if path == "/rest/v1/rpc/service_record_visit_note_failure":
            assert body["engine"] == VERSION
            target = body["target_visit_id"]
            self.note_failures[target] = self.note_failures.get(target, 0) + 1
            return httpx.Response(200, json=self.note_failures[target])
        if path == "/rest/v1/rpc/service_save_visit_note_transcript":
            assert body["engine"] == VERSION
            self.transcripts[body["target_visit_id"]] = body["note_transcript"]
            return httpx.Response(200, json=True)
        if path.startswith("/storage/v1/object/pulse-audio/"):
            name = request.url.path.rsplit("/", 1)[-1]
            if name.startswith("damaged"):
                return httpx.Response(200, content=b"damaged")
            if name.startswith("missing"):
                return httpx.Response(400, json={"statusCode": "404", "error": "not_found"})
            if name.startswith("unavailable"):
                return httpx.Response(503, text="Service unavailable")
            return httpx.Response(200, content=b"recording")
        if path == "/rest/v1/pulse_scores":
            assert request.url.params["on_conflict"] == "check_id"
            assert "resolution=merge-duplicates" in request.headers["prefer"]
            self.scores[body["check_id"]] = body
            # A check that is scored at last is no longer listed as a failure.
            self.attempts.pop(body["check_id"], None)
            self.reasons.pop(body["check_id"], None)
            return httpx.Response(201)
        if path == "/rest/v1/rpc/service_record_pulse_score_failure":
            target = body["target_check_id"]
            assert body["current_engine"] == VERSION
            if body["counts_attempt"] or target not in self.attempts:
                self.attempts[target] = self.attempts.get(target, 0) + 1
            self.reasons[target] = body["failure_reason"]
            return httpx.Response(200, json=self.attempts[target])
        if path == "/rest/v1/rpc/service_pulse_agreement":
            assert body["current_engine"] == VERSION
            assert body["since"]
            return httpx.Response(200, json=AGREEMENT)
        if path == "/rest/v1/pulse_scoring_runs":
            self.runs.append(body)
            return httpx.Response(201)
        return httpx.Response(404, text="not found")


class FakeScorer:
    version = VERSION

    def __init__(self, server: FakeServer | None = None) -> None:
        self.server = server
        self.started_with: list[tuple[int, str]] = []

    def score(self, recording: bytes, check: CheckToScore):
        if self.server is not None:
            # What the server knew of the check while it was being scored.
            self.started_with.append(
                (self.server.attempts[check.check_id], self.server.reasons[check.check_id])
            )
        if recording == b"damaged":
            raise ValueError("The recording could not be decoded.")
        item = parse_item(check.item, check.grade, check.reading_language)
        passage = "the cat sat on the mat"
        return score_check(
            item,
            {
                "passage": Hearing("passage", passage, 30.0, 10.0, 1.0, 11.0, confidence=0.9),
                "english": Hearing(
                    "english", "a cat", 28.0, 2.0, 0.5, 2.5, confidence=0.8, english_probability=0.9
                ),
            },
        )


def service_for(server: FakeServer) -> Service:
    return Service(URL, KEY, transport=httpx.MockTransport(server.handle))


def test_scores_waiting_checks_and_logs_the_run():
    server = FakeServer([check_row(1), check_row(2, "damaged"), check_row(3)])
    messages: list[str] = []
    with service_for(server) as service:
        summary = run(service, FakeScorer(), runner="scheduled", batch_size=2, log=messages.append)

    assert sorted(server.scores) == [check_id(1), check_id(3)]
    saved = server.scores[check_id(1)]
    assert saved["engine_version"] == VERSION
    # Six words read correctly in 10 seconds: 36 words a minute, above the Class 1 goal of 25.
    assert saved["wcpm"] == 36.0
    assert saved["reading_level"] == "fluent"
    # The damaged recording is tried once in this run, with its reason, and left for the next.
    assert server.attempts == {check_id(2): 1}
    assert server.reasons[check_id(2)].startswith("ValueError: ")
    # Agreement over the grouped counts: 4 checks, reading levels all the same.
    assert (summary.scored, summary.failed, summary.compared) == (2, 1, 4)
    assert summary.reading_kappa == 1.0
    assert summary.english_kappa is not None and summary.english_kappa < 1.0
    assert not summary.stopped_early
    assert len(server.runs) == 1
    assert server.runs[0]["runner"] == "scheduled"
    assert (server.runs[0]["scored"], server.runs[0]["failed"]) == (2, 1)
    assert server.runs[0]["compared"] == 4
    assert not any(KEY in message for message in messages)
    # The recording's path is sent encoded.
    downloads = [r for r in server.requests if r.url.path.startswith("/storage/")]
    assert all(b" " not in r.url.raw_path for r in downloads)


def test_an_attempt_is_counted_before_the_engine_starts():
    # A run that ends in the middle of a check still counts the attempt, so that a recording that
    # stops the engine every time is given up after its third attempt.
    server = FakeServer([check_row(1), check_row(2, "damaged")])
    scorer = FakeScorer(server)
    with service_for(server) as service:
        run(service, scorer, runner="local", log=lambda _: None)
    assert scorer.started_with == [(1, STARTED), (1, STARTED)]
    # The failure's reason replaced the note without counting a second attempt.
    assert server.attempts[check_id(2)] == 1


def test_a_check_tried_three_times_is_left_alone():
    server = FakeServer([check_row(1, "damaged")])
    for _ in range(4):
        with service_for(server) as service:
            run(service, FakeScorer(), runner="scheduled", log=lambda _: None)
    assert server.attempts[check_id(1)] == 3
    assert [entry["failed"] for entry in server.runs] == [1, 1, 1, 0]


def test_a_missing_recording_concerns_that_check_only():
    server = FakeServer([check_row(1, "missing"), check_row(2)])
    with service_for(server) as service:
        summary = run(service, FakeScorer(), runner="scheduled", log=lambda _: None)
    assert (summary.scored, summary.failed) == (1, 1)
    assert server.reasons[check_id(1)].startswith("MissingRecording: ")


def test_the_service_failing_ends_the_run():
    server = FakeServer([check_row(1), check_row(2, "unavailable"), check_row(3)])
    with service_for(server) as service, pytest.raises(ServiceError) as raised:
        run(service, FakeScorer(), runner="scheduled", log=lambda _: None)
    assert raised.value.status == 503
    # The run is logged with what it did; the check it stopped at keeps its attempt.
    assert sorted(server.scores) == [check_id(1)]
    assert server.attempts == {check_id(2): 1}
    assert len(server.runs) == 1
    assert (server.runs[0]["scored"], server.runs[0]["failed"]) == (1, 0)


def test_checks_failing_one_after_another_end_the_run():
    server = FakeServer([check_row(number, "damaged") for number in range(1, 10)])
    with service_for(server) as service, pytest.raises(RunAborted):
        run(service, FakeScorer(), runner="scheduled", log=lambda _: None)
    assert len(server.attempts) == FAILURES_IN_A_ROW
    assert server.runs[0]["failed"] == FAILURES_IN_A_ROW


def test_a_success_starts_the_count_of_failures_again():
    rows = [check_row(number, "damaged") for number in range(1, 5)]
    rows += [check_row(5)]
    rows += [check_row(number, "damaged") for number in range(6, 10)]
    server = FakeServer(rows)
    with service_for(server) as service:
        summary = run(service, FakeScorer(), runner="scheduled", log=lambda _: None)
    assert (summary.scored, summary.failed) == (1, 8)


def test_the_list_grows_with_the_checks_that_failed():
    # Checks that failed in this run are listed again; the list is made longer by their number,
    # so that the checks after them are still reached.
    rows = [check_row(1, "damaged"), check_row(2, "damaged"), check_row(3), check_row(4)]
    server = FakeServer(rows)
    with service_for(server) as service:
        summary = run(service, FakeScorer(), runner="scheduled", batch_size=2, log=lambda _: None)
    assert (summary.scored, summary.failed) == (2, 2)
    sizes = [
        json.loads(r.content)["batch_size"]
        for r in server.requests
        if r.url.path.endswith("service_pulse_checks_to_score")
    ]
    # The last list holds only the two that failed: the run ends there.
    assert sizes == [2, 4, 4]


def test_a_run_stops_at_the_time_limit():
    server = FakeServer([check_row(1), check_row(2)])
    with service_for(server) as service:
        summary = run(service, FakeScorer(), runner="gpu", max_minutes=-1, log=lambda _: None)
    assert summary.stopped_early
    assert summary.scored == 0
    assert server.runs[0]["runner"] == "gpu"


def test_refuses_a_key_that_is_not_the_secret_key():
    with pytest.raises(ValueError):
        Service(URL, "sb_publishable_x")
    with pytest.raises(ValueError):
        Service("http://example.org", KEY)


def test_reports_api_errors_without_the_key():
    def refuse(_: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text="Invalid API key")

    with (
        Service(URL, KEY, transport=httpx.MockTransport(refuse)) as service,
        pytest.raises(ServiceError) as raised,
    ):
        service.checks_to_score(10, "x")
    assert raised.value.status == 401
    assert KEY not in str(raised.value)


def test_agreement_of_the_two_scales():
    compared, reading, english = agreement(
        [
            {
                "teacher_reading": "fluent",
                "machine_reading": "fluent",
                "teacher_english": "words",
                "machine_english": "words",
                "checks": 2,
            },
            {
                "teacher_reading": "needs_support",
                "machine_reading": "needs_support",
                "teacher_english": "sentences",
                "machine_english": "no_response",
                "checks": 1,
            },
            {
                "teacher_reading": "hesitant",
                "machine_reading": "fluent",
                "teacher_english": "words",
                "machine_english": "words",
                "checks": 0,
            },
        ]
    )
    assert compared == 3
    assert reading == 1.0
    assert english is not None and english < 1.0
    assert agreement([]) == (0, None, None)


def test_the_command_line_checks_its_arguments(monkeypatch, capsys):
    with pytest.raises(SystemExit) as raised:
        main(["score", "--batch-size", "0"])
    assert raised.value.code == 2
    with pytest.raises(SystemExit):
        main(["score", "--batch-size", "501"])
    with pytest.raises(SystemExit):
        main(["score", "--max-minutes", "ten"])
    # Without the project's address and key, nothing is loaded.
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SECRET_KEY", raising=False)
    assert main(["score"]) == 2
    assert "SUPABASE_URL" in capsys.readouterr().err


class FakeTranscriber:
    version = VERSION

    def transcribe(self, recording: bytes, language: str) -> Recognition:
        if recording == b"damaged":
            raise ValueError("The note could not be decoded.")
        return Recognition(text=f"note in {language}")


def note_row(number: int, name: str = "note", language: str = "hi") -> dict:
    visit_id = check_id(number)
    return {
        "visit_id": visit_id,
        "audio_path": f"{visit_id}/{name}-{number}.webm",
        "audio_type": "audio/webm",
        "language": language,
        "duration_ms": 95_000,
    }


def test_writes_the_transcripts_of_voice_notes():
    server = FakeServer([])
    server.notes = [note_row(1), note_row(2, "damaged"), note_row(3, language="en")]
    with service_for(server) as service:
        summary = run_notes(service, FakeTranscriber(), log=lambda _: None)
    assert (summary.transcribed, summary.failed, summary.stopped_early) == (2, 1, False)
    assert server.transcripts == {check_id(1): "note in hi", check_id(3): "note in en"}
    # Every note is counted as attempted before the engine starts on it.
    assert server.note_failures == {check_id(1): 1, check_id(2): 1, check_id(3): 1}
    downloads = [r.url.path for r in server.requests if r.url.path.startswith("/storage/")]
    assert all(path.startswith("/storage/v1/object/visit-notes/") for path in downloads)


def test_the_service_failing_ends_the_notes_run_without_counting_against_the_note():
    server = FakeServer([])
    server.notes = [note_row(1, "unavailable")]
    with service_for(server) as service, pytest.raises(ServiceError):
        run_notes(service, FakeTranscriber(), log=lambda _: None)
    assert server.note_failures == {}


def test_a_note_missing_from_storage_counts_as_its_attempt_only():
    server = FakeServer([])
    server.notes = [note_row(1, "missing"), note_row(2)]
    with service_for(server) as service:
        summary = run_notes(service, FakeTranscriber(), log=lambda _: None)
    assert (summary.transcribed, summary.failed) == (1, 1)
    assert server.note_failures == {check_id(1): 1, check_id(2): 1}


def test_the_notes_are_transcribed_when_scoring_stops(monkeypatch, capsys):
    import agla_engine.engine as engine_module
    import agla_engine.run as run_module
    import agla_engine.service as service_module
    from agla_engine.run import NotesSummary

    class FakeEngine:
        version = VERSION

    class FakeService:
        def __init__(self, url: str, key: str) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *exc: object) -> None:
            return None

    def failing_run(*args: object, **kwargs: object):
        raise RunAborted("5 checks in a row could not be scored.")

    transcribed: list[bool] = []

    def notes(*args: object, **kwargs: object) -> NotesSummary:
        transcribed.append(True)
        return NotesSummary(transcribed=2, failed=0, stopped_early=False)

    monkeypatch.setenv("SUPABASE_URL", URL)
    monkeypatch.setenv("SUPABASE_SECRET_KEY", KEY)
    monkeypatch.setattr(engine_module, "load_engine", lambda **kwargs: FakeEngine())
    monkeypatch.setattr(service_module, "Service", FakeService)
    monkeypatch.setattr(run_module, "run", failing_run)
    monkeypatch.setattr(run_module, "run_notes", notes)
    assert main(["score", "--device", "cpu"]) == 1
    assert transcribed == [True]
    output = capsys.readouterr()
    assert "Scoring stopped" in output.err
    assert "Transcribed 2 voice notes" in output.out
