# ue2three saved handoff · 2026-10-18

## Compilazione incrementale e priorità native · 2026-10-19

Latest user asks for drastic acceleration of the reusable converter.
Implemented private content-addressed IR cache independent of runtime/QA;
runtime changes still expire the published proof identity. Actual source,
parsed AST, types/tables, controls and compiler-module hashes are verified.
Corrupt IR rebuilds. Changed original source is rejected until reinspection.

DDS controlled runtime-only benchmark: baseline8b29b14 two samples5.402/7.190 s;
new cache reuse1.344/1.007 s. Mean6.296→1.175 s,5.36× /81.3% less time.
First population7.850 s; do not claim whole-game/development acceleration from
these timings. Semantic payload identical in all samples. See acceleration.md
and acceleration-results.json. No Unreal launch, rescan, export or upload.

Planner now observes exact native API identities, arities and source witnesses,
including165 verified constant-entry event slices,0 slice failures. Native
families overlap: objects244, math152, timers66, data37, animation33,
audio/VFX15, physics6 blocked source functions involved. Exact
Actor.GetComponentByClass appears in45 blocked functions. Implement shared
typed source component lookup/lifecycle next for character/weapons; counts
are NOT predicted automatic unlocks. Seven native work packets plus3 existing
structural packets stay local. Removed stale packet support boilerplate.
Runtime-only plan updates reuse analysis but refresh program versions/checksums.

151 Python /97 JS tests PASS;719 source comparisons including491 inventory
PASS.187 translated /320 blocked and all gameplay estimates unchanged.
Current program SHA07ee4113eb2dc73d73539315dc870780b535dfb50ef331bae65df3069deba48d.
Compiler key4ffafda428db50f2d1c49c32e81d8d3e28ee4fbc4eee829cc9e895d90a0168a7.
No fresh visual acceptance: integrated browser protocol/error state unresolved;
do not bypass via another browser, CDP, AutoGLM or a new-tab workaround.
Animations1:1 deferred, lighting last, source behaviors only.

## Benefici per chi gioca · 2026-10-19

Aggiunta alla baseline di tutte le18 aree la colonna «Cosa cambia per te
giocando al100%». Il JSON omonimo conserva player_benefit e main_dependencies
per ciascuna area. Le prossime tabelle devono mantenere questa spiegazione,
insieme a percentuale fatta/restante e variazione. I benefici richiedono le
dipendenze integrate e riguardano solo funzioni effettivamente presenti nel DDS.
Percentuali e stato di implementazione invariati: aggiornamento documentale.

## Percentuali per area · 2026-10-19

Riferimento per i prossimi aggiornamenti: [definizioni del100%, stime e lavoro
restante](ue2three-completion-baseline.md), con dati strutturati nel file omonimo
.json. Sono stime iniziali della checklist funzionale del DDS completo; gli
intervalli sono provvisori e non misurano tempo. Personaggio e armi15–25%,
restante75–85%. Ogni aggiornamento deve indicare area, fatto, restante,
variazione e criteri di chiusura ancora mancanti. Non dedurre una percentuale
globale dai conteggi di funzioni/file o dalla media delle aree sovrapposte.
Nessuna nuova scansione, modifica al runtime o verifica visiva in questo aggiornamento.

## Source weapon reload/component queries · 2026-10-19

187 translated /320 blocked, 67 event helpers, 60 declarations, six no-op
functions and56 empty callbacks. The denominator is now507 functions rather
than500 because one bounded original BPA_Weapon_Fixers read added seven real
functions, all still blocked. Uncached packages262. Do not compare the blocker
count as if the source inventory had stayed unchanged.

Added generic, source-typed read-only queries between explicitly bound SCS
components. Original parameter schemas, export/class identities, context byte
offsets and query dependencies must match. Out parameters copy into caller
storage. Null receivers keep caller out storage and produce an Accessed None
warning, matching admitted void/out calls. Query receivers use current component
state on each call, with no persistent copy/cache. Mutation, dirty properties,
multicast effects, persistent frames, reentrant aliases and unsupported calls
reject transactionally. Component initialization, world creation and mutation
are NOT implemented by this adapter.

New original source bodies: CanReload and OnRep_CachedCurrentAmmo. Fifteen
independent reload predicate cases cover ammo below/equal/above capacity, empty,
negative ammo/reserve, wrong ammo, busy flags and missing objects. Eleven ammo
notification cases reuse independently expected original inventory reserve
results. Object fixtures are explicit OFFLINE source-class identities; they
never spawn/register actors in the live game and cannot grant scene acceptance.
Total719 source comparisons /491 inventory PASS. Generic regression:143 Python,
97 JavaScript PASS. Editor build PASS, revision23 ue-source-weapon-queries-23.
Source report SHAd04bf2919f7bb9c0f4737c9eff4c85e0b08dc1b965882918dc935d02bbf01324.

