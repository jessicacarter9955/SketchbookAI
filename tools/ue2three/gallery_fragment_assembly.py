#!/usr/bin/env python3
"""Assemble source-witnessed Gallery glTF fragments without discarding materials.

No source Unreal files or fragment GLBs are rewritten. Incomplete actor coverage
is explicit in the output report; this is never a 1:1 Play acceptance gate.
"""

import argparse
import copy
import hashlib
import json
import os
import struct
import tempfile
from pathlib import Path


class AssemblyError(ValueError):
    pass


JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942
SUPPORTED_EXTENSIONS = {
    "KHR_materials_specular", "KHR_materials_anisotropy", "KHR_materials_ior",
    "KHR_materials_emissive_strength", "KHR_materials_unlit", "KHR_texture_transform",
    "KHR_lights_punctual",
}


def _pad(data, byte=b"\x00"):
    return data + byte * (-len(data) % 4)


def read_glb(path):
    raw = Path(path).read_bytes()
    if len(raw) < 28 or raw[:4] != b"glTF" or struct.unpack_from("<II", raw, 4) != (2, len(raw)):
        raise AssemblyError(f"Invalid GLB header: {path}")
    offset = 12
    chunks = []
    while offset < len(raw):
        if offset + 8 > len(raw):
            raise AssemblyError("Truncated GLB chunk")
        count, kind = struct.unpack_from("<II", raw, offset)
        offset += 8
        if count % 4 or count + offset > len(raw):
            raise AssemblyError("Invalid GLB chunk bounds")
        chunks.append((kind, raw[offset:offset + count]))
        offset += count
    if len(chunks) != 2 or [kind for kind, _ in chunks] != [JSON_CHUNK, BIN_CHUNK]:
        raise AssemblyError("Expected one self-contained glTF JSON and BIN chunk")
    doc = json.loads(chunks[0][1].rstrip(b"\x00 ").decode("utf-8"))
    binary = chunks[1][1]
    if len(doc.get("buffers", [])) != 1 or doc["buffers"][0].get("uri") or \
            doc["buffers"][0].get("byteLength", 0) > len(binary):
        raise AssemblyError("External or invalid GLB buffer")
    unsupported = set(doc.get("extensionsUsed", [])) - SUPPORTED_EXTENSIONS
    if unsupported or set(doc.get("extensionsRequired", [])) - SUPPORTED_EXTENSIONS:
        raise AssemblyError(f"Unknown extension(s): {sorted(unsupported)}")
    if doc.get("animations") or doc.get("skins") or not doc.get("scenes") or not doc.get("meshes"):
        raise AssemblyError("Fragment must contain static, renderable source geometry")
    for view in doc.get("bufferViews", []):
        if view.get("buffer", 0) != 0 or view.get("byteOffset", 0) + view["byteLength"] > len(binary):
            raise AssemblyError("Out-of-bounds binary view")
    for image in doc.get("images", []):
        if image.get("uri") and not image["uri"].startswith("data:"):
            raise AssemblyError("External texture URI would break self-contained output")
    for access in doc.get("accessors", []):
        if "sparse" in access:
            raise AssemblyError("Sparse accessors require source-aware remapping")
    return doc, binary, hashlib.sha256(raw).hexdigest()


def _material_textures(material, offset):
    """Remap all texture infos, including KHR material-extension texture slots."""
    for key, value in material.items():
        if key.endswith("Texture") and isinstance(value, dict) and "index" in value:
            value["index"] += offset
        elif isinstance(value, dict):
            _material_textures(value, offset)


