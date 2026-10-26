"""Run inside Unreal: export selected source levels as portable glTF scenes."""
import json
import os
import re
import sys
from pathlib import Path

import unreal

# Unreal's -run=pythonscript -script=<absolute path> does not reliably add the
# script directory to sys.path. Resolve the sibling source-witness validator
# explicitly; otherwise Unreal exits before loading the map or writing census.
_ue2three_script_dir = str(Path(__file__).resolve().parent)
if _ue2three_script_dir not in sys.path:
    sys.path.insert(0, _ue2three_script_dir)
from map_actor_selection import resolve_actor_selection


def atomic(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp")
    temp.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")
    os.replace(temp, path)


def restore_parent_materials(world):
    """Use inherited source materials when map actors hold empty transient MIDs.

    Construction scripts commonly wrap a MaterialInstanceConstant in a dynamic
    instance even when they do not override any parameters. Preserve those
    inherited values with a stable parent assignment in the isolated export world.
    This alone does not resolve every material baking failure.
    """
    changed = []
    for actor in unreal.EditorLevelLibrary.get_all_level_actors():
        for component in actor.get_components_by_class(unreal.StaticMeshComponent):
            for index in range(component.get_num_materials()):
                material = component.get_material(index)
                if not material or material.get_class().get_name() != "MaterialInstanceDynamic":
                    continue
                try:
                    parent = material.get_editor_property("parent")
                    has_overrides = any(material.get_editor_property(name) for name in (
                        "vector_parameter_values", "scalar_parameter_values", "texture_parameter_values"))
                except Exception:
                    continue
                if not parent or parent.get_class().get_name() == "MaterialInstanceDynamic" or has_overrides:
                    continue
                component.set_material(index, parent)
                changed.append({"actor": actor.get_actor_label(), "slot": index,
                                "instance": material.get_name(), "parent": parent.get_path_name()})
    unreal.log("UE2THREE_MATERIAL_INSTANCES_RESOLVED " + json.dumps(changed, sort_keys=True))
    return changed


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
                    ("export_lights", True), ("export_vertex_colors", False)):
    if hasattr(options, name):
        options.set_editor_property(name, value)
requested_bake_mode = job.get("material_bake_mode", "use_mesh_data")
bake_modes = {"use_mesh_data": "USE_MESH_DATA", "simple": "SIMPLE", "disabled": "DISABLED"}
if requested_bake_mode not in bake_modes:
    raise RuntimeError("[INVALID_MATERIAL_BAKE_MODE] Unknown glTF material bake mode")
if not hasattr(unreal, "GLTFMaterialBakeMode") or not hasattr(options, "bake_material_inputs"):
    raise RuntimeError("[MATERIAL_BAKE_OPTIONS_MISSING] This Unreal glTF exporter lacks explicit material bake controls")
# World-position shaders need the actual component geometry. Keep this as the
# default; lower-fidelity modes are allowed only by the crash-aware orchestrator.
options.set_editor_property("bake_material_inputs", getattr(unreal.GLTFMaterialBakeMode,
                                                             bake_modes[requested_bake_mode]))
if hasattr(unreal, "GLTFTextureImageFormat") and hasattr(options, "texture_image_format"):
    options.set_editor_property("texture_image_format", unreal.GLTFTextureImageFormat.PNG)
if hasattr(unreal, "GLTFMaterialBakeSize") and hasattr(options, "default_material_bake_size"):
    # Keep the migration cache portable and avoid multi-megabyte renders for
    # every dynamic instance in large maps. 512px retains readable PBR detail.
    options.set_editor_property("default_material_bake_size", unreal.GLTFMaterialBakeSize(512, 512, False))
for name, value in (("export_texture_transforms", True), ("adjust_normalmaps", True)):
    if hasattr(options, name):
        options.set_editor_property(name, value)
unreal.log("UE2THREE_GLTF_OPTIONS requested_material_bake_mode=" + requested_bake_mode +
           " bake_material_inputs=" + str(options.get_editor_property("bake_material_inputs")) +
           " texture_image_format=" + str(options.get_editor_property("texture_image_format")) +
           " default_material_bake_size=" + str(options.get_editor_property("default_material_bake_size")))

level_editor = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
editor = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
results = []
for index, item in enumerate(job["maps"], 1):
    package, filename = item["package"], item["filename"]
    target = output / filename
    row = {"package": package, "filename": filename, "fingerprint": item["fingerprint"],
           "material_bake_mode": requested_bake_mode, "status": "failed"}
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
        actors = list(unreal.EditorLevelLibrary.get_all_level_actors())
        actor_set, selection = resolve_actor_selection(actors, item.get("selected_actor_names"))
        row["actor_selection"] = selection
        if job.get("actor_census_file"):
            census = Path(job["actor_census_file"]).resolve()
            if census == source_project.parent or source_project.parent in census.parents:
                raise RuntimeError("[CENSUS_INSIDE_SOURCE] Actor diagnostics must stay outside the source project")
            atomic(census, {"schema_version": 1, "package": package,
                            "source_snapshot_hash": job["source_snapshot_hash"],
                            "selection": selection,
                            "actors": [{"name": actor.get_name(), "label": actor.get_actor_label(),
                                        "class": actor.get_class().get_name()} for actor in actors]})
        resolved_materials = restore_parent_materials(world)
        if job.get("progress"):
            atomic(job["progress"], {"completed": index - 1, "total": len(job["maps"]),
                                      "package": package, "status": "baking",
                                      "message": "Converto materiali, texture e geometria della mappa"})
        # Per Epic's GLTFExporter contract, a nonempty set limits the export to
        # exactly those actors; an empty set exports all. The isolated subset
        # mode is diagnostic only and must never be published as a full level.
        messages = unreal.GLTFExporter.export_to_gltf(world, str(target), options, actor_set)
        errors = getattr(messages, "errors", []) if messages is not None else ["Exporter returned no result"]
        warnings = getattr(messages, "warnings", []) if messages is not None else []
        if errors:
            raise RuntimeError("; ".join(str(message) for message in errors))
        if not target.is_file() or target.stat().st_size < 20:
            raise RuntimeError("Exporter produced no GLB file")
        row.update(status="exported", bytes=target.stat().st_size,
                   warnings=[str(message) for message in warnings],
                   resolved_dynamic_material_instances=len(resolved_materials))
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