Fixed a separate source default decoding bug: BytePropertyData with ByteType
FName has EnumValue rather than Value. The old generic property helper returned
null for these original class defaults. Now source enum identities resolve the
real values (combat CurrentEquippedSlot21); unavailable named native enum
fields are omitted and explicitly listed, never replaced with invented zero.
Combat TraceChannel still lacks its native enum mapping.

BPA_Weapon_Fixers cached SHA417038db955fdb077cb1db8ab4052c5073f96f8e476a22c1bfaf9879235a1206.
Its seven blocked bodies: GetLeftHandIKTransform, GetMuzzleTransform,
GetRightHandIKTransform, GetShellEjectTransform, InitializeWeapon,
OnRep_WeaponMeshAsset, UpdateCachedAmmo. These need original native skeletal
mesh/socket/state adapters; do not replace them with hand-authored weapon rules.

Complete character/weapons remains YELLOW. Actual live R/fire/weapon changes
are still mainly presentation. Next: original component initialization and
cross-object delegate wiring; typed native mesh/socket/world actor lifecycle;
original equip/unequip, source game clock/fire cadence/trace/ammo and actual
reload transfer/timers. See docs/ue2three-character-weapons.md. No Unreal launch,
rescan/export/upload or new tool installation. Animations1:1 deferred, lighting
last. The integrated browser still lists connection-error documents, even though
127.0.0.1:8401 is listening. Its prior protocol access block needs manual reload;
no fresh screenshot/browser acceptance claimed or bypass attempted.

## Original weapon montage selectors · 2026-10-19

Character/weapons priority: source getters GetEquipMontageForGripType and
GetUnequipMontageForGripType now translate, using typed original AnimMontage
imports. The adapter accepts an explicit set of static Engine asset classes;
actors, components, generated classes and foreign-library objects still reject.
References remain data identities; they do not execute the referenced assets.

185 translated /315 blocked; 693 source comparisons /491 inventory PASS.
137 Python and92 JavaScript regression tests PASS. No runtime code changed,
so no redundant editor rebuild/export. Thirty-six independent source cases
cover every original grip enum branch plus out-of-range defaults. One initial
expectation failed for unequip grip12: original source explicitly returns null,
whereas equip grip12 chooses HipLeft. Corrected the independent expectation
to preserve this original asymmetry; no source/gameplay rule was changed.

This does NOT complete character/weapons. Live scene fire/reload are still
mostly presentation: source equip lifecycle, cross-component inventory calls,
clock/cadence, ammo transfer, weapon actor creation and animation/native
adapters remain required. Animations remain yellow/1:1 verification deferred.
The integrated browser tab inventory still reports connection-error documents;
prior Browser Use protocol block remains unresolved. No fresh screenshot or
visual acceptance claimed. Continue source dependencies without opening Unreal.

## Original injector table batch · 2026-10-19

**183 translated /317 blocked**, 67 event helpers; other counts unchanged.
Read only three original inventoried assets, 22,203 bytes total: S_InjectorData,
DT_Injectors and E_InjectorEffect. The first two reads correctly left the table
blocked while its original enum schema was unavailable. Reading that enum
resolved the dependency; no fallback row/type was invented.
GetInjectorData now uses the existing generic typed-table adapter. DT_Injectors
contains one original nine-field Test_Inj_HealthStim row: EffectValue30,
UseTime2.7, UsesPerItem1, EffectType0, duration/cooldown0, original montage and
sound asset identities. Those identities do not execute the montage/audio or
implement the heal/use timer. Missing-row source code explicitly sets both
asset references null, unlike the non-null original struct constructor defaults.

Added four independent cases (exact ID, ASCII case variant, missing ID, None),
comparing every row/fallback field. **657 source cases /491 inventory PASS**
through the reusable verifier. Prior full-code regression result remains136
Python/92 JS PASS; no code changed after that run, so no redundant full rebuild
or regression rerun for this data-only batch. Editor remains revision22.
Current source report SHA: 97c3c67c39b8ea78eab97717c964f784ee77ad873a8c7a06b21b8d793c78c2c6.
Proof: published blueprint-offline-verification.json; visual acceptance stays
pending under the browser access block described below. Source private assets
and generated reports remain local; tracked code/fixtures/docs are pushed.

