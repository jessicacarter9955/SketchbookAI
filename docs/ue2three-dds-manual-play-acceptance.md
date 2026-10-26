# DDS → Three.js — manual Play acceptance checklist

Updated: 2026-10-24. For the original VIPExtractionKitDDS project on branch
`chatgpt/ue2three-dds`. **The tester only presses Play and reports outcomes**;
asset export, rebuild, deploy, log capture, machine checks and repairs are the
responsibility of the conversion pipeline. This document does not certify that
the items below are implemented.

## How to read the checklist

- **PASS** means the actual Three.js runtime produced the stated observable
  result, with no console/runtime errors, for the identified *original* DDS
  source map/content/function. A preview showing a model is not a gameplay PASS.
- **BLOCKED** means the build, page, map or original asset is not available;
  this is an implementation failure, not a request for the tester to export it.
- **FAIL** means Play loaded but a source-required action or visual did not match.
- **N/A — source** means the original DDS scene does not contain that feature,
  established from the source inventory; do not manufacture a demo substitute.
- **PROVISIONAL** means there is a Three.js approximation without confirmed
  Unreal source equivalence. It never turns the original DDS area green.

Do not run tests against the separate `dds-portland` training raid to certify
the *original* DDS game: it is an intentionally independent sample scenario.

### What to send after each Play session

```
Build/commit shown in page:
URL, map name, original source asset (if displayed):
Browser, device, approximate FPS:
Test IDs attempted (PASS / FAIL / BLOCKED):
Exact action and expected result:
Actual result, error text (copyable), first visible timestamp:
Screenshot or short screen recording for a visual difference (if possible):
```

The build should display its commit/asset-manifest IDs and supply a selectable
Copy diagnostics action; absent diagnostics is an implementation defect.

## Gate 0 — the build is actually testable

| ID | You do | You should see | Blocking outcome |
| --- | --- | --- | --- |
| G00 | Open the **permanent** Play URL supplied for this DDS build. | Page opens without expired preview URL, missing deployment or sign-in step. | 404, temporary site, deploy/credential error. |
| G01 | Wait for the loading bar. | Asset names and stage-by-stage progress; entrance becomes clickable only after required scene resources are usable. | Infinite spinner, arbitrary 100%, blank canvas. |
| G02 | Enter Play, wait 30 seconds. | Active camera and controllable source scene; no WebGL errors or crash. | Any missing manifest/GLB/schema/runtime module. |
| G03 | Open/copy diagnostics, then refresh. | Build commit, project/map ID, GLB/material/Blueprint audit counts, errors and FPS remain obtainable as *text*. | Logs impossible to select/copy. |
| G04 | Reopen the same URL on the same device. | Deterministic version/asset identity unless a newer deployment is explicitly marked. | Cache mixes GLBs or scripts from different builds. |

## Gate 1 — GLB and map completeness

**Every original map must be selectable and load**: `LV_Fixers_MainMenu`,
`LV_Fixers_RaidMapTest`, `LV_Fixers_Startup`, `LV_Fixers_TestRange`,
`LV_ItemsPhotosPNG`, `GalleryLevel`, `TestSpriteMap`, `Demo`, `DefaultLevel`,
`NPCLevel`. The viewer must identify the exact source World, not silently
substitute a different map. Historical counters 56/58 GLBs and 8/10 maps are
*not* green; the two historical map blockers were `LV_Fixers_Startup` and
`GalleryLevel`. Current reports must remeasure the actual manifest.

| ID | You do | You should see |
| --- | --- | --- |
| M01 | Open each of the 10 maps in Play, one after the other. | All load successfully, with the original scene identity and an actual 3D view; no blank or substituted scene. |
| M02 | For each map, rotate camera 360°, zoom in and out, look above and below. | Complete meshes, correct scale, coordinates, normals and no stretched or missing pieces. |
| M03 | Walk around every playable map, up/down slopes, steps, rooms and near boundaries. | Ground contact, no ground sinking/hovering, walls block, stairs and ramps work, no invisible obstacles. |
| M04 | Enter/exit each original level transition or streaming trigger. | Required destination is loaded, assets visible at the right position, no crash or duplicate spawn. |
| M05 | Open `GalleryLevel`; inspect perimeter, each room, exhibits and the central area from multiple angles. | Source-matched 185-actor scene including geometry, actor transforms, correct light/VFX placement and interactive elements. |
| M06 | Revisit previously unloaded areas, move quickly, turn camera sharply. | No pop-in that exposes absent geometry, stuck loading, duplicated/detached meshes or material loss. |
| M07 | Inspect source GLB audit in the build. | All required GLBs validate in Three.js, load by URL, retain original mesh/skin/node hierarchy, correct transforms and source provenance. |
| M08 | Toggle a scene reload and re-enter after loading. | Scene reconstructs without losing textures, animations, colliders or event bindings; no permanent stale state. |
| M09 | Use original scripted non-mesh actors (spawns, lights, atmosphere, Niagara, landscape/volume actors). | Equivalent Three.js components and triggers appear/behave where the source places them. These need not be GLB geometry. |

