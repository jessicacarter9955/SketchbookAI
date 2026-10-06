"""Read-only UMG extraction for a source-derived Three.js screen preview."""
import hashlib
import json
import os
import subprocess
import urllib.request
from pathlib import Path

from core import atomic_json, file_hash, read_json
from map_migration import _dependency_packages


UASSETGUI_URL = "https://github.com/atenfyr/UAssetGUI/releases/download/v1.1.0/UAssetGUI.exe"
UASSETGUI_SHA256 = "b7d75c0893f1a60e565853ae638bc21f2416cd12c2d9d854e297abb87ceb3263"


class UMGMigrationError(RuntimeError):
    pass


def _tool(cache_dir):
    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    executable = cache_dir / "UAssetGUI-1.1.0.exe"
    if executable.is_file() and file_hash(executable) == UASSETGUI_SHA256:
        return executable
    temporary = executable.with_suffix(".download")
    try:
        request = urllib.request.Request(UASSETGUI_URL, headers={"User-Agent": "ue2three/1"})
        with urllib.request.urlopen(request, timeout=60) as response, temporary.open("wb") as output:
            while True:
                block = response.read(1024 * 1024)
                if not block:
                    break
                output.write(block)
        if file_hash(temporary) != UASSETGUI_SHA256:
            raise UMGMigrationError("UAssetGUI release checksum does not match the pinned v1.1.0 tool.")
        os.replace(temporary, executable)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    return executable


def _properties(export):
    return {item.get("Name"): item for item in export.get("Data", [])
            if isinstance(item, dict) and item.get("Name")}


def _value(item):
    if not isinstance(item, dict):
        return item
    kind = str(item.get("$type", ""))
    if kind.endswith("TextPropertyData, UAssetAPI"):
        return item.get("CultureInvariantString") or item.get("SourceValue") or ""
    if kind.endswith("ArrayPropertyData, UAssetAPI"):
        return [_value(child) for child in item.get("Value", [])]
    if kind.endswith("MapPropertyData, UAssetAPI"):
        return [[_value(child) for child in pair] for pair in item.get("Value", [])]
    if kind.endswith("StructPropertyData, UAssetAPI"):
        return {child.get("Name", str(index)): _value(child)
                for index, child in enumerate(item.get("Value", [])) if isinstance(child, dict)}
    value = item.get("Value")
    if isinstance(value, list):
        if value and all(isinstance(child, dict) and "Name" in child for child in value):
            return {child["Name"]: _value(child) for child in value}
        return [_value(child) for child in value]
    if isinstance(value, dict) and "X" in value:
        return {key: value[key] for key in ("X", "Y", "Z", "W") if key in value}
    return value


class Package:
    def __init__(self, document):
        self.document = document
        self.exports = document.get("Exports", [])
        self.imports = document.get("Imports", [])

    def export(self, index):
        return self.exports[index - 1] if isinstance(index, int) and 0 < index <= len(self.exports) else None

    def class_name(self, export):
        reference = export.get("ClassIndex")
        if isinstance(reference, int) and reference < 0 and -reference <= len(self.imports):
            return str(self.imports[-reference - 1].get("ObjectName", "Unknown"))
        if isinstance(reference, int) and reference > 0:
            obj = self.export(reference)
            return str(obj.get("ObjectName", "Unknown")) if obj else "Unknown"
        return "Unknown"

    def props(self, export):
        return {key: _value(value) for key, value in _properties(export).items()}


def _asset_file(project, package):
    if package.startswith("/Game/"):
        return project.parent / "Content" / (package[len("/Game/"):] + ".uasset")
    return None


def _references(value):
    if isinstance(value, dict):
        if value.get("$type", "").endswith("ObjectPropertyData, UAssetAPI"):
            ref = value.get("Value")
            return [ref] if isinstance(ref, int) else []
        return [ref for child in value.values() for ref in _references(child)]
    if isinstance(value, list):
        return [ref for child in value for ref in _references(child)]
    return []


