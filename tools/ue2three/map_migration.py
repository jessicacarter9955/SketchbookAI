"""Cache-validated Unreal level exports orchestrated by ue2three."""
import json
import os
import re
import struct
import subprocess
import time
from pathlib import Path

from core import atomic_json, digest, file_hash, read_json
from engine_runner import EngineError, prepare_project
from pipeline import load_state
from map_processing import (classify_empty_export_source, export_implementation_hash, read_raw_export,
                            store_raw_export, process_raw_export)


class MapMigrationError(RuntimeError):
    pass


def valid_glb(path):
    path = Path(path)
    try:
        with path.open("rb") as stream:
            header = stream.read(12)
        return (len(header) == 12 and header[:4] == b"glTF" and
                struct.unpack("<II", header[4:])[0] == 2 and
                struct.unpack("<II", header[4:])[1] == path.stat().st_size)
    except OSError:
        return False


def glb_summary(path):
    path = Path(path)
    empty = {key: 0 for key in ("mesh_count", "node_count", "material_count", "texture_count",
                                "image_count", "embedded_image_count")}
    try:
        with path.open("rb") as stream:
            header = stream.read(20)
            if len(header) != 20:
                return empty
            chunk_length, chunk_type = struct.unpack_from("<II", header, 12)
            document_bytes = stream.read(chunk_length)
        if chunk_type != 0x4E4F534A:
            return empty
        document = json.loads(document_bytes.decode("utf-8").rstrip(" \0"))
        return {"mesh_count": len(document.get("meshes", [])), "node_count": len(document.get("nodes", [])),
                "material_count": len(document.get("materials", [])),
                "texture_count": len(document.get("textures", [])),
                "image_count": len(document.get("images", [])),
                "embedded_image_count": sum("bufferView" in image or image.get("uri", "").startswith("data:")
                                            for image in document.get("images", []))}
    except (OSError, ValueError, UnicodeDecodeError, struct.error):
        return empty


def _slug(value):
    return "".join(char if char.isalnum() or char in "-_" else "-" for char in value).strip("-")[:72]


def _cached_map_matches(record, prior, target):
    return (prior.get("status") in {"exported", "reused"} and
            prior.get("fingerprint") == record["fingerprint"] and valid_glb(target) and
            prior.get("output_sha256") == file_hash(target))


def _cached_source_only_matches(record, prior, manifest_path, project):
    if (prior.get('status') != 'source_only' or prior.get('fingerprint') != record['fingerprint'] or
            not Path(manifest_path).is_file()):
        return False
    try:
        manifest = read_json(manifest_path)
        if (not isinstance(manifest, dict) or manifest.get('status') != 'source_only' or
                manifest.get('map_fingerprint') != record['fingerprint'] or
                manifest.get('project') != str(project) or
                prior.get('source_only_manifest_sha256') != file_hash(manifest_path)):
            return False
        source_root = Path(project).resolve().parent
        for item in record.get('source_files', []):
            source = (source_root / item['path']).resolve()
            if source_root not in source.parents or not source.is_file() or file_hash(source) != item['sha256']:
                return False
        return True
    except (OSError, ValueError, KeyError, TypeError):
        return False


