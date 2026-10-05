"""Executed inside Unreal Editor Python. Exports one recipe-defined character without saving source packages."""
import json
import os
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
        setattr(options, name, value)
    else:
        warnings.append("GLTF option unavailable in this Unreal version: " + name)


options = unreal.GLTFExportOptions()
set_option(options, "export_uniform_scale", float(recipe.get("export", {}).get("uniform_scale", 0.01)))
set_option(options, "export_vertex_skin_weights", True)
set_option(options, "export_animation_sequences", True)
set_option(options, "export_preview_mesh", True)
if hasattr(unreal, "GLTFMaterialBakeMode"):
    set_option(options, "bake_material_inputs", unreal.GLTFMaterialBakeMode.DISABLED)
if hasattr(unreal, "GLTFMaterialVariantMode"):
    set_option(options, "export_material_variants", unreal.GLTFMaterialVariantMode.NONE)


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
export(mesh, "character.glb", unreal.SkeletalMesh)
set_option(options, "export_preview_mesh", False)

clip_files = {}
for name, path in sorted(recipe["clips"].items()):
    filename = "clip-" + name + ".glb"
    export(unreal.load_asset(path), filename, unreal.AnimSequence)
    clip_files[name] = filename

manifest = {
    "schema_version": 1,
    "kind": "character",
    "recipe_id": recipe["id"],
    "fingerprint": recipe["fingerprint"],
    "mesh": "character.glb",
    "clips": clip_files,
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
