"""Export original Unreal SoundWave assets into a checked Three.js audio manifest."""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

from core import atomic_json, digest, file_hash, read_json
from engine_runner import prepare_project


class SoundMigrationError(RuntimeError):
    pass


_SAFE_PACKAGE = re.compile(r"^/Game/[A-Za-z0-9_/-]+$")


def select_soundwaves(inventory, registry, project, existing=(), requested=(), limit=4):
    if not isinstance(limit, int) or not 1 <= limit <= 4096:
        raise SoundMigrationError("Sound export limit must be 1..4096")
    sources = {item["package"]: item for item in inventory.get("assets", [])}
    available = {item["package"]: item for item in registry.get("assets", [])
                 if item.get("class") == "SoundWave" and _SAFE_PACKAGE.fullmatch(item.get("package", ""))}
    names = tuple(dict.fromkeys(requested)) if requested else tuple(sorted(available))
    if requested and any(name not in available for name in names):
        raise SoundMigrationError("Requested asset is not a witnessed SoundWave")
    prior = {item["package"]: item for item in existing if item.get("package") in available}
    records = []
    for name in names:
        row, asset = sources.get(name), available.get(name)
        if row is None or asset is None:
            continue
        if name in prior and prior[name].get("source_sha256") == row.get("sha256"):
            continue
        source = (Path(project).parent / row["path"]).resolve()
        if source != Path(project).parent and Path(project).parent not in source.parents:
            raise SoundMigrationError("Original SoundWave path escaped Content")
        if not source.is_file() or file_hash(source) != row["sha256"]:
            raise SoundMigrationError("Source SoundWave changed: " + name)
        basename = str(asset.get("object_name") or name.rsplit("/", 1)[-1]).removesuffix("_C")
        if not re.fullmatch(r"[A-Za-z0-9_-]+", basename):
            raise SoundMigrationError("Unsafe original SoundWave object name")
        records.append({"package": name, "asset": name + "." + basename,
                        "kind": "SoundWave", "source_sha256": row["sha256"],
                        "filename": "audio/" + row["sha256"] + ".wav", "source_file": str(source)})
        if len(records) >= limit:
            break
    return records


def validate_source_wave(path):
    path = Path(path)
    if not path.is_file() or path.stat().st_size < 44:
        raise SoundMigrationError("SoundWave export is missing or empty: " + str(path))
    with path.open("rb") as audio:
        header = audio.read(12)
    if header[:4] != b"RIFF" or header[8:12] != b"WAVE":
        raise SoundMigrationError("Original SoundWave export is not WAV")
    return file_hash(path)


