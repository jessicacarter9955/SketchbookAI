"""Inventory editable project files without parsing or executing package code."""
import os
import time
from collections import Counter
from pathlib import Path

from adapters import detect_engine
from core import SCHEMA, checked_hash, digest, read_json

PACKAGE_EXTENSIONS = {".uasset", ".umap"}
INPUT_EXTENSIONS = PACKAGE_EXTENSIONS | {".uexp", ".ubulk", ".uptnl", ".ini", ".uplugin", ".uproject",
                                         ".h", ".hpp", ".cpp", ".c", ".cs", ".ush", ".usf"}
PRUNE = {"Binaries", "Intermediate", "Saved", "DerivedDataCache", ".git", "node_modules"}


def linked(path):
    return path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction())


def source_files(project):
    """Deterministic traversal; never follow nested symlinks or junctions."""
    root = project.parent
    paths, omitted = [project], []
    for name in ("Content", "Config", "Plugins", "Source"):
        directory = root / name
        if linked(directory):
            omitted.append(name)
            continue
        if not directory.exists():
            continue
        def fail(error):
            raise error
        for current, dirs, files in os.walk(directory, followlinks=False, onerror=fail):
            retained = []
            for dirname in sorted(dirs):
                path = Path(current) / dirname
                if linked(path):
                    omitted.append(path.relative_to(root).as_posix())
                elif dirname not in PRUNE:
                    retained.append(dirname)
            dirs[:] = retained
            for filename in sorted(files):
                path = Path(current) / filename
                if linked(path):
                    omitted.append(path.relative_to(root).as_posix())
                else:
                    paths.append(path)
    return sorted(set(paths), key=lambda item: item.relative_to(root).as_posix()), sorted(omitted)


def collect_snapshot(project, engine_override, registry_path, logger):
    start, last = time.monotonic(), time.monotonic()
    paths, omitted = source_files(project)
    records, bytes_read = [], 0
    logger.event("hash-start", f"Hashing {len(paths)} source files; no editor or plugins will execute", total=len(paths))
    for index, path in enumerate(paths, 1):
        checksum, size = checked_hash(path)
        bytes_read += size
        records.append({"path": path.relative_to(project.parent).as_posix(), "size": size, "sha256": checksum})
        if time.monotonic() - last >= 3:
            logger.event("hash-progress", f"Verified {index}/{len(paths)} files", completed=index, total=len(paths), bytes_read=bytes_read, current_asset=path.relative_to(project.parent).as_posix())
            last = time.monotonic()
    descriptor = read_json(project)
    if not isinstance(descriptor, dict):
        raise ValueError(".uproject must contain a JSON object")
    if not isinstance(descriptor.get("Plugins", []), list):
        raise ValueError(".uproject Plugins must be a list")
    engine = detect_engine(descriptor.get("EngineAssociation", ""), engine_override)
    registry_hash = checked_hash(registry_path)[0] if registry_path else None
    logger.event("hash-done", f"Verified {len(paths)} files ({bytes_read} bytes)", seconds=round(time.monotonic() - start, 3))
    return {"schema_version": SCHEMA, "project": str(project), "files": records,
            "omitted_links": omitted, "descriptor": descriptor, "engine": engine,
            "registry_path": str(registry_path) if registry_path else None, "registry_sha256": registry_hash}


def inspect_project(snapshot):
    descriptor = snapshot["descriptor"]
    return {"project": snapshot["project"], "name": Path(snapshot["project"]).stem,
            "descriptor_version": descriptor.get("FileVersion"),
            "engine_association": descriptor.get("EngineAssociation", ""),
            "modules": descriptor.get("Modules", []), "plugins": descriptor.get("Plugins", []),
            "content_present": any(item["path"].startswith("Content/") for item in snapshot["files"]),
            "note": "FileVersion is the project descriptor format, not the Unreal Engine version."}


def package_path(relative, plugin_roots):
    path = Path(relative)
    if relative.startswith("Content/"):
        return "/Game/" + path.relative_to("Content").with_suffix("").as_posix()
    for prefix, name in plugin_roots:
        if relative.startswith(prefix):
            return "/" + name + "/" + relative[len(prefix):].rsplit(".", 1)[0]
    return None


