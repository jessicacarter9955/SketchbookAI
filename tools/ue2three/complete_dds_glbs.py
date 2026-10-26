"""Finish DDS's two missing GLB *files* from source-witnessed scene data.

GalleryLevel: reuse the SHA-256 verified assembly of the original 185 actor scene.
Startup: emit a meshless glTF scene: the source map has a login-flow manager
with MediaSound + Scene components and one editor-only Brush. No visible mesh
or artificial replacement is created.

Writes an immutable recovery manifest instead of falsifying the original
Unreal export supervisor's failed native-export receipts. Neither GLB proves
Niagara, shaders, networking, Blueprint behavior or Play/visual 1:1.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct

from core import atomic_json, file_hash, read_json
from map_fixup import source_scene
from map_migration import valid_glb, glb_summary
from umg_migration import _asset_document, UASSETGUI_SHA256
from dds_asset_export import _animation_channels

START = "/Game/Fixers/Maps/LV_Fixers_Startup"
GALLERY = "/Game/Fixers/VFX/NiagaraExamples/GalleryLevel"
EXPECTED = {"BP_LoginFlowManager": ("BP_LoginFlowManager_C", "BP_LoginFlowManager_C_1"),
            "Brush0": ("Brush", "Brush_0")}
NONRENDERING_COMPONENTS = {"MediaSoundComponent", "SceneComponent"}


def checked_package(project: Path, workspace: Path):
    root = project.parent
    source = root / "Content/Fixers/Maps/LV_Fixers_Startup.umap"
    engine = read_json(workspace / "artifacts/engine.json")
    reader = workspace / "tool-cache/UAssetGUI-1.1.0.exe"
    if file_hash(reader) != UASSETGUI_SHA256:
        raise ValueError("Original cached UAssetAPI reader changed")
    return _asset_document(START, source, reader, workspace / "artifacts/uasset-json",
                           str(engine["version"]).split("-")[0])[0]


def certify_startup(scene, package):
    actors = scene["actors"]
    if len(actors) != 2 or scene.get("mesh_components"):
        raise ValueError("Startup original source is not the 2-actor, zero-mesh scene")
    for a in actors:
        known = EXPECTED.get(a.get("actor_label"))
        if not known or (a.get("source_class"), a.get("source_object")) != known:
            raise ValueError("Startup actor class/identity differs from its original source")
        if a.get("root_component_class") not in ("SceneComponent", "BrushComponent"):
            raise ValueError("Startup root component can produce unverified geometry")
    manager = next(a for a in actors if a["actor_label"] == "BP_LoginFlowManager")
    brush = next(a for a in actors if a["actor_label"] == "Brush0")
    manager_export = package.export(manager["source_export_index"])
    brush_export = package.export(brush["source_export_index"])
    manager_props = package.props(manager_export)
    brush_props = package.props(brush_export)
    if brush_props.get("bNotForClientOrServer") is not True:
        raise ValueError("Unreal Brush is not marked editor-only")
    components = manager_props.get("BlueprintCreatedComponents")
    if not isinstance(components, list) or len(components) != 2:
        raise ValueError("Unverified LoginFlowManager component graph")
    types = {package.class_name(package.export(n)) for n in components}
    if types != NONRENDERING_COMPONENTS:
        raise ValueError("LoginFlowManager has newly added or rendering components")
    if any(package.class_name(package.export(n)) in
           {"StaticMeshComponent", "SkeletalMeshComponent", "InstancedStaticMeshComponent"}
           for n in components):
        raise ValueError("A rendering component is present")
    return {"brush_editor_only": True, "login_components": sorted(types),
            "actor_count": 2, "mesh_count": 0,
            "source_umap_sha256": scene["source_sha256"]}


def startup_glb(scene: dict) -> bytes:
    nodes = []
    for row in scene["actors"]:
        node = {"name": row["actor_label"],
                "extras": {"source_object": row["source_object"],
                           "source_class": row["source_class"],
                           "source_export_index": row["source_export_index"],
                           "unreal_non_rendering": True}}
        for field, value in row.get("transform", {}).items():
            if field == "rotation":
                node["rotation"] = value
            elif field in ("translation", "scale"):
                node[field] = value
        nodes.append(node)
    document = {"asset": {"version": "2.0", "generator": "ue2three DDS source-only startup"},
                "scene": 0,
                "scenes": [{"name": "LV_Fixers_Startup", "nodes": list(range(len(nodes)))}],
                "nodes": nodes,
                "extras": {"original_map": START, "source_umap_sha256": scene["source_sha256"],
                           "source_only": True, "renderable_meshes": 0,
                           "unreal_gameplay_reimplemented": False}}
    payload = json.dumps(document, separators=(",", ":"), ensure_ascii=False).encode("utf8")
    payload += b" " * ((-len(payload)) % 4)
    length = 12 + 8 + len(payload)
    return struct.pack("<4sII", b"glTF", 2, length) + struct.pack("<II", len(payload), 0x4e4f534a) + payload


def read_glb_json(path: Path):
    raw = path.read_bytes()
    if (len(raw) < 20 or struct.unpack_from("<4sII", raw) != (b"glTF", 2, len(raw))):
        raise ValueError("Invalid glTF binary header/length")
    length, kind = struct.unpack_from("<II", raw, 12)
    if kind != 0x4e4f534a or 20 + length > len(raw):
        raise ValueError("Missing original JSON chunk")
    return json.loads(raw[20:20 + length].decode("utf8").rstrip(" \0"))


def atomic_bytes(path: Path, content: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(content).hexdigest()
    if path.exists():
        if file_hash(path) != digest:
            raise ValueError("Refusing to overwrite a differing GLB: " + str(path))
        return digest
    tmp = path.with_name(path.name + "." + digest[:10] + ".tmp")
    try:
        with tmp.open("xb") as out:
            out.write(content)
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)
    return digest


def finish(project: Path, workspace: Path, gallery_source: Path,
           published_map_directory: Path, baseline_manifest: Path, receipt: Path):
    project = Path(project).resolve(strict=True)
    workspace = Path(workspace).resolve(strict=True)
    gallery_source = Path(gallery_source).resolve(strict=True)
    published_map_directory = Path(published_map_directory).resolve()
    receipt = Path(receipt).resolve()
    original_root = project.parent.resolve()
    for dest in (published_map_directory, receipt):
        if dest == original_root or original_root in dest.parents:
            raise ValueError("Output may never modify the original Unreal project")
    baseline = read_json(baseline_manifest)
    state = read_json(workspace / "state.json")
    if (Path(baseline["source_project"]).resolve() != project
            or baseline["source_snapshot_hash"] != state["snapshot_hash"]
            or baseline["assets"]["discovered"] != 58
            or baseline["assets"]["verified"] != 56
            or len(baseline["files"]) != 56):
        raise ValueError("The source inventory differs from the verified 56/58 baseline")
    gallery_meta = read_json(gallery_source.with_name("Gallery185Source.source.json"))
    if (gallery_meta["source_snapshot_hash"] != state["snapshot_hash"]
            or gallery_meta["map"] != GALLERY
            or gallery_meta["glb_sha256"] != file_hash(gallery_source)
            or gallery_meta["original_actor_count"] != 185
            or gallery_meta["represented_original_actors"] != 185
            or gallery_meta["geometry_covered_actors"] != 184
            or gallery_meta["unrepresented_original_actors"] != []):
        raise ValueError("Gallery geometry assembly is not source-snapshot complete")
    gallery_counts = glb_summary(gallery_source)
    if not valid_glb(gallery_source) or gallery_counts["mesh_count"] < 184:
        raise ValueError("Gallery GLB is not structurally verified and renderable")
    gallery_scene = source_scene(project, GALLERY, workspace)
    # The raw UAssetAPI source scene also includes extra editor-only/rooted
    # exports (186 here); the independent native-audited actor census is 185.
    # Check original .umap identity and the explicitly non-rendering TargetPoint,
    # not equality between two deliberately different actor scopes.
    from gallery_audit_assembly import original_target_point
    marker = original_target_point(project, workspace)
    if (len(gallery_scene["actors"]) < gallery_meta["original_actor_count"]
            or marker.get("name") != "TargetPoint_0"
            or marker.get("extras", {}).get("original_map_sha256") != gallery_scene["source_sha256"]
            or marker.get("extras", {}).get("non_rendering_source_marker") is not True):
        raise ValueError("Original Gallery actor evidence or target marker differs")
    startup_scene = source_scene(project, START, workspace)
    evidence = certify_startup(startup_scene, checked_package(project, workspace))

    for row in baseline["files"]:
        path = Path(row["path"])
        if not path.is_file() or not valid_glb(path) or file_hash(path) != row["sha256"]:
            raise ValueError("Existing verified GLB is missing or changed: " + str(path))
        if row["kind"] == "map" and glb_summary(path)["mesh_count"] < 1:
            raise ValueError("Original map output lost renderable geometry")
        if row["kind"].startswith("clip:") and _animation_channels(path) < 1:
            raise ValueError("Original animation GLB has no animation channels")

    starter = startup_glb(startup_scene)
    startup_file = published_map_directory / "LV_Fixers_Startup.glb"
    gallery_file = published_map_directory / "GalleryLevel.glb"
    if startup_file.exists() and file_hash(startup_file) != hashlib.sha256(starter).hexdigest():
        raise ValueError("Conflicting preexisting Startup GLB")
    if gallery_file.exists() and file_hash(gallery_file) != gallery_meta["glb_sha256"]:
        raise ValueError("Conflicting preexisting Gallery GLB")
    start_sha = atomic_bytes(startup_file, starter)
    gallery_sha = atomic_bytes(gallery_file, gallery_source.read_bytes())
    start_json = read_glb_json(startup_file)
    gallery_json = read_glb_json(gallery_file)
    if (len(start_json.get("nodes", [])) != 2 or start_json.get("meshes")
            or sorted(n["name"] for n in start_json["nodes"]) != sorted(EXPECTED)
            or glb_summary(startup_file)["mesh_count"] != 0
            or len(gallery_json.get("meshes", [])) != gallery_counts["mesh_count"]):
        raise ValueError("Published GLB did not retain its source geometry contract")
    additions = [
        {"kind": "map", "source_package": START, "path": str(startup_file),
         "bytes": startup_file.stat().st_size, "sha256": start_sha, "mesh_count": 0,
         "source_only": True, "non_rendering_scene": evidence,
         "visual_1to1_verified": False, "gameplay_play_verified": False},
        {"kind": "map", "source_package": GALLERY, "path": str(gallery_file),
         "bytes": gallery_file.stat().st_size, "sha256": gallery_sha,
         "mesh_count": gallery_counts["mesh_count"], "texture_count": gallery_counts["texture_count"],
         "original_actor_count": 185, "source_actors_represented": 185,
         "source_geometry_covered": 184, "source_assembly": str(gallery_source),
         "native_unreal_export_clean": False,
         "visual_1to1_verified": False, "gameplay_play_verified": False}
    ]
    result = {"schema_version": 1, "status": "all_58_glb_files_source_validated",
              "original_source_project": str(project),
              "source_snapshot_hash": state["snapshot_hash"],
              "source_manifest": str(baseline_manifest),
              "original_verified_files": 56,
              "recovered_files": 2,
              "total_verified_glb_files": 58,
              "renderable_scene_note": "Startup is genuinely non-rendering; Gallery is geometry-only and not visual/Play 1:1 certified",
              "files": baseline["files"] + additions,
              "original_ue_native_export_status": "two original native map exports failed",
              "visual_1to1_verified": False, "gameplay_play_verified": False}
    if receipt.exists():
        older = read_json(receipt)
        if older != result:
            raise ValueError("Existing recovery receipt differs; refuse overwrite")
    else:
        atomic_json(receipt, result)
    print("DDS_GLB_FINISHED",json.dumps({"files": 58, "recovered": additions,
                   "receipt": str(receipt), "status": result["status"]},ensure_ascii=False),flush=True)
    return result


def main():
    a=argparse.ArgumentParser(description=__doc__)
    for flag in ("project", "workspace", "gallery-source", "maps-output", "baseline-manifest", "receipt"):
        a.add_argument("--"+flag, required=True, type=Path)
    z=a.parse_args()
    finish(z.project,z.workspace,z.gallery_source,z.maps_output,z.baseline_manifest,z.receipt)


if __name__ == "__main__":
    main()
