"""Export an explicitly selected CityBLD / Modern City Unreal batch to genuine GLB.

Run INSIDE Unreal Editor 5.8 Python console, after creating CityBLD geometry:
  py "C:/path/to/SketchbookAI/tools/citybld/export_selected_citybld.py"

Fail closed: this script does NOT generate CityBLD content, install a license,
invent GLB geometry, or use any unrelated public city asset as a replacement.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import traceback

import unreal

def require(condition, message):
    if not condition:
        raise RuntimeError("CITYBLD_PREFLIGHT: " + message)

def run():
    batch = os.getenv("CITYBLD_BATCH_NAME", "ny-001")
    require(re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", batch) is not None,
            "Invalid batch name; use lowercase letters, numbers and hyphens.")
    version = str(unreal.SystemLibrary.get_engine_version())
    require(version.startswith("5.8"), "Unreal Engine 5.8 required; got " + version)
    enabled = sorted(str(x) for x in unreal.PluginBlueprintLibrary.get_enabled_plugin_names())
    plugin_keys = [x.lower() for x in enabled]
    require(any("worldbld" in x for x in plugin_keys), "WorldBLD plugin must be enabled.")
    require(any("citybld" in x for x in plugin_keys), "CityBLD plugin must be enabled.")
    kit_name = os.getenv("CITYBLD_KIT_PLUGIN_NAME", "")
    if kit_name:
        require(kit_name in enabled, "Specified Modern City Kit plugin is not enabled: " + kit_name)
    else:
        require(any("modern" in x and ("city" in x or "essentials" in x) for x in plugin_keys),
                "Modern City kit plugin not confirmed. Set CITYBLD_KIT_PLUGIN_NAME "
                "to its ACTUAL enabled plugin name after installing it.")
    require("GLTFExporter" in enabled, "Enable Unreal's built-in glTF Exporter plugin.")
    subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    actors = list(subsystem.get_selected_level_actors())
    require(len(actors) >= 1, "Select the CityBLD-built geometry of ONE batch in the viewport.")
    world = unreal.EditorLevelLibrary.get_editor_world()
    require(world is not None, "Open the actual generated CityBLD level.")
    source_level = str(world.get_path_name())
    require("/Game/" in source_level, "The level must be a saved, project-owned .umap.")
    output_root = Path(os.getenv("CITYBLD_EXPORT_DIR") or
                       str(Path(unreal.Paths.project_saved_dir()) / "CityBLDBatches"))
    folder = output_root / batch
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / (batch + ".glb")
    if target.exists():
        # Never mistake leftovers from an earlier attempt for a new export.
        target.unlink()
    source_actors = []
    for actor in actors:
        paths = []
        for component in actor.get_components_by_class(unreal.StaticMeshComponent):
            mesh = component.get_editor_property("static_mesh")
            if mesh:
                paths.append(str(mesh.get_path_name()))
        source_actors.append({
            "name": str(actor.get_actor_label()),
            "class": str(actor.get_class().get_name()),
            "mesh_asset_paths": sorted(set(paths)),
        })
    options = unreal.GLTFExportOptions()
    options.set_editor_property("adjust_normalmaps", True)
    unreal.log("CITYBLD_EXPORT: " + batch + " selected=" + str(len(actors)))
    # Epic's documented built-in exporter. An empty set exports the WHOLE level;
    # passing the explicit selected set prevents accidental giant/cross-kit exports.
    messages = unreal.GLTFExporter.export_to_gltf(world, str(target), options, set(actors))
    require(target.is_file() and target.stat().st_size > 1024,
            "Exporter produced no non-empty GLB; check Output Log: " + str(messages))
    with target.open("rb") as f:
        require(f.read(4) == b"glTF", "Exported file is not binary glTF.")
    sha256 = hashlib.sha256(target.read_bytes()).hexdigest()
    manifest = {
        "schema": "citybld-selected-export-v1",
        "batch": batch,
        "source_engine": version,
        "source_level": source_level,
        "source_workflow": "CityBLD + Modern City Kit in Unreal Editor",
        "enabled_worldbld_plugins": [p for p in enabled
                                     if "bld" in p.lower() or "modern" in p.lower()],
        "selected_actor_count": len(actors),
        "actors": source_actors,
        "glb": target.name,
        "sha256": sha256,
        "bytes": target.stat().st_size,
        "verified_in_threejs": False,
    }
    (folder / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    unreal.log("CITYBLD_EXPORT_OK: " + str(target))
    unreal.log("CITYBLD_EXPORT_SHA256: " + sha256)
    return folder

if __name__ == "__main__":
    try:
        run()
    except Exception as exc:
        unreal.log_error("CITYBLD_EXPORT_FAILED: " + str(exc))
        traceback.print_exc()
        raise