def _write_empty_scene_manifest(record, target, project, workspace, snapshot_hash, geometry):
    from map_fixup import source_scene

    source_data, source_error = None, None
    try:
        source_data = source_scene(project, record['package'], workspace)
        if (not isinstance(source_data, dict) or source_data.get('project') != str(project) or
                source_data.get('map') != record['package']):
            source_data, source_error = None, 'Source reader returned a different project or map identity.'
    except (OSError, ValueError, KeyError, TypeError, RuntimeError, subprocess.SubprocessError) as error:
        source_error = f'{type(error).__name__}: {error}'
    classification = classify_empty_export_source(source_data)
    status = 'source_only' if classification['classification'] == 'source_meshless' else 'failed'
    actor_provenance = None
    if source_data:
        actor_provenance = {key: source_data.get(key) for key in
                            ('source_sha256', 'source_hashes', 'actors', 'actor_transforms', 'mesh_components')}
    detail = {'schema_version': 1, 'status': status, 'package': record['package'],
              'project': str(project), 'source_snapshot_hash': snapshot_hash,
              'map_fingerprint': record['fingerprint'],
              'source_files': record.get('source_files', []),
              'empty_export': geometry, 'source_classification': classification,
              'source_scene_error': source_error, 'actor_provenance': actor_provenance,
              'limitations': ['This sidecar preserves source actor identity and authored transforms; it contains no Three.js renderable geometry.',
                              'Serialized-source classification cannot rule out geometry spawned by native code at runtime.']}
    manifest_path = Path(target).with_suffix('.actors.json')
    atomic_json(manifest_path, detail)
    if status == 'source_only':
        error = 'No renderable geometry was exported; source actor provenance is available, but this is not a rendered map conversion.'
    elif classification['classification'] == 'source_geometry_present':
        error = 'No renderable geometry was exported although source components reference geometry; possible geometry loss.'
    else:
        error = 'No renderable geometry was exported and source data cannot prove the level is meshless.'
    return {'status': status, 'error': error, 'source_only_manifest': str(manifest_path),
            'source_only_manifest_sha256': file_hash(manifest_path),
            'source_classification': classification,
            'warnings': [source_error] if source_error else []}


def _merge_map_catalog(old, results):
    catalog = {key: {**value, 'verified_in_run': False} for key, value in old.items()}
    for result in results:
        catalog[result['package']] = {**result, 'verified_in_run': True}
    return sorted(catalog.values(), key=lambda item: item['package'])


