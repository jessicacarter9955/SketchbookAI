# ue2three saved handoff · 2026-10-15

Latest source batch (2026-10-16): **107 translated /393 blocked**. Added exact
UE5.7 Lerp, FMin/FMax and InRange_FloatFloat primitives. Original
CalculateDamageFalloff and Get_MovementDirectionFromThresholds now execute.
Fixed const reference inputs incorrectly classified as outputs: require their
input values, exclude them from outputs and reject writes/output bindings to
const inputs. Mutable reference parameters require initial input too.
Only one extra source type was parsed: S_MovementDirectionThresholds, 6,814 bytes.
Its original constructor has zero thresholds; tests also use -60/60/-120/120
from one original source branch. The full cvar/configuration dispatcher remains
blocked and no runtime movement/animation state machine was replaced.
104 Python/64 JS tests and editor build pass. Audit: 321 generic +326 source
comparisons (14 damage and 17 direction cases added). Evidence is saved under
verification/source-character-math/. Editor revision16, optional chunk421.
Next inventory dependency: GetItemData calls original GetDataTableRowFromName,
with TextProperty/ObjectProperty fields in S_ItemData; do not discard these
fields or invent item records to bypass blocked functions.

Newest checkpoint: **105 translated /395 blocked**. Added exact UE5.7 int Min,
Max, SelectInt and Conv_IntToDouble primitives after inspecting local Engine
source. CalculateReloadAmmo now executes with 12 manual source comparisons;
negative and over-capacity inputs remain un-clamped, matching the source graph.
101 Python/63 JS tests and editor build pass. Browser: 315 generic +295 source
cases. Scene: 24 inputs /35 metrics /4 events /160 inventory checks; horizontal
movement 0.660 units. Evidence: verification/source-reload/. Editor revision15.
Full reload timing, firing, inventory writes and original notification/network
paths are NOT complete. Array mutation calls and OnRep multicast/dirty native
calls still block whole source functions. No side effect was silently discarded.
Fixed report table overflow exposed by multi-output reload results; corrected
UTF-8 text damaged by an intermediate Windows-default encoding read before save.

Current batch: **104 translated /396 blocked**. Exact Array_Length source adapter
unlocks CountItemByID, FindItemByID and HasItemByID. Added 24 independent source
cases (283 total), including empty arrays, missing IDs, case-insensitive names,
first-match searches, negative quantities and int32 maximum. Source CountItemByID
returns the LAST matching quantity, not a stack sum; original behavior preserved.
100 Python/62 JS tests and editor build pass. Native browser: 312 generic +283
source cases; real scene: 24 inputs +35 metrics +4 events +148 inventory reads,
0.671 horizontal displacement. No browser errors. Evidence:
uild/local-scenes/ue2three/verification/source-search/. Editor revision14.
10 scoped checkpoints verified; the full inventory/game systems remain yellow/red.
Next: original inventory mutations and notifications, typed object/native adapters.

Newest batch supersedes counts below: **101 translated /399 blocked**, six empty
functions and 56 event callbacks without game effects. Added original
GetSlotData, IsSlotEmpty, GetEquippedWeapon, GetWeaponModData: **124 independent
source cases** cover fixed slots, four arrays, negative/out-of-range indices,
empty/nonempty items, equipped slots and mod selection. These are source data
reads, not complete inventory UI, equip mutations, saves or combat bindings.
99 Python/62 JS tests and editor build pass. Browser: 303 generic +259 source
cases; real scene: 24 input +35 metrics +4 event +124 inventory read checks, with
0.757 horizontal displacement. Screenshots/DOM proofs:
`build/local-scenes/ue2three/verification/source-inventory/`. Editor revision13.
The optional live verification chunk is now **build/421.editor.min.js**; ship it
with editor.min.js. Older 519 remains the previous compatible asset.
`blueprint_types.py` reads original primitive UserDefinedStruct defaults and enum
numeric mappings. Only S_InventorySlot (15,937 bytes) and E_InventorySlot_Fixers
(7,801 bytes) were parsed additionally, using the existing bounded parser.
Arrays are copied via the exact Engine.KismetArrayLibrary.Array_Get context;
invalid indices restore original defaults (e.g. CurrentHP=-1) and emit warnings.
Other contexts, nested structs, unsupported types and array mutation stay blocked.
Program file shrank from 25,416,759 to 1,172,793 bytes despite four added functions;
shared fixture baselines reduced 2,006,308 to 293,181 bytes without dropping cases.
`ue2three-fixtures.mjs` verifies baseline package/type hashes before reusing them.
Source quirk preserved: mod enum6 checks Grip for Found but returns Muzzle. No
Unreal asset/game rule was changed. Next: Array_Set/Add/remove/length, inventory
mutations/notifications, typed native/object adapters and source event scheduling.

