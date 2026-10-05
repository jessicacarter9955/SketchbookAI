"""OPTIONAL: run manually inside a trusted Unreal editor's Python environment.

Set UE2THREE_REGISTRY_OUT to an absolute local output JSON path, outside source.
This reads the Asset Registry without loading assets or saving packages. Starting
the user's editor may itself load project/plugin code. ue2three never runs it.
"""
import json
import os
from pathlib import Path

import unreal

out = Path(os.environ["UE2THREE_REGISTRY_OUT"]).resolve()
project = Path(unreal.Paths.convert_relative_path_to_full(unreal.Paths.get_project_file_path())).resolve()
if out == project.parent or project.parent in out.parents or out in project.parents:
    raise RuntimeError("Registry output must be outside the source project")
registry = unreal.AssetRegistryHelpers.get_asset_registry()
registry.search_all_assets(True)
options = unreal.AssetRegistryDependencyOptions(
    include_soft_package_references=True, include_hard_package_references=True,
    include_searchable_names=False, include_soft_management_references=True,
    include_hard_management_references=True,
)
by_package = {}
for asset in registry.get_all_assets():
    package = str(asset.package_name)
    # Engine/script packages are external dependencies, not project export inputs.
    if package.startswith(("/Engine/", "/Script/")):
        continue
    class_path = getattr(asset, "asset_class_path", None)
    kind = str(class_path.asset_name if class_path is not None else asset.asset_class)
    entry = {"package": package, "class": kind,
             "dependencies": sorted(str(item) for item in registry.get_dependencies(asset.package_name, options))}
    # A package may expose multiple objects. Prefer the main asset over redirectors.
    if package not in by_package or kind != "ObjectRedirector":
        by_package[package] = entry
data = {"schema_version": 1, "project": str(project), "assets": [by_package[key] for key in sorted(by_package)],
        "engine_version": unreal.SystemLibrary.get_engine_version()}
out.parent.mkdir(parents=True, exist_ok=True)
temp = out.with_name(out.name + ".tmp")
temp.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")
os.replace(temp, out)
unreal.log("UE2THREE_REGISTRY_DONE " + str(out))
