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

### Independent map export and offline correction caches

New exports keep immutable raw GLBs under `maps/raw/<fingerprint>.glb` in the
inspection workspace. Export fingerprints cover source dependencies (including
package sidecars), project/configuration and native/shader source, engine version
and export implementation. Editing offline corrections no longer forces
another Unreal export. Processing starts from those raw bytes, checks their
checksum and source dependencies, and caches the corrected GLB plus its source
and validation sidecars independently. Corrupt outputs or missing diagnostics
are reprocessed; corrupt raw exports and changed source dependencies are refused.
Source project files are never used as output destinations.

`migrate-maps --offline` permits only cache reuse and offline processing. It
fails explicitly when a matching raw export is unavailable, without starting
Unreal. Legacy export fingerprints are not silently treated as the new contract.
The DDS verification below uses its earlier cached export with explicit legacy
provenance, rather than asserting a new source export took place.

Selective exports retain the other map catalog entries. Each completed map is
checkpointed, and retained entries have `verified_in_run: false`: they remain
selectable but are not presented as freshly verified or sent through another
screenshot job. Report counts describe only the selected batch.

The lightweight DDS replay checked 152 explicitly authored actor transforms,
found zero mismatches and skipped one actor requiring a world-space comparison.
These checks cover stored local translation/rotation/scale values, not inherited
Blueprint defaults or every mesh in the level. The preview exposes the counts
under **Controlli della scena**, alongside the 3,072 repaired terrain vertices,
eight material fallbacks and approximate lighting.

Two local measurements of offline processing showed reductions of roughly
75–86% on the cached second pass (0.66→0.09 seconds when idle, 4.05→1.03 seconds
while tests were running). These are observations of this phase on this laptop,
not a total migration speed estimate. No Unreal or external parser process was
allowed during this DDS replay.

Material inspection identified 91 expression nodes in `M_Grid`, but its root
connections remain an undecoded `MaterialEditorOnlyData` raw export. Parameter
tints are therefore still fallbacks; shader composition and lighting fidelity
remain open. Windows JSON reads now briefly retry transient sharing errors,
matching the existing atomic-write retry. Persistent errors and invalid JSON
still raise errors instead of becoming successful empty state.

This batch passed 61 Python tests and 36 JavaScript tests. The published DDS
GLB loaded in the integrated browser in overview, ground and material-detail
views with no captured console errors. Local screenshots are stored under
`build/local-scenes/ue2three/verification/offline-cache/`. This verifies loading
and the visible checks panel; it does not establish complete shader fidelity.

### Visual map verification

Map exports now run an offline source check using the cached UAssetAPI reader.
Landscape vertices outside the authored `CachedLocalBox` are repaired only when
the source bounds are almost flat, at least 75% of exported heights are valid,
and all valid heights agree. Non-flat or insufficient data is reported and left
unchanged. The GLB and `.validation.json` retain the repair diagnostics.

Mesh-dependent material baking preserves world-aligned patterns. Eight materials
in the local DDS RaidMapTest bake returned magenta constants; source parameter
tints are used as an explicitly reported fallback for those failed bakes.
Successful textured bakes are preserved without applying the source tint twice.
This does not establish shader fidelity for the fallback materials.

After migration, the manager runs Chrome screenshot verification at 1120×700
in three fixed views: overview, source player spawn (when available), and detail.
It checks browser/resource failures, non-finite vertices, empty/uniform renders
and views that are more than 85% nearly black. Each scene has a local screenshot
gallery and JSON report in its `verification` directory, selectable in the
manager. Status `captured` means these checks completed, not full Unreal fidelity.
Punctual source lights and shadows are retained in the map viewer; Unreal
SkyLight/Lumen, exposure and postprocessing are not fully translated and the
viewer explicitly identifies its ambient-light approximation. A neutral reflection
environment keeps reflective PBR surfaces visible; it is not an exported SkyLight
capture. Detail cameras select nearby colored props and check sight lines without
relying on DDS actor names.

