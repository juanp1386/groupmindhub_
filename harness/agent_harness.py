#!/usr/bin/env python3
"""A lightweight, local harness for running long-ish agent loops safely.

Goals:
- Track progress as a sequence of checkpoints.
- Run tests/commands at each checkpoint and stop on failure.
- Optionally capture Playwright screenshots for human review.
- Periodically ask the user for feedback/approval.

This is intentionally simple: no external deps (uses tomllib on Python 3.11+).
"""

from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import sys
import textwrap
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

try:
    import tomllib  # py311+
except ModuleNotFoundError:  # pragma: no cover
    tomllib = None  # type: ignore


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG_PATH = REPO_ROOT / "harness" / "harness.toml"
STATE_DIR = REPO_ROOT / ".harness"
STATE_PATH = STATE_DIR / "state.json"
RUNS_DIR = STATE_DIR / "runs"


@dataclass(frozen=True)
class CommandResult:
    command: str
    exit_code: int
    duration_seconds: float
    stdout_path: str
    stderr_path: str


def _utc_now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _slugify(value: str) -> str:
    out = []
    for ch in value.strip().lower():
        if ch.isalnum():
            out.append(ch)
        elif ch in {" ", "-", "_", "/"}:
            out.append("_")
    slug = "".join(out).strip("_")
    while "__" in slug:
        slug = slug.replace("__", "_")
    return slug or "item"


def _parse_id_list(values) -> set[str]:
    if not values:
        return set()
    if isinstance(values, str):
        values = [values]
    out: set[str] = set()
    for item in values:
        if not item:
            continue
        for part in str(item).split(','):
            part = part.strip()
            if part:
                out.add(part)
    return out


def _ensure_dirs() -> None:
    RUNS_DIR.mkdir(parents=True, exist_ok=True)


def _load_state() -> dict[str, Any]:
    if not STATE_PATH.exists():
        return {"approved": {}}
    return json.loads(STATE_PATH.read_text("utf-8"))


def _save_state(state: dict[str, Any]) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", "utf-8")


def _load_config(path: Path) -> dict[str, Any]:
    if tomllib is None:
        raise RuntimeError("Python 3.11+ required (tomllib missing)")
    data = tomllib.loads(path.read_text("utf-8"))
    return data


def _run_command(command: str, cwd: Path, out_dir: Path) -> CommandResult:
    start = time.time()
    stdout_path = out_dir / "stdout.txt"
    stderr_path = out_dir / "stderr.txt"

    # Keep shell=True for convenience (mirrors docs), but ensure it runs from repo root.
    proc = subprocess.run(
        command,
        cwd=str(cwd),
        shell=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env={**os.environ, "PYTHONUNBUFFERED": "1"},
    )

    stdout_path.write_text(proc.stdout, encoding="utf-8")
    stderr_path.write_text(proc.stderr, encoding="utf-8")

    return CommandResult(
        command=command,
        exit_code=proc.returncode,
        duration_seconds=round(time.time() - start, 3),
        stdout_path=str(stdout_path.relative_to(REPO_ROOT)),
        stderr_path=str(stderr_path.relative_to(REPO_ROOT)),
    )


def _prompt_multiline(prompt: str) -> str:
    print(prompt)
    print("(finish with an empty line)")
    lines: list[str] = []
    while True:
        try:
            line = input("> ")
        except EOFError:
            break
        if not line.strip():
            break
        lines.append(line)
    return "\n".join(lines).strip()


def _capture_screenshots(
    *,
    base_url: str,
    username: str,
    password: str,
    pages: list[str],
    out_dir: Path,
) -> int:
    script_path = REPO_ROOT / "harness" / "capture_screenshots.mjs"
    args = [
        "node",
        str(script_path),
        "--base-url",
        base_url,
        "--out",
        str(out_dir),
        "--pages",
        ",".join(pages),
        "--username",
        username,
        "--password",
        password,
    ]
    proc = subprocess.run(args, cwd=str(REPO_ROOT))
    return proc.returncode