Next: fresh integrated-browser scene/audit screenshots after manual tab reload
requested earlier; source actor lifecycle, IsValid, GetComponentByClass/casts and
cross-component calls for equip/transfer/use. No Unreal launch, full source
scan, export, upload or new dependency install. Lighting last; animation1:1
verification remains deferred. Whole game is still incomplete.


## Original inventory events batch · 2026-10-19

**182 translated /318 blocked**, 67 event helpers, 60 declarations, six empty
functions, 56 empty callbacks and 263 uncached packages. New original local
bodies: Server_RemoveCurrency, Server_MergeStacks and Server_AttachMod. This
does not implement server authority, RPC transport or complete equipment flows.
Server_AttachMod comparisons cover original rejection paths only: the cached
DT_Items has no Category21 accessory row. Do not fabricate a mod item or claim
positive attachment acceptance.

The generic compiler now handles EX_SetArray and localized EX_TextConst.
SetArray clears its target and constructs a default slot BEFORE each expression
runs, following UE5.7 ScriptCore.cpp. Transactional nested calls require
reacquiring the resulting array; otherwise a copied state loses assignments.
Reentrant destination mutation fails explicitly rather than returning wrong data.
Localized text retains source text, namespace and key; an empty source becomes
original empty FText. Other text literal kinds remain explicitly unsupported.

Added 33 independent source cases, **653 total /487 inventory**, all PASS using
the new reusable tools/ue2three/verify-blueprints.mjs command and
src/editor/ue2three-source-verification.mjs. The verifier requires source,
type/table/event witnesses and independent expectations; it preserves inputs and
rejects writing proof into the Unreal source project. CLI output paths resolve
existing junctions/symlinks before the source-project boundary check.
**136 Python /92 JavaScript tests PASS; editor build PASS**, revision22.
Current report SHA: 1c8e0c2652d9e340b3982273336e1be66369232fd84556d7ea869efaa4b51c78.

Source behavior retained: removal notifications subtract the amount again from
the updated currency balance and emit ChangeAmount0; original enum mapping is
Low0/Clean1/Ghost2. Server_MergeStacks validates IDs and stackability, calls
MergeSlots, then re-reads the source slot AFTER removal for OnItemMoved; that
payload can consequently contain None. Negative transfer on overfull stacks,
HP reset and stale slot-index metadata remain original behavior.

Current browser verification is **pending**. The integrated browser is on an
ERR_CONNECTION_REFUSED internal error document (data:). Local server restarted
with pythonw, responds HTTP200 on127.0.0.1:8401, but Browser Use rejects access to
that error document under its URL policy. A request for the user to reload the
existing integrated tab is pending; do not bypass the browser policy or switch
to an external browser. No new browser audit or visual PASS claimed this batch.
Published blueprint-offline-verification.json contains current data proof.
The checklist shows offline counts separately and keeps visual green gates
closed without current screenshots. Runtime/QA implementation checksums are now
part of the migration fingerprint, so changing interpreter code expires old
visual evidence even when original bytecode is unchanged.

No Unreal start, new parser read, source rescan, export, upload or dependency
installation this batch. Next: acquire fresh integrated-browser audit/game
screenshots after the tab is accessible; exact IsValid and actor lifecycle,
GetComponentByClass/casts/cross-object calls for equip and transfers; optionally
read original S_InjectorData/DT_Injectors (inventoried, not cached). Animations
remain yellow with 1:1 verification deferred; lighting last. Complete game is
still partial. Do not equate source-case or asset counts with completion percent.


## Slot ownership batch · 2026-10-18

179 translated /321 blocked; 60 delegate declarations, six empty functions,
56 empty callbacks, 64 event helpers and 263 uncached packages. Added original
SCS owner graph validation and runtime Actor identities. The real scene player
owns its original inventory component; cached class/field/template/SCS/source
witnesses are checked before binding. Four cached ActorComponent types available.
No construction scripts, BeginPlay, native template behavior or replication run.
GetOwner and ForceNetUpdate require explicit standalone/no-game-or-demo-driver
bindings. ForceNetUpdate records a transactional call receipt; it does not provide
networking. Class overrides and incompatible component multiplicity fail explicitly.

New functions: SetSlotData, ClearSlot, SwapSlotData, MergeSlots,
CycleInjectorSlot and CycleUtilitySlot. Added 97 independent source cases, including
all fixed slots, invalid storage indices, no-resize writes, null owner context,
stack overflow arithmetic, all injector/utility occupancy combinations and old
pre-swap notification payloads. No source rules corrected or invented.

