"""Read source rig, material parameters and DataTables in an isolated UE commandlet."""
import json
import os
from pathlib import Path

import unreal

recipe = json.loads(Path(os.environ["UE2THREE_CHARACTER_RECIPE"]).read_text(encoding="utf-8"))
out = Path(os.environ["UE2THREE_CHARACTER_OUT"])
out.mkdir(parents=True, exist_ok=True)
report = {"mesh": recipe["mesh"], "assets": {}, "data_tables": {}}

for label, path in [("character", recipe["mesh"])] + [
    (name, value["asset"]) for name, value in recipe.get("attachment_assets", {}).items()
]:
    asset = unreal.load_asset(path)
    entry = {"source": path, "sockets": [], "materials": []}
    if isinstance(asset, unreal.SkeletalMesh):
        component = unreal.SkeletalMeshComponent()
        component.set_skeletal_mesh_asset(asset)
        for socket in component.get_all_socket_names():
            parent = component.get_socket_bone_name(socket)
            transform = component.get_socket_transform(socket, unreal.RelativeTransformSpace.RTS_PARENT_BONE_SPACE)
            entry["sockets"].append({"name": str(socket), "bone": str(parent),
                                     "transform": str(transform)})
        materials = asset.get_editor_property("materials")
        for slot in materials:
            material = slot.get_editor_property("material_interface")
            details = {"path": material.get_path_name() if material else None}
            if isinstance(material, unreal.MaterialInstanceConstant):
                for kind in ("vector", "scalar", "texture"):
                    names = getattr(unreal.MaterialEditingLibrary, "get_" + kind + "_parameter_names")(material)
                    details[kind] = {str(name): str(getattr(unreal.MaterialEditingLibrary,
                        "get_material_instance_" + kind + "_parameter_value")(material, name)) for name in names}
            entry["materials"].append(details)
    report["assets"][label] = entry
    (out / "source-inspection.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    unreal.log("UE2THREE_INSPECTED " + label)

for name, path in recipe.get("data_tables", {}).items():
    table = unreal.load_asset(path)
    if not isinstance(table, unreal.DataTable):
        raise RuntimeError("Expected DataTable: " + path)
    rows = json.loads(table.export_to_json_string())
    report["data_tables"][name] = {"source": path, "rows": rows}
(out / "source-inspection.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
unreal.log("UE2THREE_INSPECTION_DONE")
