# DDS Blueprint batch checkpoint · 2026-10-27

The cumulative batch since commit `5fba7c0` translates **531/1,957 original
functions (27.1%)**, up from **470/1,957**: **61 additional functions**, with
**1,426 still blocked**, **zero regressions** and **zero missing source packages**.
The most recent continuation started at 518 and added 13 of these functions.
These counts measure whole translated source functions, not complete playable
systems. No new browser, Unreal editor, visual or Play 1:1 acceptance occurred.

## Shared implementations

| Family | Delivered | Remaining boundary |
| --- | --- | --- |
| Inventory UI | Image texture, FSlateColor, focus, typed text formatting and existing widget effects | Original widget handles and rendered UI must be connected |
| Pure native math | 14 operations, Vector2D schema, source-correct double BreakVector outputs | Other native functions and exact renderer/animation integration |
| Object casting | Original class ancestry, DynamicCast and ObjectToBool on supported bound handles | Controllers, game instances, animation instances and unresolved runtime families |
| Original actors | Authenticated fields, staged field/struct member writes, role queries | Full initialization, spawned actors, inherited storage and replication |
| Batch analysis | All nested bytecode, exact static call dependencies, reusable per-package census, HTML/JSON/Markdown reports | Candidate reach is not a prediction of successful conversion |

The complete original cache contains 276 Blueprint packages and 2,142 bytecode
bodies including declarations and helper bodies. The compiler progress
denominator remains the same 1,957 translated-or-blocked original functions.
Native declarations, no-op functions and helper counts are reported separately.

Notable new functions include `AN_GrabItem.Received_Notify`,
`AN_ReleaseItem.Received_Notify`, inventory `RestoreFullInventory`,
`Server_UnequipToCarry`, four slot widget UpdateVisuals chains, tooltip rarity
colors, control hints, movement conditions and hit reaction selection.
Their callers can still require additional original dependencies or runtime
bindings. Exporting or compiling one does not certify its full gameplay flow.

## Evidence and next batches

The saved aggregate replay compares every original package with the 470-function
baseline. Report paths under `.local/reconciled-blueprints-20261027-final-batch/`
contain the 61 gained function identities and every changed blocker reason.
The published local report is in
`build/local-scenes/ue2three/projects/VIPExtractionKitDDS-23a280ac11/`.
Private DDS reports and exports remain ignored by Git.

Checks: **435 Python tests across 54 isolated test files**, **210 JavaScript
tests**, production Webpack build and final editor build passed. A combined
Python discovery run did not finish; it was stopped and replaced by isolated
file runs to prevent shared module/mock state from making the export-loop test
wait for real retry intervals. The isolated export supervisor tests passed 17/17.

The source batch planner uses 2 workers by default (bounded to 1–4). A second
run reused all **276 package censuses**, decoding **zero source packages**.
Source hashes are still checked before cache reuse. It ranks every shared
native call/opcode and its exact static caller closure, including code after
the first compiler error. Counts overlap and are never added as expected gains.

Next high-reuse families are live object/context dispatch, remaining native
class schemas, timer/delegate lifecycle and animation event input structs.
The planner distinguishes potential affected functions from replay-proven
unlocks. Multiplayer, original UI construction, actor spawning and latent
callbacks remain separate runtime work.

## Reuse on another project

Run the existing Blueprint migration against that project's verified cache,
then use the generic planner with the resulting report:

```powershell
python tools/ue2three/blueprint_batch_plan.py --report <blueprint-programs.json> --source-cache <workspace>/artifacts/uasset-json --output <batch-plan-directory> --workers 2
```

The report directory contains `blueprint-batch-plan.html`, `.json`, `.md` and
the content-addressed package census. Outputs must stay outside the original
Unreal project and source cache. No level export or editor launch is needed.
