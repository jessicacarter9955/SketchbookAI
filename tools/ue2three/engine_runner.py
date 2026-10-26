"""Installed Unreal runs offline in an isolated workspace, never saving source packages."""
import os
import shutil
import subprocess
import time
from pathlib import Path

from core import atomic_json, digest, file_hash, read_json, utc


class EngineError(RuntimeError):
    def __init__(self, code, message):
        self.code = code
        super().__init__(f"[{code}] {message}")


# Only built-in Unreal engine plugins are permitted in the isolated map exporter.
# Never load original project-native modules or network/assistant integrations.
_MAP_DEFAULT_ENGINE_PLUGINS = frozenset(("EnhancedInput", "Niagara"))
_MAP_EXCLUDED_ENGINE_PLUGINS = {
    "AIAssistant": "AI assistant native code is excluded from offline export",
    "OnlineSubsystemSteam": "network subsystem excluded from offline export",
    "SteamSockets": "network subsystem excluded from offline export",
    "MetaHumanCharacter": ("isolated UE 5.7 commandlet crashes loading the engine plugin's own "
                           "AS_MetaHuman_ARKit_Mapping animation (AnimSequenceBase without data model)"),
    "ModelingToolsEditorMode": "editor modeling interface not needed to deserialize world geometry",
    "MovieRenderPipeline": "editor movie-render interface not needed for static map conversion",
}


def source_engine_plugins(project, executable):
    """Identify source-enabled, installed engine plugins without running project code.

    The original .uproject is read-only.  Engine plugins are resolved under the
    installed engine tree; project and Marketplace plugin executables stay off.
    A manifest records omissions instead of pretending missing types are loaded.
    """
    descriptor = read_json(project)
    if not isinstance(descriptor, dict) or not isinstance(descriptor.get("Plugins", []), list):
        raise EngineError("SOURCE_PLUGINS_INVALID", "The source .uproject has no valid plugin declaration list")
    source_entries = descriptor.get("Plugins", [])
    explicit = {item["Name"]: item["Enabled"] for item in source_entries
                if isinstance(item, dict) and isinstance(item.get("Name"), str)
                and isinstance(item.get("Enabled"), bool)}
    requested = ({name for name, enabled in explicit.items() if enabled} |
                 {name for name in _MAP_DEFAULT_ENGINE_PLUGINS if explicit.get(name, True)})
    engine_binary = Path(executable)
    plugin_root = engine_binary.parent.parent.parent / "Plugins"
    available = {}
    if plugin_root.is_dir():
        for path in plugin_root.rglob("*.uplugin"):
            if path.stem in requested and path.stem not in available:
                available[path.stem] = path
    included, omitted = [], {}
    for name in sorted(requested):
        path = available.get(name)
        if name in _MAP_EXCLUDED_ENGINE_PLUGINS:
            omitted[name] = _MAP_EXCLUDED_ENGINE_PLUGINS[name]
        elif not path:
            omitted[name] = "not installed as an Unreal engine plugin"
        elif "Marketplace" in path.relative_to(plugin_root).parts:
            omitted[name] = "third-party Marketplace plugin excluded from native execution"
        elif not path.resolve().is_relative_to(plugin_root.resolve()):
            omitted[name] = "plugin descriptor resolves outside the installed engine"
        else:
            try:
                settings = read_json(path)
                if not isinstance(settings, dict) or not isinstance(settings.get("Modules", []), list):
                    raise ValueError("invalid module declaration")
            except (OSError, ValueError) as error:
                omitted[name] = f"invalid engine plugin descriptor: {type(error).__name__}"
                continue
            included.append(name)
    return included, omitted


def mount_content(source, destination):
    source, destination = Path(source).resolve(), Path(destination)
    if destination.exists():
        if not destination.samefile(source):
            raise EngineError("MOUNT_CONFLICT", f"Existing mount does not match source: {destination}")
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    if os.name == "nt":
        quote = lambda text: "'" + str(text).replace("'", "''") + "'"
        subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
                        f"$ErrorActionPreference='Stop'; New-Item -ItemType Junction -Path {quote(destination)} -Target {quote(source)} | Out-Null"],
                       check=True, capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
    else:
        destination.symlink_to(source, target_is_directory=True)