For `GalleryLevel`, a **partial** ~52.3 MB `GalleryPartialSource.glb` with
163/185 geometry-covered actors was generated on the PC during 2026-10-24;
22 actors were not geometry-covered in that artifact. This does **not** count as
a complete source-fidelity Gallery or a Play pass. Lighting, sky, volumes,
Niagara and spawning may need typed Three.js representations instead of GLBs.

## Gate 2 — source characters, weapons and animation

| ID | You do | You should see |
| --- | --- | --- |
| C01 | Spawn each required original playable character/variant. | Correct original skinned mesh, skeleton, materials, proportions, equipment slots and orientation. |
| C02 | Idle, walk forward/back, strafe, turn, sprint, stop and reverse. | Animations transition at correct timings and speeds, feet follow terrain without skating. |
| C03 | Jump/fall/land, crouch, change locomotion states and traverse climbable elements present in source. | Original state guards, Motion Matching/IK and landing; no dummy animation substitution. |
| C04 | Select every source-required weapon; equip/unequip while moving. | Correct model, right/left-hand transforms, socket attachments and equip timing. |
| C05 | Aim horizontally/vertically, rotate around character and switch shoulders if source supports it. | Muzzle and aim line align, arms/IK stay attached, legs continue correct animation. |
| C06 | Shoot once/hold fire, hit target and cover at different distances. | Source cadence, ammo use, impacts/hit reactions, damage, occlusion and no shooting through cover. |
| C07 | Empty magazine, reload, interrupt with allowed actions, switch weapon. | Source reload duration, ammo accounting, cancel rules, animation/audio and effect synchronization. |
| C08 | Take damage, heal, die/down/revive/respawn where the source supports it. | Health values and exact allowed transitions match source, no placeholder poses. |
| C09 | Inspect character and each weapon up close from all directions. | Correct textures, normals, shader response, skin weights, no clipping or polygonal substitutes. |

## Gate 3 — Blueprint, events and real gameplay

The automated audit must first show **zero blocked reachable functions** for
the implemented DDS scope; the human Play tests then prove that wiring to the
Three.js world actually works. There were 1,521 blocked source functions in
the last verified cached report, so this gate is **not yet green**.

| ID | You do | You should see |
| --- | --- | --- |
| B01 | Open original startup map, start game through original UI. | Startup GameMode/controller/possessed pawn flows execute and reach intended gameplay state. |
| B02 | Activate every original input action used by the scenario, including press/hold/release. | Correct Enhanced Input binding, action phase, focus guards and mapped source Blueprint callback. |
| B03 | Trigger every visible interactable, button, pickup, volume and door. | Correct source guard/precondition, state mutation, feedback and following event. |
| B04 | Trigger an event that calls another Blueprint/function/actor. | Call chain completes; no `unsupported opcode`, unresolved native call, lost context/cast or dependency warning. |
| B05 | Repeat same action before/after changing relevant inventory, health or nearby object. | Source branches change on real state and not placeholder hard-coded success. |
| B06 | Test event-driven delays, timers, animation notify, latent sequences and cancellation. | Source timing and order are respected; no duplicate callback or missed event. |
| B07 | Spawn/destroy/respawn actors and reload map after state changes. | Actor lifecycle, references, delegates, construction and cleanup match source. |
| B08 | Toggle or compare source-required camera/UI bindings from gameplay. | All visible value/state updates come from the translated actor/Blueprint state. |
| B09 | Exercise source AI/NPC patrol, perception, interactions, shop, dialogue and combat where present. | Behavior tree/Blueprint decisions, paths, conditions, consequences and dialogue flows match source. |
| B10 | Complete a full source mission/raid/level session from original entry to end. | Objective updates, valid success/failure, loading, return to menu and state transitions match original. |
| B11 | Try invalid actions (out of range, no ammo, full inventory, insufficient money, blocked destination). | Correct original rejection and no partial corrupt state. |
| B12 | Replay the same scenario twice, including failure/interrupt paths. | Deterministic guards and clean reset of transient state; no duplicated listeners or actors. |