def _unreal_failure_detail(log_path, exit_code):
    try:
        text = Path(log_path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return f"Unreal exited with code {exit_code} and did not write a result."
    match = re.search(r"Invalid Animation Sequence base state[^\r\n]*\r?\n[^\r\n]*", text)
    if match:
        return " ".join(match.group(0).split())[:700]
    match = re.search(r"Assertion failed:[^\r\n]*(?:\r?\n\[[^\r\n]+)?", text)
    if match:
        return " ".join(match.group(0).split())[:700]
    exception = re.search(r"Unhandled Exception:[^\r\n]*", text)
    if exception:
        mesh_error = next((line.strip() for line in reversed(text[:exception.start()].splitlines())
                           if "LogMeshUtilities:" in line and "distance field" in line.lower()), "")
        detail = exception.group(0).strip()
        return (detail + ("; " + mesh_error if mesh_error else ""))[:700]
    for line in reversed(text.splitlines()):
        if "LogPython: Error:" in line or "Critical error:" in line or "Fatal error:" in line:
            return line.strip()[-700:]
    return f"Unreal exited with code {exit_code} before producing a level result."


def _package_sources(package, inventory):
    return [item for item in inventory.get("assets", []) if item.get("package") == package]


def _dependency_packages(root, registry):
    by_package = {item.get("package"): item for item in registry.get("assets", [])}
    pending, found = [root], set()
    while pending:
        package = pending.pop()
        if package in found:
            continue
        found.add(package)
        entry = by_package.get(package)
        if entry:
            pending.extend(dep for dep in entry.get("dependencies", []) if dep not in found and not dep.startswith(("/Engine/", "/Script/")))
    return found



def _map_export_packages(root, registry):
    """Retain visual assets and the types needed to deserialize authored map actors.

    Blueprint parents, helper classes and nested structs can carry mesh/material
    defaults. Stripping them silently changes construction-script output.
    Animation and widget assets are exported through their own pipelines.
    """
    by_package = {item.get("package"): item for item in registry.get("assets", [])}
    included = {root}
    visual = {"StaticMesh", "SkeletalMesh", "Texture2D", "Material", "MaterialInstanceConstant",
              "MaterialFunction", "MaterialFunctionInstance", "MaterialParameterCollection",
              "MaterialFunctionMaterialLayer", "MaterialFunctionMaterialLayerBlend", "SubsurfaceProfile",
              "TextureCube", "Texture2DArray", "VolumeTexture", "TextureRenderTarget2D",
              "Skeleton", "PhysicsAsset", "SkeletalMeshLODSettings",
              "LandscapeLayerInfoObject", "LandscapeGrassType", "PhysicalMaterial"}
    authored_types = {"Blueprint", "BlueprintGeneratedClass", "UserDefinedStruct", "UserDefinedEnum",
                      "DataTable", "CurveTable", "DataAsset", "PrimaryDataAsset",
                      "CurveFloat", "CurveVector", "CurveLinearColor"}
    pending = [root]
    while pending:
        package = pending.pop()
        item = by_package.get(package, {})
        dependencies = list(item.get("dependencies", []))
        # Some registries expose inheritance only as a tag, not a dependency.
        parent = re.search(r"'(/[^']+)'", item.get("tags", {}).get("ParentClass", ""))
        if parent:
            dependencies.append(parent.group(1).split(".", 1)[0])
        for dependency in dependencies:
            if dependency.startswith(("/Engine/", "/Script/")) or dependency in included:
                continue
            child = by_package.get(dependency, {})
            if child.get("class") in visual | authored_types:
                included.add(dependency)
                pending.append(dependency)
    return included


def _select_map_packages(packages, map_package=None):
    packages = sorted(set(packages))
    if not map_package:
        return packages
    if map_package not in packages:
        raise MapMigrationError(f"Requested map is not present in the verified inventory: {map_package}")
    return [map_package]


def _map_record(package, inventory, registry, source_files, engine, implementation_hash, snapshot_hash, excluded_packages=()):
    package_items = []
    for dependency in sorted(_dependency_packages(package, registry)):
        package_items.extend(_package_sources(dependency, inventory))
    package_items = {item["path"]: item for item in package_items}
    paths = set(package_items)
    stems = {str(Path(path).with_suffix('')) for path in paths}
    # Split cooked/editor packages can carry their geometry and texture payload
    # in sidecars. Project configuration and native/shader source affect export
    # even when Asset Registry does not declare them as package dependencies.
    for path in source_files:
        suffix = Path(path).suffix.lower()
        if (suffix in {'.uproject', '.uplugin', '.ini', '.h', '.hpp', '.cpp', '.c', '.cs', '.ush', '.usf'} or
                suffix in {'.uexp', '.ubulk', '.uptnl'} and str(Path(path).with_suffix('')) in stems):
            paths.add(path)
    files = [source_files[path] for path in sorted(paths) if path in source_files]
    if not any(item.get("kind") == "map" for item in _package_sources(package, inventory)):
        raise MapMigrationError(f"No source map file exists for {package}")
    fingerprint = digest({"schema": 1, "package": package,
                         "engine": engine.get("version"), "implementation": implementation_hash,
                         "excluded_packages": sorted(excluded_packages),
                         "files": [{"path": item["path"], "sha256": item["sha256"]} for item in files]})
    name = _slug(package.rsplit("/", 1)[-1])
    return {"package": package, "filename": name + ".glb", "fingerprint": fingerprint,
            "source_files": [{"path": item["path"], "sha256": item["sha256"]} for item in files]}


def migrate_maps(project, workspace, publish_dir, logger, engine_override=None, force=False,
                 timeout=3600, popen=subprocess.Popen, map_package=None, allow_engine=True):
    project = Path(project).resolve(strict=True)
    workspace, publish_dir = Path(workspace).resolve(strict=True), Path(publish_dir).resolve()
    if project.parent == publish_dir or project.parent in publish_dir.parents:
        raise MapMigrationError('Published maps must stay outside the source project')
    state = load_state(workspace)
    if Path(state["config"]["project"]).resolve() != project:
        raise MapMigrationError("Inspection workspace belongs to another Unreal project")
    if state.get("source_verification_status") != "verified":
        raise MapMigrationError("Run project analysis and verify the source before exporting maps")
    inventory_path = workspace / "artifacts" / "inventory.json"
    registry_path = workspace / "artifacts" / "engine_metadata.json"
    engine_path = workspace / "artifacts" / "engine.json"
    snapshot_path = workspace / "snapshot.json"
    inventory, registry, snapshot = read_json(inventory_path), read_json(registry_path), read_json(snapshot_path)
    engine = read_json(engine_path)
    if digest(snapshot) != state.get("snapshot_hash"):
        raise MapMigrationError("The saved project snapshot does not match its verified workspace state")
    if (not registry.get("complete") or
            registry.get("source_snapshot_hash") != digest(snapshot.get("files", [])) or
            registry.get("project") != str(project)):
        raise MapMigrationError("Fresh Unreal Asset Registry metadata is required before map export")
    if engine_override:
        from adapters import detect_engine
        descriptor = read_json(project)
        engine = detect_engine(str(descriptor.get("EngineAssociation", "")), engine_override)

    packages = _select_map_packages(inventory.get("maps", []), map_package)
    if not packages:
        raise MapMigrationError("The project inventory contains no Unreal levels")
    publish_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = publish_dir / "map-manifest.json"
    old, excluded_packages = {}, set()
    try:
        saved = read_json(manifest_path)
        if saved.get("project") == str(project.resolve()):
            old = {entry["package"]: entry for entry in saved.get("maps", [])}
            excluded_packages.update(saved.get("excluded_incompatible_assets", []))
            for entry in saved.get("maps", []):
                log_path = entry.get("log", "")
                if not log_path:
                    match = re.search(r"see (.+?)(?:\"|$)", entry.get("error", ""))
                    log_path = match.group(1) if match else ""
                try:
                    log = Path(log_path).read_text(encoding="utf-8", errors="replace")
                except OSError:
                    continue
                excluded_packages.update(re.findall(r"AnimSequenceBase:(/Game/[A-Za-z0-9_./-]+)\.", log))
    except (OSError, ValueError, KeyError, TypeError):
        pass

    animation_classes = {"AnimBlueprintGeneratedClass", "AnimMontage", "AnimSequence", "AnimSequenceBase", "AnimComposite"}
    animation_packages = {item.get("package") for item in registry.get("assets", [])
                          if item.get("class") in animation_classes}
    animation_packages.discard(None)
    map_exclusions = excluded_packages | animation_packages
    included_packages = set().union(*(_map_export_packages(package, registry) for package in packages))
    implementation_hash = export_implementation_hash()
    source_files = {item["path"]: item for item in inventory.get("files", [])}
    records = [_map_record(package, inventory, registry, source_files, engine, implementation_hash,
                           state["snapshot_hash"], map_exclusions) for package in packages]
    map_dir = publish_dir / "maps"
    map_dir.mkdir(parents=True, exist_ok=True)

    results, pending = [], []
    actual_by_relative = None

    def verify_record_sources(record):
        nonlocal actual_by_relative
        if actual_by_relative is None:
            from scanner import source_files as walk_source_files
            actual_paths, _ = walk_source_files(project)
            actual_by_relative = {path.relative_to(project.parent).as_posix(): path for path in actual_paths}
        for source_record in record['source_files']:
            relative, expected_hash = source_record['path'], source_record['sha256']
            source = actual_by_relative.get(relative)
            if not source or file_hash(source) != expected_hash:
                raise EngineError('SOURCE_CHANGED_DURING_MAP_EXPORT', f'Source changed during map export: {relative}')

    def checkpoint():
        atomic_json(manifest_path, {'schema_version': 2, 'project': str(project),
                    'engine_version': engine.get('version'), 'source_snapshot_hash': state['snapshot_hash'],
                    'selected_packages': packages, 'maps': _merge_map_catalog(old, results),
                    'excluded_incompatible_assets': sorted(excluded_packages)})

    for record in records:
        target = map_dir / record["filename"]
        prior = old.get(record["package"], {})
        raw = None if force else read_raw_export(workspace, record['fingerprint'], project, record['package'])
        if raw:
            processed = process_raw_export(raw, target, project, workspace)
            results.append({**record, 'status': 'reused', 'output': str(target), **processed,
                            'fingerprint': record['fingerprint'],
                            'processing_fingerprint': processed['fingerprint'],
                            'warnings': raw.get('warnings', []) + processed['validation'].get('warnings', []),
                            'cache': {'raw_export': 'reused', 'postprocess': 'reused' if processed['reused'] else 'processed',
                                      'unreal_started': False}})
            logger.event('map-reuse', f"Riutilizzo export Unreal: {record['package']} · correzioni " +
                         ('in cache' if processed['reused'] else 'aggiornate offline'), task='map_export',
                         processing_seconds=processed['processing_seconds'])
            checkpoint()
        elif not force and prior.get('status') == 'source_only':
            actor_manifest = target.with_suffix('.actors.json')
            if _cached_source_only_matches(record, prior, actor_manifest, project):
                results.append({**prior, **record, 'status': 'source_only',
                                'source_only_manifest': str(actor_manifest),
                                'cache': {'source_only_manifest': 'reused', 'unreal_started': False}})
            else:
                verify_record_sources(record)
                geometry = glb_summary(target)
                fallback = _write_empty_scene_manifest(record, target, project, workspace,
                                                       state['snapshot_hash'], geometry)
                results.append({**record, **geometry, **fallback,
                                'cache': {'source_only_manifest': 'rebuilt', 'unreal_started': False}})
            checkpoint()
        elif not force and not prior.get('processing_fingerprint') and _cached_map_matches(record, prior, target):
            geometry = glb_summary(target)
            if geometry["mesh_count"] == 0:
                verify_record_sources(record)
                fallback = _write_empty_scene_manifest(record, target, project, workspace,
                                                       state['snapshot_hash'], geometry)
                results.append({**record, **geometry, **fallback,
                                'cache': {'source_only_manifest': 'created', 'unreal_started': False}})
                checkpoint()
                continue
            results.append({**prior, **record, "status": "reused", "output": str(target), "bytes": target.stat().st_size,
                            "warnings": prior.get("warnings", []), "output_sha256": prior["output_sha256"], **geometry})
            logger.event("map-reuse", f"Reused unchanged map {record['package']}", task="map_export", output=str(target))
            checkpoint()
        else:
            pending.append(record)

    if pending:
        if not allow_engine:
            raise MapMigrationError('An unchanged verified raw export is unavailable; offline mode will not launch Unreal')
        if engine.get("status") != "detected" or not engine.get("executable"):
            raise EngineError("ENGINE_MISSING", "The matching Unreal Editor installation was not detected.")
        engine_snapshot = {"project": str(project), "files": snapshot.get("files", []),
                           "omitted_links": snapshot.get("omitted_links", []), "engine": engine}
        exclusion_key = digest(sorted(map_exclusions))[:12] if map_exclusions else "clean"
        scratch, _plugin_mounts = prepare_project(workspace, engine_snapshot,
                                                  scratch_name="map-export-" + exclusion_key,
                                                  mirror_assets=True, excluded_packages=map_exclusions,
                                                  limit_shader_workers=True, included_packages=included_packages)
        script = Path(__file__).with_name("unreal_world_export.py").resolve()
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        logger.event("map-export-start", f"Exporting {len(pending)} Unreal levels with glTF Exporter",
                     task="map_export", maps=len(pending))
        for map_index, record in enumerate(pending, 1):
            run_dir = workspace / "maps" / "runs" / (str(time.time_ns()) + "-" + _slug(record["package"].rsplit("/", 1)[-1]))
            stage = run_dir / "output"
            stage.mkdir(parents=True, exist_ok=True)
            job_path, result_path, progress_path = run_dir / "request.json", run_dir / "result.json", run_dir / "progress.json"
            request = {"schema_version": 1, "source_project": str(project), "scratch_project": str(scratch),
                       "source_snapshot_hash": state["snapshot_hash"], "output": str(stage),
                       "result": str(result_path), "progress": str(progress_path), "maps": [record]}
            atomic_json(job_path, request)
            environment = os.environ.copy()
            environment["UE2THREE_MAP_JOB_FILE"] = str(job_path)
            command = [engine["executable"], str(scratch), "-run=pythonscript", f"-script={script}",
                       "-unattended", "-nosplash", "-AllowCommandletRendering",
                       # UE disables per-shader DDC for non-cook commandlets by default.
                       # Enable the editor's on-demand path instead of compiling every
                       # shader permutation of every material loaded with the level.
                       "-forceAllowShaderCompilerJobCache",
                       "-nosound", "-NoSourceControl",
                       "-NoEpicPortal", "-NoAnalytics", "-stdout", "-FullStdOutLogOutput",
                       f"-abslog={run_dir / 'unreal.log'}"]
            display_name = record["package"].rsplit("/", 1)[-1]
            logger.event("map-progress", f"Esporto livello {map_index}/{len(pending)}: {display_name}",
                         task="map_export", log=str(run_dir / "unreal.log"))
            failure = None
            started = time.monotonic()
            with (run_dir / "stdout.log").open("wb") as stdout, (run_dir / "stderr.log").open("wb") as stderr:
                process = popen(command, cwd=scratch.parent, env=environment, stdin=subprocess.DEVNULL,
                                 stdout=stdout, stderr=stderr, creationflags=flags)
                atomic_json(run_dir / "process.json", {"pid": process.pid, "started": time.time(), "command": command})
                previous = None
                last_notice = started
                try:
                    while process.poll() is None:
                        if time.monotonic() - started > timeout:
                            failure = f"[MAP_EXPORT_TIMEOUT] Unreal exceeded {timeout}s; logs retained at {run_dir}"
                            break
                        try:
                            progress = read_json(progress_path)
                            if progress != previous:
                                current_name = str(progress.get("package", "una mappa Unreal")).rsplit("/", 1)[-1]
                                logger.event("map-progress", f"{progress.get('message', 'Esporto livello')}: {current_name}",
                                             task="map_export", completed=progress.get("completed"),
                                             total=progress.get("total"), status=progress.get("status"))
                                previous = progress
                                last_notice = time.monotonic()
                        except FileNotFoundError:
                            pass
                        if time.monotonic() - last_notice >= 30:
                            elapsed = int(time.monotonic() - started)
                            stage_text = (previous or {}).get("message", "Preparo Unreal")
                            logger.event("map-progress", f"{display_name}: {stage_text} · {elapsed // 60} min {elapsed % 60:02d} s trascorsi",
                                         task="map_export", status="running", elapsed_seconds=elapsed)
                            last_notice = time.monotonic()
                        time.sleep(0.25)
                finally:
                    if process.poll() is None:
                        process.terminate()
                        try:
                            process.wait(timeout=10)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.wait()
            if failure:
                results.append({**record, "status": "failed", "error": failure,
                                "log": str(run_dir / "unreal.log")})
                logger.event("map-export-failed", failure, task="map_export")
                continue
            if not result_path.is_file():
                results.append({**record, "status": "failed", "error": _unreal_failure_detail(
                                run_dir / "unreal.log", process.returncode),
                                "log": str(run_dir / "unreal.log"), "engine_exit_code": process.returncode})
                logger.event("map-export-failed", f"Unreal did not finish {record['package']}; continuing with the next map",
                             task="map_export", log=str(run_dir / "unreal.log"), exit_code=process.returncode)
                continue
            exported = read_json(result_path)
            if exported.get("source_project") != str(project) or exported.get("source_snapshot_hash") != state["snapshot_hash"]:
                results.append({**record, "status": "failed", "error": "Unreal returned a result for a different project snapshot"})
                continue
            result = next((item for item in exported.get("results", []) if item.get("package") == record["package"]),
                          {"status": "failed", "error": "Unreal did not report this map"})
            if result.get("status") != "exported":
                results.append({**record, "status": "failed", "error": result.get("error", "Unreal failed to export this level"),
                                "log": str(run_dir / "unreal.log")})
                continue
            staged = stage / record["filename"]
            if not valid_glb(staged):
                results.append({**record, "status": "failed", "error": "The exported GLB header or byte length is invalid"})
                continue
            geometry = glb_summary(staged)
            if geometry["mesh_count"] == 0:
                verify_record_sources(record)
                fallback = _write_empty_scene_manifest(record, target=map_dir / record['filename'],
                                                       project=project, workspace=workspace,
                                                       snapshot_hash=state['snapshot_hash'], geometry=geometry)
                results.append({**record, **geometry, **fallback,
                                'log': str(run_dir / 'unreal.log'),
                                'cache': {'source_only_manifest': 'created', 'unreal_started': True}})
                checkpoint()
                continue
            verify_record_sources(record)
            target = map_dir / record["filename"]
            raw = store_raw_export(staged, workspace, record['fingerprint'], project, record['package'],
                                   warnings=result.get('warnings', []), source_hashes={
                                       str(project.parent / row['path']): row['sha256'] for row in record['source_files']})
            processed = process_raw_export(raw, target, project, workspace)
            results.append({**record, **processed, 'fingerprint': record['fingerprint'],
                            'processing_fingerprint': processed['fingerprint'],
                            'status': 'exported', 'output': str(target),
                            'warnings': raw.get('warnings', []) + processed['validation'].get('warnings', []),
                            'log': str(run_dir / 'unreal.log'),
                            'cache': {'raw_export': 'exported', 'postprocess': 'processed', 'unreal_started': True}})
            checkpoint()
            logger.event("map-export-done", f"Exported Unreal level {record['package']}", task="map_export",
                         output=str(target), bytes=target.stat().st_size)
            logger.event("map-progress", f"{display_name}: {geometry['mesh_count']} mesh, {geometry['material_count']} materiali, "
                         f"{geometry['image_count']} immagini esportate", task="map_export", **geometry)

    results.sort(key=lambda item: item["package"])
    counts = {name: sum(item["status"] == name for item in results)
              for name in ("exported", "reused", "source_only", "failed")}
    catalog = _merge_map_catalog(old, results)
    game_assets = registry.get("assets", [])
    widgets = sum(item.get("class") == "WidgetBlueprintGeneratedClass" for item in game_assets)
    blueprints = sum(item.get("class") in {"BlueprintGeneratedClass", "AnimBlueprintGeneratedClass"}
                     for item in game_assets)
    public_results = [{key: value for key, value in item.items() if key not in {"source_files", "fingerprint"}}
                      for item in catalog]
    report = {"schema_version": 1, "project": str(project), "engine_version": engine.get("version"),
              "source_snapshot_hash": state["snapshot_hash"], "counts": counts, "maps": public_results,
              "counts_scope": "selected_packages", "selected_packages": packages,
              "retained_map_count": sum(not item['verified_in_run'] for item in catalog),
              "excluded_incompatible_assets": sorted(excluded_packages),
              "omitted_animation_package_count": len(animation_packages),
              "inventory": {"widget_blueprints": widgets, "gameplay_blueprints": blueprints,
                            "asset_classes": registry.get("classes", {})},
              "limitations": [
                  "Exported maps preserve supported scene geometry, transforms, materials, cameras and lights.",
                  "Unreal collision data is not represented by glTF, so map collision and physics are not migrated.",
                  "Blueprint execution, Unreal widget screens, conversations, shops, inventory rules, AI and networking are not converted into running Three.js behavior by glTF export.",
                  "Map GLBs are static scenes. Animation assets are omitted only from a separate hard-link export mirror so UE 5.7 can inspect map geometry; character clips are migrated separately.",
                  "Unsupported or unresolved map actors are recorded in Unreal export logs; source assets remain unchanged."
              ]}
    checkpoint()
    report_path = publish_dir / "migration-report.json"
    atomic_json(report_path, report)
    if counts["exported"] + counts["reused"] + counts['source_only'] == 0:
        raise MapMigrationError(f"Unreal could not export any level; see {manifest_path}")
    logger.event("map-export-summary", f"Unreal maps exported/reused {counts['exported']}/{counts['reused']}; "
                 f"source-only {counts['source_only']}; failed {counts['failed']}",
                 task="map_export", report=str(report_path))
    return report