def _widgets_for_map(registry, map_package):
    assets = {item.get("package"): item for item in registry.get("assets", [])}
    closure = _dependency_packages(map_package, registry)
    return sorted(package for package in closure
                  if assets.get(package, {}).get("class") == "WidgetBlueprintGeneratedClass")


def _asset_document(package_name, asset_file, tool, cache_dir, engine_version, force=False):
    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    source_hash = file_hash(asset_file)
    cache_file = cache_dir / f"{source_hash}.json"
    if cache_file.is_file() and not force:
        try:
            return Package(read_json(cache_file)), source_hash
        except (OSError, ValueError):
            cache_file.unlink(missing_ok=True)
    temporary = cache_file.with_suffix(".json.tmp")
    completed = subprocess.run([str(tool), "tojson", str(asset_file), str(temporary), str(engine_version)],
                               capture_output=True, text=True, timeout=300, check=False)
    if completed.returncode != 0 or not temporary.is_file():
        detail = (completed.stderr or completed.stdout or f"UAssetGUI exited {completed.returncode}").strip()
        raise UMGMigrationError(f"Could not read {package_name}: {detail[:600]}")
    try:
        document = read_json(temporary)
        if not document.get("Exports"):
            raise UMGMigrationError(f"UAssetGUI returned no exports for {package_name}")
        os.replace(temporary, cache_file)
        return Package(document), source_hash
    except (OSError, ValueError) as error:
        temporary.unlink(missing_ok=True)
        raise UMGMigrationError(f"Invalid UAssetGUI JSON for {package_name}: {error}") from error


def _widget_blueprint(package, asset_name):
    return next((item for item in package.exports
                 if item.get("ObjectName") == asset_name and
                 package.class_name(item) in {"WidgetBlueprint", "WidgetBlueprintGeneratedClass"}), None)


def _build_widget_tree(package_name, package, asset_name, widget_packages, packages, active=()):
    if package_name in active:
        return {"kind": "cycle", "name": package_name, "children": []}
    blueprint = _widget_blueprint(package, asset_name)
    if not blueprint:
        return {"kind": "unsupported", "name": asset_name, "children": []}
    blueprint_props = package.props(blueprint)
    tree_export = package.export(blueprint_props.get("WidgetTree"))
    if not tree_export:
        return {"kind": "unsupported", "name": asset_name, "children": []}
    root_ref = package.props(tree_export).get("RootWidget")
    next_active = (*active, package_name)

    def walk(ref, depth=0):
        if depth > 48:
            return {"kind": "depth-limit", "children": []}
        export = package.export(ref)
        if not export:
            return {"kind": "missing", "children": []}
        kind = package.class_name(export)
        raw_props = _properties(export)
        values = {key: _value(value) for key, value in raw_props.items()
                  if key not in {"Slot", "Parent", "Slots", "bExpandedInDesigner"}}
        node = {"kind": kind, "name": export.get("ObjectName", ""), "properties": values, "slot": None, "children": []}
        props = package.props(export)
        slot = package.export(props.get("Slot"))
        if slot:
            node["slot"] = {key: _value(value) for key, value in _properties(slot).items()
                            if key not in {"Parent", "Content"}}
        custom_name = kind[:-2] if kind.endswith("_C") else None
        child_package = widget_packages.get(custom_name) if custom_name else None
        if child_package and child_package != package_name:
            nested = packages.get(child_package)
            if nested:
                sub = _build_widget_tree(child_package, nested, custom_name, widget_packages, packages, next_active)
                sub["name"] = node["name"]
                sub["instance"] = values
                return sub
        slot_refs = _references(raw_props.get("Slots", {}))
        for slot_ref in slot_refs:
            slot_export = package.export(slot_ref)
            if not slot_export:
                continue
            content_ref = package.props(slot_export).get("Content")
            child = walk(content_ref, depth + 1)
            child["slot"] = {key: _value(value) for key, value in _properties(slot_export).items()
                             if key not in {"Parent", "Content"}}
            node["children"].append(child)
        return node

    return walk(root_ref)