def migrate_sounds(project, workspace, publish_dir, packages=(), limit=4, timeout=600):
    project = Path(project).resolve(strict=True)
    workspace = Path(workspace).resolve(strict=True)
    publish_dir = Path(publish_dir).resolve()
    original_root = project.parent
    if publish_dir == original_root or original_root in publish_dir.parents:
        raise SoundMigrationError("Cannot publish into original Unreal project")
    inventory = read_json(workspace / "artifacts/inventory.json")
    registry = read_json(workspace / "artifacts/engine_metadata.json")
    engine = read_json(workspace / "artifacts/engine.json")
    snapshot = read_json(workspace / "snapshot.json")
    if (registry.get("complete") is not True or
            Path(registry.get("project", "")).resolve() != project or
            registry.get("source_snapshot_hash") != digest(inventory.get("files", [])) or
            digest(snapshot) != read_json(workspace / "state.json").get("snapshot_hash")):
        raise SoundMigrationError("Verified original project inventory is required")
    old_path = publish_dir / "audio-manifest.json"
    old = read_json(old_path) if old_path.is_file() else {}
    if old and (old.get("schema_version") != 1 or old.get("project") != str(project)):
        raise SoundMigrationError("Existing audio manifest belongs to another source")
    existing = []
    for item in old.get("sounds", []):
        if not isinstance(item, dict) or not re.fullmatch(r"audio/[a-f0-9]{64}\.wav", item.get("filename", "")):
            continue
        try:
            if validate_source_wave(publish_dir / item["filename"]) == item.get("output_sha256"):
                existing.append(item)
        except SoundMigrationError:
            continue
    requested = select_soundwaves(inventory, registry, project, existing, packages, limit)
    if not requested:
        return {"status": "reused", "published": len(existing), "manifest": str(old_path)}
    if engine.get("status") != "detected" or not engine.get("executable"):
        raise SoundMigrationError("Matching Unreal Editor is needed for SoundWave export")

    engine_snapshot = {"project": str(project), "files": snapshot.get("files", []),
                       "omitted_links": snapshot.get("omitted_links", []), "engine": engine}
    scratch, _ = prepare_project(workspace, engine_snapshot, scratch_name="sound-export-v1",
                                 mirror_assets=True, included_packages={r["package"] for r in requested})
    run_dir = workspace / "audio" / "runs" / (str(time.time_ns()) + "-" + digest(requested)[:10])
    stage = run_dir / "output"
    stage.mkdir(parents=True, exist_ok=True)
    request_file, result_file = run_dir / "request.json", run_dir / "result.json"
    atomic_json(request_file, {"schema_version": 1, "source_project": str(project),
                               "original_content": str(original_root / "Content"),
                               "output": str(stage), "result": str(result_file), "sounds": requested})
    command = [engine["executable"], str(scratch), "-run=pythonscript",
               "-script=" + str(Path(__file__).with_name("unreal_sound_export.py").resolve()),
               "-unattended", "-nosplash", "-nosound", "-NoSourceControl", "-NoEpicPortal",
               "-NoAnalytics", "-stdout", "-FullStdOutLogOutput",
               "-abslog=" + str(run_dir / "unreal.log")]
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    env = os.environ.copy()
    env["UE2THREE_SOUND_JOB_FILE"] = str(request_file)
    with (run_dir / "stdout.log").open("wb") as out, (run_dir / "stderr.log").open("wb") as err:
        process = subprocess.run(command, cwd=scratch.parent, env=env,
                                 stdout=out, stderr=err, stdin=subprocess.DEVNULL,
                                 timeout=timeout, creationflags=flags, check=False)
    if process.returncode or not result_file.is_file():
        raise SoundMigrationError("Unreal sound export failed; see " + str(run_dir / "unreal.log"))
    results = read_json(result_file)
    if results.get("complete") is not True:
        raise SoundMigrationError("Sound exporter did not finish")
    by_package = {row["package"]: row for row in results["results"]}
    published = [*existing]
    for record in requested:
        item = by_package.get(record["package"], {})
        if item.get("status") != "exported":
            print("SOUND_BLOCKED", record["package"], item.get("error", "no exporter result"), flush=True)
            continue
        if file_hash(record["source_file"]) != record["source_sha256"]:
            raise SoundMigrationError("Original SoundWave changed during export")
        source = stage / record["filename"]
        sha = validate_source_wave(source)
        target = publish_dir / record["filename"]
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix(target.suffix + ".tmp")
        shutil.copyfile(source, temporary)
        if validate_source_wave(temporary) != sha:
            raise SoundMigrationError("SoundWave changed during publication")
        os.replace(temporary, target)
        published.append({k:record[k] for k in ("package", "asset", "kind", "source_sha256", "filename")}
                         | {"output_sha256":sha, "bytes":target.stat().st_size})
        print("SOUND_EXPORTED", record["package"], target.stat().st_size, flush=True)
    manifest = {"schema_version": 1, "project": str(project),
                "source_snapshot_hash": registry["source_snapshot_hash"],
                "sounds": sorted(published, key=lambda item:item["package"]),
                "limitations": ["SoundWave WAV only; SoundCue/MetaSound, attenuation and routing not yet migrated"]}
    atomic_json(old_path, manifest)
    return {"status": "exported" if len(published)-len(existing) == len(requested) else "partial",
            "attempted":len(requested), "published":len(published),
            "new":len(published)-len(existing), "manifest":str(old_path), "run_dir":str(run_dir)}