## Gate 4 — inventory, UI, materials, effects, audio, persistence

| ID | You do | You should see |
| --- | --- | --- |
| S01 | Open every original menu, HUD, inventory, settings, dialogue and shop route in scope. | Source layout, text, fonts/images, focus and working buttons; no inert scaffolding. |
| S02 | Pick up, move, split/stack, use/drop and equip items supported by original source. | Correct constraints, slot/weight/quantity updates, game world and UI always agree. |
| S03 | Purchase, exchange or consume items, including insufficiency cases. | Correct source currencies, prices, capacity guards and persistent transaction state. |
| S04 | Save through original path, reload page, resume and transition maps. | Exactly the source-prescribed persistent variables survive; transient ones reset. |
| S05 | Inspect surfaces under light from near/far and multiple angles. | Original texture channels, alpha, roughness/metalness, normal maps and dynamic material parameter response. |
| S06 | Switch scenes/time/weather or trigger lighting volumes where applicable. | Source light color/intensity, sky, fog, shadow, exposure and postprocess effects. |
| S07 | Trigger original particles, decals, smoke, muzzle flash, impact, Niagara effects. | Timing, attachment, blend/alpha and life cycle comparable to source. |
| S08 | Listen to footsteps, weapons, UI, ambient sounds and music while moving. | Correct original cue/sample, source distance attenuation, spatialization, start/stop and overlap. |
| S09 | Trigger cinematic/sequence and interrupt/resume when source allows. | Camera/event/audio/animation synchronization and correct end/skip handling. |
| S10 | If source requires networking, join from two browser clients and act simultaneously. | Actor authority/replication, damage, inventory and session state agree across clients; otherwise mark N/A after source audit. |

## Gate 5 — reliability, controls, performance

| ID | You do | You should see |
| --- | --- | --- |
| R01 | Play 15+ minutes, visit all available mapped areas and repeatedly enter menus. | No accumulating memory, listeners, animations, shadows, geometries or GPU resource errors. |
| R02 | Move rapidly between the densest locations, rotate camera and open inventory. | No sustained stutter, black/unloaded region or incorrect occlusion; record actual FPS instead of assuming 60. |
| R03 | Leave browser tab and return, resize/fullscreen, lose pointer focus while aiming/shooting. | No stuck keys/fire, sensible pause/capture behavior, canvas and HUD recover. |
| R04 | Repeat a completed run, open a fresh session, reload cached assets. | Same behaviors and source identities; no 404, cache conflict, bad checksum or broken saves. |
| R05 | Test keyboard/mouse and intended mobile controls, on actual supported devices. | Readable touch UI, correct joystick/camera, no offscreen critical buttons or gesture conflicts. |
| R06 | Force a recoverable network interruption, then retry Play. | Clear error and retry/resume without corrupting cached source files or replacing them silently. |

## How this becomes a green result

1. **Machine gate:** full source census, no missing target GLB/actor behavior,
   zero blocked Blueprint functions required by reachable source flows,
   source-fingerprinted conversion reports and relevant automated tests pass.
2. **Integration gate:** the rebuilt Three.js scene truly imports those outputs,
   loads in the deployed playable build and shows correct behavior; a standalone
   Python translation or GLB validator is insufficient.
3. **Visual and manual gate:** the tester marks the above source-applicable
   tests PASS, with screenshots/videos for visually significant differences.

Until all three gates pass, keep the corresponding traffic light **yellow or
red**, and tell the tester exactly which test IDs are ready versus blocked.

### Separate demo-only quick Play (does not certify original DDS)

When an independently working `dds-portland` demo build is supplied, you may
test: `WASD` movement, `Shift` sprint, `Space` jump, mouse camera, `1` rifle,
`2` pistol, `3` holster, right click/`V` aim, left click fire, `R` reload,
`I` inventory, `C` crouch, `E` interact/loot/extract/shop, `H` heal, `F2`
editor. Expected demo scenario: destroy three targets, collect a case and use
the green extraction zone; supply crate provides ammo/medkit, Mara and Nico
offer demo dialogue/shop, inventory progress is local. Those mechanics are
**not** proof of original DDS raid logic, UMG fidelity, AI or multiplayer.