def inventory(snapshot):
    root = Path(snapshot["project"]).parent
    plugin_descriptors, plugin_roots = [], []
    for item in snapshot["files"]:
        if item["path"].endswith(".uplugin"):
            path = root / item["path"]
            data = read_json(path)
            if not isinstance(data, dict):
                raise ValueError(f"Invalid plugin descriptor: {item['path']}")
            plugin_descriptors.append({"name": path.stem, "path": item["path"],
                                       "version": data.get("VersionName"), "engine_version": data.get("EngineVersion"),
                                       "can_contain_content": data.get("CanContainContent", False),
                                       "modules": data.get("Modules", []), "dependencies": data.get("Plugins", [])})
            plugin_roots.append((path.parent.relative_to(root).as_posix() + "/Content/", path.stem))
    assets = []
    for item in snapshot["files"]:
        suffix = Path(item["path"]).suffix.lower()
        if suffix in PACKAGE_EXTENSIONS:
            assets.append({**item, "package": package_path(item["path"], plugin_roots),
                           "kind": "map" if suffix == ".umap" else "unclassified_package",
                           "class": "World" if suffix == ".umap" else None,
                           "classification_source": "file_extension"})
    return {"schema_version": SCHEMA, "assets": assets,
            "maps": [item["package"] or item["path"] for item in assets if item["kind"] == "map"],
            "project_plugins": plugin_descriptors,
            "files": snapshot["files"], "omitted_links": snapshot["omitted_links"],
            "unclassified_files": [item["path"] for item in snapshot["files"] if Path(item["path"]).suffix.lower() not in INPUT_EXTENSIONS],
            "excluded_generated_directories": sorted(PRUNE),
            "counts": {"packages": len(assets), "maps": sum(item["kind"] == "map" for item in assets),
                       "project_plugins": len(plugin_descriptors), "input_files": len(snapshot["files"]),
                       "input_bytes": sum(item["size"] for item in snapshot["files"])},
            "dependency_coverage": "Unknown without Asset Registry metadata; filenames do not reveal package dependencies."}


def import_registry(snapshot, source_inventory, verified_engine=False):
    if not snapshot["registry_path"]:
        return {"available": False, "assets": [], "dependency_coverage": "unknown", "freshness": "unavailable"}
    data = read_json(snapshot["registry_path"])
    if not isinstance(data, dict) or data.get("schema_version") != SCHEMA or not isinstance(data.get("assets"), list):
        raise ValueError("Registry JSON must have schema_version: 1 and an assets list")
    if Path(data.get("project", "")).resolve() != Path(snapshot["project"]).resolve():
        raise ValueError("Registry metadata belongs to a different project")
    assets, seen = [], set()
    for entry in data["assets"]:
        if not isinstance(entry, dict):
            raise ValueError("Registry asset must be an object")
        package, kind, dependencies = entry.get("package"), entry.get("class"), entry.get("dependencies", [])
        if not isinstance(package, str) or not package.startswith("/") or not isinstance(kind, str):
            raise ValueError("Registry asset needs a package path and class string")
        if package in seen:
            raise ValueError(f"Duplicate registry package: {package}")
        if not isinstance(dependencies, list) or any(not isinstance(dep, str) or not dep.startswith("/") for dep in dependencies):
            raise ValueError("Registry dependencies must be package path strings")
        seen.add(package)
        assets.append({**entry, "package": package, "class": kind, "dependencies": sorted(set(dependencies))})
    known = {item["package"] for item in source_inventory["assets"]}
    local_mounts = {"Game", *(item["name"] for item in source_inventory["project_plugins"])}
    missing, external = [], []
    for entry in assets:
        for dependency in entry["dependencies"]:
            if dependency in known or dependency.startswith(("/Engine/", "/Script/")):
                continue
            record = {"asset": entry["package"], "dependency": dependency}
            (missing if dependency.split("/")[1] in local_mounts else external).append(record)
    return {"available": True, "assets": sorted(assets, key=lambda item: item["package"]),
            "missing_references": missing, "unverified_external_references": external,
            "classes": dict(sorted(Counter(item["class"] for item in assets).items())),
            "matched_filesystem_packages": sum(item["package"] in known for item in assets),
            "dependency_coverage": "declared_asset_registry_package_dependencies_only",
            "freshness": "verified_snapshot" if verified_engine and data.get("source_snapshot_hash") == digest(snapshot["files"]) else "unverified", "source_sha256": snapshot["registry_sha256"],
            "warning": "Imported metadata freshness is not proven. Regenerate after source changes; dynamic runtime references may be absent."}


