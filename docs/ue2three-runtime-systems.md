# Runtime systems batch · 2026-10-22

This branch starts at `bf45d2f`, separately from the active DDS integration and
asset-export workers. It does not modify their checkpoints, stop their processes,
launch Unreal, rescan DDS or copy its GLBs. Its preview uses the existing exports.

## Delivered

* `BlueprintActorRuntime.onCommittedEffects` delivers future committed audio/VFX
  requests to browser adapters. Failed interpreter transactions deliver nothing.
  Restoring a snapshot does not replay historical side effects.
* `NativeEffectBridge` provides ordered asynchronous delivery, bounded pending
  work, bounded receipts, explicit missing-adapter errors and disposal. An adapter
  failure does not retroactively roll back already committed Blueprint state.
* QA temporarily suppresses external delivery while preserving source effect
  records for comparisons. Thus source fixtures cannot accidentally play real
  sounds while temporarily changing inventory/state.
* `SourceComponentEffects` binds exact original native-component identities to
  audio gain and translated Niagara linear-color parameter targets. No component
  or particle system is synthesized when a binding is missing.
* `SourceWaveAudio` plays a restricted, verified local SoundWave UI/2D subset via
  Web Audio, reusing SHA-256-verified decoded WAVs. It preserves original volume,
  pitch and nonnegative start time. Cache and active-voice counts are bounded.
  A real user gesture is required. It rejects unconverted SoundCue/MetaSound
  graphs, concurrency/owner policies, non-UI pause behavior and missing settings.
* Gameplay installs the effect bridge, discovers an optional project-level
  `audio-manifest.json`, unlocks audio on a real pointer gesture only when that
  manifest is available, and exposes component bindings on the gameplay runtime.
  Disposal removes listeners, audio nodes, mixers and update registration.
* Collision construction honors geometry draw ranges, checks indices and finite
  vertices, omits degenerate triangles, handles transformed/mirrored instances,
  and reports its actual render-surface scope. It does not claim to reconstruct
  Unreal collision channels, PhysicsAssets, constraints or Mover behavior.
* Directional shadow frusta fit the exported world bounds in light-camera space,
  rather than centering on world zero. The authored light transform, intensity
  and color remain unchanged. A fallback directional light can now cast bounded
  shadows; presentation disposal restores the preceding environment/background.
* Nested parallel-export map paths resolve the correct Blueprint report and map
  manifest. Map progress links resolve to the project root.
* The preview server explicitly serves JS/MJS with `text/javascript` instead of
  relying on Windows registry associations that can return `text/plain`.

## What is NOT complete

The compiled DDS report inspected in this batch contains 428 translated functions
and 1,529 blocked functions. Its audio/VFX calls contain eight source call sites:

| API | Sites | Remaining dependency |
| --- | ---: | --- |
| GameplayStatics.SpawnSoundAttached | 3 | Original sound graph, attachment and lifecycle semantics |
| GameplayStatics.PlaySoundAtLocation | 2 | Original WAV/Cue graph, attenuation and world audio policies |
| NiagaraComponent.SetVariableLinearColor | 3 | Original Niagara graph and exact render-component binding |

One inventory location call references the original Engine sound
`/Engine/VREditor/Sounds/VR_ungrab_Cue.VR_ungrab_Cue`; substituting an unrelated
sound would not be a faithful conversion. The current published project has no
`audio-manifest.json`. The new 2D adapter therefore does not prove DDS sound
playback, and it does not implement these spatial/attached calls.

Multiplayer remains unfinished: current source actor adapters explicitly require
standalone mode with zero net drivers. `ForceNetUpdate` receipts and local dirty
marks do not send RPCs or replicate state. DDS needs original replicated-property
and RPC contracts, actor-instance lifecycle/ownership, authoritative transport,
OnRep ordering and independent two-client verification. No alternative network
game rules or movement synchronization were inserted in this batch.

