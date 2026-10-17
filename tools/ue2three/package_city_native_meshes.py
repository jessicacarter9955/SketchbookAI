#!/usr/bin/env python3
"""Bundle genuinely decoded Unreal-native StaticMesh .uasset geometry into web GLB.

Source geometry must originate from UEViewer-exported *.gltf, never from a
different FBX/GLB stand-in. The web texture is CC0 and is NOT presented as an
authentic baked Unreal shader. Native map conversion remains a separate task.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image
import trimesh
from trimesh.visual import TextureVisuals
from trimesh.visual.material import PBRMaterial
from trimesh.transformations import rotation_matrix, translation_matrix

SOURCE_PROJECT = "https://github.com/Erisbv-zz/UNREAL-Procedural-Cities"
TEXTURE_SOURCE = "https://ambientcg.com/view?id=Bricks066"
MAP = {
    "door": "Import/doorMesh_door006.gltf",
    "awning": "Import/street/awning.gltf",
    "hydrant": "Import/street/fireHydrant.gltf",
    "fence": "Import/street/fences/standardfence.gltf",
    "bench": "Import/street/sidewalk/bench.gltf",
}
# Deliberately small foreground architecture insert; this is NOT a whole
# converted Unreal map and must never count as 1/4 complete districts.
DETAILS = [
    ("door", [0, 0, 0], 0, 1),
    ("awning", [0, 3.17, 0.35], 1.5707963267948966, 1),
    ("hydrant", [4, 0, 2.0], 0, 1),
    ("fence", [-5.5, 0, 2.5], 0, 1),
    ("bench", [6.2, 0, 3.5], 0, 0.17),
]


def bundle(input_dir: Path, output_dir: Path, brick_image: Path):
    source_sha = (input_dir / "SOURCE_COMMIT.txt").read_text().strip()
    if len(source_sha) != 40 or any(x not in "0123456789abcdef" for x in source_sha):
        raise ValueError("Missing original Unreal repository SHA; refuse untraceable assets")
    photo = Image.open(brick_image).convert("RGB")
    photo.thumbnail((512, 512))
    if min(photo.size) < 128:
        raise ValueError("CC0 photographic texture is too small")
    output_dir.mkdir(parents=True, exist_ok=True)
    scene = trimesh.Scene()
    inventory = []
    for name, rel in MAP.items():
        path = input_dir / rel
        if not path.is_file() or not (input_dir / rel.replace(".gltf", ".bin")).is_file():
            raise FileNotFoundError("Missing actually exported Unreal UAsset mesh: " + rel)
        doc = json.loads(path.read_text())
        if not doc.get("asset", {}).get("generator", "").startswith("UE Viewer"):
            raise ValueError("Non-Unreal exporter or substituted mesh at " + rel)
        mesh_input = trimesh.load(str(path), force="scene", process=False)
        parts = [mesh for mesh in mesh_input.geometry.values()
                 if isinstance(mesh, trimesh.Trimesh) and len(mesh.faces)]
        if not parts:
            raise ValueError("Unreal mesh contains no triangles: " + rel)
        part = trimesh.util.concatenate(parts)
        if len(part.faces) < 12:
            raise ValueError("Implausibly small native mesh: " + rel)
        # UModel provides the real UVs but could not decode UE Materials because
        # material packages were not in the curated source subset.
        uv = getattr(part.visual, "uv", None)
        if uv is None or len(uv) != len(part.vertices):
            raise ValueError("Original Unreal mesh has no complete UV data: " + rel)
        if name in ("door", "awning", "fence", "bench"):
            material = PBRMaterial(baseColorTexture=photo.copy(),
                                   metallicFactor=0.04, roughnessFactor=0.74)
        else:
            material = PBRMaterial(baseColorFactor=[0.72, 0.10, 0.08, 1],
                                   metallicFactor=0.15, roughnessFactor=0.43)
        part.visual = TextureVisuals(uv=uv, material=material)
        spec = next(v for v in DETAILS if v[0] == name)
        translation, angle, scale = spec[1:]
        transform = translation_matrix(translation) @ rotation_matrix(angle, [0, 1, 0])
        transform[:3, :3] *= scale
        scene.add_geometry(part, geom_name=name, node_name="UE_NATIVE_" + name, transform=transform)
        inventory.append({
            "name": name,
            "uasset": "Content/" + rel.replace(".gltf", ".uasset"),
            "triangles": len(part.faces),
            "source_sha256_not_available_in_subset": False,
            "source_uri": SOURCE_PROJECT + "/blob/" + source_sha + "/Content/" +
                          rel.replace(".gltf", ".uasset"),
        })
    target = output_dir / "ue-ny-native-streetfront.glb"
    blob = scene.export(file_type="glb")
    target.write_bytes(blob)
    recovered = trimesh.load(str(target), force="scene", process=False)
    if not recovered.geometry or sum(len(m.faces) for m in recovered.geometry.values()) < 1000:
        raise ValueError("Output GLB has insufficient recovered Unreal geometry")
    manifest = {
        "version": 1,
        "source_type": "UNREAL_NATIVE_STATIC_MESH_COMPOSITION",
        "source_project": SOURCE_PROJECT,
        "source_revision": source_sha,
        "license": "MIT - provenance review required for third-party materials/models",
        "texture": {"source": TEXTURE_SOURCE, "license": "CC0",
                    "status": "replacement texture; not source Unreal material graph"},
        "full_unreal_level": False,
        "district": "ny",
        "mesh": target.name,
        "sha256": hashlib.sha256(blob).hexdigest(),
        "triangles": sum(entry["triangles"] for entry in inventory),
        "parts": inventory,
    }
    (output_dir / "native-meshes.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print("AUTHENTIC UNREAL NATIVE GEOMETRY:", json.dumps({
        "file": str(target), "bytes": len(blob), "native_source_files": len(inventory),
        "triangles": manifest["triangles"], "sha256": manifest["sha256"]
    }))
    return manifest


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--input", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--brick-photo", type=Path, required=True)
    a = p.parse_args()
    bundle(a.input, a.output, a.brick_photo)
