"""Run inside an isolated Unreal editor process; export only verified SoundWaves."""
import json
import os
from pathlib import Path

import unreal


def _atomic(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")
    os.replace(temporary, path)


request_path = Path(os.environ["UE2THREE_SOUND_JOB_FILE"]).resolve(strict=True)
request = json.loads(request_path.read_text(encoding="utf-8"))
if request.get("schema_version") != 1 or not isinstance(request.get("sounds"), list):
    raise RuntimeError("Unrecognized source SoundWave export request")

destination = Path(request["output"]).resolve()
original_content = Path(request["original_content"]).resolve()
if destination == original_content or original_content in destination.parents:
    raise RuntimeError("Audio export cannot write into the original Unreal Content directory")
destination.mkdir(parents=True, exist_ok=True)
results = []

for index, source in enumerate(request["sounds"], 1):
    package = source["package"]
    filename = source["filename"]
    # Reject any path escape even when upstream verification is present.
    if not filename.startswith("audio/") or not filename.endswith(".wav") or \
            not all(part and part not in (".", "..") for part in Path(filename).parts):
        raise RuntimeError("Unrecognized SoundWave output filename")
    target = (destination / filename).resolve()
    if destination not in target.parents:
        raise RuntimeError("SoundWave output escaped staging")
    entry = {"package": package, "filename": filename, "status": "failed"}
    try:
        unreal.log(f"UE2THREE_SOUND_START {index}/{len(request['sounds'])} {package}")
        asset = unreal.EditorAssetLibrary.load_asset(package)
        if asset is None or not isinstance(asset, unreal.SoundWave):
            raise RuntimeError("Original package does not load as SoundWave")
        target.parent.mkdir(parents=True, exist_ok=True)
        task = unreal.AssetExportTask()
        task.set_editor_property("object", asset)
        task.set_editor_property("filename", str(target))
        task.set_editor_property("exporter", unreal.SoundExporterWAV())
        task.set_editor_property("automated", True)
        task.set_editor_property("prompt", False)
        task.set_editor_property("replace_identical", True)
        success = unreal.Exporter.run_asset_export_task(task)
        if not success or not target.is_file() or target.stat().st_size < 44:
            errors = task.get_editor_property("errors")
            raise RuntimeError("SoundExporterWAV failed: " + "; ".join(str(item) for item in errors))
        with target.open("rb") as audio:
            signature = audio.read(12)
        if signature[:4] != b"RIFF" or signature[8:12] != b"WAVE":
            raise RuntimeError("Original SoundWave exporter did not produce a WAV container")
        entry.update(status="exported", bytes=target.stat().st_size)
        unreal.log(f"UE2THREE_SOUND_DONE {package} {entry['bytes']}")
    except Exception as error:
        entry["error"] = str(error)
        unreal.log_error(f"UE2THREE_SOUND_FAILED {package}: {error}")
    results.append(entry)
    _atomic(request["result"], {"schema_version": 1, "results": results})

_atomic(request["result"], {"schema_version": 1, "results": results, "complete": True})