Screenshots are cached by GLB, viewer and audit-script hashes and validated by
their own checksums. No repeated Unreal run is needed to verify a cached GLB.
The browser audit reuses an installed Chrome and Playwright package (project
installation, `UE2THREE_PLAYWRIGHT_PATH`, or the Codex bundled runtime). It does
not download software. Missing browser dependencies produce a visible failure
report, never a successful verification. Browser startup/timeout failures also
replace any stale gallery rather than displaying old screenshots as new evidence.
The preview server serves the existing bundles without starting a webpack watcher.

#### DDS evidence, 2026-10-11

The cached mesh-dependent RaidMapTest export was corrected and published without
launching Unreal: 6 shared landscape position buffers contained 3,072 invalid
heights (instanced across 12 components). Authored flat bounds allowed their
replacement; the scene minimum Y changed from -256 m to approximately -0.56 m.
The reused bake contains 214 embedded images, with 8 reported tint fallbacks.
Three Chrome views loaded without browser/resource errors; a second verification
reused the checksummed screenshots. This is a static map preview, not proof of a
complete playable game or equivalent Unreal lighting. The local evidence is in
`build/local-scenes/ue2three/projects/<project-id>/verification/<map-name>/`.
Windows dashboard polling also exposed a transient `WinError 5` on state-file
replacement; atomic JSON writes now retry sharing failures briefly while keeping
the prior state intact. Persistent failures are still raised. The batch passed
48 Python tests and 29 JavaScript tests.
The integrated browser exposed an additional stale-model cache issue: changing
the page URL did not invalidate the GLB request. Asset URLs now include the
published content revision; links opened without a revision resolve it from the
local map manifest. Source exports remain cached on disk.

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

### Cached material graphs and project checklist · 2026-10-12

The generic offline reader recovers native material input connections omitted
from cached package JSON. DDS M_Grid now has 66 direct connections preserved in
the source sidecar; nested functions and shader execution remain unsupported.
The manager and level preview link to a generated checklist of 18 project areas
and scoped completed checkpoints. Lighting is the last priority.
See the [complete checklist and verification scope](ue2three-progress.md).

Generate it from existing metadata without opening Unreal or rescanning:

```powershell
python tools/ue2three/ue2three.py progress --workspace WORKSPACE --publish-dir PUBLISHED_PROJECT --character-dir PUBLISHED_CHARACTER
```

Missing/corrupt published files or changed report code invalidate the checklist
cache. Source graph reading changes invalidate only offline map processing;
existing raw exports remain reusable. A checklist green is a completed scoped
checkpoint; full-game fidelity is a separate acceptance gate.

### Lightweight map presentation batch · 2026-10-11

The level preview and playable imported level share `map-presentation.mjs`.
Both use the exported map checksum to version GLB requests, source punctual
lights, ACES exposure 1, sRGB output, and the same explicitly approximate neutral
reflection/ambient environment. The playable level hides the playground sky and
its lights. Shadows are limited to one source directional light at 2048 pixels;
other source lights retain their color and intensity without shadow allocations.

Native browser screenshots exposed an additional playable-rendering discrepancy:
the FXAA composer returned linear pixels without final sRGB encoding, making the
level much darker than the direct-rendered preview. A final gamma correction pass
now encodes the output once. Direct rendering with FXAA disabled already encodes
via the renderer. This batch reuses existing exports and does not launch Unreal.

| Area | Status | Remaining acceptance work |
| --- | --- | --- |
| Map geometry | Partial | Full source transform/dimension comparison; the bounded flat-landscape spike repair is retained |
| Materials/textures | Partial | Translate missing shaders beyond the eight parameter tint fallbacks |
| Lighting | Partial | Source SkyLight, exposure, postprocessing and lighting fidelity; shared presentation is implemented |
| Cache/output regression checks | Passed | Checksum URL, missing manifest fallback, shadow budget and single output encoding have automated coverage |

Screenshot cache fingerprints include the shared presentation module, so a
lighting change cannot reuse old visual evidence. Browser screenshots confirm
appearance for the tested map; they do not prove complete Unreal fidelity or
correctness of the character's materials, animations and weapon attachments.

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
