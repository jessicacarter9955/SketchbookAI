"""Recipe-driven character migration helpers shared by host CLI and Unreal exporter."""
import os
import math
import re
import shutil
import struct
import subprocess
from pathlib import Path

from adapters import detect_engine
from core import atomic_json, digest, file_hash, prepare_workspace, read_json

RECIPE_SCHEMA = 1
MANIFEST_SCHEMA = 1
CHARACTER_EXPORTER_VERSION = "4-material-bake-sockets"
PACKAGE_EXTENSIONS = (".uasset", ".uexp", ".ubulk", ".uptnl")
SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$")


def _asset_path(value, label):
    if not isinstance(value, str) or not value.startswith("/") or "\\" in value or ".." in value.split("/"):
        raise ValueError(f"{label} must be an Unreal package path")
    value = value.rstrip("/")
    if len(value.split("/")) < 3:
        raise ValueError(f"{label} must include a mount and asset name")
    return value


def load_character_recipe(path):
    path = Path(path).resolve(strict=True)
    data = read_json(path)
    if not isinstance(data, dict) or data.get("schema_version") != RECIPE_SCHEMA:
        raise ValueError(f"Character recipe must use schema_version {RECIPE_SCHEMA}")
    recipe_id = data.get("id")
    if not isinstance(recipe_id, str) or not SAFE_NAME.fullmatch(recipe_id):
        raise ValueError("Character recipe id must be a safe portable name")
    mesh = _asset_path(data.get("mesh"), "mesh")
    clips = data.get("clips")
    if not isinstance(clips, dict) or not clips:
        raise ValueError("Character recipe needs a non-empty clips object")
    normalized_clips = {}
    for name, asset in clips.items():
        if not isinstance(name, str) or not SAFE_NAME.fullmatch(name):
            raise ValueError(f"Unsafe clip name: {name!r}")
        normalized_clips[name] = _asset_path(asset, f"clip {name}")
    attachment_assets = data.get("attachment_assets", {})
    if not isinstance(attachment_assets, dict):
        raise ValueError("attachment_assets must map portable names to Unreal asset definitions")
    normalized_attachments = {}
    for name, definition in attachment_assets.items():
        if not isinstance(name, str) or not SAFE_NAME.fullmatch(name) or not isinstance(definition, dict):
            raise ValueError("attachment_assets entries need safe names and object definitions")
        asset = _asset_path(definition.get("asset"), f"attachment asset {name}")
        bone = definition.get("bone")
        if not isinstance(bone, str) or not bone:
            raise ValueError(f"attachment {name} needs a bone/socket name")
        transform = definition.get("transform", {})
        if not isinstance(transform, dict):
            raise ValueError(f"attachment {name}.transform must be an object")
        normalized_transform = {}
        for key, default in (("position", [0, 0, 0]), ("rotation", [0, 0, 0]), ("scale", [1, 1, 1])):
            value = transform.get(key, default)
            if not isinstance(value, list) or len(value) != 3 or any(
                not isinstance(component, (int, float)) or isinstance(component, bool) or not math.isfinite(component)
                for component in value
            ):
                raise ValueError(f"attachment {name}.transform.{key} must contain three finite numbers")
            if key == "scale" and any(component <= 0 for component in value):
                raise ValueError(f"attachment {name}.transform.scale must be positive")
            normalized_transform[key] = [float(component) for component in value]
        normalized_attachments[name] = {"asset": asset, "bone": bone, "transform": normalized_transform}
    data_tables = data.get("data_tables", {})
    if not isinstance(data_tables, dict):
        raise ValueError("data_tables must map portable names to Unreal DataTable package paths")
    normalized_tables = {}
    for name, package in data_tables.items():
        if not isinstance(name, str) or not SAFE_NAME.fullmatch(name):
            raise ValueError(f"Unsafe data table name: {name!r}")
        normalized_tables[name] = _asset_path(package, f"data table {name}")
    runtime = data.get("runtime", {})
    if not isinstance(runtime, dict):
        raise ValueError("runtime must be an object")
    root_bone = runtime.get("root_bone", "root")
    if not isinstance(root_bone, str) or not root_bone:
        raise ValueError("runtime.root_bone must be a non-empty string")
    required_bones = runtime.get("required_bones", [])
    if not isinstance(required_bones, list) or any(not isinstance(item, str) or not item for item in required_bones):
        raise ValueError("runtime.required_bones must be a string list")
    attachments = runtime.get("attachments", {})
    if not isinstance(attachments, dict) or any(not isinstance(k, str) or not isinstance(v, str) or not v for k, v in attachments.items()):
        raise ValueError("runtime.attachments must map names to bone/socket names")
    aliases = runtime.get("animation_aliases", {})
    if not isinstance(aliases, dict) or any(
        not isinstance(k, str) or not SAFE_NAME.fullmatch(k) or
        not isinstance(v, str) or not SAFE_NAME.fullmatch(v)
        for k, v in aliases.items()
    ):
        raise ValueError("runtime.animation_aliases must map safe clip names to safe source names")
    unknown_alias_sources = sorted(set(aliases.values()) - set(normalized_clips))
    if unknown_alias_sources:
        raise ValueError("runtime.animation_aliases reference missing clips: " + ", ".join(unknown_alias_sources))
    root_motion = runtime.get("root_motion", "preserve")
    if root_motion not in {"preserve", "strip_root_translation", "strip_root_transform"}:
        raise ValueError("runtime.root_motion is unsupported")
    export = data.get("export", {})
    if not isinstance(export, dict):
        raise ValueError("export must be an object")
    scale = export.get("uniform_scale", 0.01)
    if not isinstance(scale, (int, float)) or isinstance(scale, bool) or scale <= 0:
        raise ValueError("export.uniform_scale must be positive")
    required_plugins = export.get("required_engine_plugins", [])
    if not isinstance(required_plugins, list) or any(not isinstance(item, str) or not SAFE_NAME.fullmatch(item) for item in required_plugins):
        raise ValueError("export.required_engine_plugins must be a list of safe Unreal engine plugin names")
    return {
        "schema_version": RECIPE_SCHEMA,
        "id": recipe_id,
        "mesh": mesh,
        "clips": dict(sorted(normalized_clips.items())),
        "attachment_assets": dict(sorted(normalized_attachments.items())),
        "data_tables": dict(sorted(normalized_tables.items())),
        "runtime": {"root_motion": root_motion, "root_bone": root_bone,
                    "required_bones": required_bones, "attachments": attachments,
                    "animation_aliases": dict(sorted(aliases.items()))},
        "export": {"uniform_scale": float(scale), "required_engine_plugins": sorted(set(required_plugins))},
        "recipe_path": str(path),
    }


