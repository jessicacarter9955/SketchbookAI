"""Extract original Enhanced Input mappings and Blueprint event entry points."""
from pathlib import Path

from core import atomic_json, read_json
from pipeline import load_state
from umg_migration import Package, UMGMigrationError, _asset_document, _asset_file, _tool


INPUT_CONTEXT = "/Game/Fixers/Core/Input/Actions/IMC_Fixers"
MOVER_BLUEPRINT = "/Game/Fixers/Core/Blueprints/Characters/CBP_Fixers_Mover"
EVENT_PREFIX = "InpActEvt_"
EVENT_SUFFIX = "_K2Node_EnhancedInputActionEvent_"


def _resolve_reference(package, reference):
    if not isinstance(reference, int) or reference == 0:
        return None
    if reference < 0 and -reference <= len(package.imports):
        return package.imports[-reference - 1].get("ObjectName")
    if reference > 0 and reference <= len(package.exports):
        return package.exports[reference - 1].get("ObjectName")
    return None


def _input_bindings(package):
    context = next((export for export in package.exports if export.get("ObjectName") == "IMC_Fixers"), None)
    if not context:
        raise UMGMigrationError("IMC_Fixers has no exported input mapping context")
    values = package.props(context).get("DefaultKeyMappings", {})
    mappings = values.get("Mappings", []) if isinstance(values, dict) else []
    result = []
    for mapping in mappings:
        if not isinstance(mapping, dict):
            continue
        key_data = mapping.get("Key", {})
        key = key_data.get("KeyName") if isinstance(key_data, dict) else None
        action = _resolve_reference(package, mapping.get("Action"))
        if not isinstance(key, str) or not action:
            continue
        result.append({
            "key": key,
            "action": action,
            "modifiers": [name for value in mapping.get("Modifiers", [])
                          if (name := _resolve_reference(package, value))],
        })
    if not result:
        raise UMGMigrationError("IMC_Fixers contained no readable action-to-key mappings")
    return result


def _event_entry_points(package):
    ubergraph = next((index + 1 for index, export in enumerate(package.exports)
                      if export.get("ObjectName") == "ExecuteUbergraph_CBP_Fixers_Mover"), None)
    if not ubergraph:
        raise UMGMigrationError("CBP_Fixers_Mover has no compiled ubergraph export")
    events = []
    for export in package.exports:
        name = export.get("ObjectName", "")
        if not name.startswith(EVENT_PREFIX) or EVENT_SUFFIX not in name:
            continue
        action = name[len(EVENT_PREFIX):].split(EVENT_SUFFIX, 1)[0]
        bytecode = export.get("ScriptBytecode", [])
        entry = None
        for expression in bytecode if isinstance(bytecode, list) else []:
            kind = str(expression.get("$type", "")).rsplit(".", 1)[-1].split(",", 1)[0]
            if kind not in {"EX_LocalFinalFunction", "EX_FinalFunction"} or expression.get("StackNode") != ubergraph:
                continue
            for parameter in expression.get("Parameters", []):
                parameter_type = str(parameter.get("$type", "")).rsplit(".", 1)[-1].split(",", 1)[0]
                if parameter_type == "EX_IntConst" and isinstance(parameter.get("Value"), int):
                    entry = parameter["Value"]
                    break
            if entry is not None:
                break
        if entry is not None:
            events.append({"action": action, "function": name, "ubergraph_entry_point": entry})
    if not events:
        raise UMGMigrationError("CBP_Fixers_Mover input functions had no readable ubergraph entry points")
    return events


def _source_input_functions(package):
    wanted = {"SetupInput", "ProduceInput", "Get_MoveInput", "Get_AimingRotation",
              "Get_RotationMode", "Get_OrientationIntent", "Get_Gait", "Get_MovementDirectionAndOffset"}
    functions = {}
    call_types = {"EX_FinalFunction", "EX_LocalFinalFunction", "EX_VirtualFunction",
                  "EX_LocalVirtualFunction", "EX_CallMath"}

    def visit(value):
        if isinstance(value, dict):
            kind = str(value.get("$type", "")).rsplit(".", 1)[-1].split(",", 1)[0]
            if kind in call_types:
                name = value.get("VirtualFunctionName") or _resolve_reference(package, value.get("StackNode"))
                if name:
                    calls.append(str(name))
            for key, child in value.items():
                if key != "$type":
                    visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    for export in package.exports:
        name = export.get("ObjectName")
        if name not in wanted:
            continue
        calls = []
        visit(export.get("ScriptBytecode", []))
        functions[name] = calls
    return functions


def migrate_controls(project, workspace, publish_dir, logger=None, force=False):
    """Read source controls without executing Unreal or inventing action behavior."""
    project = Path(project).resolve(strict=True)
    workspace = Path(workspace).resolve(strict=True)
    state = load_state(workspace)
    if Path(state["config"]["project"]).resolve() != project or state.get("source_verification_status") != "verified":
        raise UMGMigrationError("Verified inspection metadata for this project is required before control extraction")
    engine = read_json(workspace / "artifacts" / "engine.json")
    engine_version = str(engine.get("version", "")).split("-")[0]
    if not engine_version:
        raise UMGMigrationError("Engine version metadata is missing for Blueprint extraction")
    input_file = _asset_file(project, INPUT_CONTEXT)
    mover_file = _asset_file(project, MOVER_BLUEPRINT)
    for package, path in ((INPUT_CONTEXT, input_file), (MOVER_BLUEPRINT, mover_file)):
        if path is None or not path.is_file():
            raise UMGMigrationError(f"Required source asset is missing: {package}")
    tool = _tool(workspace / "tool-cache")
    cache = workspace / "artifacts" / "uasset-json"
    input_package, input_hash = _asset_document(INPUT_CONTEXT, input_file, tool, cache, engine_version, force)
    mover_package, mover_hash = _asset_document(MOVER_BLUEPRINT, mover_file, tool, cache, engine_version, force)
    bindings = _input_bindings(input_package)
    events = _event_entry_points(mover_package)
    source_functions = _source_input_functions(mover_package)
    report = {
        "schema_version": 1,
        "project": str(project),
        "engine_version": engine_version,
        "sources": {
            "input_mapping_context": {"package": INPUT_CONTEXT, "sha256": input_hash},
            "character_blueprint": {"package": MOVER_BLUEPRINT, "sha256": mover_hash},
        },
        "default_key_mappings": bindings,
        "blueprint_input_events": events,
        "compiled_input_functions": source_functions,
        "limitations": [
            "This batch extracts original key mappings and compiled Blueprint entry points only.",
            "The extracted function-call paths expose the original Blueprint input flow but do not execute it.",
            "The Mover plugin simulation is not translated yet.",
        ],
    }
    output = Path(publish_dir)
    output.mkdir(parents=True, exist_ok=True)
    atomic_json(output / "character-controls.json", report)
    if logger:
        logger.event("controls-extracted", f"{len(bindings)} key mappings; {len(events)} input Blueprint events",
                     report=str(output / "character-controls.json"))
    return report