Lighting remains approximate. Keeping glTF punctual lights and fixing their
shadow bounds does not reproduce Lumen, SkyLight capture, exposure volumes or
Unreal postprocessing. Those full-game areas must remain yellow/red.

## Reusable checks

* `node --test --test-reporter=dot tests/ue2three-*.test.mjs`
* `python -m unittest tools.ue2three.tests.test_automation_web`
* `node node_modules/webpack/bin/webpack.js --config webpack.editor.js`
* `/ue2three-systems.html`: automatic visible technical checks, progress bar,
  log, per-API current DDS inventory and JSON report. The colored blocks/sphere
  are explicitly a technical fixture, not an invented DDS level.

The browser probe simulates 360 physics steps, checks actual contacts and height,
checks the translated shadow frustum AND changed framebuffer pixels with shadows
on/off, checks effect ordering and checks missing-adapter reporting. Its four
green checks certify those checks only, not the four whole-game areas.

### Recorded results

* 121 ue2three JavaScript tests passed; 15 web-server Python tests passed.
* The production editor bundle and its verification chunk built successfully.
* All four visible technical checks passed, including 84 changed framebuffer
  pixels when switching shadow casting off/on with source light intensity intact.
* The actual cached DDS RaidMapTest loaded in the playable editor with the new
  nested-path handling. Its existing source-verification suite passed 24 input,
  35 metric, 4 event, 506 inventory and 31 character-calculation checks, plus one
  original component-owner binding. Horizontal player displacement was 0.997487 m.
  These checks exclude complete Mover, damage delivery, ammo/reload gameplay,
  source audio playback and replication.
* Source program content SHA-256:
  `0ffa8da249e9b6e5a914fa15534b98978db03c3e63ba9fe0ad50d8e2ca84f1cd`.

Evidence: [gameplay screenshot](evidence/ue2three-runtime-20261022/dds-gameplay.jpg),
[visible technical results](evidence/ue2three-runtime-20261022/systems-checks.jpg),
[live summary](evidence/ue2three-runtime-20261022/dds-live-summary.json),
[technical report](evidence/ue2three-runtime-20261022/systems-checks.json).

Gameplay screenshot SHA-256:
`be1d325580a02590755c779ce06b78b0a1d90322ace1b794a0fc3b7567e84dc0`.
Technical screenshot SHA-256:
`892eb0782725e84b806475125bd5f1f0c5ca712d4c3494f29e17a3af1d5625f8`.

Two browser failures were investigated rather than accepted as passes. Initially
Windows MIME associations prevented JS modules from loading; explicit server
types fixed it. The first pixel comparison toggled shadow-map rendering while
Three.js retained the same material/light shader variant, producing zero changed
pixels. Toggling the actual light's castShadow flag correctly changes that
variant and verifies real pixel differences. The map's ambient approximation
and visibly incomplete character/animation fidelity remain open.

## Required audio manifest contract

`audio-manifest.json` belongs beside `blueprint-programs.json` and must match its
exact project identity. It has `schema_version: 1`, `project`, and `assets` keyed
by original Unreal asset identity. Supported Wave entries contain `kind:
SoundWave`, a project-local `/build/local-scenes/.../*.wav` URL, WAV `sha256`,
original `volume`, `pitch`, `loop`, and `source_settings_verified: true`.
That last flag requires an actual source-settings export; it must not be set
manually to bypass unconverted sound class/concurrency/submix behavior. This batch
does not produce such a DDS manifest or auto-launch an audio export.

UE contract inspected locally without launching Unreal:
`Engine/Source/Runtime/Engine/Private/GameplayStatics.cpp`, PlaySound2D, including
null/world checks, disabled spatialization, pitch/volume and clamped start time.

## Integration

Merge this isolated branch into the active integration branch after reconciling
any concurrent edits to the Blueprint runtime, web handler and generated editor
bundles. Do not replace the active checkout or copy over its local changes.
The preview is a separate local server; the main dashboard at port 8401 is not
silently replaced by this branch.
