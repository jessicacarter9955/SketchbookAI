# ue2three: offline migration toolkit

## Current release: one-click project analysis and supported GLB migration

The local manager scans an editable Unreal project, extracts its Asset Registry,
automatically prepares a character when it can match a mesh and animation set,
and exports inventoried levels through Unreal's glTF exporter. Valid level GLBs
are cached by their source dependencies, engine version, and exporter settings;
an unchanged project can reuse those outputs. The DDS character profile is only
used when its mesh exists in the selected project. Other projects use generic
asset detection.

Map exports contain only content the Unreal glTF exporter can represent, such as
supported geometry, transforms, materials, cameras, and lights. This does not
translate Blueprint execution, widget screens, dialogue, shops, inventory rules,
AI, networking, or physics/collision into Three.js behavior. The migration report
lists exported, reused, and failed maps and identifies unsupported content.
Processing completion remains separate from visual/gameplay fidelity.

No upload, AI, account, API key, network call, or package installation is needed.
Use Python 3.12+ and files already on disk. Unreal itself will be required for
engine package extraction; Blender will be optional for formats needing it.

## Run locally

### Web manager (Windows)

Double-click `tools/ue2three/start-web.vbs` to open the local project manager in
Chrome without showing a terminal. The `.uproject` field defaults to the DDS sample
path and **Sfoglia…** selects a different project. Press **Avvia** once. The
manager shows analysis, character preparation, map export, and the activity log;
when done, its scene list opens migrated Unreal levels or the playable Sketchbook
character scene as an alternative. No character recipe selection is required.

The manager listens only on `127.0.0.1:8766`; the Three.js preview server listens
on `127.0.0.1:8401`. The browser sends the selected project path to that local
server; it does not upload project files. Map previews are orbitable scene views,
not recreated Unreal game logic.

From this repository in PowerShell:

```powershell
.\ue2three scan "C:\Projects\MyGame\MyGame.uproject"
.\ue2three resume
.\ue2three dashboard
```

The Windows wrapper calls `python tools/ue2three/ue2three.py`. That Python entry
point also runs on other platforms. Output defaults to
`.local/ue2three/<project>-<path-hash>/`. A local pointer remembers the last scan
from the current working directory. To select a job explicitly:

```powershell
.\ue2three scan "C:\Projects\MyGame\MyGame.uproject" --workspace .local/ue2three/my-game
.\ue2three resume --workspace .local/ue2three/my-game
.\ue2three retry --task inventory --workspace .local/ue2three/my-game
.\ue2three skip --task registry --reason "Waiting for engine installation" --workspace .local/ue2three/my-game
.\ue2three revalidate --workspace .local/ue2three/my-game
.\ue2three report --workspace .local/ue2three/my-game
.\ue2three dashboard --workspace .local/ue2three/my-game --port 8766
```

Source and output must be separate, non-nested directories. Generated jobs get
their own ignore file and are not intended for Git. The dashboard binds only to
127.0.0.1, lists sibling job directories, shows real task statuses and hash
progress, and supports resume/retry/skip/revalidate, logs, reports and output.
Its progress describes six inspection tasks, not hypothetical conversion work.
Skipped tasks remain skipped and block their dependents; they never count as
successful conversion. The displayed quality remains "not evaluated".

## Existing workflow and reusable boundaries

| Reference | What works now | Manual decisions to extract next |
|---|---|---|
| `tools/export-dds.ps1` | Selects UE, creates a scratch export project and starts a local commandlet | Replace fixed engine/project assumptions with version adapters and capability probes |
| `tools/export-dds.py` | Uses Unreal's glTF exporter for mannequin, skeletal clips and two weapons; preserves logs and inventory | Replace fixed asset paths and action list with a migration recipe; validate outputs before publishing |
| `DdsAssets.js` | Loads model, clips and weapons, removes root travel, creates action aliases | Store skeleton, units, root-motion policy and action mapping in versioned manifests |
| `DdsCharacter.js` | Capsule locomotion, disjoint lower/upper animation tracks, additive recoil, grip and camera | Rig/socket mapping, attachment calibration and controller profiles per project |
| `DdsGame.js` / state / UI / population | Single-player shooting, ammo, inventory, loot, extraction, passive residents | Explicit gameplay modules; these are reconstructed behavior, not executable Blueprint imports |
| `CityRuntime` | GTA streaming/collisions and independent test scenes | A separate Unreal map adapter for actors, instances, transforms and collision |

The reference has 23 exported character sequences, a derived equip clip, and
weapon animation clips. It does not execute all source animations, Motion
Matching, original UI, Blueprint gameplay, AI or Steam multiplayer. The original
maps and the purchased source/exported assets remain local and unchanged.

## Architecture and state

