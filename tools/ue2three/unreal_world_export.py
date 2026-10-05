"""Run inside Unreal: export selected source levels as portable glTF scenes."""
import json
import os
import re
from pathlib import Path

import unreal


def atomic(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp")
    temp.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")
    os.replace(temp, path)


job = json.loads(Path(os.environ["UE2THREE_MAP_JOB_FILE"]).read_text(encoding="utf-8"))
active = Path(unreal.Paths.convert_relative_path_to_full(unreal.Paths.get_project_file_path())).resolve()
if active != Path(job["scratch_project"]).resolve():
    raise RuntimeError("[PROJECT_IDENTITY_MISMATCH] Active Unreal project does not match the migration job.")
source_project = Path(job["source_project"]).resolve()
output = Path(job["output"]).resolve()
if output == source_project.parent or source_project.parent in output.parents:
    raise RuntimeError("[OUTPUT_INSIDE_SOURCE] Map output must be outside the Unreal project.")

options = unreal.GLTFExportOptions()
for name, value in (("export_uniform_scale", 0.01), ("export_vertex_skin_weights", True),
                    ("export_animation_sequences", False), ("export_skeletal_meshes", True),
                    ("export_static_meshes", True), ("export_cameras", True),
                    ("export_lights", True)):
    if hasattr(options, name):
        setattr(options, name, value)
if hasattr(unreal, "GLTFMaterialBakeMode") and hasattr(options, "bake_material_inputs"):
    options.bake_material_inputs = unreal.GLTFMaterialBakeMode.DISABLED

level_editor = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
editor = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
results = []
for index, item in enumerate(job["maps"], 1):
    package, filename = item["package"], item["filename"]
    target = output / filename
    row = {"package": package, "filename": filename, "fingerprint": item["fingerprint"], "status": "failed"}
    try:
        unreal.log(f"UE2THREE_MAP_START {index}/{len(job['maps'])} {package}")
        if not level_editor.load_level(package):
            raise RuntimeError("Unreal could not open this level package")
        world = editor.get_editor_world()
        if world is None:
            raise RuntimeError("Unreal returned no editor world after loading the level")
        messages = unreal.GLTFExporter.export_to_gltf(world, str(target), options, set())
        errors = getattr(messages, "errors", []) if messages is not None else ["Exporter returned no result"]
        warnings = getattr(messages, "warnings", []) if messages is not None else []
        if errors:
            raise RuntimeError("; ".join(str(message) for message in errors))
        if not target.is_file() or target.stat().st_size < 20:
            raise RuntimeError("Exporter produced no GLB file")
        row.update(status="exported", bytes=target.stat().st_size,
                   warnings=[str(message) for message in warnings])
        unreal.log(f"UE2THREE_MAP_DONE {package} {target.stat().st_size}")
    except Exception as error:
        row["error"] = str(error)
        unreal.log_error(f"UE2THREE_MAP_FAILED {package}: {error}")
    results.append(row)
    atomic(job["result"], {"source_project": str(source_project), "source_snapshot_hash": job["source_snapshot_hash"],
                           "complete": index == len(job["maps"]), "results": results})
    if job.get("progress"):
        atomic(job["progress"], {"completed": index, "total": len(job["maps"]), "package": package,
                                 "status": row["status"]})

if not any(row["status"] == "exported" for row in results):
    raise RuntimeError("[NO_LEVEL_EXPORTS] Unreal could not export any selected source level.")
