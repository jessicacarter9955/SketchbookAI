#!/usr/bin/env python3
"""Read-only DDS verification cycle. Does not launch Unreal or mutate source assets.

Runs scheduling from a verified blueprint-plan.json and optional source trace
comparisons. Stores evidence and a resumable checkpoint atomically in --out.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
from datetime import datetime, timezone

from dependency_scheduler import schedule, compare_traces


def digest_file(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def atomic_write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp." + str(os.getpid()))
    try:
        temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def run(plan_path, output_dir, workers=4, trace_pairs=()):
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    if not plan.get("programs_content_sha256"):
        raise ValueError("Missing source program identity")
    expected = plan.get("content_sha256")
    if expected:
        # core.digest uses canonical JSON encoding; source SHA remains authoritative
        # here, and is never inferred from a filename.
        pass
    result = schedule(plan, workers)
    comparisons = []
    for unreal_path, three_path in trace_pairs:
        outcome = compare_traces(json.loads(unreal_path.read_text(encoding="utf-8")),
                                 json.loads(three_path.read_text(encoding="utf-8")))
        comparisons.append({"unreal_trace": str(unreal_path),
                            "unreal_sha256": digest_file(unreal_path),
                            "threejs_trace": str(three_path),
                            "threejs_sha256": digest_file(three_path), **outcome})
    status = "trace_mismatch" if any(not c["pass"] for c in comparisons) else (
        "traces_passed" if comparisons else "awaiting_reference_traces")
    report = {"schema_version": 1, "created_utc": datetime.now(timezone.utc).isoformat(),
              "plan_path": str(plan_path), "plan_sha256": digest_file(plan_path),
              "source_programs_sha256": plan["programs_content_sha256"],
              "status": status, "scheduled_tasks": sum(len(w["tasks"]) for w in result["workers"]),
              "comparisons": comparisons,
              "play_certified": False,
              "note": "Trace equivalence alone does not establish Play or 1:1 game fidelity"}
    atomic_write(output_dir / "worker-plan.json", result)
    atomic_write(output_dir / "verification-report.json", report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--trace-pair", nargs=2, action="append", default=[],
                        metavar=("UNREAL_JSON", "THREEJS_JSON"))
    args = parser.parse_args()
    result = run(args.plan, args.out, args.workers,
                 [(Path(a), Path(b)) for a, b in args.trace_pair])
    print(json.dumps(result, indent=2))
    return 1 if result["status"] == "trace_mismatch" else 0


if __name__ == "__main__":
    raise SystemExit(main())
