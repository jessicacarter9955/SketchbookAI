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
        options.set_editor_property(name, value)
if hasattr(unreal, "GLTFMaterialBakeMode") and hasattr(options, "bake_material_inputs"):
    options.set_editor_property("bake_material_inputs", unreal.GLTFMaterialBakeMode.USE_MESH_DATA)
if hasattr(unreal, "GLTFTextureImageFormat") and hasattr(options, "texture_image_format"):
    options.set_editor_property("texture_image_format", unreal.GLTFTextureImageFormat.PNG)
if hasattr(unreal, "GLTFMaterialBakeSize") and hasattr(options, "default_material_bake_size"):
    # Keep the migration cache portable and avoid multi-megabyte renders for
    # every dynamic instance in large maps. 512px retains readable PBR detail.
    options.set_editor_property("default_material_bake_size", unreal.GLTFMaterialBakeSize(512, 512, False))
for name, value in (("export_texture_transforms", True), ("adjust_normalmaps", True)):
    if hasattr(options, name):
        options.set_editor_property(name, value)
unreal.log("UE2THREE_GLTF_OPTIONS bake_material_inputs=" + str(options.get_editor_property("bake_material_inputs")) +
           " texture_image_format=" + str(options.get_editor_property("texture_image_format")) +
           " default_material_bake_size=" + str(options.get_editor_property("default_material_bake_size")))

level_editor = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
editor = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
results = []
for index, item in enumerate(job["maps"], 1):
    package, filename = item["package"], item["filename"]
    target = output / filename
    row = {"package": package, "filename": filename, "fingerprint": item["fingerprint"], "status": "failed"}
    try:
        unreal.log(f"UE2THREE_MAP_START {index}/{len(job['maps'])} {package}")
        if job.get("progress"):
            atomic(job["progress"], {"completed": index - 1, "total": len(job["maps"]),
                                      "package": package, "status": "loading",
                                      "message": "Carico la mappa e preparo gli shader dei materiali"})
        if not level_editor.load_level(package):
            raise RuntimeError("Unreal could not open this level package")
        world = editor.get_editor_world()
        if world is None:
            raise RuntimeError("Unreal returned no editor world after loading the level")
        if job.get("progress"):
            atomic(job["progress"], {"completed": index - 1, "total": len(job["maps"]),
                                      "package": package, "status": "baking",
                                      "message": "Converto materiali, texture e geometria della mappa"})
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
