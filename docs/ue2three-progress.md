# DDS migration checklist · 2026-10-12

The tool generates `progress.json` and `progress.html` from cached source metadata
and checksum-verified published outputs. Open **Avanzamento del progetto completo**
in the level preview, or select the checklist from the manager's scene list.
Lighting is the last priority. This snapshot describes the DDS test project;
the report generator works with the selected project's registry and outputs.

Green checkpoints have a narrow, declared scope. They do not make the parent
system or the complete game green. Yellow means partial migration. Red means
translation or original-game verification remains outstanding. Asset counts
are not a percentage of completed gameplay.

## Completed checkpoints

| Checkpoint | Status | Evidence and boundary |
| --- | --- | --- |
| Cached source inventory | 🟢 | 4,617 registry assets classified; 10 map files in filesystem inventory |
| Published map integrity | 🟢 | One GLB header, size and SHA-256 match its manifest |
| Comparable actor transforms | 🟢 | 152 match; one actor cannot yet be associated with an export node |
| Bounded flat terrain repair | 🟢 | 3,072 vertex positions repaired inside original terrain bounds; other terrain types excluded |
| Direct material input extraction | 🟢 | 66 original connections recovered from M_Grid; nested functions and shader execution excluded |

## Remaining project areas

| Area | Status | Next work |
| --- | --- | --- |
| Geometry | 🟡 | Associate the missing actor; compare all components, dimensions and hierarchies |
| Materials and textures | 🟡 | Translate six nested calls in M_Grid and original shader operations; remove eight parameter fallback materials; compare PBR channels |
| Other maps and streaming | 🟡 | One of 10 map files published; convert remaining levels and original transitions |
| Characters, skin and rig | 🟡 | Validate source materials, sockets, IK and remaining characters; 20 skeletal meshes in registry |
| Animation clips | 🟡 | 45 unique clip files published; determine used sequences among 1,590 source sequences, then migrate curves, notifies and root motion |
| Animation systems | 🔴 | Translate nine AnimBlueprints, 105 montages, 10 blendspaces, pose databases, chooser and Control Rig behavior |
| Weapons and armed movement | 🟡 | Two accessories published; compare grip, aim, recoil, reload, hit detection and original damage rules |
| Blueprint and native behavior | 🔴 | Translate events, functions, variables, timers and dependencies of 210 Blueprint classes |
| Menu, HUD and UI | 🟡 | One hierarchy published among 57 source widgets; migrate styles, assets, bindings and events |
| Inventory, loot and saves | 🔴 | Translate original item, container, equipment and persistence rules |
| NPC, shop, dialogue and missions | 🔴 | Translate actual source interactions, AI, prices, conditions and progression |
| Modes, lobby and extraction | 🔴 | Translate session, raid, extraction, death and level-change flows |
| Collision and physics | 🔴 | Compare primitives, channels, queries, contacts and ragdolls; 11 PhysicsAssets in registry |
| VFX, Niagara and groom | 🔴 | Translate 109 Niagara systems and eight groom assets with their dependencies |
| Audio and sequences | 🔴 | Migrate 481 waves, 50 cues, 39 MetaSounds and nine level sequences |
| Multiplayer and services | 🔴 | Translate authority, RPC, replication, sessions and source services |
| Complete game acceptance | 🔴 | Demonstrate matching source inputs, outputs, timing, data and visual flows |
| Lighting — last | 🟡 | Source punctual lights retained; SkyLight, exposure, reflections, shadows and postprocessing remain approximate |

## Resource policy

- Reuse raw Unreal exports independently of changes to offline conversion code.
- Reprocess only changed dependencies; reuse valid metadata and output checkpoints.
- Reuse screenshots only when their asset and presentation fingerprints still match.
- Generate the checklist without Unreal, a new source scan or external services.
- Keep unsupported graph operations explicit; do not simplify meshes or lower
  texture resolution as a speed shortcut. Existing baked exports still require
  a fidelity comparison and are not automatically 1:1.

The offline cache replay for this batch took 4.328 seconds for processing and
0.25 seconds on reuse, with subprocess execution disabled. This comparison
applies only to the cached offline stage, not the time to port the whole game.

## Material reader batch

Cached UAssetAPI JSON lost native `ExpressionInput` links as `Value: 0`; material
editor data was a raw export. The tool now reads bounded original export bytes
using the cached name and export tables, checks source/raw-byte agreement and
tag endpoints, and preserves original inputs, channel masks and constants.
Indexed `CustomizedUVs` are handled without merging them into UV0.

M_Grid contains 91 expression nodes and 66 recovered direct connections.
BaseColor, Roughness and Normal now reference their original expressions in the
intermediate representation. Six material function calls remain explicitly
unsupported. This batch extracts the graph; it does not execute it in Three.js
and does not improve rendered material colors yet.

The full graph is in the map's `.source.json` sidecar; only its summary is added
to GLB diagnostics. Changing the reader invalidates offline processing while
retaining the raw export. Serialization layout references are the upstream
[UAssetAPI serializer](https://github.com/atenfyr/UAssetAPI/blob/master/UAssetAPI/MainSerializer.cs)
and [native material input implementation](https://github.com/atenfyr/UAssetAPI/blob/master/UAssetAPI/PropertyTypes/Structs/Engine/MaterialInputProperties.cs).

Verification: 68 Python tests and 36 JavaScript tests passed; cached DDS replay
started no external process and preserved the raw GLB checksum. Native browser
proof is saved locally under
`build/local-scenes/ue2three/verification/material-graphs/` and kept outside Git.
