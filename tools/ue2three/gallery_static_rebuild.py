#!/usr/bin/env python3
"""Rebuild *static geometry only* from witnessed Gallery actor instances.

This does not translate Blueprint behavior, Niagara, dynamic materials or the
complete GalleryLevel. Source GLBs and the original Unreal project are read-only.
"""

import argparse
import copy
import hashlib
import json
import math
import os
import re
import struct
import tempfile
from pathlib import Path


class GalleryRebuildError(ValueError):
    pass


_NUMBER = r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?"
_VECTOR = re.compile(r"\{x: (" + _NUMBER + r"), y: (" + _NUMBER + r"), z: (" + _NUMBER + r")\}")
_ROTATION = re.compile(r"rotation: \{x: (" + _NUMBER + r"), y: (" + _NUMBER +
                       r"), z: (" + _NUMBER + r"), w: (" + _NUMBER + r")\}")
_CHUNK_JSON = 0x4E4F534A
_CHUNK_BIN = 0x004E4942


def source_transform(value):
    """UE cm / XYZ-left-handed -> glTF m / XZY-right-handed."""
    if not isinstance(value, str) or "translation: " not in value or "scale3d: " not in value:
        raise GalleryRebuildError("Expected an original Unreal Transform string")
    rotation = _ROTATION.search(value)
    translation = _VECTOR.match(value.split("translation: ", 1)[1])
    scale = _VECTOR.match(value.split("scale3d: ", 1)[1])
    if not all((rotation, translation, scale)):
        raise GalleryRebuildError("Incomplete Unreal Transform; cannot infer missing coordinates")
    q = tuple(map(float, rotation.groups()))
    t = tuple(map(float, translation.groups()))
    s = tuple(map(float, scale.groups()))
    if not all(math.isfinite(v) for v in (*q, *t, *s)) or not 0.999 < sum(v*v for v in q) < 1.001:
        raise GalleryRebuildError("Nonfinite coordinates or invalid Unreal quaternion")
    return {"translation": [t[0] / 100, t[2] / 100, t[1] / 100],
            "rotation": [-q[0], -q[2], -q[1], q[3]],
            "scale": [s[0], s[2], s[1]]}


def _pad(data, byte=b"\x00"):
    return data + byte * (-len(data) % 4)


def _read_glb(path):
    raw = path.read_bytes()
    if len(raw) < 28 or raw[:4] != b"glTF" or struct.unpack_from("<II", raw, 4) != (2, len(raw)):
        raise GalleryRebuildError(f"Invalid GLB header: {path.name}")
    chunks = []
    cursor = 12
    while cursor < len(raw):
        if cursor + 8 > len(raw):
            raise GalleryRebuildError(f"Truncated GLB chunk: {path.name}")
        length, chunk_type = struct.unpack_from("<II", raw, cursor)
        cursor += 8
        if length % 4 or cursor + length > len(raw):
            raise GalleryRebuildError(f"Invalid GLB chunk length: {path.name}")
        chunks.append((chunk_type, raw[cursor:cursor + length]))
        cursor += length
    if not chunks or chunks[0][0] != _CHUNK_JSON or len(chunks) != 2 or chunks[1][0] != _CHUNK_BIN:
        raise GalleryRebuildError(f"Expected self-contained JSON and BIN chunks: {path.name}")
    doc = json.loads(chunks[0][1].rstrip(b" \x00").decode("utf-8"))
    binary = chunks[1][1]
    if (len(doc.get("buffers", [])) != 1 or
            doc["buffers"][0].get("uri") or doc["buffers"][0].get("byteLength", 0) > len(binary)):
        raise GalleryRebuildError(f"External or invalid GLB buffer: {path.name}")
    # Fail closed instead of dropping textures, skins or material extensions.
    for feature in ("textures", "images", "samplers", "animations", "skins", "cameras",
                    "extensionsUsed", "extensionsRequired", "extensions"):
        if doc.get(feature):
            raise GalleryRebuildError(f"Unsupported {feature} in {path.name}; no lossy conversion allowed")
    if len(doc.get("scenes", [])) < 1 or not doc.get("meshes") or not doc.get("nodes"):
        raise GalleryRebuildError(f"No renderable scene in {path.name}")
    for access in doc.get("accessors", []):
        if "sparse" in access:
            raise GalleryRebuildError(f"Sparse accessors require explicit support: {path.name}")
    return doc, binary, hashlib.sha256(raw).hexdigest()


