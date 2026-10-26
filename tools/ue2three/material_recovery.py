"""Batch-recover source-witnessed Unreal material graphs without editing Unreal assets.

This reports original graph connectivity. It does not claim to execute the
shader in Three.js or establish visual parity with Unreal.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
from pathlib import Path

from core import atomic_json, digest, file_hash, read_json
from material_graph import extract_material_graph
from umg_migration import _asset_document, _tool


class MaterialRecoveryError(RuntimeError):
    pass


def verified_materials(project, workspace):
    """Return only original, inventoried Material packages, never instances."""
    project = Path(project).resolve(strict=True)
    workspace = Path(workspace).resolve(strict=True)
    inventory = read_json(workspace / "artifacts/inventory.json")
    registry = read_json(workspace / "artifacts/engine_metadata.json")
    state = read_json(workspace / "state.json")
    snapshot = read_json(workspace / "snapshot.json")
    if (state.get("source_verification_status") != "verified"
            or registry.get("complete") is not True
            or Path(registry.get("project", "")).resolve() != project
            or state.get("snapshot_hash") != digest(snapshot)
            or registry.get("source_snapshot_hash") != digest(inventory.get("files", []))):
        raise MaterialRecoveryError("Fully verified original Unreal inventory is required")
    source = {row["package"]: row for row in inventory.get("assets", [])}
    rows = []
    for asset in registry.get("assets", []):
        if asset.get("class") != "Material":
            continue
        package = asset.get("package", "")
        row = source.get(package)
        # Source plugins may mount as /PluginName/ rather than /Game/.
        # The witnessed inventory and in-project file path are the authority.
        if not package.startswith("/") or not row:
            raise MaterialRecoveryError("Material is missing from the witnessed source inventory")
        original = (project.parent / row["path"]).resolve()
        if project.parent not in original.parents or not original.is_file():
            raise MaterialRecoveryError("Material source is absent or outside original project")
        rows.append({"package": package, "original": original, "source_sha256": row["sha256"]})
    return sorted(rows, key=lambda row: row["package"]), registry


def recover_materials(project, workspace, publish_dir, *, workers=4, limit=None):
    if not isinstance(workers, int) or not 1 <= workers <= 8:
        raise MaterialRecoveryError("Worker count must be between 1 and 8")
    if limit is not None and (not isinstance(limit, int) or limit < 1):
        raise MaterialRecoveryError("Optional limit must be positive")
    project, workspace, publish_dir = (Path(project).resolve(strict=True),
                                       Path(workspace).resolve(strict=True),
                                       Path(publish_dir).resolve())
    if publish_dir == project.parent or project.parent in publish_dir.parents:
        raise MaterialRecoveryError("Cannot publish graphs into original Unreal project")
    rows, registry = verified_materials(project, workspace)
    tool = _tool(workspace / "tool-cache")
    version = str(registry.get("engine_version") or read_json(workspace / "artifacts/engine.json").get("version", "")).split("-")[0]
    if not version or version == "None":
        raise MaterialRecoveryError("The matching Unreal package version is required")
    impl = digest({"graph": file_hash(Path(__file__).with_name("material_graph.py")),
                   "parser": file_hash(Path(__file__).with_name("umg_migration.py"))})
    publish_dir.mkdir(parents=True, exist_ok=True)
    report_path = publish_dir / "material-graphs.json"
    old = read_json(report_path) if report_path.is_file() else {}
    if old and (old.get("project") != str(project)
                or old.get("source_snapshot_hash") != registry["source_snapshot_hash"]
                or old.get("implementation_sha256") != impl):
        raise MaterialRecoveryError("Existing graph report belongs to another source or parser version")
    entries = dict(old.get("materials", {}))

    def extract(row):
        name, original, expected = row["package"], row["original"], row["source_sha256"]
        try:
            raw = original.read_bytes()
            if file_hash(original) != expected:
                raise MaterialRecoveryError("Original material source hash changed")
            parsed, parsed_hash = _asset_document(name, original, tool,
                                                   workspace / "artifacts/material-json", version)
            if parsed_hash != expected:
                raise MaterialRecoveryError("Material parser source hash differs from inventory")
            graph = extract_material_graph(parsed, raw)
            return name, {"status": "recovered", "source_sha256": expected,
                          "nodes": len(graph["nodes"]), "connections": graph["connection_count"],
                          "graph": graph}
        except (OSError, ValueError, RuntimeError, KeyError) as error:
            return name, {"status": "blocked", "source_sha256": expected,
                          "error": f"{type(error).__name__}: {error}"[:600]}

    pending = [row for row in rows if entries.get(row["package"], {}).get("status") != "recovered"
               or entries[row["package"]].get("source_sha256") != row["source_sha256"]]
    if limit is not None:
        pending = pending[:limit]

    def checkpoint():
        names = {row["package"] for row in rows}
        recovered = sum(entries.get(name, {}).get("status") == "recovered" for name in names)
        blocked = sum(entries.get(name, {}).get("status") == "blocked" for name in names)
        report = {"schema_version": 1, "project": str(project),
                  "source_snapshot_hash": registry["source_snapshot_hash"],
                  "implementation_sha256": impl,
                  "counts": {"source": len(names), "recovered": recovered,
                             "blocked": blocked, "pending": len(names) - recovered - blocked},
                  "materials": {name: entries[name] for name in sorted(names) if name in entries},
                  "limitations": ["Native graph connectivity recovered; shader execution is not translated.",
                                  "Material instances/functions, Niagara and visual 1:1 remain separate work."]}
        atomic_json(report_path, report)
        return report

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        for index, (name, result) in enumerate(pool.map(extract, pending), 1):
            entries[name] = result
            if index % 10 == 0 or index == len(pending):
                report = checkpoint()
                print("MATERIAL_GRAPH_PROGRESS", report["counts"], flush=True)
    return checkpoint()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=Path)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--publish-dir", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    result = recover_materials(args.project, args.workspace, args.publish_dir,
                               workers=args.workers, limit=args.limit)
    print(json.dumps(result["counts"], sort_keys=True))
    return 0 if not result["counts"]["blocked"] and not result["counts"]["pending"] else 3


if __name__ == "__main__":
    raise SystemExit(main())
