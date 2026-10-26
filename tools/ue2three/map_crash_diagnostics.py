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

from core import atomic_json, file_hash, read_json, workspace_lock
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


def inspect_completed_export(request, record, group, result_file, glb, exit_code, failure=None):
    """Validate a finalized subset by source identity, JSON metadata and GLB structure.

    A nonzero UnrealEditor-Cmd exit cannot invalidate a fully written scene by
    itself, but an incomplete result or meshless output cannot establish it.
    """
    exported = None
    if result_file.is_file():
        try:
            exported = read_json(result_file)
        except (OSError, ValueError):
            pass
    rows = exported.get("results", []) if isinstance(exported, dict) else []
    item = rows[0] if len(rows) == 1 and isinstance(rows[0], dict) else {}
    selection = item.get("actor_selection", {})
    exported_exactly = (failure is None and isinstance(exported, dict) and exported.get("complete") is True
                        and exported.get("source_project") == request.get("source_project")
                        and exported.get("source_snapshot_hash") == request.get("source_snapshot_hash")
                        and item.get("status") == "exported"
                        and item.get("package") == record.get("package")
                        and item.get("filename") == record.get("filename")
                        and item.get("fingerprint") == record.get("fingerprint")
                        and isinstance(selection, dict) and selection.get("mode") == "subset"
                        and selection.get("selected") == len(group)
                        and isinstance(selection.get("actor_names"), list)
                        and sorted(selection["actor_names"]) == sorted(group)
                        and valid_glb(glb))
    geometry = glb_summary(glb) if exported_exactly else None
    nonempty = geometry is not None and geometry["mesh_count"] > 0 and geometry["node_count"] > 0
    # Exit=1 is observed even with a complete GLB (95 actual Gallery meshes).
    # Preserve the exit anomaly rather than suppressing it.
    recovered_unclean = (exit_code != 0 and exported_exactly and nonempty and
                         item.get("bytes") == glb.stat().st_size)
    success = bool(exported_exactly and nonempty and (exit_code == 0 or recovered_unclean))
    return {"success": success, "error": failure or item.get("error"),
            "glb": str(glb) if success else None,
            "geometry": geometry if success else None,
            "glb_sha256": file_hash(glb) if success else None,
            "verification_mode": ("complete_export_unclean_exit" if recovered_unclean else
                                  "complete_export_clean_exit" if success else None)}


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
    glb = output_dir / record["filename"]
    inspected = inspect_completed_export(request, record, group,
                                         attempt_dir / "result.json", glb, exit_code, failure)
    return {"actor_names": list(group), "attempt_dir": str(attempt_dir),
            "exit_code": exit_code, **inspected,
            "elapsed_seconds": round(time.monotonic() - started, 2),
            }


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


def audit_existing_exports(run_dir, destination):
    """Recover finished GLB candidates without repeating Unreal runs or changing job state.

    Older diagnostic versions rejected complete files solely on Unreal's
    nonzero shutdown exit. This read-only audit rechecks the actual artifacts,
    selects non-overlapping actor groups and leaves pending jobs untouched.
    """
    source_request, _, names = load_source_attempt(run_dir)
    destination = Path(destination).resolve()
    state = read_json(destination / "diagnosis.json")
    if (state.get("origin") != str(Path(run_dir).resolve()) or state.get("actors") != names
            or state.get("source_snapshot_hash") != source_request["source_snapshot_hash"]):
        raise DiagnosisError("Audit source and original actor census differ")
    candidates = []
    for number, attempt in enumerate(state["attempts"], 1):
        if attempt.get("status") == "started" or not isinstance(attempt.get("actor_names"), list):
            continue
        attempt_dir = destination / f"attempt-{number:04d}"
        job_path = attempt_dir / "request.json"
        if not job_path.is_file():
            continue
        job = read_json(job_path)
        maps = job.get("maps", [])
        if (len(maps) != 1 or job.get("source_project") != source_request["source_project"]
                or job.get("source_snapshot_hash") != source_request["source_snapshot_hash"]
                or maps[0].get("package") != source_request["maps"][0]["package"]
                or maps[0].get("fingerprint") != source_request["maps"][0]["fingerprint"]
                or sorted(maps[0].get("selected_actor_names", [])) != sorted(attempt["actor_names"])):
            continue
        glb = attempt_dir / "output" / maps[0]["filename"]
        inspected = inspect_completed_export(source_request, maps[0], attempt["actor_names"],
                                             attempt_dir / "result.json", glb,
                                             attempt.get("exit_code"), attempt.get("error"))
        if inspected["success"]:
            candidates.append({"attempt_number": number, "actor_names": attempt["actor_names"],
                               "unreal_exit_code": attempt.get("exit_code"), **inspected})
    recovered, covered = [], set()
    for candidate in sorted(candidates, key=lambda row: (-len(row["actor_names"]), row["attempt_number"])):
        group = set(candidate["actor_names"])
        if group.isdisjoint(covered):
            recovered.append(candidate)
            covered.update(group)
    report = {"schema_version": 1, "map": state["map"],
              "source_snapshot_hash": state["source_snapshot_hash"],
              "source_actor_count": len(names), "recovered_actor_count": len(covered),
              "unrecovered_actor_names": sorted(set(names) - covered),
              "verified_nonoverlapping_groups": recovered,
              "candidates_including_overlaps": len(candidates),
              "complete_geometry_export": False,
              "limitations": ["An audited GLB subgroup is not a merged or playable Three.js scene.",
                              "Niagara, illumination and source-authored actor behavior need separate translation.",
                              "Nonzero Unreal shutdown exits remain recorded and require further verification."]}
    atomic_json(destination / "recovered-geometry-audit.json", report)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description="Crash-isolate original Unreal map actors without losing geometry")
    parser.add_argument("--run-dir", type=Path, required=True,
                        help="previous full-map attempt with actor-census.json")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--workspace", type=Path, required=True,
                        help="existing ue2three map scan workspace; serialized with other Unreal exports")
    parser.add_argument("--max-attempts", type=int, default=12)
    parser.add_argument("--timeout", type=int, default=360)
    parser.add_argument("--audit-existing", action="store_true",
                        help="audit completed GLB subsets without acquiring the Unreal export lock")
    args = parser.parse_args(argv)
    if args.max_attempts < 1 or args.timeout < 1:
        parser.error("max-attempts and timeout must be positive")
    try:
        root = args.run_dir.resolve()
        expected = args.workspace.resolve()
        if root.parent.name != "runs" or root.parent.parent.name != "maps" or root.parents[2] != expected:
            raise DiagnosisError("Source attempt does not belong to the specified locked map workspace")
        if args.audit_existing:
            report = audit_existing_exports(root, args.output)
            print(json.dumps({"source_actors": report["source_actor_count"],
                              "recovered_geometry_actors": report["recovered_actor_count"],
                              "groups": len(report["verified_nonoverlapping_groups"]),
                              "report": str(args.output / "recovered-geometry-audit.json")},
                             sort_keys=True))
            return 0
        with workspace_lock(expected):
            state = diagnose(root, args.output, max_attempts=args.max_attempts,
                             timeout=args.timeout)
    except (DiagnosisError, OSError, KeyError, TypeError, ValueError, RuntimeError) as error:
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