def _link_tree(source, destination, excluded_packages=(), root_mount="/Game", included_packages=None):
    source, destination = Path(source).resolve(), Path(destination)
    excluded = set(excluded_packages)
    included = None if included_packages is None else set(included_packages)
    for item in source.rglob("*"):
        if not item.is_file():
            continue
        relative = item.relative_to(source)
        package = root_mount.rstrip("/") + "/" + relative.with_suffix("").as_posix()
        if item.suffix.lower() in {".uasset", ".umap", ".uexp", ".ubulk", ".uptnl"}:
            if package in excluded or (included is not None and package not in included):
                continue
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.link(item, target)
        except FileExistsError:
            if not target.samefile(item):
                raise EngineError("MIRROR_CONFLICT", f"Existing content mirror differs from source: {target}")
        except OSError as exc:
            raise EngineError("MIRROR_LINK_FAILED", f"Cannot mirror source asset without copying it: {item} ({exc})") from exc


def prepare_project(directory, snapshot, scratch_name="inspection-project", mirror_assets=False, excluded_packages=(), limit_shader_workers=False, included_packages=None, restore_source_engine_plugins=False):
    engine = snapshot["engine"]
    if engine.get("status") != "detected" or not engine.get("executable"):
        raise EngineError("ENGINE_MISSING", "Install the matching Unreal editor or provide --engine.")
    association = str(engine["requested_association"])
    version = engine.get("version_parts", [])
    if association and association[0].isdigit() and association.split(".")[:2] != [str(part) for part in version[:2]]:
        raise EngineError("ENGINE_VERSION_MISMATCH", "Extraction requires the source major/minor engine version.")
    if not version or version[0] not in (4, 5):
        raise EngineError("ENGINE_UNSUPPORTED", "No Python metadata adapter for this engine version.")
    source = Path(snapshot["project"]).parent
    engine_directory = (Path(directory) / "engine").resolve()
    scratch = engine_directory / scratch_name
    if scratch.resolve() == engine_directory or engine_directory not in scratch.resolve().parents:
        raise EngineError("SCRATCH_PATH_INVALID", "Export scratch must stay inside the workspace engine directory.")
    scratch.mkdir(parents=True, exist_ok=True)
    if (source / "Content").is_dir():
        if mirror_assets:
            marker = scratch / ".ue2three-content-mirror.json"
            identity = digest({"source": str(source), "excluded_packages": sorted(set(excluded_packages)),
                               "included_packages": sorted(set(included_packages)) if included_packages is not None else None})
            try:
                existing = read_json(marker)
            except (OSError, ValueError):
                existing = {}
            if existing.get("identity") != identity:
                if scratch.exists():
                    shutil.rmtree(scratch)
                scratch.mkdir(parents=True, exist_ok=True)
                _link_tree(source / "Content", scratch / "Content", excluded_packages, included_packages=included_packages)
                atomic_json(marker, {"identity": identity, "excluded_packages": sorted(set(excluded_packages))})
        else:
            mount_content(source / "Content", scratch / "Content")
    # Content-only mirrors mount plugin assets without loading project native code,
    # AI assistants, online services, or source-project startup Python scripts.
    plugins = [{"Name": "PythonScriptPlugin", "Enabled": True},
               {"Name": "GLTFExporter", "Enabled": True}]
    if restore_source_engine_plugins:
        enabled, omitted = source_engine_plugins(Path(snapshot["project"]), engine["executable"])
        plugins.extend({"Name": name, "Enabled": True} for name in enabled
                       if name not in {"PythonScriptPlugin", "GLTFExporter"})
        atomic_json(scratch / ".ue2three-engine-plugin-provenance.json", {
            "schema_version": 1, "source_project": str(Path(snapshot["project"]).resolve()),
            "enabled_stock_engine_plugins": enabled, "omitted_source_plugins": omitted,
            "policy": "isolated map export: no original project-native or network/assistant plugin code"})
    mirrors = []
    for item in snapshot["files"]:
        if not item["path"].lower().endswith(".uplugin"):
            continue
        descriptor = source / item["path"]
        content = descriptor.parent / "Content"
        if not content.is_dir():
            continue
        target = scratch / "Plugins" / descriptor.stem
        target.mkdir(parents=True, exist_ok=True)
        atomic_json(target / descriptor.name, {"FileVersion": 3, "Version": 1, "CanContainContent": True, "Modules": []})
        if mirror_assets:
            _link_tree(content, target / "Content", excluded_packages, "/" + descriptor.stem, included_packages)
        else:
            mount_content(content, target / "Content")
        plugins.append({"Name": descriptor.stem, "Enabled": True})
        mirrors.append(descriptor.stem)
    path = scratch / "Inspect.uproject"
    atomic_json(path, {"FileVersion": 3, "EngineAssociation": ".".join(map(str, version[:2])), "DisableEnginePluginsByDefault": True, "Plugins": plugins})
    if limit_shader_workers:
        config = scratch / "Config" / "DefaultEngine.ini"
        config.parent.mkdir(parents=True, exist_ok=True)
        config.write_text("[DevOptions.Shaders]\nNumUnusedShaderCompilingThreads=96\nNumUnusedShaderCompilingThreadsDuringGame=96\nPercentageUnusedShaderCompilingThreads=100\nbForceUseSCWMemoryPressureLimits=True\nCookerMemoryUsedInGB=6\nMemoryToLeaveForTheOSInGB=4\nMemoryUsedPerSCWProcessInGB=1\nMinSCWsToSpawnBeforeWarning=1\nMaxShaderJobBatchSize=2\n", encoding="utf-8")
    return path, mirrors


