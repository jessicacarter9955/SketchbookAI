#!/usr/bin/env python3
"""Compare two source-witnessed ue2three Blueprint program reports.

Read-only. Never combines counts from distinct source snapshots into a claimed
migration gain. Exit 2 when source identities differ; 1 for changed outcomes.
"""
import argparse
import json
import re
from pathlib import Path


def load(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data.get("packages"), dict):
        raise ValueError(f"{path}: missing packages")
    return data


def entries(data):
    out = {}
    for package, record in data["packages"].items():
        source = record.get("source", {})
        # The compiler's actual translated programs live in the `functions`
        # mapping, not a `translated` array. Omitting that mapping made genuine
        # blocked→translated transitions appear to be blocked→missing, yielding
        # a false "no certifiable gain" despite a matching source snapshot.
        translated = record.get("functions", {})
        if not isinstance(translated, dict):
            raise ValueError(f"{package}: functions must be an object")
        for group, items in (("translated", translated.values()),
                             ("blocked", record.get("blocked", []))):
            for item in items:
                idx = item.get("source_export_index")
                if idx is None:
                    raise ValueError(f"{package}: {group} item without source_export_index")
                key = (package, str(idx))
                if key in out:
                    raise ValueError(f"Duplicate export index: {key}")
                out[key] = {"status": group, "function": item.get("name") or item.get("function") or "",
                            "reason": item.get("reason") if group == "blocked" else None,
                            "source_sha256": source.get("source_sha256")}
    return out


def compare_shared_packages(before, after):
    """Certify only packages present in both snapshots; report excluded coverage.

    Never interpret absent baseline packages as regressions or claim a full-project
    monotonic result. Source hash mismatches inside the common scope still fail.
    """
    baseline = set(before["packages"])
    current = set(after["packages"])
    common = baseline & current
    if not common:
        raise ValueError("No overlapping Blueprint packages to compare")
    scoped_before = dict(before, packages={p: before["packages"][p] for p in sorted(common)})
    scoped_after = dict(after, packages={p: after["packages"][p] for p in sorted(common)})
    result = compare(scoped_before, scoped_after)
    result["comparison_scope"] = "shared_packages_only"
    result["shared_package_count"] = len(common)
    result["baseline_only_packages"] = sorted(baseline - current)
    result["current_only_packages"] = sorted(current - baseline)
    result["full_project_certified"] = not (baseline ^ current) and result["monotonic_source_compilation"]
    result["scoped_monotonic_source_compilation"] = result["monotonic_source_compilation"]
    return result


def compare(before, after):
    a, b = entries(before), entries(after)
    sources_a = {p: r.get("source", {}).get("source_sha256") for p, r in before["packages"].items()}
    sources_b = {p: r.get("source", {}).get("source_sha256") for p, r in after["packages"].items()}
    valid_hash = lambda value: isinstance(value, str) and bool(re.fullmatch(r'[0-9a-f]{64}', value))
    mismatched = {p: {"before": sources_a.get(p), "after": sources_b.get(p)}
                  for p in sorted(sources_a.keys() | sources_b.keys())
                  if sources_a.get(p) != sources_b.get(p)
                  or not valid_hash(sources_a.get(p)) or not valid_hash(sources_b.get(p))}
    changed = []
    for key in sorted(a.keys() | b.keys()):
        old, new = a.get(key), b.get(key)
        if old != new:
            changed.append({"package": key[0], "export_index": key[1], "before": old, "after": new})
    new_translations = [row for row in changed if row['before'] and row['after']
                        and row['before']['status'] == 'blocked' and row['after']['status'] == 'translated']
    regressions = [row for row in changed if row['before'] and row['before']['status'] == 'translated'
                   and (not row['after'] or row['after']['status'] != 'translated')]
    dropped = [row for row in changed if row['before'] and not row['after']]
    return {"same_source_snapshot": not mismatched, "source_mismatches": mismatched,
            "before_counts": before.get("counts", {}), "after_counts": after.get("counts", {}),
            "changed_functions": changed, "changed_count": len(changed),
            "new_translations": new_translations, "new_translation_count": len(new_translations),
            "regressions": regressions, "regression_count": len(regressions),
            "disappeared_functions": dropped, "disappeared_count": len(dropped),
            "monotonic_source_compilation": not mismatched and not regressions and not dropped,
            "certifiable_gain": not mismatched and not regressions and not dropped and bool(new_translations)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    parser.add_argument("--output", type=Path, help="Optional JSON diagnostic report")
    parser.add_argument("--require-monotonic", action="store_true",
                        help="Fail with exit 3 when a same-source function regresses or disappears")
    args = parser.parse_args()
    result = compare(load(args.before), load(args.after))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.require_monotonic and not result['monotonic_source_compilation']:
        return 3
    return 2 if not result["same_source_snapshot"] else 1 if result["changed_count"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
