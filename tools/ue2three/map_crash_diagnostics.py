"""Resume-safe, source-witnessed crash isolation for Unreal level glTF export.

This tool runs ONLY on a prior isolated Unreal export attempt whose actor
census was written before a native crash. It never publishes a partial GLB as
the complete map and never changes the source Unreal project.
"""

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

from core import atomic_json, read_json
from map_migration import glb_summary, valid_glb


class DiagnosisError(RuntimeError):
    pass


def load_source_attempt(run_dir):
    run_dir = Path(run_dir).resolve()
    request = read_json(run_dir / "request.json")
    process = read_json(run_dir / "process.json")
    census = read_json(run_dir / "actor-census.json")
    maps = request.get("maps", [])
    if len(maps) != 1 or not isinstance(maps[0], dict):
        raise DiagnosisError("An isolated one-map source export is required")
    record = maps[0]
    if (census.get("package") != record.get("package") or
            census.get("source_snapshot_hash") != request.get("source_snapshot_hash") or
            census.get("selection", {}).get("mode") != "all"):
        raise DiagnosisError("Actor census does not match the full source export")
    actors = census.get("actors", [])
    names = [actor.get("name") for actor in actors]
    if not names or any(not isinstance(name, str) or not name for name in names) or len(set(names)) != len(names):
        raise DiagnosisError("Actor census has no unique source actor identities")
    source_project = Path(request["source_project"]).resolve()
    scratch = Path(request["scratch_project"]).resolve()
    if source_project == scratch or not source_project.is_file() or not scratch.is_file():
        raise DiagnosisError("Original and isolated project must exist separately")
    command = process.get("command", [])
    if not isinstance(command, list) or not command or str(scratch) not in command:
        raise DiagnosisError("Source Unreal launch command is missing or unrelated")
    if not any(str(flag).startswith("-script=") for flag in command):
        raise DiagnosisError("Source Unreal command has no export script")
    return request, command, names


def first_groups(names):
    """Do not repeat the already-observed crashing full-scene export."""
    if len(names) == 1:
        return [names]
    middle = len(names) // 2
    return [names[:middle], names[middle:]]


def split_group(names):
    if len(names) < 2:
        return []
    middle = len(names) // 2
    return [names[:middle], names[middle:]]


def _save(destination, state):
    atomic_json(destination / "diagnosis.json", state)


def initialize(run_dir, destination):
    request, command, names = load_source_attempt(run_dir)
    destination = Path(destination).resolve()
    source_dir = Path(request["source_project"]).resolve().parent
    if destination == source_dir or source_dir in destination.parents:
        raise DiagnosisError("Diagnostics cannot be written inside the source Unreal project")
    destination.mkdir(parents=True, exist_ok=True)
    state_file = destination / "diagnosis.json"
    if state_file.exists():
        state = read_json(state_file)
        if (state.get("origin") != str(Path(run_dir).resolve()) or
                state.get("actors") != names or
                state.get("source_snapshot_hash") != request["source_snapshot_hash"]):
            raise DiagnosisError("Existing diagnosis belongs to a different source snapshot")
        # A crash of the orchestrator itself must never make its active group
        # disappear from the queue or launch a duplicate Unreal process.
        if state.get("attempts") and state["attempts"][-1].get("status") == "started":
            raise DiagnosisError("Previous attempt was interrupted; inspect its Unreal process and logs before resuming")
    else:
        state = {"schema_version": 1, "origin": str(Path(run_dir).resolve()),
                 "source_snapshot_hash": request["source_snapshot_hash"],
                 "map": request["maps"][0]["package"], "actors": names,
                 "pending": first_groups(names), "attempts": [], "verified_groups": [],
                 "unexportable_actors": [], "complete": False}
        _save(destination, state)
    return request, command, state