Verification: **131 Python /84 JavaScript tests PASS**, editor build PASS.
Browser audit: **179 functions /537 generic /620 source cases PASS**.
Actual scene: **24 input /35 metrics /4 events /454 inventory /31 math cases
PASS**, inventory owner is the actual player; horizontal movement 1.3533333027.
Source report SHA: 329dd1ad150a723bebcfacd2fb46f6e792e622c19e470141f2da6e0109a2b250.
Evidence JSON saved in build/local-scenes/ue2three/verification/source-slot-ownership/.

**Visual acceptance remains pending:** integrated browser Page.captureScreenshot
repeatedly timed out for both audit and game tabs, despite successful DOM-visible
PASS summaries. Do not reuse an old screenshot with this new program checksum.
Current published proofs explicitly omit screenshot hashes, so visual green gates
expire honestly. No gameplay failure was observed in these source cases. New JS
test setup initially omitted its required Count property and used an invalid object
constant; corrected the test setup to exercise typed asset rejection properly.
All tests now pass. Editor revision21 with optional chunk421 shipped together.
No Unreal start, source rescan, new parsed packages, export or upload this batch.

Next dependency audit (cached AST only): TryAutoEquipItem has original local
EX_SetArray instructions, Actor.GetComponentByClass, ActorComponent.GetOwner,
and KismetSystemLibrary.IsValid. EquipItemToSlot and TryAutoEquipStackable also
require IsValid; the complete source paths then need cross-component calls.
TryEquipToSlot contains LocalizedText "Slot In Use" with original key
C52FCD624614FE4233E099A431659554 and empty namespace; non-empty TextConst is not
translated yet. Do not replace these paths with invented equip handlers.
The corresponding UE5.7 execSetArray empties the destination before evaluating
and adding elements sequentially; evaluate-all-then-assign would be wrong if
expressions read that same array. Any future adapter must preserve that order.

Next: acquire fresh integrated-browser screenshots when capture works, then
continue original equip/transfer dependencies (native calls, casts, array literals,
source Text constants), cross-component events and original UI wiring. Animations
stay yellow with verification deferred; lighting last. Broad gameplay stays partial.


Latest equipment batch: **173 translated /327 blocked**, 60 declarations,
six empty functions, 56 callbacks without effects, 64 event helpers and 263
uncached packages. Added ClassProperty data identities with original MetaClass
constraints and class-import validation. No class instantiation or camera-shake
execution is implied. Persistent structs/arrays/objects now retain their exact
source schemas, initialize original defaults and validate transactional copies.
Read seven extra original assets (124,118 bytes): armor/shield/weapon structs,
three tables and the firing-mode enum. DT_Weapons retains three 73-field rows;
DT_Armor and DT_ShieldData retain one original row each. No Unreal start,
rescan, export, upload or additional dependency installation.
New supported functions: GetWeaponData, GetArmorData, GetShieldData,
GetReserveAmmoForWeapon [trailing space], GetCombat_CurrentWeaponData and the
original Server_ApplyArmorStats/Server_ApplyShieldStats bodies. Previously
translated clear-stat bodies now also have source state/effect comparisons.
25 cases added (523 total). Source quirks preserved: GetShieldData Found=true
on the missing-row path; missing weapon fallback still counts light ammo;
negative HP refills to maximum, positive over-maximum HP is not clamped;
ClearArmorStats retains movement/stamina penalties. These are original rules.
Verification: 124 Python/79 JS tests, editor build; browser audit 173 functions,
519 generic and 523 source cases. Scene: 24 input/35 metrics/4 events/357
inventory/equipment/31 character-math checks; horizontal movement 0.6028400331.
Source checksum: 9527b7bb1dc6719a05896010a45e1aec5d56a01aa8ec2c2459e52542b90dbab9.
Evidence: verification/source-equipment-data/{armor-stats,weapons,scene}.jpg
plus audit.json and live-inputs.json. The audit now shows before/actual/expected
field tables alongside raw proofs. Progress: 18 broad areas, 14 scoped green
checkpoints, including table reads with explicitly compared fields. Broad
inventory, combat, UI and complete gameplay remain partial. Editor revision20.
Next: source object/component graph and native adapters needed by SetSlotData,
ClearSlot, equip, damage and UI bindings; full character controller/animation
state graphs and other maps/materials remain open. Animations stay yellow with
1:1 verification deferred on user request. Lighting last. Never infer overall
game completion from function counts or asset references.

Remote integration: all nine newer branch commits were merged, preserving
Drive staging, CI, Tripo connectivity and server-managed Sketchfab access.
Published array_set/array_add IR and their regression tests remain supported.
Merge conflicts in the compiler and runtime were resolved with both behaviors
preserved; the integrated code passed the full suites and fresh visual QA.