CAPABILITIES = [
    ("characters", "Skeletal mesh, skin, skeleton, units and axes; glTF validation and Three.js playback"),
    ("animations", "Clips, root motion policy, retargeting, action mapping and blend behavior"),
    ("weapons", "Meshes, sockets, grips, animation events and gameplay integration"),
    ("materials", "Texture extraction, supported material translation and optional baking"),
    ("maps", "Actors, transforms, instancing, streaming, collision and lighting approximations"),
    ("gameplay", "Explicit Blueprint/C++ system reimplementation and gameplay tests"),
    ("ai", "Behavior trees, navigation, perception and combat behavior reimplementation"),
    ("multiplayer", "Authority, replication and prediction require a dedicated network architecture"),
]


def diagnostics(project, engine, inv, registry):
    messages = []
    def add(severity, code, message):
        messages.append({"severity": severity, "code": code, "message": message})
    if not project["content_present"]:
        add("warning", "NO_PROJECT_CONTENT", "No supported files found under Content; plugin-only or empty projects are possible.")
    if engine["status"] != "detected":
        add("warning", "ENGINE_UNAVAILABLE", "Matching editor unavailable. Filesystem inspection is still valid.")
    for warning in engine.get("warnings", []):
        add("warning", "ENGINE_DETAIL", warning)
    if inv["omitted_links"]:
        add("warning", "LINKS_OMITTED", f"Skipped {len(inv['omitted_links'])} symlinks/junctions. Inventory is incomplete.")
    if inv.get("unclassified_files"):
        add("warning", "UNCLASSIFIED_SOURCE_FILES", f"Retained and hashed {len(inv['unclassified_files'])} files without an inspection adapter; see inventory.unclassified_files.")
    if not registry["available"]:
        add("warning", "REGISTRY_ABSENT", "Asset classes and package dependencies are unknown for .uasset files. Optional registry extraction improves diagnostics.")
    elif registry.get("freshness") != "verified_snapshot":
        add("warning", "REGISTRY_FRESHNESS", registry["warning"])
    if registry["available"]:
        if registry.get("missing_references"):
            add("warning", "MISSING_REFERENCE", f"{len(registry['missing_references'])} declared local package references have no inventoried source file. Registry freshness is unverified; see registry.missing_references.")
        if registry.get("unverified_external_references"):
            add("warning", "EXTERNAL_REFERENCE_UNVERIFIED", f"{len(registry['unverified_external_references'])} references may require external plugins; see registry.unverified_external_references.")
    if project["modules"]:
        add("warning", "NATIVE_MODULES", "Project C++ modules require manual porting. No project code was loaded.")
    enabled = [entry.get("Name", "(unnamed)") for entry in project["plugins"] if isinstance(entry, dict) and entry.get("Enabled")]
    if enabled:
        add("info", "PLUGIN_REQUIREMENTS", f"Project declares {len(enabled)} enabled plugins; availability/API compatibility was not validated by loading them.")
    add("info", "NO_CONVERSION", "Stage 1 inspects source and plans work. It produces no converted assets or playable game.")
    return {"diagnostics": messages, "enabled_plugins": enabled,
            "asset_classes": registry.get("classes", {}), "registry_freshness": registry.get("freshness"),
            "processing": {"inspection_complete": True, "inventory_counts": inv["counts"]},
            "fidelity": {"status": "not_evaluated", "converted_assets": 0, "validated_runtime_assets": 0,
                         "playable_game": False, "percentage": None,
                         "reason": "Processing success measures inspection tasks; it is not visual or gameplay fidelity."},
            "capabilities": [{"stage": name, "status": "unsupported", "reason": detail} for name, detail in CAPABILITIES]}