def _import_template(out, doc, binary):
    """Import one source GLB once; share its immutable meshes across all actors."""
    base_byte = len(out["binary"])
    view_offset = len(out["bufferViews"])
    accessor_offset = len(out["accessors"])
    material_offset = len(out["materials"])
    mesh_offset = len(out["meshes"])
    out["binary"] += _pad(binary)
    for view in doc.get("bufferViews", []):
        item = copy.deepcopy(view)
        if item.get("buffer", 0) != 0:
            raise GalleryRebuildError("Only original in-GLB buffer 0 is supported")
        item["buffer"] = 0
        item["byteOffset"] = item.get("byteOffset", 0) + base_byte
        out["bufferViews"].append(item)
    for accessor in doc.get("accessors", []):
        item = copy.deepcopy(accessor)
        if "bufferView" in item:
            item["bufferView"] += view_offset
        out["accessors"].append(item)
    out["materials"].extend(copy.deepcopy(doc.get("materials", [])))
    for mesh in doc["meshes"]:
        item = copy.deepcopy(mesh)
        for primitive in item.get("primitives", []):
            if primitive.get("targets") or primitive.get("extensions"):
                raise GalleryRebuildError("Morph targets and primitive extensions require source-aware support")
            primitive["attributes"] = {key: value + accessor_offset
                                       for key, value in primitive.get("attributes", {}).items()}
            if "indices" in primitive:
                primitive["indices"] += accessor_offset
            if "material" in primitive:
                primitive["material"] += material_offset
        out["meshes"].append(item)
    template_nodes = copy.deepcopy(doc["nodes"])
    for node in template_nodes:
        if "mesh" in node:
            node["mesh"] += mesh_offset
        if "skin" in node or "camera" in node or "extensions" in node:
            raise GalleryRebuildError("Unsupported source node property")
    scene = doc["scenes"][doc.get("scene", 0)]
    roots = scene.get("nodes", [])
    if not roots:
        raise GalleryRebuildError("Source mesh has no scene roots")
    return template_nodes, roots