def migrate_ui(project, workspace, publish_dir, logger, engine_version=None, force=False):
    """Export menu-reachable UMG layouts into a cacheable, source-derived manifest."""
    from pipeline import load_state

    project = Path(project).resolve(strict=True)
    workspace = Path(workspace).resolve(strict=True)
    state = load_state(workspace)
    if Path(state["config"]["project"]).resolve() != project or state.get("source_verification_status") != "verified":
        raise UMGMigrationError("Verified inspection metadata for this project is required before UI migration")
    inventory = read_json(workspace / "artifacts" / "inventory.json")
    registry = read_json(workspace / "artifacts" / "engine_metadata.json")
    engine = read_json(workspace / "artifacts" / "engine.json")
    if not registry.get("complete") or registry.get("project") != str(project):
        raise UMGMigrationError("Fresh Asset Registry metadata for this project is required")
    version = str((engine_version or engine.get("version") or "").split("-")[0])
    if not version or version == "None":
        raise UMGMigrationError("The matching Unreal Engine version could not be read")
    maps = inventory.get("maps", [])
    map_package = next((name for name in maps if "mainmenu" in name.lower()), maps[0] if maps else None)
    if not map_package:
        raise UMGMigrationError("The Unreal project inventory contains no map from which to discover screens")
    widget_names = _widgets_for_map(registry, map_package)
    if not widget_names:
        raise UMGMigrationError(f"No Widget Blueprint dependencies were found for {map_package}")
    assets = {item.get("package"): item for item in registry.get("assets", [])}
    by_object = {}
    for name in widget_names:
        record = assets.get(name, {})
        object_name = str(record.get("object_name", "")).removesuffix("_C")
        by_object[object_name] = name
    roots = [name for name in widget_names
             if "mainmenu" in str(assets.get(name, {}).get("object_name", "")).lower()]
    if not roots:
        referenced = {dep for name in widget_names for dep in assets.get(name, {}).get("dependencies", [])}
        roots = [name for name in widget_names if name not in referenced]
    root_package = roots[0] if roots else widget_names[0]

    output = Path(publish_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    cache = workspace / "artifacts" / "uasset-json"
    tool = _tool(workspace / "tool-cache")
    packages, source_hashes = {}, {}
    for index, name in enumerate(widget_names, 1):
        asset_file = _asset_file(project, name)
        if not asset_file or not asset_file.is_file():
            raise UMGMigrationError(f"Widget asset file not found for {name}")
        packages[name], source_hashes[name] = _asset_document(name, asset_file, tool, cache, version, force)
        logger.event("ui-progress", f"Reading original UI {index}/{len(widget_names)}: {name.rsplit('/', 1)[-1]}",
                     task="ui_export", completed=index, total=len(widget_names))

    root_name = assets[root_package].get("object_name", "").removesuffix("_C")
    tree = _build_widget_tree(root_package, packages[root_package], root_name, by_object, packages)
    fingerprint = hashlib.sha256(json.dumps({"source_hashes": source_hashes, "root": root_package,
                                              "tool": UASSETGUI_SHA256}, sort_keys=True).encode()).hexdigest()
    manifest = {"schema_version": 1, "project": str(project), "engine_version": engine.get("version"),
                "source_snapshot_hash": state.get("snapshot_hash"), "root_map": map_package,
                "root_widget": root_package, "widget_blueprints": widget_names, "fingerprint": fingerprint,
                "tree": tree,
                "limitations": ["This batch preserves source UMG hierarchy, labels, and supported layout values.",
                                "Widget event graphs and Unreal service calls are not yet executable in Three.js.",
                                "Brush textures, Slate-specific materials, and custom widget effects are reported but not rendered yet."]}
    target = output / "ui-manifest.json"
    if force or not target.is_file() or read_json(target).get("fingerprint") != fingerprint:
        atomic_json(target, manifest)
    logger.event("ui-export-summary", f"Extracted {len(widget_names)} source Widget Blueprints", task="ui_export",
                 report=str(target), root_widget=root_package)
    return manifest
