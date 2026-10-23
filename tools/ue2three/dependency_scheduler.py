#!/usr/bin/env python3
"""Source-witnessed dependency scheduling for ue2three Blueprint work packets.

Consumes blueprint-plan.json. Produces a deterministic, conflict-free worker plan;
never claims translated functions or Unreal/Three.js parity.
"""
import argparse
import json
from collections import defaultdict
from pathlib import Path


def schedule(plan, workers=4, max_parallel_unreal=1):
    if workers < 1 or max_parallel_unreal < 1:
        raise ValueError("workers and max_parallel_unreal must be positive")
    functions = plan.get("functions", [])
    modules = plan.get("modules", [])
    native = plan.get("native_dependencies", {})
    tasks = []
    for module in modules:
        key = module["id"]
        impacted = sorted({(f["package"], str(f["export_index"]))
                           for f in functions if key in f.get("modules", [])})
        if not impacted:
            continue
        tasks.append({"id": key, "kind": "compiler", "lane": "cpu",
                      "packet": module.get("packet"), "affected_functions": impacted,
                      "first_blockers": module.get("first_blocked_functions", 0)})
    for family in native.get("families", []):
        key = family.get("id")
        if not key:
            continue
        tasks.append({"id": key, "kind": "native_adapter", "lane": "cpu",
                      "packet": family.get("packet"),
                      "affected_functions": [], "first_blockers": 0,
                      "observed_affected_count": family.get("blocked_source_functions_involved", 0)})
    # Avoid claiming all related functions would become translated. These are
    # candidates only; overlapping dependencies must be re-evaluated after tests.
    tasks.sort(key=lambda t: (-t["first_blockers"],
                              -len(t["affected_functions"]),
                              -t.get("observed_affected_count", 0), t["id"]))
    lanes = [{"worker": i + 1, "tasks": [], "estimated_candidate_load": 0}
             for i in range(workers)]
    for task in tasks:
        lane = min(lanes, key=lambda x: (x["estimated_candidate_load"], len(x["tasks"]), x["worker"]))
        lane["tasks"].append(task)
        lane["estimated_candidate_load"] += max(1, len(task["affected_functions"]),
                                                  task.get("observed_affected_count", 0))
    return {"schema_version": 1, "source_programs_sha256": plan.get("programs_content_sha256"),
            "status": "proposed_only", "workers": lanes,
            "unreal_export_concurrency_limit": max_parallel_unreal,
            "shared_writer_policy": "isolated worktrees; serialized integration; never share Unreal workspace locks",
            "certification": "No function or feature is green until source comparison, runtime and Play tests pass"}


def compare_traces(reference, translated, *, float_tolerance=1e-6):
    """Strict recursive oracle comparison; rejects missing events and type mismatches."""
    differences = []
    def visit(a, b, path):
        if type(a) is not type(b):
            differences.append({"path": path, "expected": a, "actual": b, "reason": "type"})
        elif isinstance(a, dict):
            if a.keys() != b.keys():
                differences.append({"path": path, "reason": "keys",
                                    "expected": sorted(a), "actual": sorted(b)})
            for key in a.keys() & b.keys():
                visit(a[key], b[key], path + "." + str(key))
        elif isinstance(a, list):
            if len(a) != len(b):
                differences.append({"path": path, "reason": "length",
                                    "expected": len(a), "actual": len(b)})
            for i, (left, right) in enumerate(zip(a, b)):
                visit(left, right, path + "[" + str(i) + "]")
        elif isinstance(a, float):
            import math
            if not (math.isfinite(a) and math.isfinite(b) and abs(a-b) <= float_tolerance):
                differences.append({"path": path, "reason": "float", "expected": a, "actual": b})
        elif a != b:
            differences.append({"path": path, "reason": "value", "expected": a, "actual": b})
    visit(reference, translated, "$")
    return {"pass": not differences, "differences": differences}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="command", required=True)
    planner = sub.add_parser("plan")
    planner.add_argument("blueprint_plan", type=Path)
    planner.add_argument("--workers", type=int, default=4)
    planner.add_argument("--output", type=Path)
    oracle = sub.add_parser("compare-traces")
    oracle.add_argument("unreal_trace", type=Path)
    oracle.add_argument("threejs_trace", type=Path)
    oracle.add_argument("--tolerance", type=float, default=1e-6)
    oracle.add_argument("--output", type=Path)
    args = p.parse_args()
    if args.command == "plan":
        result = schedule(json.loads(args.blueprint_plan.read_text(encoding="utf-8")), args.workers)
        status = 0
    else:
        result = compare_traces(json.loads(args.unreal_trace.read_text(encoding="utf-8")),
                                json.loads(args.threejs_trace.read_text(encoding="utf-8")),
                                float_tolerance=args.tolerance)
        status = 0 if result["pass"] else 1
    rendered = json.dumps(result, indent=2, ensure_ascii=False) + "\n"
    print(rendered)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    return status


if __name__ == "__main__":
    raise SystemExit(main())