def _plugin_mounts(project):
    root = Path(project).resolve().parent
    mounts = {}
    plugins = root / "Plugins"
    if plugins.is_dir():
        for descriptor in plugins.rglob("*.uplugin"):
            mounts.setdefault(descriptor.stem, descriptor.parent / "Content")
    return mounts


def package_base(project, package):
    project = Path(project).resolve()
    package = _asset_path(package, "package")
    parts = package.lstrip("/").split("/")
    mount, relative = parts[0], parts[1:]
    if mount == "Game":
        root = project.parent / "Content"
    else:
        root = _plugin_mounts(project).get(mount)
        if root is None:
            raise ValueError(f"Unknown project/plugin mount /{mount} for {package}")
    return root.joinpath(*relative)


def package_files(project, package):
    base = package_base(project, package)
    found = [base.with_suffix(ext) for ext in PACKAGE_EXTENSIONS if base.with_suffix(ext).is_file()]
    if not found:
        raise FileNotFoundError(f"No package files found for {package}")
    return found


def character_fingerprint(project, recipe):
    project = Path(project).resolve()
    assets = [recipe["mesh"], *recipe["clips"].values(),
              *(item["asset"] for item in recipe.get("attachment_assets", {}).values()),
              *recipe.get("data_tables", {}).values()]
    records = []
    for package in sorted(set(assets)):
        files = package_files(project, package)
        records.append({"package": package, "files": [
            {"path": p.resolve().relative_to(project.parent).as_posix(), "sha256": file_hash(p)} for p in files
        ]})
    normalized = {k: v for k, v in recipe.items() if k != "recipe_path"}
    return digest({"recipe": normalized, "sources": records,
                   "character_exporter_version": CHARACTER_EXPORTER_VERSION}), records


def _portable_file(value, label):
    if not isinstance(value, str) or Path(value).name != value or Path(value).suffix.lower() != ".glb":
        raise ValueError(f"Unsafe {label} filename")
    if not SAFE_NAME.fullmatch(Path(value).stem):
        raise ValueError(f"Unsafe {label} filename")
    return value


def validate_glb(path):
    path = Path(path)
    with path.open("rb") as stream:
        header = stream.read(12)
    if len(header) != 12:
        raise ValueError(f"GLB header too short: {path.name}")
    magic, version, declared_length = struct.unpack("<4sII", header)
    if magic != b"glTF" or version != 2:
        raise ValueError(f"Invalid GLB header: {path.name}")
    actual = path.stat().st_size
    if declared_length != actual:
        raise ValueError(f"GLB length mismatch: {path.name}")
    return {"bytes": actual, "sha256": file_hash(path)}


