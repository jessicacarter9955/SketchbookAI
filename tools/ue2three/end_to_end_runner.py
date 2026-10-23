#!/usr/bin/env python3
"""DDS end-to-end *bounded* runner: migrate, plan, verify, checkpoint.

Runs existing ue2three commands locally with isolated output and strict failure
handling. Never marks gameplay green, never deletes assets, never deploys.
"""
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

from verification_cycle import atomic_write, run as verify


def execute(project, workspace, published, state_dir, *, timeout=3600, workers=4):
    project, workspace, published, state_dir = map(lambda p: Path(p).resolve(),
                                                   (project, workspace, published, state_dir))
    if not project.is_file() or project.suffix.lower() != ".uproject":
        raise ValueError("An existing .uproject is required")
    if timeout < 1 or workers < 1:
        raise ValueError("Positive timeout and worker count required")
    for output in (workspace, published, state_dir):
        if output == project.parent or project.parent in output.parents:
            raise ValueError("Workspace, publish and state must be outside Unreal source tree")
    if len({str(workspace), str(published), str(state_dir)}) != 3:
        raise ValueError("Workspace, publish and state must be distinct")
    state_dir.mkdir(parents=True, exist_ok=True)
    lock = state_dir / "runner.lock"
    try:
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError as exc:
        raise RuntimeError("Another runner holds this state directory; inspect before resuming") from exc
    try:
        with os.fdopen(fd, "w") as stream:
            stream.write(json.dumps({"pid": os.getpid(), "started": time.time()}))
        steps = [
            ("migrate-blueprints", [str(project), "--workspace", str(workspace),
                                    "--publish-dir", str(published)]),
            ("plan-blueprints", ["--workspace", str(workspace),
                                 "--publish-dir", str(published)])]
        history = []
        for command, args in steps:
            argv = [sys.executable, str(Path(__file__).with_name("cli.py")), command, *args]
            started = time.monotonic()
            try:
                result = subprocess.run(argv, capture_output=True, text=True,
                                        timeout=timeout, check=False)
                outcome = {"step": command, "exit_code": result.returncode,
                           "elapsed_seconds": round(time.monotonic() - started, 2),
                           "stdout_tail": result.stdout[-6000:],
                           "stderr_tail": result.stderr[-6000:]}
            except subprocess.TimeoutExpired:
                outcome = {"step": command, "exit_code": None, "error": "timeout",
                           "elapsed_seconds": round(time.monotonic() - started, 2)}
            history.append(outcome)
            atomic_write(state_dir / "execution-checkpoint.json",
                         {"steps": history, "status": "running" if outcome["exit_code"] == 0 else "blocked"})
            if outcome["exit_code"] != 0:
                return {"status": "blocked", "steps": history}
        plan = published / "blueprint-plan.json"
        report = verify(plan, state_dir, workers=workers)
        final = {"status": "awaiting_play_certification", "steps": history,
                 "verification_status": report["status"],
                 "source_programs_sha256": report["source_programs_sha256"],
                 "play_certified": False}
        atomic_write(state_dir / "execution-checkpoint.json", final)
        return final
    finally:
        lock.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=Path)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--publish-dir", type=Path, required=True)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--timeout", type=int, default=3600)
    args = parser.parse_args()
    result = execute(args.project, args.workspace, args.publish_dir,
                     args.state_dir, timeout=args.timeout, workers=args.workers)
    print(json.dumps(result, indent=2))
    return 0 if result["status"] == "awaiting_play_certification" else 1


if __name__ == "__main__":
    raise SystemExit(main())
