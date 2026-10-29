"""Command line of the engine.

agla-engine score            score the checks waiting on the server, then write the transcripts
                             of the CRPs' voice notes (needs SUPABASE_URL and SUPABASE_SECRET_KEY
                             in the environment)
agla-engine download-models  fetch the speech models once, before a run without a network
agla-engine try FILE ITEM    score a recording on this machine and print the result; nothing
                             is sent anywhere
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any


def _device(requested: str) -> str:
    if requested != "auto":
        return requested
    try:
        import torch

        return "cuda" if torch.cuda.is_available() else "cpu"
    except ImportError:
        return "cpu"


def _number(kind: type[int] | type[float], low: float, high: float) -> Any:
    """An argument type that accepts numbers from `low` to `high`."""

    def parse(value: str) -> int | float:
        try:
            number = kind(value)
        except ValueError:
            raise argparse.ArgumentTypeError(f"{value!r} is not a number.") from None
        if not low <= number <= high:
            raise argparse.ArgumentTypeError(f"must be from {low:g} to {high:g}.")
        return number

    return parse


def _score(arguments: argparse.Namespace) -> int:
    import httpx

    from .engine import load_engine
    from .run import RunAborted, run, run_notes
    from .service import Service, ServiceError

    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SECRET_KEY", "").strip()
    if not url or not key:
        print("Set SUPABASE_URL and SUPABASE_SECRET_KEY in the environment first.", file=sys.stderr)
        return 2
    engine = load_engine(device=_device(arguments.device), hindi=arguments.hindi)
    print(f"Engine: {engine.version}")
    summary = notes = None
    scoring_stopped = False
    try:
        with Service(url, key) as service:
            try:
                summary = run(
                    service,
                    engine,
                    runner=arguments.runner,
                    batch_size=arguments.batch_size,
                    max_minutes=arguments.max_minutes,
                )
            except RunAborted as error:
                # Scoring failing on every check does not hold up the voice notes, which need only
                # the recogniser; they stop on their own if it is the recogniser that fails.
                print(f"Scoring stopped: {error}", file=sys.stderr)
                scoring_stopped = True
            if not arguments.skip_notes:
                notes = run_notes(service, engine, max_minutes=arguments.notes_minutes)
    except (RunAborted, ServiceError, httpx.HTTPError) as error:
        print(f"The run stopped: {error}", file=sys.stderr)
        return 1
    if summary is not None:
        reading = "n/a" if summary.reading_kappa is None else f"{summary.reading_kappa:.2f}"
        english = "n/a" if summary.english_kappa is None else f"{summary.english_kappa:.2f}"
        print(
            f"Scored {summary.scored}, could not score {summary.failed}. Agreement with teachers "
            f"over {summary.compared} checks: reading kappa {reading}, English kappa {english}."
        )
        if summary.stopped_early:
            print("Stopped at the time limit; the next run continues.")
    if notes is not None:
        print(
            f"Transcribed {notes.transcribed} voice notes, could not transcribe {notes.failed}."
            + (" Stopped at the time limit." if notes.stopped_early else "")
        )
    return 1 if scoring_stopped else 0


def _download(arguments: argparse.Namespace) -> int:
    from huggingface_hub import snapshot_download
    from huggingface_hub.errors import GatedRepoError

    from .asr import INDIC_CONFORMER, INDIC_CONFORMER_REVISION, WHISPER_MODELS

    repository, revision = WHISPER_MODELS["small"]
    snapshot_download(repository, revision=revision)
    print("Whisper small is ready.")
    if arguments.hindi != "whisper":
        try:
            snapshot_download(INDIC_CONFORMER, revision=INDIC_CONFORMER_REVISION)
        except GatedRepoError:
            message = (
                "IndicConformer needs a Hugging Face account that accepted its terms, signed in "
                "on this machine (see the setup guide)."
            )
            if arguments.hindi == "indicconformer":
                print(message, file=sys.stderr)
                return 1
            print(f"{message} Hindi reading will be transcribed with Whisper.")
            return 0
        print("IndicConformer is ready.")
    return 0


def _try(arguments: argparse.Namespace) -> int:
    from .engine import CheckToScore, load_engine

    item = json.loads(Path(arguments.item).read_text(encoding="utf-8"))
    engine = load_engine(device=_device(arguments.device), hindi=arguments.hindi)
    check = CheckToScore(
        check_id="local",
        audio_path=str(arguments.file),
        item=item,
        grade=arguments.grade,
        reading_language=arguments.language,
    )
    score = engine.score(Path(arguments.file).read_bytes(), check)
    print(json.dumps(score.row("local", engine.version), ensure_ascii=False, indent=2))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="agla-engine",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    commands = parser.add_subparsers(dest="command", required=True)

    def common(command: argparse.ArgumentParser) -> None:
        command.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto")
        command.add_argument(
            "--hindi",
            choices=["auto", "indicconformer", "whisper"],
            default="auto",
            help="recogniser for reading in Hindi (auto: IndicConformer when available)",
        )

    score = commands.add_parser("score", help="score the checks waiting on the server")
    common(score)
    score.add_argument("--runner", choices=["scheduled", "gpu", "local"], default="local")
    score.add_argument("--batch-size", type=_number(int, 1, 500), default=100)
    score.add_argument("--max-minutes", type=_number(float, 1, 1440), default=90.0)
    score.add_argument(
        "--notes-minutes",
        type=_number(float, 1, 1440),
        default=20.0,
        help="time for the voice notes after the checks",
    )
    score.add_argument(
        "--skip-notes", action="store_true", help="score the checks only, without the voice notes"
    )
    score.set_defaults(handler=_score)

    download = commands.add_parser("download-models", help="fetch the speech models once")
    download.add_argument("--hindi", choices=["auto", "indicconformer", "whisper"], default="auto")
    download.set_defaults(handler=_download)

    trial = commands.add_parser("try", help="score a recording on this machine")
    common(trial)
    trial.add_argument("file", type=Path, help="a recording (WebM, Ogg, MP4 or WAV audio)")
    trial.add_argument("item", type=Path, help="the item as stored with the check, as JSON")
    trial.add_argument("--grade", type=int, choices=[1, 2, 3], required=True)
    trial.add_argument("--language", choices=["hi", "en"], required=True)
    trial.set_defaults(handler=_try)

    arguments = parser.parse_args(argv)
    return int(arguments.handler(arguments))


if __name__ == "__main__":
    raise SystemExit(main())