Latest batch: constant source event entry specialization and per-instance
persistent frames are implemented. Current result: **97 translated / 403 blocked**,
including six directly empty callbacks and **56 event callbacks without game
effects**. Two new useful state paths: Set_CharacterInputState and
ResetSlideCooldown. Do not claim full animation/gameplay from the callback count.
58 internal entry helpers have 515 compact instructions; source graph indices,
offsets and hashes are preserved. Helpers are not counted again as functions.
94 Python and 60 JS tests pass; browser audit 291 generic +135 source cases;
live scene 24 input +35 metric +4 event state cases. Evidence is in
`build/local-scenes/ue2three/verification/source-events/`. Editor revision12.
Runtime snapshots now include `{states, frames}`. Event compilation lives in
`blueprint_events.py`; compiler cache keys include that module. Unknown reachable
effects, native calls/timers/cross-object calls/replication still block callers.
The older numerical snapshot below documents the previous batch.

Branch: `chatgpt/ue2three-dds`. Workspace/repo:
`C:/Users/jessi/Documents/Codex/2026-10-01/cl/SketchbookAI`.

## User constraints

- Expand the generic ue2three converter; DDS is the current test project.
- Translate original logic; do not invent substitutes or use pixel streaming.
- Animations stay yellow, **assumed functioning for now**, fidelity work deferred.
- Lighting last. Prioritize character, Blueprint, inventory/interactions and other systems.
- Do not open Unreal now. Use cached exports; parse bounded source packages only when needed.
- Show verification in Codex's integrated browser and save screenshots.
- Update the status table and push successful batches to the branch above.

## Durable local outputs

- Source: `C:/Users/jessi/OneDrive/Desktop/unreal/VIPDDSExtractionKitv2.1/VIPExtractionKitDDS.uproject`.
- Cache: `.local/ue2three/ui-check/jobs/VIPExtractionKitDDS-23a280ac11`.
- Parsed source JSON: cache's `artifacts/uasset-json/`, keyed by source SHA-256.
- Published project: `build/local-scenes/ue2three/projects/VIPExtractionKitDDS-23a280ac11`.
- Character: `build/local-scenes/ue2three/current/` (45 clips, two attachments).
- Reports: project `blueprint-programs.json`, `progress.json`, `progress.html`.
- Screenshots/audits: `build/local-scenes/ue2three/verification/blueprint-runtime/`.

These generated outputs and source caches stay local and are not committed game
assets. Tool code, built editor and this checkpoint are saved in Git.

## Exact current scope

39 translated functions: 33 with source behavior and six empty
callbacks. 461 functions are blocked in parsed packages; 60 delegate signatures
are declarations; 263 Blueprint/widget/animation packages are not parsed yet.
Original whole-game fidelity is not established. Most gameplay logic, Motion
Matching/Mover, latent actions, RPC/replication and native simulation remain open.

Runtime compiler: `tools/ue2three/blueprint_migration.py`.
Interpreter: `src/editor/ue2three-blueprint.mjs`.
Browser proof: `ue2three-blueprint.html`, `tools/ue2three/blueprint-audit.mjs`.
Shared socket transform: `src/editor/ue2three-attachment.mjs`.

## Resume steps

1. Check Git status/branch and remote divergence before changing files.
2. Read `blueprint-programs.json` blocked reasons and corresponding cached JSON.
3. Static control flow is now implemented with validated Kismet **memory offsets**.
   Extend only known layouts. `ScriptBytecodeSize` and instruction-boundary
   checks must continue rejecting unknown layouts or malformed destinations.
