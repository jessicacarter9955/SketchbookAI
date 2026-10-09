"""Executed inside Unreal Editor Python. Exports one recipe-defined character without saving source packages."""
import json
import os
import re
import struct
from pathlib import Path

import unreal

RECIPE = Path(os.environ["UE2THREE_CHARACTER_RECIPE"])
OUT = Path(os.environ["UE2THREE_CHARACTER_OUT"])
OUT.mkdir(parents=True, exist_ok=True)
recipe = json.loads(RECIPE.read_text(encoding="utf-8"))
warnings = []


def valid_glb(path):
    try:
        with Path(path).open("rb") as stream:
            header = stream.read(12)
        if len(header) != 12:
            return False
        magic, version, length = struct.unpack("<4sII", header)
        return magic == b"glTF" and version == 2 and length == Path(path).stat().st_size
    except OSError:
        return False


def set_option(options, name, value):
    if hasattr(options, name):
        options.set_editor_property(name, value)
    else:
        warnings.append("GLTF option unavailable in this Unreal version: " + name)


options = unreal.GLTFExportOptions()
set_option(options, "export_uniform_scale", float(recipe.get("export", {}).get("uniform_scale", 0.01)))
set_option(options, "export_vertex_skin_weights", True)
set_option(options, "export_animation_sequences", True)
set_option(options, "export_preview_mesh", True)
if hasattr(unreal, "GLTFMaterialBakeMode"):
    # Material instances with layered/function graphs need baking to carry their
    # rendered base color and texture inputs into portable glTF materials.
    set_option(options, "bake_material_inputs", unreal.GLTFMaterialBakeMode.USE_MESH_DATA)
if hasattr(unreal, "GLTFTextureImageFormat"):
    set_option(options, "texture_image_format", unreal.GLTFTextureImageFormat.PNG)
set_option(options, "export_texture_transforms", True)
set_option(options, "adjust_normalmaps", True)
if hasattr(unreal, "GLTFMaterialVariantMode"):
    set_option(options, "export_material_variants", unreal.GLTFMaterialVariantMode.NONE)
unreal.log("UE2THREE_GLTF_OPTIONS bake_material_inputs=" + str(options.get_editor_property("bake_material_inputs")) +
           " texture_image_format=" + str(options.get_editor_property("texture_image_format")))


def export(asset, filename, expected_type):
    target = OUT / filename
    if valid_glb(target):
        unreal.log("UE2THREE_REUSE " + filename)
        return
    if target.exists():
        target.unlink()
    if not isinstance(asset, expected_type):
        raise RuntimeError("Unexpected or missing Unreal asset for " + filename)
    messages = unreal.GLTFExporter.export_to_gltf(asset, str(target), options, set())
    if messages is None or getattr(messages, "errors", None):
        raise RuntimeError("GLTF export failed for " + filename + ": " + str(messages))
    if not valid_glb(target):
        raise RuntimeError("GLTF exporter produced an invalid file: " + filename)
    unreal.log("UE2THREE_EXPORTED " + filename)


mesh = unreal.load_asset(recipe["mesh"])
component = unreal.SkeletalMeshComponent()
component.set_skeletal_mesh_asset(mesh)


def resolve_socket(name):
    if not component.does_socket_exist(name):
        raise RuntimeError("Character has no Unreal bone/socket: " + name)
    bone = str(component.get_socket_bone_name(name))
    if bone == name:
        return bone, None
    value = component.get_socket_transform(name, unreal.RelativeTransformSpace.RTS_PARENT_BONE_SPACE)
    p, q, s = value.translation, value.rotation, value.scale3d
    scale = float(recipe.get("export", {}).get("uniform_scale", 0.01))
    # Same handedness/axis conversion as UE's FGLTFCoreUtilities.
    return bone, {"position": [p.x * scale, p.z * scale, p.y * scale],
                  "quaternion": [-q.x, -q.z, -q.y, q.w], "scale": [s.x, s.z, s.y]}


export(mesh, "character.glb", unreal.SkeletalMesh)
set_option(options, "export_preview_mesh", False)

clip_files = {}
for name, path in sorted(recipe["clips"].items()):
    filename = "clip-" + name + ".glb"
    export(unreal.load_asset(path), filename, unreal.AnimSequence)
    clip_files[name] = filename

attachment_files = {}
for name, definition in sorted(recipe.get("attachment_assets", {}).items()):
    asset = unreal.load_asset(definition["asset"])
    if not isinstance(asset, (unreal.StaticMesh, unreal.SkeletalMesh)):
        raise RuntimeError("Attachment must be a StaticMesh or SkeletalMesh: " + definition["asset"])
    filename = "attachment-" + name + ".glb"
    export(asset, filename, (unreal.StaticMesh, unreal.SkeletalMesh))
    bone, socket_transform = resolve_socket(definition["bone"])
    attachment_files[name] = {"file": filename, "bone": bone, "socket": definition["bone"],
                              "transform": definition.get("transform", {})}
    if socket_transform:
        attachment_files[name]["socket_transform"] = socket_transform

data_table_files = {}
for name, path in sorted(recipe.get("data_tables", {}).items()):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,79}", name):
        raise RuntimeError("Data table key must be a safe portable name: " + name)
    table = unreal.load_asset(path)
    if not isinstance(table, unreal.DataTable):
        raise RuntimeError("Expected an Unreal DataTable: " + path)
    filename = "table-" + name + ".json"
    target = OUT / filename
    if not table.export_to_json_file(str(target)) or not target.is_file():
        raise RuntimeError("Unreal could not export DataTable " + path)
    data_table_files[name] = {"file": filename, "source": path}
    unreal.log("UE2THREE_DATA_TABLE_EXPORTED " + name + " rows=" + str(len(table.get_row_names())))

manifest = {
    "schema_version": 1,
    "kind": "character",
    "recipe_id": recipe["id"],
    "fingerprint": recipe["fingerprint"],
    "mesh": "character.glb",
    "clips": clip_files,
    "attachment_assets": attachment_files,
    "data_tables": data_table_files,
    "runtime": recipe.get("runtime", {}),
    "source": {
        "project": recipe.get("source_project"),
        "mesh": recipe["mesh"],
        "clips": recipe["clips"],
        "engine_version": unreal.SystemLibrary.get_engine_version(),
        "files": recipe.get("source_files", []),
    },
    "export": recipe.get("export", {}),
    "warnings": warnings,
}
temp = OUT / "manifest.json.tmp"
temp.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
os.replace(temp, OUT / "manifest.json")
unreal.log("UE2THREE_CHARACTER_EXPORT_DONE " + recipe["id"])