def cmd_status(args: argparse.Namespace) -> int:
    cfg = _load_config(Path(args.config))
    state = _load_state()
    approved = state.get("approved", {})

    checkpoints = cfg.get("checkpoints") or []
    print(f"Project: {cfg.get('project_name', 'unknown')}")
    print(f"Config: {args.config}")
    print(f"Runs: {RUNS_DIR}")
    print("\nCheckpoints:")
    for cp in checkpoints:
        cp_id = cp.get("id")
        title = cp.get("title") or cp_id
        stamp = approved.get(cp_id, {}).get("approved_at")
        status = "approved" if stamp else "pending"
        suffix = f" (approved_at={stamp})" if stamp else ""
        print(f"- {cp_id}: {title} [{status}]{suffix}")
    return 0


def cmd_run(args: argparse.Namespace) -> int:
    _ensure_dirs()
    cfg = _load_config(Path(args.config))

    base_url = str(cfg.get("base_url") or "http://127.0.0.1:8000").rstrip("/")
    auth = cfg.get("auth") or {}
    username = str(args.username or auth.get("username") or os.environ.get("E2E_USER") or "e2e")
    password = str(args.password or auth.get("password") or os.environ.get("E2E_PASS") or "e2e-pass")

    interactive_cfg = bool((cfg.get("harness") or {}).get("interactive", True))
    interactive = bool(args.interactive) if args.interactive is not None else interactive_cfg

    state = _load_state()
    approved: dict[str, Any] = state.setdefault("approved", {})

    only_ids = _parse_id_list(getattr(args, 'only', None))
    skip_ids = _parse_id_list(getattr(args, 'skip', None))

    checkpoints = cfg.get("checkpoints") or []
    if not isinstance(checkpoints, list) or not checkpoints:
        raise SystemExit("No checkpoints defined in config")

    run_id = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    run_dir = RUNS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=False)

    run_meta = {
        "run_id": run_id,
        "started_at": _utc_now_iso(),
        "base_url": base_url,
        "config": str(Path(args.config).relative_to(REPO_ROOT)),
        "checkpoints": [],
    }

    print(f"[harness] Run: {run_id}")

    overall_ok = True

    for index, cp in enumerate(checkpoints, start=1):
        cp_id = str(cp.get("id") or f"step_{index}")
        cp_title = str(cp.get("title") or cp_id)
        cp_dir = run_dir / f"{index:02d}_{_slugify(cp_id)}"
        cp_dir.mkdir(parents=True, exist_ok=False)

        cp_record: dict[str, Any] = {
            "id": cp_id,
            "title": cp_title,
            "started_at": _utc_now_iso(),
            "ok": True,
            "commands": [],
            "screenshots": None,
            "feedback": None,
        }

        if only_ids and cp_id not in only_ids:
            print(f"[harness] {cp_id}: skipping (filtered by --only)")
            cp_record["skipped"] = True
            cp_record["skipped_reason"] = "filtered"
            cp_record["ok"] = True
            run_meta["checkpoints"].append(cp_record)
            continue

        if skip_ids and cp_id in skip_ids:
            print(f"[harness] {cp_id}: skipping (--skip)")
            cp_record["skipped"] = True
            cp_record["skipped_reason"] = "skip"
            cp_record["ok"] = True
            run_meta["checkpoints"].append(cp_record)
            continue

        if args.skip_approved and cp_id in approved:
            print(f"[harness] {cp_id}: skipping (already approved)")
            cp_record["skipped"] = True
            cp_record["ok"] = True
            run_meta["checkpoints"].append(cp_record)
            continue

        print(f"\n[harness] Checkpoint {index}/{len(checkpoints)}: {cp_id} — {cp_title}")

        # Commands
        commands = cp.get("commands") or []
        if not isinstance(commands, list):
            raise SystemExit(f"checkpoint {cp_id}: commands must be a list")

        for cmd_index, command in enumerate(commands, start=1):
            command = str(command)
            print(f"[harness] running: {command}")
            cmd_dir = cp_dir / f"cmd_{cmd_index:02d}"
            cmd_dir.mkdir(parents=True, exist_ok=False)
            result = _run_command(command, cwd=REPO_ROOT, out_dir=cmd_dir)
            cp_record["commands"].append(result.__dict__)
            if result.exit_code != 0:
                cp_record["ok"] = False
                overall_ok = False
                print(f"[harness] command failed (exit {result.exit_code}): {command}")
                break

        # Screenshots
        pages = cp.get("screenshots")
        if cp_record["ok"] and pages and not args.no_screenshots:
            if not isinstance(pages, list):
                raise SystemExit(f"checkpoint {cp_id}: screenshots must be a list of paths")
            out_screens = cp_dir / "screenshots"
            out_screens.mkdir(parents=True, exist_ok=True)
            print(f"[harness] capturing screenshots: {', '.join(map(str, pages))}")
            shot_code = _capture_screenshots(
                base_url=base_url,
                username=username,
                password=password,
                pages=[str(p) for p in pages],
                out_dir=out_screens,
            )
            cp_record["screenshots"] = {
                "pages": pages,
                "out_dir": str(out_screens.relative_to(REPO_ROOT)),
                "exit_code": shot_code,
            }
            if shot_code != 0:
                cp_record["ok"] = False
                overall_ok = False
                print(f"[harness] screenshot capture failed (exit {shot_code})")

        # Feedback prompt
        prompt = bool(cp.get("prompt", False))
        if interactive and prompt:
            feedback = _prompt_multiline(
                textwrap.dedent(
                    f"""
                    [harness] Feedback checkpoint: {cp_id}
                    - What looks good?
                    - What should change before we proceed?
                    - Any scope/priority adjustments?
                    """
                ).strip()
            )
            cp_record["feedback"] = feedback
            (cp_dir / "feedback.md").write_text(feedback + "\n", "utf-8")

            approval = input("[harness] Mark this checkpoint approved and continue? [y/N] ").strip().lower()
            if approval == "y":
                approved[cp_id] = {
                    "approved_at": _utc_now_iso(),
                    "run_id": run_id,
                    "title": cp_title,
                    "feedback": feedback,
                }
                _save_state(state)
            else:
                print("[harness] stopping for review (not approved)")
                cp_record["ok"] = False
                overall_ok = False

        cp_record["finished_at"] = _utc_now_iso()
        run_meta["checkpoints"].append(cp_record)

        if not cp_record["ok"] and not args.continue_on_failure:
            break

    run_meta["finished_at"] = _utc_now_iso()
    run_meta["ok"] = overall_ok

    report_path = run_dir / "report.md"
    report_lines = [
        f"# Harness run: {run_id}",
        "",
        f"- started_at: {run_meta['started_at']}",
        f"- finished_at: {run_meta['finished_at']}",
        f"- ok: {run_meta['ok']}",
        f"- base_url: {base_url}",
        "",
        "## Checkpoints",
    ]

    for cp_record in run_meta["checkpoints"]:
        ok = cp_record.get("ok")
        status = "OK" if ok else "FAILED"
        report_lines.append(f"- {cp_record['id']}: {status} — {cp_record.get('title','')}")
        shots = cp_record.get("screenshots")
        if shots and isinstance(shots, dict):
            report_lines.append(f"  - screenshots: `{shots.get('out_dir')}`")

    report_path.write_text("\n".join(report_lines) + "\n", "utf-8")
    (run_dir / "run.json").write_text(json.dumps(run_meta, indent=2) + "\n", "utf-8")

    print(f"\n[harness] report: {report_path.relative_to(REPO_ROOT)}")
    return 0 if overall_ok else 2


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="agent_harness",
        description="Run tests + checkpoints + screenshots with periodic feedback.",
    )
    parser.add_argument(
        "--config",
        default=str(DEFAULT_CONFIG_PATH),
        help=f"Path to harness TOML config (default: {DEFAULT_CONFIG_PATH})",
    )

    sub = parser.add_subparsers(dest="cmd", required=True)

    p_status = sub.add_parser("status", help="Show checkpoint approval status")
    p_status.set_defaults(func=cmd_status)

    p_run = sub.add_parser("run", help="Run checkpoints")
    p_run.add_argument("--continue-on-failure", action="store_true")
    p_run.add_argument("--skip-approved", action="store_true")
    p_run.add_argument("--only", action="append", help="Run only these checkpoint ids (repeatable or comma-separated)")
    p_run.add_argument("--skip", action="append", help="Skip these checkpoint ids (repeatable or comma-separated)")
    p_run.add_argument("--no-screenshots", action="store_true", help="Disable screenshot capture even if configured")
    p_run.add_argument("--username", help="Auth username for screenshots")
    p_run.add_argument("--password", help="Auth password for screenshots")
    p_run.add_argument(
        "--interactive",
        choices=["true", "false"],
        help="Override config harness.interactive",
    )
    p_run.set_defaults(func=cmd_run)

    return parser


def main(argv: list[str]) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    if getattr(args, "interactive", None) is not None:
        args.interactive = args.interactive == "true"
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
