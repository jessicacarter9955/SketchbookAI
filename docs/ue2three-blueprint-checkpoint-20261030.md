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
- Later replay after verified `FKey` equality adapter: **537/1,957 translated**, **1,420 blocked** and **0 missing** (unchanged count; another bytecode blocker still prevents complete translation of the affected original functions).

## Changes implemented and tested

1. `EX_TransformConst`: verified UE5.7 80-byte FTransform payload, preserving Rotation quaternion, Translation and Scale3D and original numeric types.
2. `KismetMathLibrary.NormalizedDeltaRotator`: UE5.7 native arithmetic (`(A-B).GetNormalized()`) in both the bytecode compiler and JavaScript runtime. This enabled the original `CBP_Fixers_Mover_ABP::Get_TrajectoryTurnAngle` function.
3. Original nested Actor property context: source-owned chained receiver resolution, with owner/property/offset checks and rejection of unresolved references.
4. `KismetSystemLibrary.MakeLiteralString`: exact source-validated `FString` identity through the compiler and runtime. Full DDS replay gained two completed source functions.
5. `KismetSystemLibrary.MakeLiteralText`: UE5.7 inline `FText` identity with preserved invariant FText metadata/history; targeted compiler and runtime tests pass. It unblocks an opcode family but yielded **zero additional whole functions** in this replay.
6. `KismetInputLibrary.EqualEqual_KeyKey`: original InputCore `FKey` schema, reflected `FName KeyName`, `StructSize=32`, exact native import and parameter arity; implemented in source compiler and Three.js runtime, rejecting foreign layouts and Unicode case-fold uncertainty. Targeted tests pass, no added completely translated functions in the source replay.

7. Shared pure-Kismet `EX_Context` dispatcher: recognizes exact `Default__KismetStringLibrary`, `Default__KismetTextLibrary`, and `Default__KismetSystemLibrary` native calls via the existing reflected signature registry, validating import ownership, bytecode offset, and original argument/return types. Added strict positive/negative compiler tests and JS runtime concatenation test. This is a working generic family capability, *not yet* a universal cross-object dispatcher. The full source replay remained **537/1,957**, so it does **not** count additional green functions.

The source is on branch `chatgpt/dds-blueprints-continue-20261030`, additional `FKey` implementation at commit `03c5224e805e974cafc45c65ba8cb331208bf91b`.

## Verified tests and replay

An **isolated test worktree** (not the dirty existing DDS worktree) was used:
`C:\Users\jessi\Documents\Codex\2026-10-01\cl\SketchbookAI-dds-blueprint-test-20261030`.

- `test_blueprint_keys.py`: **2 passed** (additional regression and rejection checks).
- `test_blueprint_objects.py`: **17 passed** after generic CDO dispatcher.
- `test_blueprint_source_objects.py`: **4 passed**.
- `test_blueprint_migration.py`: **36 passed**.
- `tests/ue2three-native-keys.test.mjs`: **2 passed** (additional input key semantics and rejection checks).
- `tests/ue2three-native-strings.test.mjs`: **8 passed** after shared native concatenation.
- `tests/ue2three-native-math.test.mjs`: **20 passed**.
- Full source-witnessed replay of the 276 packages after `FKey` change: **537 translated, 1,420 blocked, 0 missing**, completed on Windows (35.4-second whole-source replay; 0 exit code).
- Full source-witnessed replay after shared CDO dispatcher commit `e7cfd006226f9ffdd13361a06f1727d0b8ff4381`: **537 translated, 1,420 blocked, 0 missing** (44.6-second full replay; 0 exit code).

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

## Windows autonomous coordinator observed blocker (2026-10-30)

A separate read-only bridge audit found an existing `dds_automation.py` coordinator in the original checkout, but **not working**: `phase=failed`, `error=Repository worktree must be clean before autonomous work starts.`, 77 failures, 8 families exhausted, 2 configured workers, last checkpoint 534/1,957 on the older `chatgpt/ue2three-dds` branch. The isolated test worktree at `SketchbookAI-dds-blueprint-test-20261030` is clean, but initially had no `blueprint-plan.json`; generating that from the preserved source cache is the safe next prerequisite. Do not claim autonomous coding is active until an actual worker is observed.

## Automation verification — 2026-10-31 03:56 Europe/Rome (read-only source audit)