def validate_character_output(directory, expected_fingerprint=None):
    directory = Path(directory)
    data = read_json(directory / "manifest.json")
    if not isinstance(data, dict) or data.get("schema_version") != MANIFEST_SCHEMA or data.get("kind") != "character":
        raise ValueError("Invalid character manifest")
    if expected_fingerprint and data.get("fingerprint") != expected_fingerprint:
        raise ValueError("Character export fingerprint does not match current inputs")
    mesh_file = _portable_file(data.get("mesh"), "mesh")
    clips = data.get("clips")
    if not isinstance(clips, dict) or not clips:
        raise ValueError("Character manifest has no clips")
    checked = {"mesh": validate_glb(directory / mesh_file), "clips": {}, "attachment_assets": {}}
    for name, filename in clips.items():
        if not isinstance(name, str) or not SAFE_NAME.fullmatch(name):
            raise ValueError("Invalid clip name in manifest")
        filename = _portable_file(filename, f"clip {name}")
        checked["clips"][name] = validate_glb(directory / filename)
    for name, metadata in data.get("attachment_assets", {}).items():
        if not isinstance(name, str) or not SAFE_NAME.fullmatch(name) or not isinstance(metadata, dict):
            raise ValueError("Invalid attachment asset entry in manifest")
        filename = _portable_file(metadata.get("file"), f"attachment {name}")
        if not isinstance(metadata.get("bone"), str) or not metadata["bone"]:
            raise ValueError(f"Attachment {name} has no attachment bone/socket")
        if "socket_transform" in metadata:
            socket = metadata["socket_transform"]
            for key, length in (("position", 3), ("quaternion", 4), ("scale", 3)):
                values = socket.get(key) if isinstance(socket, dict) else None
                if (not isinstance(values, list) or len(values) != length or any(
                        not isinstance(value, (int, float)) or isinstance(value, bool) or
                        not math.isfinite(value) for value in values)):
                    raise ValueError(f"Invalid socket {key} for attachment {name}")
            if (any(value <= 0 for value in socket["scale"]) or
                    abs(math.sqrt(sum(value * value for value in socket["quaternion"])) - 1) > 0.001):
                raise ValueError(f"Invalid socket transform for attachment {name}")
        checked["attachment_assets"][name] = validate_glb(directory / filename)
    checked["data_tables"] = {}
    for name, metadata in data.get("data_tables", {}).items():
        if not isinstance(name, str) or not SAFE_NAME.fullmatch(name) or not isinstance(metadata, dict):
            raise ValueError("Invalid data table entry in character manifest")
        filename = metadata.get("file")
        if (not isinstance(filename, str) or Path(filename).name != filename or
                Path(filename).suffix.lower() != ".json" or
                not SAFE_NAME.fullmatch(Path(filename).stem)):
            raise ValueError(f"Unsafe data table filename for {name}")
        value = read_json(directory / filename)
        if not isinstance(value, (dict, list)):
            raise ValueError(f"Invalid data table JSON for {name}")
        checked["data_tables"][name] = {"file": filename, "rows": len(value)}
    return {"manifest": data, "validated": checked}


def _link_directory(link, target):
    link, target = Path(link), Path(target).resolve(strict=True)
    if link.exists() or link.is_symlink():
        if link.resolve() != target:
            raise RuntimeError(f"Scratch link points to another source: {link}")
        return
    link.parent.mkdir(parents=True, exist_ok=True)
    if os.name == "nt":
        result = subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target)], capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError("Cannot create scratch Content junction: " + (result.stderr or result.stdout).strip())
    else:
        link.symlink_to(target, target_is_directory=True)


def prepare_character_scratch(project, directory, engine, recipe):
    project, directory = Path(project).resolve(strict=True), Path(directory).resolve()
    scratch = directory / "scratch" / "character-export"
    scratch.mkdir(parents=True, exist_ok=True)
    _link_directory(scratch / "Content", project.parent / "Content")
    version_parts = engine.get("version_parts") or []
    association = ".".join(str(x) for x in version_parts[:2]) if len(version_parts) >= 2 else engine.get("requested_association", "")
    plugins = [{"Name": "PythonScriptPlugin", "Enabled": True}, {"Name": "GLTFExporter", "Enabled": True}]
    plugin_root = Path(engine.get("root", "")) / "Engine" / "Plugins"
    available_plugins = {descriptor.stem: descriptor for descriptor in plugin_root.rglob("*.uplugin")} if plugin_root.is_dir() else {}
    for name in recipe["export"]["required_engine_plugins"]:
        if name not in available_plugins:
            raise RuntimeError(f"Required Unreal engine plugin is not installed: {name}")
        plugins.append({"Name": name, "Enabled": True})
    atomic_json(scratch / "Export.uproject", {"FileVersion": 3, "EngineAssociation": association, "Plugins": plugins})
    return scratch / "Export.uproject"