def rebuild(manifest_path, mesh_dir, output_path, *, aliases=None):
    manifest_path, mesh_dir, output_path = (Path(manifest_path).resolve(),
                                           Path(mesh_dir).resolve(), Path(output_path).resolve())
    data = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    if data.get("level") != "/Game/Fixers/VFX/NiagaraExamples/GalleryLevel":
        raise GalleryRebuildError("Manifest does not identify the original GalleryLevel")
    actors = data.get("actors", [])
    if not actors or len({actor[0] for actor in actors}) != len(actors):
        raise GalleryRebuildError("Unique original actors required")
    aliases = aliases or {}
    out = {"binary": b"", "bufferViews": [], "accessors": [], "materials": [], "meshes": [],
           "nodes": [], "roots": []}
    templates = {}
    witnessed_files = {}
    component_count = instance_count = empty_components = 0
    for actor_name, components in actors:
        if not isinstance(actor_name, str) or not actor_name or not isinstance(components, list):
            raise GalleryRebuildError("Malformed original actor entry")
        for component in components:
            if not isinstance(component, list) or len(component) != 3:
                raise GalleryRebuildError("Malformed original component")
            component_name, package, transforms = component
            if not isinstance(package, str) or "." not in package or not isinstance(transforms, list):
                raise GalleryRebuildError("Missing source component package or transforms")
            component_count += 1
            if not transforms:
                empty_components += 1
                continue
            package_name = package.rsplit("/", 1)[-1].split(".", 1)[0]
            filename = aliases.get(package_name, package_name + ".glb")
            if (not isinstance(filename, str) or Path(filename).name != filename or
                    not filename.endswith(".glb")):
                raise GalleryRebuildError("Mesh alias must be a local GLB filename")
            source = (mesh_dir / filename).resolve()
            if source.parent != mesh_dir or not source.is_file() or source == output_path:
                raise GalleryRebuildError(f"Missing separate source mesh {filename} for {package}")
            if package not in templates:
                doc, binary, source_sha = _read_glb(source)
                nodes, roots = _import_template(out, doc, binary)
                templates[package] = (nodes, roots)
                witnessed_files[package] = {"path": filename, "sha256": source_sha,
                                            "mesh_count": len(doc["meshes"]),
                                            "materials": len(doc.get("materials", [])),
                                            "explicit_alias": package_name in aliases}
            for index, value in enumerate(transforms):
                transform = source_transform(value)
                source_nodes, roots = templates[package]
                offset = len(out["nodes"])
                for node in source_nodes:
                    cloned = copy.deepcopy(node)
                    if "children" in cloned:
                        cloned["children"] = [child + offset for child in cloned["children"]]
                    out["nodes"].append(cloned)
                wrapper_index = len(out["nodes"])
                out["nodes"].append({"name": f"{actor_name}/{component_name}/{index}",
                                     "children": [root + offset for root in roots],
                                     "extras": {"unreal_actor": actor_name, "unreal_component": component_name,
                                                "unreal_mesh": package}, **transform})
                out["roots"].append(wrapper_index)
                instance_count += 1
    if not instance_count:
        raise GalleryRebuildError("Original manifest contains no renderable instances")
    document = {"asset": {"version": "2.0", "generator": "ue2three Gallery static recovery"},
                "scene": 0, "scenes": [{"name": "Gallery recovered static subset", "nodes": out["roots"]}],
                "nodes": out["nodes"], "meshes": out["meshes"],
                "bufferViews": out["bufferViews"], "accessors": out["accessors"],
                "buffers": [{"byteLength": len(out["binary"])}]}
    if out["materials"]:
        document["materials"] = out["materials"]
    encoded = _pad(json.dumps(document, separators=(",", ":"), allow_nan=False).encode(), b" ")
    binary = _pad(out["binary"])
    glb = (struct.pack("<4sII", b"glTF", 2, 28 + len(encoded) + len(binary)) +
           struct.pack("<II", len(encoded), _CHUNK_JSON) + encoded +
           struct.pack("<II", len(binary), _CHUNK_BIN) + binary)
    report = {"status": "static_geometry_subset_only", "complete_level": False,
              "visual_1to1_verified": False, "source_manifest": str(manifest_path),
              "source_manifest_sha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
              "level": data["level"], "actors": len(actors), "components": component_count,
              "empty_components": empty_components, "instances": instance_count,
              "unique_source_meshes": len(templates), "source_meshes": witnessed_files,
              "output_sha256": hashlib.sha256(glb).hexdigest(),
              "limitations": ["Only witnessed static mesh instances, not all level actors",
                              "Blueprint-created runtime objects, Niagara, collisions and interactions not converted",
                              "Material parameters and shader graphs not faithfully reconstructed"]}
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=output_path.parent, suffix=".glb.tmp", delete=False) as stream:
        staged = Path(stream.name)
        try:
            stream.write(glb)
            stream.flush()
            os.fsync(stream.fileno())
        except BaseException:
            staged.unlink(missing_ok=True)
            raise
    os.replace(staged, output_path)
    sidecar = output_path.with_suffix(".source.json")
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=sidecar.parent,
                                     suffix=".json.tmp", delete=False) as stream:
        staged_report = Path(stream.name)
        json.dump(report, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(staged_report, sidecar)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--meshes", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--alias", action="append", default=[], help="Exact source mesh name=GLB filename")
    args = parser.parse_args()
    aliases = {}
    for raw in args.alias:
        if "=" not in raw:
            parser.error("--alias requires Name=filename.glb")
        name, filename = raw.split("=", 1)
        if not name or name in aliases:
            parser.error("Duplicate/invalid mesh alias")
        aliases[name] = filename
    print(json.dumps(rebuild(args.manifest, args.meshes, args.output, aliases=aliases), indent=2))


if __name__ == "__main__":
    main()