4. Same-source-class calls/out parameters are implemented. Next add cross-object
   calls, persistent-frame event dispatch and native adapters incrementally, with
   exact source ownership and explicit unsupported dependencies.
5. Connect complete translated paths to runtime only when their required state
   and native dependencies exist; getters alone do not make a game system green.
6. Regenerate reports, check in the integrated browser, save screenshots, push.

Last isolated browser result: 39 functions / 117 generic scenarios + 131 DDS comparisons
passed. Cases live in `tests/fixtures/dds-blueprints.json`; their bytecode hashes
must match the parsed source. Open the Blueprint audit with
`&fixtures=dds-blueprints.json` for these DDS-specific comparisons. Animation
checks remain deferred. Native preview server supports `pythonw` without stderr.

The real player now has original sprint/jump prerequisites mounted by
`src/editor/ue2three-blueprint-runtime.mjs` and `Ue2ThreeGameplay.js`. State uses
source class defaults; the complete input event graph/Mover and stamina drain
remain untranslated. Live QA URL is the normal editor/map URL plus
`&verify_blueprints=1&source_cases=dds-blueprints.json`. It checks real action flags,
briefly moves the character and restores fixture state. Save its DOM proof
`#live-blueprint-proof` and screenshots under verification/blueprint-live/.

The editor build now also emits `build/519.editor.min.js`; commit that chunk with
`build/editor.min.js`. Each player reset receives fresh source component state.

Latest completed verification: 87 Python tests, 59 JavaScript tests, successful
editor build, 117 generic and 131 DDS source comparisons, and 24 live player-input
plus 35 metric cases. The live movement check recorded 0.456 horizontal scene units; fixtures restored
stamina 100. A player restart visibly retained defaults. Saved evidence:
`build/local-scenes/ue2three/verification/source-structs/scene.jpg` and
`live-inputs.json`. Animations remain assumed working with fidelity deferred.

`ue2three-native-math.mjs` implements supported Kismet primitives. Ratio getters
are detected from source expressions and appear in `character_metrics`; runtime
metric caching uses package/function identity and source state. Progress greens
are tied to `blueprint-live-verification.json` and its screenshot/program hashes.

The blocker planner (`blueprint_planning.py`) automatically runs after the CLI
Blueprint migration and reuses checksummed artifacts. It publishes
`blueprint-plan.html` and three `work-packets/*.md` files for optional GLM/ChatGPT
collaboration. Current first blocker counts: events 173, objects 69, structs 23;
232 wrappers call shared event graphs. Candidate family counts overlap. See
`docs/ue2three-acceleration.md` for the measured scope and parallel work contracts.

Struct member reads and ASCII FName comparisons are implemented. Original
MapBoneToRegion is verified on 28 source cases; hit detection/damage are still
unconnected. Audit UI can filter functions and expand actual source comparison
results. Its DOM evidence is in #blocked and includes program identity/hashes.

## Reuse commands (for the coding agent; no user terminal work needed)

```powershell
C:/Python312/python.exe tools/ue2three/ue2three.py migrate-blueprints C:/Users/jessi/OneDrive/Desktop/unreal/VIPDDSExtractionKitv2.1/VIPExtractionKitDDS.uproject --workspace .local/ue2three/ui-check/jobs/VIPExtractionKitDDS-23a280ac11 --publish-dir build/local-scenes/ue2three/projects/VIPExtractionKitDDS-23a280ac11
C:/Python312/python.exe tools/ue2three/ue2three.py progress --workspace .local/ue2three/ui-check/jobs/VIPExtractionKitDDS-23a280ac11 --publish-dir build/local-scenes/ue2three/projects/VIPExtractionKitDDS-23a280ac11 --character-dir build/local-scenes/ue2three/current
C:/Python312/python.exe -m unittest discover -s tools/ue2three/tests -q
npm test
node node_modules/webpack/bin/webpack.js --config webpack.editor.js
```

`--read-package /Game/...` explicitly populates a missing parser cache from an
isolated copy. Do not schedule all packages; reuse the four already parsed core
components and select the next dependency from actual blocked call paths.