def _publish_character(final, publish_dir, project):
    if publish_dir is None:
        return None
    final, destination = Path(final).resolve(strict=True), Path(publish_dir).resolve()
    source_root = Path(project).resolve().parent
    if destination == source_root or source_root in destination.parents:
        raise ValueError("Published runtime assets must not be written inside the Unreal source project")
    if destination == final or final in destination.parents or destination in final.parents:
        raise ValueError("Publish directory and migration output must be separate, non-nested directories")
    temp = destination.with_name(destination.name + ".tmp")
    if temp.exists():
        shutil.rmtree(temp)
    temp.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(final, temp)
    validate_character_output(temp)
    if destination.exists():
        shutil.rmtree(destination)
    temp.replace(destination)
    return str(destination)


def migrate_character(project, recipe_path, workspace, engine_override=None, force=False, logger=None, publish_dir=None):
    project = Path(project).resolve(strict=True)
    recipe = load_character_recipe(recipe_path)
    workspace = prepare_workspace(workspace, project)
    fingerprint, sources = character_fingerprint(project, recipe)
    final = workspace / "output" / "characters" / recipe["id"]
    if not force and (final / "manifest.json").is_file():
        try:
            validated = validate_character_output(final, fingerprint)
            if logger:
                logger.event("reuse", f"character {recipe['id']}: cached export valid", task="character-export")
            published = _publish_character(final, publish_dir, project)
            return {"status": "reused", "output": str(final), "published": published,
                    "fingerprint": fingerprint, **validated}
        except (OSError, ValueError):
            pass
    descriptor = read_json(project)
    engine = detect_engine(descriptor.get("EngineAssociation", ""), engine_override)
    if engine.get("status") != "detected" or not engine.get("executable"):
        raise RuntimeError("Matching Unreal Editor commandlet is required for character export")
    scratch_project = prepare_character_scratch(project, workspace, engine, recipe)
    staging = workspace / "staging" / ("character-" + recipe["id"])
    recipe_runtime = {k: v for k, v in recipe.items() if k != "recipe_path"}
    recipe_runtime.update(fingerprint=fingerprint, source_project=str(project), source_files=sources)
    if force and staging.exists():
        shutil.rmtree(staging)
    elif staging.is_dir() and (staging / "recipe.json").is_file():
        try:
            previous = read_json(staging / "recipe.json")
        except (OSError, ValueError):
            previous = None
        if not isinstance(previous, dict) or previous.get("fingerprint") != fingerprint:
            shutil.rmtree(staging)
    elif staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True, exist_ok=True)
    atomic_json(staging / "recipe.json", recipe_runtime)
    if not force and (staging / "manifest.json").is_file():
        try:
            validated = validate_character_output(staging, fingerprint)
            if final.exists():
                shutil.rmtree(final)
            final.parent.mkdir(parents=True, exist_ok=True)
            staging.replace(final)
            if logger:
                logger.event("recovered", f"Published completed staged character {recipe['id']}", task="character-export")
            published = _publish_character(final, publish_dir, project)
            return {"status": "recovered", "output": str(final), "published": published,
                    "fingerprint": fingerprint, **validated}
        except (OSError, ValueError):
            pass
    logs = workspace / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    script = Path(__file__).with_name("unreal_character_export.py").resolve()
    env = os.environ.copy()
    env.update({"UE2THREE_CHARACTER_RECIPE": str(staging / "recipe.json"),
                "UE2THREE_CHARACTER_OUT": str(staging)})
    args = [engine["executable"], str(scratch_project), "-run=pythonscript", f"-script={script}",
            "-unattended", "-nosplash", "-AllowCommandletRendering", "-nosound",
            "-NoSourceControl", "-stdout",
            "-FullStdOutLogOutput"]
    if logger:
        logger.event("task-start", f"Exporting character {recipe['id']} through Unreal", task="character-export")
    with (logs / "unreal-character.log").open("w", encoding="utf-8") as stdout,          (logs / "unreal-character-error.log").open("w", encoding="utf-8") as stderr:
        process = subprocess.run(args, env=env, stdout=stdout, stderr=stderr)
    if process.returncode:
        raise RuntimeError(f"Unreal character export failed with exit code {process.returncode}; see logs/unreal-character*.log")
    validated = validate_character_output(staging, fingerprint)
    if final.exists():
        shutil.rmtree(final)
    final.parent.mkdir(parents=True, exist_ok=True)
    staging.replace(final)
    if logger:
        logger.event("task-done", f"Character {recipe['id']} exported and validated", task="character-export")
    published = _publish_character(final, publish_dir, project)
    return {"status": "converted", "output": str(final), "published": published,
            "fingerprint": fingerprint, **validated}
