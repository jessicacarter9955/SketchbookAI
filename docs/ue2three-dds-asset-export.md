# DDS Unreal → GLB automatic asset lanes

`tools/ue2three/dds_asset_export.py` is a checkpointed asset exporter supervisor.
It **reuses**, rather than duplicates, the existing source-verified `ue2three.py`
`migrate-character` and `migrate-maps` commands. It does not change the four
independent Blueprint/Codex workers. The only remaining human acceptance is
**Play** (visual, animation, gameplay and fidelity checks).

## Starting the Windows supervisor

Use a separate clean DDS integration checkout and the **existing verified**
ue2three scan workspace. The workspaces and publication directory must be outside
the original Unreal project, and separate from each other.

```powershell
py -3 tools/ue2three/dds_asset_export.py --once `
  --project "C:\Users\jessi\OneDrive\Desktop\unreal\VIPDDSExtractionKitv2.1\VIPExtractionKitDDS.uproject" `
  --map-workspace "C:\path\to\existing\verified\ue2three-workspace" `
  --publish-dir "C:\path\to\isolated\SketchbookAI\build\local-scenes\ue2three" `
  --state-dir "C:\path\to\isolated\SketchbookAI\.local\ue2three\asset-export" `
  --engine "C:\Program Files\Epic Games\UE_5.7" `
  --max-parallel 2
```

`--once` makes one batch, reusing valid original-source-matched exports and
recording failures; `--run` is the same command. To keep it running between
ChatGPT turns (while Windows stays powered and the user is logged in), change
`--once` to `--loop --interval-seconds 300`. A Windows Scheduled Task can also
execute `--once` every five minutes. Concurrent invocations in the same
checkpoint directory are stopped by an OS-backed lock. If **another Codex chat
is already exporting maps** with the existing ue2three workspace, the maps lane
reports `blocked` and retries on the next tick; it does **not** interrupt or
overwrite that map batch. Character export uses a distinct workspace and can
proceed at the same time.

For a PC with limited RAM, use `--max-parallel 1` to serialize the two Unreal
lanes. To prohibit a new source scan, add `--no-scan`. By default missing/stale
scan metadata triggers `ue2three.py scan` in the separate workspace; it never
requests a browser upload. Missing original `.uasset`/`.umap` files or an
unavailable Unreal editor are reported `blocked`/`failed`, **not converted**.

Status without starting any process:

```powershell
py -3 tools/ue2three/dds_asset_export.py --status `
  --state-dir "C:\path\to\isolated\SketchbookAI\.local\ue2three\asset-export"
```

## Live dashboard telemetry and evidence

The dashboard reads `.local/ue2three/asset-export/progress.json` directly,
updated atomically every three seconds while an actual subprocess is running.

```json
{
  "schema_version": 1,
  "updated_at": "2026-10-22T10:00:00+00:00",
  "heartbeat_at": null,
  "phase": "not_started",
  "status": "not_started",
  "running": false,
  "assets": {
    "discovered": 0,
    "eligible": 0,
    "converted": 0,
    "verified": 0,
    "failed": 0,
    "skipped": 0
  },
  "progress": {"percent": null, "basis": "unknown", "description": "Waiting for verified inventory"},
  "jobs": [],
  "outputs": {"manifest_path": null, "published_dir": "...", "source_root": "..."},
  "error": null,
  "notes": []
}
```

Each job has `id` (`character`/`maps`), `status`, `running`, `completed`,
`total`, `percent`, `started_at`, `heartbeat_at`, `log`, `manifest`, `error`,
`process_id`, `attempts` and verified `outputs`. Percent is
`verified GLB outputs / expected outputs`, and is **null** until an exact
denominator is established. `character` targets are source recipe mesh + clips
+ attachments; `maps` targets are verified inventory level packages. A
`source_only` level, malformed GLB, missing mesh, stale source snapshot or
missing original asset cannot become green by simply returning exit code zero.

The final checkpoint `.local/ue2three/asset-export/manifest.json` lists
verified files with sizes, SHA-256 and original source identities. Files under
`<publish-dir>/dds-assets/character` and `<publish-dir>/dds-assets/maps` remain
private/local; the supervisor does not push licensed GLBs, deploy them to a
public host or mark a live playable build as accepted. Logs
`character.log`/`maps.log` show the underlying ue2three process and failure
evidence. Source packages are never overwritten by this supervisor; existing
UE extraction routines work through their own scratch project and verify
source inputs, and the character source fingerprint is rechecked after export.

Running two GLB lanes is **not** four simultaneous map instances: `migrate-maps`
already processes map packages individually with source-aware, resumable
checkpoints. The additional four Codex workers handle Blueprint functions.
The all-green condition still requires integration into Three.js, runtime
collision and animation checks, scene Play and user acceptance after conversion.

## Source plugin fidelity in isolated map exports

Unreal world exports run in a temporary Content-only mirror. Unlike the registry
inspector, that map mirror now loads **installed stock engine plugins explicitly
enabled by the source `.uproject`**, plus the built-in `EnhancedInput` and
`Niagara` serializers unless explicitly disabled by the original project.
This matters for Blueprint input structs and Niagara scene objects: omitting
these plugins can deserialize valid original assets as unknown types, resulting
in lost data and compiler errors. The source project and packages are never
edited. The exporter continues to disable other default plugins and refuses
project-native, Marketplace, network, and assistant integrations.

`engine/<map-export-scratch>/.ue2three-engine-plugin-provenance.json` lists
the exact stock modules enabled and any omitted or invalid source plugin
descriptors (for example an unavailable plugin). An omission is **not** proof
that the corresponding logic has been translated. Adding serializers also does
not by itself establish a valid `GalleryLevel` GLB or 1:1 runtime behavior;
the next targeted Unreal export, geometry/material checks, and Play remain
required. Existing exports are invalidated by the changed exporter fingerprint
when reprocessed.

The first PC trial found an independent Unreal 5.7 startup failure inside the
stock `MetaHumanCharacter` plugin: its own
`/MetaHumanCharacter/Face/ARKit/AS_MetaHuman_ARKit_Mapping` sequence has no
usable animation data model. That plugin and the unrelated movie-render and
modeling-editor interfaces are omitted from the **map export mirror only**,
with their names and exact reasons retained in the provenance report. This
preserves the source and avoids treating an unrelated editor-plugin crash as
proof that the DDS level cannot be migrated. MetaHuman-specific content, if
referenced by a DDS scene, still requires its own compatible export path.
