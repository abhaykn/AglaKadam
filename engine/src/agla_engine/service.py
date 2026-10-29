"""The project's API as the engine uses it, with the secret key.

Only the service functions made for the engine and the scoring tables are used. The key is sent
in the headers the Supabase API expects and never appears in a message or a log.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

import httpx

BUCKET = "pulse-audio"
NOTES_BUCKET = "visit-notes"
#: Storage answers 400 or 404 for an object that is not there.
MISSING_STATUSES = (400, 404)


class ServiceError(RuntimeError):
    """The API refused or failed a request."""

    def __init__(self, what: str, status: int, detail: str) -> None:
        super().__init__(f"{what} failed with HTTP {status}: {detail[:300]}")
        self.status = status


class MissingRecording(LookupError):
    """The recording of a check is not in storage. It concerns that check only."""

    def __init__(self, path: str) -> None:
        super().__init__("The recording is not in storage.")
        self.path = path


class Service:
    def __init__(
        self,
        url: str,
        secret_key: str,
        timeout: float = 60.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        if not url.startswith("https://") and not url.startswith("http://127.0.0.1"):
            raise ValueError("The project URL must start with https://.")
        if not secret_key.startswith("sb_secret_"):
            raise ValueError("The key must be the project's secret key (sb_secret_...).")
        self._client = httpx.Client(
            base_url=url.rstrip("/"),
            headers={"apikey": secret_key, "Authorization": f"Bearer {secret_key}"},
            timeout=timeout,
            # A connection that cannot be opened is tried again before the run gives up.
            transport=transport or httpx.HTTPTransport(retries=2),
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> Service:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def _check(self, response: httpx.Response, what: str) -> httpx.Response:
        if response.is_error:
            raise ServiceError(what, response.status_code, response.text)
        return response

    def _rpc(self, name: str, arguments: dict[str, Any]) -> Any:
        response = self._client.post(f"/rest/v1/rpc/{name}", json=arguments)
        return self._check(response, name).json()

    def checks_to_score(self, batch_size: int, engine_version: str) -> list[dict[str, Any]]:
        rows = self._rpc(
            "service_pulse_checks_to_score",
            {"batch_size": batch_size, "current_engine": engine_version},
        )
        return list(rows or [])

    def download(self, path: str, bucket: str = BUCKET) -> bytes:
        response = self._client.get(f"/storage/v1/object/{bucket}/{quote(path)}")
        if response.status_code in MISSING_STATUSES:
            raise MissingRecording(path)
        return self._check(response, "Downloading a recording").content

    def save_score(self, row: dict[str, Any]) -> None:
        response = self._client.post(
            "/rest/v1/pulse_scores",
            params={"on_conflict": "check_id"},
            json=row,
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
        )
        self._check(response, "Saving a score")

    def record_failure(
        self, check_id: str, engine_version: str, reason: str, counts_attempt: bool = True
    ) -> int:
        """Notes an attempt to score a check (with `counts_attempt` false: the reason the same
        attempt failed) and returns the number of attempts so far."""
        attempts = self._rpc(
            "service_record_pulse_score_failure",
            {
                "target_check_id": check_id,
                "current_engine": engine_version,
                "failure_reason": reason[:500],
                "counts_attempt": counts_attempt,
            },
        )
        return int(attempts)

    def agreement(self, since_iso: str, engine_version: str) -> list[dict[str, Any]]:
        """How often each pair of the teacher's and this engine's levels occurred."""
        rows = self._rpc(
            "service_pulse_agreement", {"since": since_iso, "current_engine": engine_version}
        )
        return list(rows or [])

    def notes_to_transcribe(self, batch_size: int, engine_version: str) -> list[dict[str, Any]]:
        """CRPs' voice notes of visits waiting for a transcript; notes this engine failed on three
        times are left out."""
        rows = self._rpc(
            "service_visit_notes_to_transcribe",
            {"batch_size": batch_size, "current_engine": engine_version[:120]},
        )
        return list(rows or [])

    def save_note_transcript(
        self, visit_id: str, path: str, transcript: str, engine_version: str
    ) -> bool:
        """Saves a note's transcript; false when the note was recorded again or removed."""
        saved = self._rpc(
            "service_save_visit_note_transcript",
            {
                "target_visit_id": visit_id,
                "target_path": path,
                "note_transcript": transcript[:8000],
                "engine": engine_version[:120],
            },
        )
        return bool(saved)

    def record_note_failure(self, visit_id: str, path: str, engine_version: str) -> int:
        """Notes an attempt by this engine to transcribe a note; returns its attempts so far."""
        attempts = self._rpc(
            "service_record_visit_note_failure",
            {"target_visit_id": visit_id, "target_path": path, "engine": engine_version[:120]},
        )
        return int(attempts or 0)

    def log_run(self, row: dict[str, Any]) -> None:
        response = self._client.post(
            "/rest/v1/pulse_scoring_runs",
            json=row,
            headers={"Prefer": "return=minimal"},
        )
        self._check(response, "Logging the run")
