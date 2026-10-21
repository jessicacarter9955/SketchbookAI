"""Safely populate immutable, source-hash-addressed Unreal package caches in parallel.

This phase only decodes source packages. It never translates or publishes gameplay;
run migrate-blueprints and verify-blueprints after the batch finishes.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from pathlib import Path
import json
import sys
import time

from core import atomic_json, digest, file_hash, read_json
from umg_migration import _asset_document, _tool

BLUEPRINT_CLASSES = frozenset((
    "BlueprintGeneratedClass", "AnimBlueprintGeneratedClass", "WidgetBlueprintGeneratedClass"
))


def select_packages(registry, inventory, cache_dir, requested=(), auto=False, limit=8):
    """Choose distinct, inventoried source packages without racing on cache keys."""
    assets = {asset["package"]: asset for asset in inventory["assets"]}
    eligible = {row["package"] for row in registry["assets"] if row.get("class") in BLUEPRINT_CLASSES}
    if not 1 <= limit <= 256:
        raise ValueError("limit must be 1..256")
    if requested and auto:
        raise ValueError("Use explicit --package names or --auto, not both")
    if not requested and not auto:
        raise ValueError("Provide --package or --auto")
    for name in requested:
        if name not in eligible or name not in assets:
            raise ValueError("Package not present in the verified Blueprint inventory: " + name)
    if auto:
        names = [name for name in eligible if name in assets
                 and not (cache_dir / (assets[name]["sha256"] + ".json")).is_file()]
        # Most relevant DDS core mechanics first; no package is discarded.
        def priority(name):
            path = name.casefold()
            rank = 0 if "/fixers/core/" in path else 1 if "/fixers/ui/hud/" in path else 2 if "/fixers/ui/" in path else 3
            return rank, name
        names.sort(key=priority)
    else:
        names = list(dict.fromkeys(requested))
    unique, hashes = [], set()
    for name in names:
        sha = assets[name]["sha256"]
        if sha not in hashes:
            hashes.add(sha)
            unique.append(name)
        if len(unique) >= limit:
            break
    return unique


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=Path)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--package", action="append", default=[])
    parser.add_argument("--auto", action="store_true")
    parser.add_argument("--limit", type=int, default=8)
    parser.add_argument("--workers", type=int, default=2)
    args = parser.parse_args(argv)
    if not 1 <= args.workers <= 4:
        parser.error("workers must be between 1 and 4")
    project = args.project.resolve(strict=True)
    workspace = args.workspace.resolve(strict=True)
    if workspace == project.parent or project.parent in workspace.parents:
        raise ValueError("Cache must stay outside the original Unreal project")
    inventory = read_json(workspace / "artifacts/inventory.json")
    registry = read_json(workspace / "artifacts/engine_metadata.json")
    if (not registry.get("complete") or Path(registry["project"]).resolve() != project
            or registry.get("source_snapshot_hash") != digest(inventory["files"])):
        raise ValueError("Verified original source inventory/registry is required")
    cache_dir = workspace / "artifacts/uasset-json"
    assets = {row["package"]: row for row in inventory["assets"]}
    names = select_packages(registry, inventory, cache_dir, args.package, args.auto, args.limit)
    if not names:
        print("No missing packages in selected batch", flush=True)
        return 0
    executable = _tool(workspace / "tool-cache")
    version = str(read_json(workspace / "artifacts/engine.json")["version"]).split("-")[0]
    start = time.monotonic()
    print("PARSING", len(names), "PACKAGES_WITH", args.workers, "WORKERS", flush=True)

    def decode(name):
        asset = assets[name]
        path = (project.parent / asset["path"]).resolve(strict=True)
        expected = asset["sha256"]
        if project.parent not in path.parents or file_hash(path) != expected:
            raise ValueError("Source moved or changed: " + name)
        began = time.monotonic()
        parsed, parsed_hash = _asset_document(name, path, executable, cache_dir, version)
        if parsed_hash != expected or file_hash(path) != expected:
            raise ValueError("Source changed while decoding: " + name)
        if not parsed.exports:
            raise ValueError("Parser returned zero exports: " + name)
        return {"status": "parsed", "source_sha256": expected,
                "exports": len(parsed.exports), "seconds": round(time.monotonic() - began, 3)}

    results = {}
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        pending = {pool.submit(decode, name): name for name in names}
        while pending:
            completed, _ = wait(pending, timeout=5, return_when=FIRST_COMPLETED)
            if not completed:
                print("PARSING_PENDING", len(pending), "ELAPSED", round(time.monotonic()-start, 1), flush=True)
            for future in completed:
                name = pending.pop(future)
                try:
                    results[name] = future.result()
                    print("PARSED", name, results[name]["exports"], flush=True)
                except Exception as exc:
                    results[name] = {"status": "failed", "error": f"{type(exc).__name__}: {exc}"[:650]}
                    print("FAILED", name, results[name]["error"], flush=True)
    report = {"source_project": str(project), "verified_snapshot_sha256": registry["source_snapshot_hash"],
              "parsed": sum(v["status"] == "parsed" for v in results.values()),
              "failed": sum(v["status"] == "failed" for v in results.values()),
              "seconds": round(time.monotonic() - start, 3),
              "results": {name: results[name] for name in sorted(results)},
              "scope": "Source decode only; neither compiled game logic nor 1:1 gameplay proof"}
    report_dir = workspace / "artifacts/blueprint-parallel-reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    batch_id = digest({"names": names, "source_snapshot": registry["source_snapshot_hash"]})[:20]
    path = report_dir / (batch_id + ".json")
    atomic_json(path, report)
    print("REPORT", str(path), "PARSED", report["parsed"], "FAILED", report["failed"], flush=True)
    return 1 if report["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