def merge_fragment(out, doc, binary):
    offsets = {key: len(out[key]) for key in ("bufferViews", "accessors", "materials",
                                             "samplers", "images", "textures", "meshes",
                                             "nodes", "cameras", "lights")}
    out["binary"] += _pad(binary)
    base_byte = len(out["binary"]) - len(_pad(binary))
    for item in doc.get("bufferViews", []):
        copied = copy.deepcopy(item)
        copied["buffer"] = 0
        copied["byteOffset"] = copied.get("byteOffset", 0) + base_byte
        out["bufferViews"].append(copied)
    for item in doc.get("accessors", []):
        copied = copy.deepcopy(item)
        if "bufferView" in copied:
            copied["bufferView"] += offsets["bufferViews"]
        out["accessors"].append(copied)
    out["samplers"].extend(copy.deepcopy(doc.get("samplers", [])))
    for image in doc.get("images", []):
        copied = copy.deepcopy(image)
        if "bufferView" in copied:
            copied["bufferView"] += offsets["bufferViews"]
        out["images"].append(copied)
    for texture in doc.get("textures", []):
        copied = copy.deepcopy(texture)
        if "source" in copied:
            copied["source"] += offsets["images"]
        if "sampler" in copied:
            copied["sampler"] += offsets["samplers"]
        if copied.get("extensions"):
            raise AssemblyError("Unrecognized texture extension references")
        out["textures"].append(copied)
    for material in doc.get("materials", []):
        copied = copy.deepcopy(material)
        _material_textures(copied, offsets["textures"])
        out["materials"].append(copied)
    for mesh in doc.get("meshes", []):
        copied = copy.deepcopy(mesh)
        for primitive in copied.get("primitives", []):
            if primitive.get("targets") or primitive.get("extensions"):
                raise AssemblyError("Unexpected animated or extended primitive")
            primitive["attributes"] = {name: index + offsets["accessors"]
                                       for name, index in primitive.get("attributes", {}).items()}
            for field, category in (("indices", "accessors"), ("material", "materials")):
                if field in primitive:
                    primitive[field] += offsets[category]
        out["meshes"].append(copied)
    out["cameras"].extend(copy.deepcopy(doc.get("cameras", [])))
    lights = doc.get("extensions", {}).get("KHR_lights_punctual", {}).get("lights", [])
    out["lights"].extend(copy.deepcopy(lights))
    for node in doc.get("nodes", []):
        copied = copy.deepcopy(node)
        for field, category in (("mesh", "meshes"), ("camera", "cameras")):
            if field in copied:
                copied[field] += offsets[category]
        if "skin" in copied:
            raise AssemblyError("Skin hierarchy would not be preserved")
        if "children" in copied:
            copied["children"] = [child + offsets["nodes"] for child in copied["children"]]
        node_extensions = copied.get("extensions", {})
        if set(node_extensions) - {"KHR_lights_punctual"}:
            raise AssemblyError("Unknown node extension")
        if "KHR_lights_punctual" in node_extensions:
            node_extensions["KHR_lights_punctual"]["light"] += offsets["lights"]
        out["nodes"].append(copied)
    scene = doc["scenes"][doc.get("scene", 0)]
    out["roots"].extend(root + offsets["nodes"] for root in scene.get("nodes", []))
    out["extensionsUsed"].update(doc.get("extensionsUsed", []))
    out["extensionsRequired"].update(doc.get("extensionsRequired", []))


def _write_glb(out, path):
    doc = {"asset": {"version": "2.0", "generator": "ue2three source-fragment assembly"},
           "scene": 0, "scenes": [{"name": "Gallery source-witnessed partial scene", "nodes": out["roots"]}],
           "nodes": out["nodes"], "meshes": out["meshes"],
           "bufferViews": out["bufferViews"], "accessors": out["accessors"],
           "buffers": [{"byteLength": len(out["binary"])}]}
    for key in ("materials", "samplers", "images", "textures", "cameras"):
        if out[key]:
            doc[key] = out[key]
    if out["lights"]:
        doc["extensions"] = {"KHR_lights_punctual": {"lights": out["lights"]}}
    if out["extensionsUsed"]:
        doc["extensionsUsed"] = sorted(out["extensionsUsed"])
    if out["extensionsRequired"]:
        doc["extensionsRequired"] = sorted(out["extensionsRequired"])
    metadata = _pad(json.dumps(doc, separators=(",", ":"), allow_nan=False).encode(), b" ")
    binary = _pad(out["binary"])
    assembled = (struct.pack("<4sII", b"glTF", 2, 28 + len(metadata) + len(binary)) +
                 struct.pack("<II", len(metadata), JSON_CHUNK) + metadata +
                 struct.pack("<II", len(binary), BIN_CHUNK) + binary)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        staged = Path(stream.name)
        stream.write(assembled)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(staged, path)
    return hashlib.sha256(assembled).hexdigest(), doc