Latest batch: **166 translated /334 blocked**, 60 delegate declarations,
six empty functions, 56 callbacks without effects, 64 event helpers,
263 packages uncached. Original typed array Set/Remove/Clear/Add/Append and
IsValidIndex, UDS struct constants, local dirty-property witnesses, typed
multicast payloads and explicitly registered same-instance source handlers now
execute transactionally. Source SelectFloat is double precision. No network
replication or original cross-object/UI wiring is implied.
Source-backed inventory operations now include TryMergeIntoCarry,
RemoveCarryItemAtIndex, RecalculateWeight [trailing space], GetBackpackData,
GetImplantData, GetImplantBonuses, Server_AddCurrency, SetWeaponMod, and original
inventory/vitality OnRep emissions. DT_Backpacks has one row; DT_Implants is
originally empty. Preserve source quirks documented in ue2three-blueprint-effects.md.
Only seven extra source assets (52,026 bytes total) were parsed: input-state
structs, backpack/implant row structs/tables, implant enum. Reuse these caches.
No Unreal start, export, full scan, or asset upload.
Failures fixed: unresolved struct schemas could be marked translated; the
compiler now blocks them and source input-state fixtures retain the full type.
The scene verifier omitted event helper dependencies; it now checks the combined
function/event library. Effect comparison ignores object key order while
preserving event/array order. Dashboard busy polling now records process exit
before reporting idle, fixing a reproducible intermittent test race.
Verification: 122 Python tests, 77 JS tests, editor build; browser audit 166
functions /498 generic /498 independent source cases. Scene: 24 input /35
metrics /4 events /332 inventory /31 character calculation cases, with
0.745766406456768 horizontal movement. Source checksum:
6bbeb5af674a63d4f29f94f75edd06586c559b89cebf305676a900174e1027d7.
Evidence: build/local-scenes/ue2three/verification/source-inventory-effects/.
Project progress now has 13 scoped green checkpoints and 18 broad areas;
full inventory remains yellow. Editor revision19 and optional chunk421 ship
together. Source package assets and generated project outputs remain local.
Next: cross-object owner/component calls and original delegate wiring needed
by SetSlotData/ClearSlot and full equip/transfer flows; then original combat
native dependencies, UI/save paths. Animations remain assumed working with
1:1 verification deferred. Lighting remains last. Do not mark whole systems
or full multiplayer green based on function counts or local notifications.

Latest batch (2026-10-16): **117 translated /383 blocked**, 60 declarations,
six empty functions, 56 callbacks without effects, 263 packages uncached.
Original DT_Items (16 rows, 53 fields) is now readable through the exact Engine
DataTableFunctionLibrary.GetDataTableRowFromName adapter. Missing rows preserve
OutRow; null/unmigrated/incompatible tables fail. Sparse rows copy original UDS
defaults, following local UE5.7 DataTable.cpp/UserDefinedStruct.cpp contracts.
New blueprint_values.py retains arrays, numeric enum mappings, native Vector/
Rotator data, FText namespace/key/source/flags, and data-only asset identities.
Other text histories/unsupported identities/types block the whole constructor/
table. Asset references do NOT imply mesh, sound, texture or object execution.
Added ten original functions: GetItemData, CalculateItemWeight,
CalculateTotalWeight, GetSlotWeight [trailing space], GetTotalCarryValue,
WouldExceedWeight, CanItemFitInSlot, CanStackWith, CanSwapSlots, FindAmmoInCarry.
77 source cases added (403 total); all 16 item rows are checked for key numeric
and localized text fields, plus missing/case-insensitive names, weights/values,
limits, slot compatibility, storage swaps and source quirks. Function outputs
and targeted struct members are compared independently and tied to source table,
type and dependency hashes. Member evidence is checked by progress_report.py.
109 Python/66 JS tests and editor build pass; browser audit 351 generic +403
source cases pass. Editor revision17 and optional chunk421 must ship together.
Only 118,463 bytes of additional original assets were parsed this batch (one
struct, four enums, one table); no Unreal start, export or full scan.
Source quirks intentionally preserved: CanStackWith uses target quantity minus
max stack (can produce negative MaxAddable); FindAmmoInCarry resets FoundIndex
to zero so missing matches can return Found=true/index0/quantity0. Do not fix
these as translator errors without an explicit game-rule change.
Evidence directory: verification/source-item-data/. Full inventory writes,
notification/native adapters, game action integration and other tables remain
open. Next: typed array mutation + original dirty/OnRep event delivery; migrate
other data tables and their exact row dependencies using bounded cached reads.

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