`scanner.py` reads `.uproject`, Content, Config, Plugins and Source; it never
guesses an asset class from a filename. `.umap` files are identified as maps;
`.uasset` classification needs Unreal Asset Registry metadata. Nested filesystem
links are reported as omitted. Unknown package data is retained in inventory.
Other source file types are hashed and listed as unclassified, with a diagnostic.
Generated directories excluded from inspection are listed in the inventory.

`adapters.py` resolves engine associations from installed paths/Windows registry
and reads the installation's `Build.version`. Missing custom GUID associations
stay unknown. `--engine PATH` explicitly chooses an installation; mismatched
numeric versions produce diagnostics. Metadata inspection is version tolerant;
future export adapters must probe version-specific APIs before converting.

`pipeline.py` owns the dependency graph:

```text
project -> inventory -> registry --+
engine --------------------------+-> diagnostics -> report
project/inventory ----------------+
```

Every task records its status, attempts, input hash, dependencies and output
checksum. State and JSON artifacts are flushed and atomically replaced. OS locks
prevent concurrent mutation. Interrupted tasks become pending on resume;
corrupted/missing outputs invalidate dependent tasks. SHA-256 covers every source
byte, including same-size/same-timestamp changes. Unchanged task outputs are
reused. Hash verification currently reads source files again; it is deliberately
not a size/mtime cache. Invalidation is at inspection-task granularity, not yet
individual converted assets. Resume restarts an interrupted hash pass, then
continues from valid task checkpoints.

`run.log` is readable text, `events.jsonl` structured events, `progress.json` the
latest real stage/asset progress, `state.json` durable state, and `report.json` /
`report.md` processing results, diagnostic codes and unsupported capabilities.

## Optional engine metadata

`registry_extract.py` is an optional script for the matching Unreal editor's
Python environment. Set `UE2THREE_REGISTRY_OUT` to an absolute output path outside
the source, then execute it inside Unreal. It reads Asset Registry classes and
package dependencies without loading asset objects or saving packages. Opening
an Unreal project itself can execute its plugins. The stage-1 CLI does not launch
Unreal automatically.

Import its result using `scan` or `resume --registry PATH`. Project identity and
schema are validated; missing references are reported. Registry freshness remains
explicitly unverified because this version does not bind the registry export to
a source snapshot. `--without-registry` clears a previous import. This optional
engine script still needs cross-version execution tests; the import contract has
automated fixture coverage.

## Incremental roadmap / acceptance gates

1. **Done:** scan, diagnostics, engine discovery, resumable graph and initial job UI.
2. **Done and validated against local DDS UE 5.7:** generic configuration-driven character
   export through Unreal, source-byte fingerprints, staged resume, GLB validation,
   required-bone/attachment validation, root-motion policy, animation aliases,
   declared engine-plugin requirements, local runtime publishing and a playable
   Sketchbook `ue2three` profile.
3. **Character runtime verified:** root-motion filtering, aliases and 60-frame
   animation sampling for each of 23 DDS clips (with the generic runtime loader).
   Cross-skeleton retargeting and configurable semantic action maps remain open.
4. **Generic asset mounting implemented:** SkeletalMesh/StaticMesh attachments can
   be exported from config and mounted to a declared bone with a local transform;
   DDS rifle and pistol exports were validated against UE 5.7. Animation events,
   attachment calibration and shooting behavior remain open.
5. **Initial map export implemented:** UE glTF level export, a cached scene list,
   and per-map failure reports. DDS UE 5.7 testing is in progress; Blueprints,
   collisions, streaming and gameplay behavior remain outside this conversion.
6. Common gameplay object adapters with explicit reconstruction reports.
7. Blueprint metadata/dependencies, native modules and plugin compatibility analysis.
8. Conversion-quality validation, richer dashboard and multi-project regressions.

Every converter must produce staged outputs, validate them, then commit its
checkpoint. Failures must retain Unreal/Blender logs and stable error codes.
Unsupported shader graphs, skeleton/animation errors, textures, gameplay and
networking must be reported rather than silently replaced. Blueprint/C++ systems
cannot be assumed to become JavaScript automatically. A playable export needs
both converted assets and matching runtime behavior; "complete game" is a
project-specific acceptance test, not a file-count percentage.

## Verification

```powershell
python -m unittest discover -s tools/ue2three/tests -v
```

Tests cover interrupted/failed tasks, corruption, deleted and same-size changed
inputs, caching, skip/retry, locks, engine GUID/mismatch, registry identity,
read-only source boundaries, CLI and actual dashboard actions.

On 2026-10-05 filesystem scans passed against local DDS UE 5.7 (4,662 input files,
10 maps) and FortniteClone (1,061 input files; missing custom engine GUID clearly
reported). This validates inspection across two real projects, not conversion
fidelity. DDS runtime has separate browser tests for actual mannequin animation,
aim/fire, inventory, residents and GTA collision behavior.
