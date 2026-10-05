"""Unreal registry worker: no asset loads, package saves or external services."""
import json
import os
from collections import Counter
from pathlib import Path
import unreal

def atomic(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp")
    with temp.open("w", encoding="utf-8") as stream:
        json.dump(data, stream, indent=2, sort_keys=True)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)

active = Path(unreal.Paths.convert_relative_path_to_full(unreal.Paths.get_project_file_path())).resolve()
if os.environ.get("UE2THREE_JOB_FILE"):
    job = json.loads(Path(os.environ["UE2THREE_JOB_FILE"]).read_text(encoding="utf-8"))
    if Path(job["scratch_project"]).resolve() != active:
        raise RuntimeError("[PROJECT_IDENTITY_MISMATCH] Active Unreal project does not match the job.")
    project, out = Path(job["source_project"]).resolve(), Path(job["output"]).resolve()
    mounts = ["/Game"] + ["/" + name for name in job["plugin_mounts"]]
else:
    project = active
    out = Path(os.environ["UE2THREE_REGISTRY_OUT"]).resolve()
    job = {"progress": str(out.with_suffix(".progress.json"))}
    mounts = ["/Game"]
if out == project.parent or project.parent in out.parents:
    raise RuntimeError("[OUTPUT_INSIDE_SOURCE] Output must be outside source project.")
registry = unreal.AssetRegistryHelpers.get_asset_registry()
registry.search_all_assets(True)
options = unreal.AssetRegistryDependencyOptions(
    include_soft_package_references=True, include_hard_package_references=True,
    include_searchable_names=False, include_soft_management_references=True,
    include_hard_management_references=True)
assets = []
for mount in mounts:
    assets.extend(registry.get_assets_by_path(mount, recursive=True))
assets.sort(key=lambda asset: (str(asset.package_name), str(asset.asset_name)))
TAGS = ["ParentClass", "NativeParentClass", "GeneratedClass", "ImplementedInterfaces", "BlueprintType",
        "Skeleton", "PreviewSkeletalMesh", "SequenceLength", "NumFrames", "SamplingFrameRate",
        "HasRootMotion", "NumTriangles", "NumVertices", "Dimensions", "ImportedSize", "LODGroup",
        "BlendMode", "ShadingModel", "MaterialDomain", "PhysicsAsset", "NumLODs"]
by_package, failures = {}, []
for index, asset in enumerate(assets, 1):
    package = str(asset.package_name)
    try:
        class_path = getattr(asset, "asset_class_path", None)
        kind = str(class_path.asset_name if class_path is not None else asset.asset_class)
        tags = {}
        for tag in TAGS:
            value = asset.get_tag_value(tag)
            if value is not None:
                tags[tag] = str(value)
        entry = {"package": package, "object_name": str(asset.asset_name), "class": kind,
                 "class_path": str(class_path) if class_path else kind, "tags": tags,
                 "dependencies": sorted(str(item) for item in registry.get_dependencies(asset.package_name, options))}
        if package not in by_package or kind != "ObjectRedirector":
            by_package[package] = entry
    except Exception as error:
        failures.append({"asset": package, "code": "ASSET_METADATA_FAILED", "message": str(error)})
    if index % 100 == 0 or index == len(assets):
        atomic(job["progress"], {"completed": index, "total": len(assets), "asset": package,
                               "message": f"Read {index}/{len(assets)} registry entries"})
entries = [by_package[key] for key in sorted(by_package)]
data = {"schema_version": 1, "project": str(project), "assets": entries, "complete": not failures,
        "source_snapshot_hash": job.get("source_snapshot_hash"), "failures": failures,
        "classes": dict(Counter(entry["class"] for entry in entries)),
        "engine_version": unreal.SystemLibrary.get_engine_version(), "tag_coverage": "selected_registry_tags",
        "limitations": ["Registry metadata is not Blueprint graph execution or gameplay conversion.",
                       "Sockets, geometry, animation tracks and map actors require asset-loading adapters."]}
atomic(out, data)
if failures:
    raise RuntimeError(f"[METADATA_INCOMPLETE] {len(failures)} failures; details retained at {out}")
unreal.log("UE2THREE_REGISTRY_DONE " + str(out))
