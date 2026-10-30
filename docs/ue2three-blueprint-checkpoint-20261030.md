# DDS → Three.js Blueprint migration checkpoint — 2026-10-30

## Status and definition of green

Source: the original `VIPExtractionKitDDS.uproject` inventory and cached UAssetAPI bytecode, fully verified against source SHA-256 values. A **green Blueprint function** must have all of its source bytecode translated with its original identity/types and executable runtime semantics; a parser accepting an expression or a mocked result is **not** sufficient. A complete game/Play check is a *separate* gate.

- Original Blueprint packages: **276**.
- Original functions measured: **1,957**.
- Fully translated functions after this branch: **537 (27.44%)**.
- Blocked original functions: **1,420 (72.56%)**.
- Missing original parsed packages: **0**.
- Baseline at start of this batch: **534** translated; net **+3** complete translations.
- No count regressions were observed in full replays. Do not infer complete source/gameplay fidelity from this metric.

## Changes implemented and tested

1. `EX_TransformConst`: verified UE5.7 80-byte FTransform payload, preserving Rotation quaternion, Translation and Scale3D and original numeric types.
2. `KismetMathLibrary.NormalizedDeltaRotator`: UE5.7 native arithmetic (`(A-B).GetNormalized()`) in both the bytecode compiler and JavaScript runtime. This enabled the original `CBP_Fixers_Mover_ABP::Get_TrajectoryTurnAngle` function.
3. Original nested Actor property context: source-owned chained receiver resolution, with owner/property/offset checks and rejection of unresolved references.
4. `KismetSystemLibrary.MakeLiteralString`: exact source-validated `FString` identity through the compiler and runtime. Full DDS replay gained two completed source functions.
5. `KismetSystemLibrary.MakeLiteralText`: UE5.7 inline `FText` identity with preserved invariant FText metadata/history; targeted compiler and runtime tests pass. It unblocks an opcode family but yielded **zero additional whole functions** in this replay.

The source is on branch `chatgpt/dds-blueprints-continue-20261030`, verified at commit `a71d915a7e5fc5f6ef2c9bf376e5479e5e5dfe1e`.

## Verified tests and replay

An **isolated test worktree** (not the dirty existing DDS worktree) was used:
`C:\Users\jessi\Documents\Codex\2026-10-01\cl\SketchbookAI-dds-blueprint-test-20261030`.

- `test_blueprint_objects.py`: **16 passed**.
- `test_blueprint_source_objects.py`: **4 passed**.
- `test_blueprint_migration.py`: **36 passed**.
- `tests/ue2three-native-strings.test.mjs`: **7 passed**.
- `tests/ue2three-native-math.test.mjs`: **20 passed**.
- Full source-witnessed replay of the 276 packages: **537 translated, 1,420 blocked, 0 missing**, completed on Windows.

A previous broader isolated run passed **447 Python tests** and **194 JS tests**. Two Python test *files* exceeded an isolated 40-second timeout. Five JS test cases could not run due to missing `three` dependency in this fresh worktree; this is not evidence that the corresponding runtime passes.

## Highest-frequency first blocker (as of this replay)

| First error in function | Number |
| --- | ---: |
| `Unsupported opcode: EX_Context` | 161 |
| `Native call is outside Engine.KismetMathLibrary` | 141 |
| `Native or unresolved direct function call` | 90 |
| `IsValid` requires live original object binding | 47 |
| Source adapter requires direct original property | 40 |
| Persistent `K2Node_Event_Transition` source schema unresolved | 25 |
| Source adapter property schema unavailable | 19 |
| Original struct constant layout unresolved | 15 |

Most blocked source packages: `CBP_Fixers_Mover_ABP` (189), `CBP_Fixers_Mover` (129), `BPC_Combat_Fixers` (76), `WBP_InventoryScreen_V2` (60), `BP_Gallery_Character` (46).

Across *all* bytecode, frequent `EX_Context` receiver/call pairs include original foreign source virtual calls, `KismetArrayLibrary.Array_Get`, UI TextBlock setters, GameplayStatics PlaySound2D, and native material/component setters. These are occurrence counts, **not** further fully translatable function counts.

## Remaining critical work (not green)

1. Build source-owned cross-instance and virtual Blueprint method dispatch, preserving instance identity, inheritance, binding and original parameter/out semantics. Retain blocking behavior for unbound actors.
2. Provide explicit runtime interfaces for GameplayStatics, World/GameInstance, timed latent actions, async audio/VFX and UMG. No no-op or guessed fallback is allowed.
3. Complete Blueprint array/map/struct/local/persistent schema and event bytecode adapters with source-version tests. Some opcodes such as `EX_ObjToInterfaceCast`, `EX_BindDelegate`, `EX_ArrayGetByRef`, `EX_ArrayConst`, `EX_SetMap` remain intentionally blocked.
4. Expand native math only where exact Unreal behavior is reproduced. `MakeRelativeTransform` (six first blockers) includes a special negative-scale matrix branch; adding only the easy positive-scale path would be incorrectly called 1:1.
5. Replay all 1,957 source functions after each batch and compare function identities, errors, source hashes, unit tests, and integrated Three.js Play behavior.
6. Run an actual Play certification in the port; full gameplay/animation/physics/inventory/multiplayer fidelity is **not yet certified**.

The original Unreal/DDS assets, TruthLab and unrelated development environments must remain untouched. Do not delete or overwrite other branches/worktrees. This checkpoint does not mark the Blueprint migration as complete.
