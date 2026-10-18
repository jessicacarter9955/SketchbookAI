"""Validate a genuine UE 5.8 CityBLD batch before any Three.js release.

Python stdlib, no Unreal installation needed for this verification stage.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct

class VerificationError(ValueError):
    pass

def check(condition, message):
    if not condition:
        raise VerificationError(message)

def read_glb(path):
    raw = path.read_bytes()
    check(len(raw) >= 32, "GLB missing/too small")
    magic, version, length = struct.unpack_from("<4sII", raw, 0)
    check(magic == b"glTF" and version == 2 and length == len(raw), "Invalid GLB header/length")
    json_length, json_type = struct.unpack_from("<I4s", raw, 12)
    check(json_type == b"JSON" and json_length > 0 and 20 + json_length <= len(raw),
          "GLB lacks a valid JSON chunk")
    data = json.loads(raw[20:20 + json_length].decode("utf-8"))
    check(data.get("asset", {}).get("version") == "2.0", "Expected glTF 2.0")
    return data, raw

def verify(folder):
    folder = Path(folder)
    file = folder / "manifest.json"
    check(file.is_file(), "No CityBLD source provenance manifest")
    m = json.loads(file.read_text(encoding="utf-8"))
    check(m.get("schema") == "citybld-selected-export-v1", "Not a CityBLD export manifest")
    batch = m.get("batch", "")
    check(bool(re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", batch)), "Invalid batch")
    check(m.get("source_workflow") == "CityBLD + Modern City Kit in Unreal Editor",
          "Wrong source workflow")
    check(str(m.get("source_engine", "")).startswith("5.8"), "Only UE 5.8 export supported")
    plugins = [p.lower() for p in m.get("enabled_worldbld_plugins", [])]
    check(any("citybld" in p for p in plugins) and any("worldbld" in p for p in plugins)
          and any("modern" in p for p in plugins), "Missing CityBLD / WorldBLD / Modern City evidence")
    check("/Game/" in str(m.get("source_level", "")), "No saved Unreal level")
    check(int(m.get("selected_actor_count", 0)) >= 1, "No selected CityBLD actors")
    check(len(m.get("actors", [])) == m["selected_actor_count"], "Actor manifest mismatch")
    name = m.get("glb", "")
    check(name == batch + ".glb", "Unexpected GLB file name")
    glb_path = folder / name
    check(glb_path.is_file(), "Real GLB not present")
    gltf, raw = read_glb(glb_path)
    check(hashlib.sha256(raw).hexdigest() == m.get("sha256"), "GLB SHA256 differs")
    check(len(raw) == m.get("bytes"), "GLB byte size differs")
    check(bool(gltf.get("meshes")), "GLB has no mesh geometry")
    check(bool(gltf.get("nodes")) and bool(gltf.get("scenes")), "GLB lacks a placed scene")
    check(bool(gltf.get("materials")), "GLB materials absent")
    textured = sum(1 for mat in gltf["materials"] if
                   mat.get("pbrMetallicRoughness", {}).get("baseColorTexture") or
                   mat.get("normalTexture"))
    check(textured > 0 and bool(gltf.get("textures")) and bool(gltf.get("images")),
          "Photographic/PBR textures absent; not ready for fidelity audit")
    return {
        "batch": batch, "source": m["source_workflow"], "bytes": len(raw),
        "meshes": len(gltf["meshes"]), "materials": len(gltf["materials"]),
        "textured_materials": textured, "actors": m["selected_actor_count"],
        "sha256": m["sha256"], "ready_for_visual_qa": True,
        "verified_in_threejs": False
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder", help="Folder containing CityBLD manifest.json and matching .glb")
    args = ap.parse_args()
    print(json.dumps(verify(args.folder), indent=2))

if __name__ == "__main__":
    main()
