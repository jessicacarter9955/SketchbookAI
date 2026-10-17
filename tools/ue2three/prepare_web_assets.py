"""Validate and stage ACTUAL Unreal glTF output for the Three.js city.

Never treat source .uasset/.umap files as already converted meshes.
Input must be scene.glb + unreal-export.json from ue_export_scene.py inside UE.
The staged directory is a fresh copy; no user data is overwritten.
"""
import argparse
import hashlib
import json
import shutil
import struct
from pathlib import Path

DISTRICTS = {"ny", "sf", "rio", "miami"}
MAX_BYTES = 300 * 1024 * 1024

def validate_glb(path):
    path = Path(path)
    if not path.is_file() or path.stat().st_size < 20 or path.stat().st_size > MAX_BYTES:
        raise ValueError("Source GLB absent, truncated or too large")
    with path.open("rb") as fd:
        header = fd.read(20)
        if len(header) != 20:
            raise ValueError("Invalid GLB header")
        magic, version, total_size, json_size, chunk_type = struct.unpack("<4sIIII", header)
        if magic != b"glTF" or version != 2 or total_size != path.stat().st_size or chunk_type != 0x4e4f534a:
            raise ValueError("Expected a complete glTF 2.0 binary with a JSON chunk")
        if not json_size or json_size > MAX_BYTES:
            raise ValueError("Invalid GLB JSON length")
        info = json.loads(fd.read(json_size).decode("utf-8"))
    if info.get("asset", {}).get("version") != "2.0":
        raise ValueError("Not a valid GLTF 2.0 asset")
    meshes = info.get("meshes", [])
    if not meshes or not all(isinstance(mesh.get("primitives"), list) and mesh["primitives"] for mesh in meshes):
        raise ValueError("Exported file has no renderable mesh primitives")
    textures = info.get("textures", [])
    return {"meshes": len(meshes), "materials": len(info.get("materials", [])),
            "textures": len(textures), "nodes": len(info.get("nodes", []))}

def stage(source, output, district, require_textures=True):
    source, output = Path(source).resolve(), Path(output).resolve()
    if district not in DISTRICTS:
        raise ValueError("Unknown district: expected ny, sf, rio, miami")
    if source == output or source in output.parents or output in source.parents:
        raise ValueError("Input and output must be in separate directories")
    original = json.loads((source / "unreal-export.json").read_text(encoding="utf-8"))
    if original.get("source_type") != "UNREAL_NATIVE_LEVEL" or original.get("stage") != "unreal-native-gltf-export":
        raise ValueError("No certified Unreal export provenance")
    url, license_id = original.get("source_url", ""), original.get("license", "")
    if not url.startswith(("https://", "http://")) or not license_id:
        raise ValueError("Missing original license and source URL")
    glb = source / "scene.glb"
    metrics = validate_glb(glb)
    if require_textures and metrics["textures"] < 1:
        raise ValueError("No baked UE textures; do not label untextured scene photorealistic")
    name = f"ue-{district}-scene.glb"
    output.mkdir(parents=True, exist_ok=True)
    destination = output / name
    shutil.copyfile(glb, destination)
    sha = hashlib.sha256(destination.read_bytes()).hexdigest()
    manifest_path = output / "manifest.json"
    manifest = {"schema": 1, "format": "UE2THREE_IMPORTED_GLTF", "districts": {}}
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("format") != "UE2THREE_IMPORTED_GLTF":
            raise ValueError("Output manifest does not belong to ue2three")
    manifest["districts"][district] = {
        "url": name, "source_type": "UNREAL_NATIVE_LEVEL", "license": license_id,
        "source_url": url, "sha256": sha, "bytes": destination.stat().st_size, **metrics,
        "note": "Materials imported from Unreal; collisions, lighting and AI implemented in Sketchbook"
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True)+"\n", encoding="utf-8")
    return manifest["districts"][district]

def main():
    parser = argparse.ArgumentParser(description="Stage verified native Unreal glTF scene for Sketchbook coastal districts")
    parser.add_argument("--source", type=Path, required=True, help="Directory generated INSIDE Unreal Editor")
    parser.add_argument("--output", type=Path, required=True, help="Web deploy assets/ue2three/")
    parser.add_argument("--district", choices=sorted(DISTRICTS), required=True)
    parser.add_argument("--allow-untextured", action="store_true", help="Development only; not photoreal")
    args = parser.parse_args()
    item = stage(args.source, args.output, args.district, not args.allow_untextured)
    print(json.dumps({"verified": True, "district": args.district, **item}, indent=2))

if __name__ == "__main__":
    main()
