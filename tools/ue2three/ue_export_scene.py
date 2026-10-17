"""Unreal-native glTF export stage for ue2three.

Run INSIDE a trusted Unreal Editor with Python Editor Script Plugin and
GLTFExporter enabled. ue2three Stage 1 inventories metadata ONLY.
This stage uses Unreal's renderer to bake UE materials into glTF.
No assumption that .uasset bytes can be decoded outside the editor.

Example (Windows):
  UnrealEditor-Cmd.exe "C:/City/City.uproject" -run=pythonscript \
    -script="C:/SketchbookAI/tools/ue2three/ue_export_scene.py"

Environment:
  UE2THREE_LEVEL=/Game/Maps/UrbanDistrict  [optional, currently-open level when omitted]
  UE2THREE_EXPORT_DIR=C:/temp/ue2three-safe-export (REQUIRED; outside source)
  UE2THREE_SOURCE_LICENSE=MIT|CC0|... (REQUIRED; attach truthful license)
  UE2THREE_SOURCE_URL=https://... (REQUIRED; source provenance)

Safety: refuses export into the project tree; refuses success on no meshes.
"""
import json
import os
import time
from pathlib import Path

def _require(k):
    result = os.environ.get(k, "").strip()
    if not result:
        raise RuntimeError(f"{k} is required; never invent exported Unreal assets")
    return result

def export_level(unreal_api, params=os.environ):
    out_root = Path(params.get("UE2THREE_EXPORT_DIR", "")).expanduser()
    license_name = params.get("UE2THREE_SOURCE_LICENSE", "").strip()
    source_url = params.get("UE2THREE_SOURCE_URL", "").strip()
    if not str(out_root).strip() or str(out_root) == ".":
        raise RuntimeError("UE2THREE_EXPORT_DIR is required")
    if not license_name or not source_url.startswith(("https://", "http://")):
        raise RuntimeError("Must specify source license AND source URL")
    unreal = unreal_api
    project_dir = Path(str(unreal.Paths.project_dir())).resolve()
    output = out_root.resolve()
    if output == project_dir or project_dir in output.parents or output in project_dir.parents:
        raise RuntimeError("Export must be outside the Unreal source project")
    target_level = params.get("UE2THREE_LEVEL", "").strip()
    if target_level:
        if not target_level.startswith("/Game/"):
            raise RuntimeError("UE2THREE_LEVEL must be a /Game/... package path")
        unreal.EditorLevelLibrary.load_level(target_level)
    if not hasattr(unreal, "GLTFExporter"):
        raise RuntimeError("GLTFExporter plugin is unavailable; enable it in the .uproject")
    world = unreal.EditorLevelLibrary.get_editor_world()
    if not world:
        raise RuntimeError("No editable Unreal world is loaded")
    actors = list(unreal.EditorLevelLibrary.get_all_level_actors())
    meshes = []
    for actor in actors:
        # Detect static and skeletal meshes in the level, not just actors without geometry.
        try:
            for comp in actor.get_components_by_class(unreal.StaticMeshComponent):
                if comp.static_mesh:
                    meshes.append(str(actor.get_actor_label()))
            for comp in actor.get_components_by_class(unreal.SkeletalMeshComponent):
                meshes.append(str(actor.get_actor_label()))
        except Exception:
            continue
    if not meshes:
        raise RuntimeError("No meshes in editor world: trigger the source project's procedural generation first")
    output.mkdir(parents=True, exist_ok=True)
    dest = output / "scene.glb"
    options = unreal.GLTFExportOptions()
    options.export_hidden_in_game = False
    start = time.monotonic()
    ok = unreal.GLTFExporter.export_to_gltf(world, str(dest), options, set())
    if not ok or not dest.is_file() or dest.stat().st_size < 32:
        raise RuntimeError("GLTFExporter did not create a usable scene.glb")
    meta = {
        "schema": 1, "tool": "ue2three", "stage": "unreal-native-gltf-export",
        "source_type": "UNREAL_NATIVE_LEVEL", "level": str(target_level or world.get_path_name()),
        "project": str(project_dir), "source_url": source_url, "license": license_name,
        "input_actor_count": len(actors), "input_mesh_actor_count": len(set(meshes)),
        "exported_glb": dest.name, "exported_bytes": dest.stat().st_size,
        "duration_seconds": round(time.monotonic()-start, 2),
        "warning": "Unreal physics collision, Nanite, Lumen, Blueprint behavior and navigation are not included in glTF"
    }
    (output / "unreal-export.json").write_text(json.dumps(meta, indent=2)+"\n", encoding="utf-8")
    unreal.log(f"UE2THREE_NATIVE_EXPORT_SUCCESS file={dest} actors={len(meshes)} bytes={dest.stat().st_size}")
    return meta

if __name__ == "__main__":
    import unreal
    export_level(unreal)