def assemble(diagnosis_file, gallery_static_file, output_file):
    diagnosis_file = Path(diagnosis_file).resolve()
    gallery_static_file = Path(gallery_static_file).resolve()
    output_file = Path(output_file).resolve()
    diagnosis = json.loads(diagnosis_file.read_text(encoding="utf-8-sig"))
    if (diagnosis.get("map") != "/Game/Fixers/VFX/NiagaraExamples/GalleryLevel" or
            not diagnosis.get("complete") or diagnosis.get("pending")):
        raise AssemblyError("Only a completed original Gallery crash diagnosis can be assembled")
    source_actors = set(diagnosis.get("actors", []))
    if not source_actors:
        raise AssemblyError("Missing original actor census")
    out = {"binary": b"", "roots": [], "extensionsUsed": set(), "extensionsRequired": set(),
           **{key: [] for key in ("bufferViews", "accessors", "materials", "samplers", "images",
                                   "textures", "meshes", "nodes", "cameras", "lights")}}
    fragments = []
    covered = set()
    for group in diagnosis.get("verified_groups", []):
        names = set(group.get("actor_names", []))
        if not names or not names <= source_actors or names & covered:
            raise AssemblyError("Missing, foreign or overlapping source actor group")
        path = Path(group.get("glb") or "").resolve()
        if not path.is_file() or path == output_file:
            raise AssemblyError("Missing original verified fragment")
        doc, binary, fingerprint = read_glb(path)
        if group.get("glb_sha256") != fingerprint:
            raise AssemblyError(f"Fragment source checksum changed: {path}")
        merge_fragment(out, doc, binary)
        covered.update(names)
        fragments.append({"source": str(path), "sha256": fingerprint,
                          "actors": sorted(names), "type": "native_subset"})
    sidecar = gallery_static_file.with_suffix(".source.json")
    supplement = json.loads(sidecar.read_text(encoding="utf-8-sig"))
    if (supplement.get("level") != diagnosis["map"] or
            supplement.get("status") != "static_geometry_subset_only" or
            supplement.get("complete_level") is not False):
        raise AssemblyError("Static supplement lacks honest source provenance")
    actor_manifest = json.loads(Path(supplement["source_manifest"]).read_text(encoding="utf-8-sig"))
    static_names = {actor[0] for actor in actor_manifest["actors"]}
    if (not static_names or not static_names <= source_actors or static_names & covered or
            supplement["source_manifest_sha256"] != hashlib.sha256(
                Path(supplement["source_manifest"]).read_bytes()).hexdigest()):
        raise AssemblyError("Static supplement has stale, overlapping or foreign original actors")
    doc, binary, fingerprint = read_glb(gallery_static_file)
    if fingerprint != supplement.get("output_sha256"):
        raise AssemblyError("Static supplement checksum changed")
    merge_fragment(out, doc, binary)
    covered.update(static_names)
    fragments.append({"source": str(gallery_static_file), "sha256": fingerprint,
                      "actors": sorted(static_names), "type": "recovered_static_instances"})
    if not covered or not out["meshes"] or not out["roots"]:
        raise AssemblyError("No verified geometry to assemble")
    output_hash, doc = _write_glb(out, output_file)
    report = {"status": "source_witnessed_partial_gallery", "complete_level": False,
              "play_verified": False, "visual_1to1_verified": False,
              "source_snapshot_hash": diagnosis["source_snapshot_hash"],
              "source_diagnosis": str(diagnosis_file),
              "source_diagnosis_sha256": hashlib.sha256(diagnosis_file.read_bytes()).hexdigest(),
              "census_actors": len(source_actors), "geometry_covered_actors": len(covered),
              "uncovered_actors": sorted(source_actors - covered),
              "source_fragments": fragments, "mesh_count": len(doc["meshes"]),
              "node_count": len(doc["nodes"]), "texture_count": len(doc.get("textures", [])),
              "material_count": len(doc.get("materials", [])), "output_sha256": output_hash,
              "limitations": ["Remaining actors may include runtime geometry and environmental actors",
                              "Native fragment materials are preserved as glTF data, not certified as Unreal-identical",
                              "No Blueprint, physics, particle, animation or Play equivalence claim"]}
    sidecar_output = output_file.with_suffix(".source.json")
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=sidecar_output.parent,
                                     delete=False) as stream:
        staged = Path(stream.name)
        json.dump(report, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(staged, sidecar_output)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--diagnosis", type=Path, required=True)
    parser.add_argument("--static", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = assemble(args.diagnosis, args.static, args.output)
    print(json.dumps({key: result[key] for key in (
        "status", "census_actors", "geometry_covered_actors", "uncovered_actors",
        "mesh_count", "node_count", "material_count", "texture_count", "output_sha256")}, indent=2))


if __name__ == "__main__":
    main()