- Rechecked the target branch at commit `68e5669df45d216bb3ae7f4f71086123874d031d`. Last **source-witnessed** whole-inventory replay remains **537/1,957 translated, 1,420 blocked, 0 missing**; this run did **not** execute a fresh local source replay, so these are carried-forward verified metrics, **not new progress**.
- Re-read `img2three/AGENTS.md` from `img2threejs-runner`; original images/assets and that branch were not changed.
- Verified isolated repair PR #5 and GitHub Actions run `41141939811` at head `e6d81f3e600d7f7697b4a96fdf9bd0f48c6052a1`: four CI jobs succeeded (Python tests, JavaScript tests, editor/player build, final migration gate). This verifies the isolated validation fix **only**, not Unreal source replay or Three.js Play.
- The private bridge issue #3 previously acknowledged a ping and job inventory for `dds_auto_20261030_2356_*`, but the fresh `dds_auto_20261031_0356_joblist_v2` and `dds_auto_20261031_0356_ping_v2` commands were **not acknowledged when checked**. Thus the current DDS job inventory, source hashes and source cache availability remain unconfirmed; **no competing worker or local source-writing job was started**.
- **No new Blueprint adapter committed, no new source-replay count, no Play certification.** This is a documentation-only checkpoint of independently verifiable GitHub state and an outstanding bridge preflight. Do not promote the isolated repair until a fresh job audit and source replay are complete.
- Evidence: [validator PR #5](https://github.com/jessicacarter9955/SketchbookAI/pull/5), [successful CI run](https://github.com/jessicacarter9955/SketchbookAI/actions/runs/41141939811), [private bridge issue #3](https://github.com/jessicacarter9955/chat-local-bridge/issues/3) (requires repository access).

## Automation preflight — 2026-10-31 07:54 Europe/Rome (bridge unacknowledged)

- GitHub repository read verified with push permission; target branch head before this documentation-only update: `1c669bc21618be8eee1aa5a7d95970a8e2fef5de`. `img2three/AGENTS.md` read on `img2threejs-runner`; no changes to original images, assets, that branch, or unrelated projects.
- Private bridge issue #3 has **1,758 comments** at inspection; last acknowledged bridge commands were `dds_auto_20261030_2356_joblist_v1` and `dds_auto_20261030_2356_ping_v1`. Both `dds_auto_20261031_0356_*` requests remain unanswered. New authorized, read-only `ping` and `job_list` requests `dds_auto_20261031_0754_ping_v3` (comment `6540321108`) and `dds_auto_20261031_0754_joblist_v3` (comment `6540321417`) were submitted; **no result/ack observed at the latest poll**.
- Because current DDS jobs, cached original source hashes and baseline have **not** been freshly verified, **no new worker, source write, source-witnessed adapter, full replay, build, or Play certification** was executed. Existing **537/1,957 translated, 1,420 blocked, 0 missing** is a **carried-forward last verified** replay, not a fresh result. The validation PR's CI results are historical, not re-run in this preflight.
- Blocker: Windows private bridge worker must acknowledge issue #3 and return an up-to-date `job_list` plus original source baseline before an incremental batch may safely start. This checkpoint commit is documentation-only and does not increase conversion coverage.

## Automation batch — 2026-10-31 12:05–12:10 Europe/Rome (source replay and retained-patch recovery)

- Verified GitHub read/write access to `jessicacarter9955/SketchbookAI`, inspected `img2three/AGENTS.md` on `img2threejs-runner`, and used **only** authorized private bridge issue #3 commands. The bridge answered `dds_auto_20261031_1155_joblist_v4`: no active jobs among the 100 tracked jobs. A separate process/state audit confirmed the preceding scheduled DDS tick had ended at **2026-10-31 10:52:26 UTC** with **537/1,957** and a `native-data` candidate rejected as `empty_or_out_of_scope_patch`. The isolated checkout was clean at `39955682858c1471b391bfd629b2641ce1ae8001`.
- Identified the actual recovery blocker: the promotion allowlist excluded legitimate root-level `tools/ue2three/test_blueprint_*.py` regression tests, even when the candidate code was under approved Blueprint paths. The native-data worktree was empty, while the retained audio/VFX and physics worktrees contained original code/test changes. No source asset was changed.
- Committed a bounded recovery repair and tests on this branch: `49541a16a4eba905cb4fbd5697a7448aa1fab37b` (scope/recovery), `b8a099f93118d50fdf3dafe161ee1a8982e2ffbf` (verify root Python and added physics JS tests), `de5af878c48092b85e5e3d6ea9ad845108323410` and `548f6d6b31a672eb452d2d07995c72db857e19c2` (regressions/syntax), `ec7e1eb4cfb4dad3490082257fc08ca119c19772` and `e47686ee1f38cc68e6d06be8d46d56501730b8c2` (hide Windows Git/test subprocess windows). The compare from `3995568` to `e47686e` changes **only** `tools/ue2three/dds_agent.py`, `tools/ue2three/dds_automation.py`, and `tools/ue2three/tests/test_dds_automation.py`; no original images, Unreal assets, other projects or Python/Node environments were edited.
- Verified Windows checkout fast-forward to `e47686ee1f38cc68e6d06be8d46d56501730b8c2` without local modifications. Python syntax compilation passed. **Two new regression tests passed**, **181 compiler Python tests passed**, **4 root compiler Python tests passed**, and **33 Blueprint JavaScript tests passed**. The broader supervisor `unittest` invocation exceeded its separate 180-second validation bound; it is **not** counted as passed.
- Fresh full source-cache replay using `verify_dds_blueprint_batch.py` completed successfully (exit 0) for the **276-package / 1,957-function** inventory. Report: isolated local `.local/ue2three/replay-20261031-1218/blueprint-source-progress.json`. **537 translated, 1,420 blocked, 0 newly gained, 0 regressed, 0 changed blocker reasons, 0 missing cached packages.** The replay checks package identity and function-level monotonicity; it does not itself establish Three.js Play or full original UE5.7 runtime parity. No green count was added.
- Started a single explicit hidden `dds_automation.py --once` supervisor tick through bridge job `dds_auto_20261031_1220_supervisor_once_v4` at **11:05 UTC**. At **11:07:48 UTC**, state was `phase=cached-blueprints`; **`native-audio-vfx` and `native-physics` were successfully revalidated as `patch_ready_for_review`**, while `native-data` remained `needs_review` because its retained worktree has no patch. This is **pre-promotion**, not proof of additional translated functions. The tick's final outcome, build and Play certification remain unconfirmed as of this checkpoint.
- Existing leading first blockers remain `EX_Context` (161), foreign native math calls (141), unresolved direct calls (90), live-object `IsValid` binding (47), and direct property binding (40). The worker candidates must pass strict full replay with positive whole-function gain before any promotion. No stub/no-op or partial adapter is counted green.

## Automation batch — 2026-10-31 15:54 Europe/Rome (failed candidate replay isolation)

- Verified GitHub read/write access, target branch, and `img2three/AGENTS.md` on `img2threejs-runner`. Private Windows bridge `jessicacarter9955/chat-local-bridge` issue #3 answered authorized `job_list` and `job_tail` requests. The 100 most recent bridge jobs contained **no running job** at preflight; the prior `dds_second_supervisor_once_job_v1` had exited **1** with `cached-blueprints: exit 2`.
- Isolated Windows checkout was **clean** at `0c65405ee8d2e13a81d204aeb41377f7cef002e3` before this batch. Original cached-source baseline: **276 packages, 544 translated, 1,413 blocked, 0 missing**; sample package records carried original `source_sha256` and `parsed_sha256` witnesses. The previous increase from 537 to 544 belongs to earlier source-replayed work, **not this batch**.
- Root cause observed in `cached-blueprints.log`: a **candidate** native-math replay rejected an original unbound `FoleyEventBank` object default (`Source object defaults require an explicit original instance binding`). The source-safety rejection is correct; the supervisor should not treat this rejected candidate as a fatal failure of the entire queue.
- Committed a bounded supervisor fix `15edbd2a421f761de2f56987b082ea8da7bf490a`: when an isolated candidate source replay fails, retain the candidate commit and diagnostic, mark the family `candidate_replay_failed` / `needs_review`, and do **not** merge the unsafe candidate or abort the whole supervisor. Added a focused regression in `242370a47995db62bf114ade59b32c72ee8b3a4f` that verifies preservation and no merge. Only `tools/ue2three/dds_automation.py` and `tools/ue2three/tests/test_dds_automation.py` changed; isolated Windows checkout fast-forwarded to `242370a` after checking this exact diff scope.
- **Tests actually run:** new supervisor regression **1/1 passed**; Blueprint Python suite **185/185 passed** when executed from `tools/ue2three`; selected Blueprint JavaScript suite **37/37 passed**. An earlier Python invocation from repository root reported two import errors (wrong test discovery working directory); that invocation is **not** counted as passed.
- **Fresh full original-source replay:** `.local/ue2three/replay-20261031-1554-v5/blueprint-source-progress.json`, exit **0**; **544/1,957 translated (27.80%), 1,413 blocked, 0 gained in this batch, 0 regressed, 0 missing cached packages, 0 changed blocker reasons**. This is compiler/source-replay coverage, not complete native runtime or Play certification.
- A separate complete supervisor-test + webpack build job `dds_auto_20261031_1554_build_tests_job_v5` was launched after the focused checks; at the last acknowledged `job_tail`, the **185 Python Blueprint tests had passed** and the supervisor suite was still running. **No full supervisor-suite or webpack build success is claimed until a terminal result is observed.** Bridge issue #3 was approaching the 2,500-comment limit; preserve the channel and use only authorized commands.
- No original Unreal/DDS assets, source cache, reference images, TruthLab files, Python/Node installations, or `img2threejs-runner` integration were changed. No visible terminal was requested. **Play certification remains unperformed**; native adapters without actual bound UE5.7 behavior are not green.