def _run_subset(request, command, group, destination, attempt_number, *, timeout, runner=subprocess.run):
    attempt_dir = destination / f"attempt-{attempt_number:04d}"
    output_dir = attempt_dir / "output"
    output_dir.mkdir(parents=True, exist_ok=False)
    record = dict(request["maps"][0], selected_actor_names=list(group))
    job = {**request, "maps": [record], "output": str(output_dir),
           "result": str(attempt_dir / "result.json"), "progress": str(attempt_dir / "progress.json"),
           "actor_census_file": str(attempt_dir / "actor-census.json")}
    atomic_json(attempt_dir / "request.json", job)
    actual_command = [f"-abslog={attempt_dir / 'unreal.log'}" if str(item).startswith("-abslog=")
                      else item for item in command]
    if not any(str(item).startswith("-abslog=") for item in actual_command):
        actual_command.append(f"-abslog={attempt_dir / 'unreal.log'}")
    environment = os.environ.copy()
    environment["UE2THREE_MAP_JOB_FILE"] = str(attempt_dir / "request.json")
    started = time.monotonic()
    try:
        with (attempt_dir / "stdout.log").open("wb") as stdout, (attempt_dir / "stderr.log").open("wb") as stderr:
            completed = runner(actual_command, cwd=Path(request["scratch_project"]).parent,
                               env=environment, stdin=subprocess.DEVNULL, stdout=stdout,
                               stderr=stderr, timeout=timeout,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        exit_code, failure = completed.returncode, None
    except subprocess.TimeoutExpired:
        exit_code, failure = None, "timeout"
    except OSError as error:
        exit_code, failure = None, type(error).__name__
    result_file = attempt_dir / "result.json"
    exported = None
    if result_file.is_file():
        try:
            exported = read_json(result_file)
        except (OSError, ValueError):
            pass
    rows = exported.get("results", []) if isinstance(exported, dict) else []
    item = rows[0] if len(rows) == 1 else {}
    glb = output_dir / record["filename"]
    success = (failure is None and exit_code == 0 and item.get("status") == "exported" and
               item.get("actor_selection", {}).get("mode") == "subset" and
               sorted(item["actor_selection"].get("actor_names", [])) == sorted(group) and
               valid_glb(glb))
    return {"actor_names": list(group), "attempt_dir": str(attempt_dir),
            "exit_code": exit_code, "success": success, "error": failure or item.get("error"),
            "elapsed_seconds": round(time.monotonic() - started, 2),
            "glb": str(glb) if success else None,
            "geometry": glb_summary(glb) if success else None}


def diagnose(run_dir, destination, *, max_attempts=12, timeout=360, runner=subprocess.run):
    request, command, state = initialize(run_dir, destination)
    destination = Path(destination).resolve()
    while state["pending"] and max_attempts > 0:
        group = state["pending"][0]
        number = len(state["attempts"]) + 1
        print(f"UE2THREE_ACTOR_DIAG attempt={number} actors={len(group)}", flush=True)
        # Recording a pending attempt before executing gives interrupted jobs a
        # safely resumable state: no attempt ID gets silently reused.
        state["attempts"].append({"actor_names": group, "success": False, "status": "started"})
        _save(destination, state)
        result = _run_subset(request, command, group, destination, number,
                             timeout=timeout, runner=runner)
        state["pending"].pop(0)
        state["attempts"][-1] = result
        if result["success"]:
            state["verified_groups"].append(result)
        elif len(group) > 1:
            state["pending"] = split_group(group) + state["pending"]
        else:
            state["unexportable_actors"].append(result)
        max_attempts -= 1
        state["complete"] = not state["pending"]
        _save(destination, state)
        print(f"UE2THREE_ACTOR_DIAG_RESULT attempt={number} success={result['success']} "
              f"pending={len(state['pending'])} isolated_failures={len(state['unexportable_actors'])}", flush=True)
    return state


def main(argv=None):
    parser = argparse.ArgumentParser(description="Crash-isolate original Unreal map actors without losing geometry")
    parser.add_argument("--run-dir", type=Path, required=True,
                        help="previous full-map attempt with actor-census.json")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-attempts", type=int, default=12)
    parser.add_argument("--timeout", type=int, default=360)
    args = parser.parse_args(argv)
    if args.max_attempts < 1 or args.timeout < 1:
        parser.error("max-attempts and timeout must be positive")
    try:
        state = diagnose(args.run_dir, args.output, max_attempts=args.max_attempts,
                         timeout=args.timeout)
    except (DiagnosisError, OSError, KeyError, TypeError, ValueError) as error:
        print(f"UE2THREE_ACTOR_DIAG_ERROR {error}", file=sys.stderr)
        return 2
    print(json.dumps({"complete": state["complete"], "groups": len(state["verified_groups"]),
                      "unexportable_actors": [r["actor_names"][0] for r in state["unexportable_actors"]],
                      "pending": len(state["pending"]), "report": str(args.output / 'diagnosis.json')},
                     sort_keys=True))
    # Even a fully diagnosed scene has not yet been composed or integrated.
    return 0 if state["complete"] and not state["unexportable_actors"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