def run_engine(directory, snapshot, logger, timeout=1200, popen=subprocess.Popen):
    project, mirrors = prepare_project(directory, snapshot)
    attempt = directory / "engine" / "runs" / str(time.time_ns())
    attempt.mkdir(parents=True)
    request = {"schema_version": 1, "source_project": snapshot["project"], "scratch_project": str(project),
               "source_snapshot_hash": digest(snapshot["files"]), "output": str(attempt / "registry.json"),
               "progress": str(attempt / "progress.json"), "plugin_mounts": mirrors}
    atomic_json(attempt / "request.json", request)
    environment = os.environ.copy()
    environment["UE2THREE_JOB_FILE"] = str(attempt / "request.json")
    script = Path(__file__).with_name("registry_extract.py").resolve()
    command = [snapshot["engine"]["executable"], str(project), "-run=pythonscript", f"-script={script}",
               "-unattended", "-nosplash", "-nullrhi", "-nosound", "-NoSourceControl", "-NoEpicPortal",
               "-NoAnalytics", "-stdout", "-FullStdOutLogOutput", f"-abslog={attempt / 'unreal.log'}"]
    started = time.monotonic()
    logger.event("engine-start", "Starting isolated Unreal Asset Registry inspection", task="engine_metadata", log=str(attempt / "unreal.log"))
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    with (attempt / "stdout.log").open("wb") as stdout, (attempt / "stderr.log").open("wb") as stderr:
        process = popen(command, cwd=project.parent, env=environment, stdin=subprocess.DEVNULL,
                        stdout=stdout, stderr=stderr, creationflags=flags)
        atomic_json(attempt / "process.json", {"pid": process.pid, "started": utc(), "command": command})
        last_progress = None
        try:
            while process.poll() is None:
                if time.monotonic() - started > timeout:
                    raise EngineError("ENGINE_TIMEOUT", f"Unreal exceeded {timeout}s; logs retained at {attempt}")
                try:
                    progress = read_json(attempt / "progress.json")
                    if progress != last_progress:
                        logger.event("engine-progress", progress.get("message", "Reading engine metadata"),
                                     task="engine_metadata", completed=progress.get("completed"), total=progress.get("total"),
                                     current_asset=progress.get("asset"))
                        last_progress = progress
                except FileNotFoundError:
                    pass
                time.sleep(0.25)
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
    if process.returncode:
        raise EngineError("ENGINE_EXIT_FAILED", f"Unreal exited {process.returncode}; see {attempt / 'stdout.log'}")
    if not (attempt / "registry.json").is_file():
        raise EngineError("ENGINE_OUTPUT_MISSING", f"Unreal produced no complete registry; see {attempt / 'stdout.log'}")
    data = read_json(attempt / "registry.json")
    if data.get("source_snapshot_hash") != request["source_snapshot_hash"] or data.get("project") != snapshot["project"] or not data.get("complete"):
        raise EngineError("ENGINE_OUTPUT_INVALID", "Output identity/completion does not match the source snapshot.")
    from scanner import source_files
    paths, omitted = source_files(Path(snapshot["project"]))
    actual = {path.relative_to(Path(snapshot["project"]).parent).as_posix(): file_hash(path) for path in paths}
    expected = {item["path"]: item["sha256"] for item in snapshot["files"]}
    if actual != expected or omitted != snapshot["omitted_links"]:
        raise EngineError("SOURCE_CHANGED_DURING_EXTRACTION", "Source changed while Unreal was reading it; resume for the new snapshot.")
    data.update(freshness="verified_snapshot", logs=str(attempt), source_snapshot_hash=request["source_snapshot_hash"],
                extraction_policy="Content registry only; original project code/plugins/startup scripts are not executed.")
    logger.event("engine-done", f"Unreal inspected {len(data['assets'])} source assets", task="engine_metadata", log=str(attempt))
    return data
