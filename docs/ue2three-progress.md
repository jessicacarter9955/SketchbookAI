# DDS migration checklist · 2026-10-13

## Compilazione incrementale e dipendenze native · 2026-10-19

Implementata cache IR separata da runtime/QA, con invalidazione delle prove a
ogni modifica runtime e controllo hash dei sorgenti a ogni riuso. Sul DDS,
iterazione con sola modifica runtime:6,296 s →1,175 s medi,5,36× /−81,3%
su due campioni per versione. Prima creazione della cache7,850 s; nessuna
accelerazione globale del porting dedotta da questa misura.

Piano nativo su14 pacchetti,165 entry costanti con layout/percorso verificati:
oggetti244 funzioni coinvolte, matematica152, timer66. Conteggi sovrapposti,
non funzioni automaticamente sbloccate. Sette nuovi pacchetti locali per
adattatori esatti, con witness e contratti; nessun invio esterno.
GetComponentByClass compare in45 funzioni bloccate: prossimo punto di riuso
per inizializzazione dei componenti originali. Piano riusato anche quando
cambia solo runtime, aggiornando versioni e checksum senza rileggere gli AST.

151 test Python /97 JavaScript PASS;719 confronti source /491 inventario PASS.
187 tradotte /320 bloccate, payload semantico invariato. Nuovo report
07ee4113eb2dc73d73539315dc870780b535dfb50ef331bae65df3069deba48d.
Nessun avvio UE, scansione/export/upload o nuova verifica visiva. Resta il
blocco della scheda integrata già segnalato. Nessun verde gameplay aggiunto:
percentuali e benefici delle18 aree invariati. Dettagli e misure in
[ue2three-acceleration.md](ue2three-acceleration.md).

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

Next: acquire fresh integrated-browser screenshots when capture works, then
continue original equip/transfer dependencies (native calls, casts, array literals,
source Text constants), cross-component events and original UI wiring. Animations
stay yellow with verification deferred; lighting last. Broad gameplay stays partial.


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
| Animation clips | 🟡 | 45 unique clip files published; assumed functioning to continue at the user's request. Unreal fidelity, curves, notifies, root motion and transitions are deferred |
| Animation systems | 🔴 | Translate nine AnimBlueprints, 105 montages, 10 blendspaces, pose databases, chooser and Control Rig behavior |
| Weapons and armed movement | 🟡 | Two accessories published; compare grip, aim, recoil, reload, hit detection and original damage rules |
| Blueprint and native behavior | 🟡 | 183 functions translated (six empty in source); 317 blocked functions in read packages and 263 packages not cached. Same-class calls and out parameters work; cross-object/native calls, dynamic jumps and timers remain |
| Menu, HUD and UI | 🟡 | One hierarchy published among 57 source widgets; migrate styles, assets, bindings and events |
| Inventory, loot and saves | 🟡 | Source slot writes/clear/swap/merge/cycling now execute; original equip, UI, persistence and complete transfers remain |
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

## Blueprint and character checkpoint · 2026-10-13

The generic compiler and JavaScript interpreter preserve original Kismet
assignments, input/output fields, instance state, source statement indices,
property types, Boolean logic and whitelisted Engine.KismetMathLibrary comparisons.
Unsupported operations reject the whole function. State updates are returned
explicitly; an execution failure does not modify the input actor.

Four additional DDS packages were parsed from isolated copies without Unreal:
Combat, Inventory, Interactions and Vitality. Together with earlier caches there
are 23 translated functions: 17 with source behavior and six empty callbacks.
The empty callbacks do **not** implement replication. Sixty delegate declarations
are recorded separately and are not counted as translated gameplay.

Examples include authored socket mounting, weapon-state getters,
`ClearJustExitedSlide`, `ClearThrowInProgress`, `ResetEmptyClick`, `SetCrouching`,
`RestoreInteractionWidgets`, `GetCurrentWeight`, `GetMaxWeight`, `IsStorageSlot`,
`HasStamina` and `IsAlive`. These programs execute on provided actor data; they
are not yet connected to the complete original game simulation.

The native browser audit passed 69 scenarios across these 23 functions. Browser
artifacts live under `build/local-scenes/ue2three/verification/blueprint-runtime/`.
Previously, 45 character clips passed finite-pose sampling and both authored
socket matrices were checked throughout the clips. **Animations stay yellow:**
the user explicitly deferred further animation/fidelity work.

Fixed failures in this batch:

- The character preview replaced authored sockets with pose compensation. It
  now shares source socket application with the playable runtime.
- The initial Blueprint audit rejected the menu visibility enum. The compiler
  now retains enum metadata and uses the original underlying property type.
- Float constants such as `+0` were emitted as strings by the package parser.
  Finite decimal strings now decode explicitly; nonfinite values remain blocked.
- The new Python test initially lacked its module search path; discovery now
  imports the converter independently of test ordering.

The next converter step is validated control-flow offsets and conditional
branches, followed by local Blueprint calls and explicit native adapters.
Use [the saved handoff](ue2three-handoff.md) to resume without new scans/exports.

## Conditional control-flow batch · 2026-10-13

Static jumps and conditional branches now use verified Kismet memory offsets.
Every computed function size must equal `ScriptBytecodeSize`; every destination
must be an instruction boundary. Unknown layouts are rejected. The interpreter
preserves false-branch semantics, primitive local defaults and explicit inputs,
and stops runaway loops with an instruction budget.

Seven additional functions now translate, bringing the total to 30 (24 with
source behavior, six empty callbacks). They include `GetHolsterSocketForSlot`,
`GetCurrency`, weapon/utility/injector slot selection, `IsValidSlotForCategory`
and `CanSprint`. 470 functions remain blocked in parsed packages. Native calls,
latent events, physics and multiplayer are not implemented by this batch.

The browser passed 90 generic scenarios and 32 explicit DDS comparisons covering
health, stamina thresholds, the sprint conditions, three currencies and slot
selection. DDS fixtures are separate from the generic audit and bound to each
original function's bytecode hash, so another project's rules are not mistaken
for DDS rules. Screenshots and structured results are saved under
`build/local-scenes/ue2three/verification/blueprint-control-flow/`.

The preview service was also repaired: Python's default HTTP logger crashes
under `pythonw` when stderr is absent. Logging now checks for the stream; a
regression test confirms complete HTTP responses without a terminal.

Batch verification: 78 Python tests and 47 JavaScript tests passed. Animation
fidelity was not re-tested; it remains explicitly deferred and yellow.

## Player input integration · 2026-10-13

The converter now resolves same-source-class direct and local virtual calls,
preserves out-parameter references, and rejects callers whose callees are not
translated. Nested execution shares an instruction budget and a depth limit;
failed execution does not modify the caller's actor. Virtual overrides on other
derived classes and cross-object calls remain unsupported.

`CanJump`, `CanRoll` and `CanSlide` now execute their original `HasStamina` calls.
Total: 33 functions, 27 with behavior and six empty callbacks. 99 generic browser
scenarios and 68 DDS-specific comparisons pass. Roll/slide are predicates at this
stage; their movement simulation is not connected.

Source input mappings and original Context calls to the typed Vitality component
provide witnesses for the sprint/jump compatibility bindings. The generated
`character_guards` point to original functions and Boolean outputs; required
instance fields come from the class defaults and primitive property initialization.
The runtime verifies project identity before mounting these bindings.

The playable DDS map now applies these predicates through the actual player's
`triggerAction` hook. Denied actions are released, including an already-held
sprint when its prerequisite changes. Each respawn gets its own default component
state. Pure prerequisites reuse unchanged results, avoiding repeated execution
for unchanged state every frame.

The optional live QA mode (`verify_blueprints=1&source_cases=dds-blueprints.json`)
checks the actual action flags against source cases, restores all test state and
includes a short movement check when sprint is permitted. It does not test
animation fidelity. The complete Mover/input event graph, stamina drain and
regeneration, BeginPlay, health events, inventory mutation and replication remain
open. The HUD explicitly labels movement and stamina consumption as incomplete.

Live screenshots and results are saved under
`build/local-scenes/ue2three/verification/blueprint-live/`.

Verified this batch: 80 Python tests and 52 JavaScript tests passed; the editor
build succeeded. In the integrated browser, all 24 live action cases passed and
the character moved 0.848 scene units during the allowed sprint check. The QA
restored source defaults (stamina 100), and restarting the player retained a fresh
component state. These checks establish the input prerequisites, not complete
Unreal movement or animation fidelity. Fixed stale HUD values after fixture
restoration/respawn and missing source instruction indices in nested-call traces.

## Source vitality values · 2026-10-14

Five original ratio getters now execute and are connected to the player's source
component state: health, stamina, armor, shield and revive progress. Total: 38
translated functions (32 with behavior, six source no-ops), 462 blocked in parsed
packages. Kismet arithmetic identities are verified before translation; double
division by zero returns zero and records the source warning, matching the local
UE 5.7 KismetMathLibrary implementation. Integer arithmetic preserves int32 width.
Non-finite numeric results remain unsupported.

Visible browser verification: 114 generic scenarios, 103 DDS source cases, 24
real scene-input cases and 35 runtime metric cases passed. The movement check
recorded 0.828 scene units and fixture state restored stamina 100. Evidence is in
`build/local-scenes/ue2three/verification/source-metrics/`. The generated progress
page now retains these two scoped green milestones only while the program version
and saved screenshot still match the live proof. Full vitality behavior, damage,
stamina drain/regeneration and the original HUD remain incomplete.

Verification: 82 Python and 57 JavaScript tests passed; editor build succeeded.
An old test still expected double division to be unsupported; its expectation was
updated for the newly supported operation and integer division stays rejected.
The local preview server was stopped at resume and was restarted without Unreal.

## Source structures and body regions · 2026-10-14

The converter/runtime now supports read-only struct member expressions and their
verified VM memory layout. Member reads preserve original hashed field names and
return isolated values; missing members, unsafe fields and struct writes remain
rejected. Struct constructors, arrays and complete inventory transactions remain
open. ASCII FName comparisons preserve case-insensitive equality and instance
suffixes; unsupported Unicode comparison constants are rejected at translation.

The original MapBoneToRegion function now executes: 23 source bone names map to
Head, Spine, LeftArm, RightArm or Legs; case variants and unknown-name behavior are
included in 28 source comparisons. This does not implement collision hit detection
or apply original damage yet. Total: 39 translated (33 with behavior, six source
no-ops), 461 blocked in parsed packages. 117 generic and 131 source comparisons
passed in the integrated browser.

87 Python tests and 59 JavaScript tests passed; editor build succeeded. The live scene again
passed 24 input and 35 metric cases. Movement QA now requires horizontal X/Z
displacement, so falling cannot masquerade as walking; observed displacement was
0.456 scene units. Screenshots and live proof are under
`build/local-scenes/ue2three/verification/source-structs/`.

The cached blocker planner and optional chat packets are documented in
`docs/ue2three-acceleration.md`; it does not change complete-game status.
Source audit evidence and its screenshot now also persist as a scoped milestone,
with exact typed outputs and source/program hashes checked by the progress tool.
A misplaced stale-proof assertion briefly caused a test-fixture NameError; it was
moved back to its original test and the complete suite passed after the fix.
# 2026-10-15 · Constant event entries and persistent source frames

- Extended the generic converter/interpreter with constant Ubergraph entry
  specialization, exact memory boundaries, bounded flow-stack reachability and
  per-instance persistent field storage. Unknown reachable effects still block
  the entire caller. Layout support alone does not execute native operations.
- Reused the 13 cached packages, without starting Unreal or rescanning assets.
  Result: **97 functions, 403 blocked**, 60 declarations, 263 uncached packages.
  The 58 new functions comprise **56 callbacks with no game effects** and two
  useful state paths: `Set_CharacterInputState`, `ResetSlideCooldown`. Complete
  animation dispatch, slide timers, Mover and replication remain untranslated.
- 58 entry programs contain **515 reachable IR instructions**, compared with
  165,633 source instructions across their complete graphs. Source instruction
  indices, offsets and whole-graph bytecode hashes are retained. Layouts are
  computed once per graph during one conversion; no quality reduction occurs.
- Added state comparison cases, dependency bytecode hashes, live event checks,
  full state/frame snapshot restoration and visible per-case traces. Scoped green
  evidence expires with the program/screenshot hash.
- Fixed three verification issues: an old test expected standalone math calls
  to fail before native resolution; a synthetic test had incorrect hand-counted
  offsets; the browser filter could run before asynchronous rows were inserted.
  The production offset calculator never accepted the incorrect fixture offsets.
- Verification: **94 Python tests, 60 JavaScript tests**, editor build succeeds;
  browser audit **97 functions / 291 generic / 135 source comparisons**; actual
  scene **24 inputs / 35 metrics / 4 source event state checks**. Animation 1:1
  fidelity is still deferred. Screenshots and DOM evidence saved locally under
  `build/local-scenes/ue2three/verification/source-events/`.
- Next: original inventory struct defaults/writes and container operations;
  typed cross-object/native adapters for remaining character/combat event paths.

## 2026-10-15 · Original inventory data reads and smaller cached programs

- Extended generic source type extraction to cached UserDefinedStruct/UserDefinedEnum
  assets. Read two original inventory dependency files (23,738 bytes total), using
  the existing parser, without launching Unreal or scanning again. Numeric enum
  mappings come from the source enum, not digits guessed from its names.
- Added typed struct initialization/member writes and a strictly identified
  Engine.KismetArrayLibrary.Array_Get copy adapter. Wrong library, context offset,
  destination owner or element type block conversion. Index overflow and invalid
  members fail; out-of-range indices warn and restore original type defaults,
  following UE5.7 KismetArrayLibrary.cpp and BlueprintPropertyHelpers.cpp.
- Unlocked GetSlotData, IsSlotEmpty, GetEquippedWeapon and GetWeaponModData.
  **101 translated /399 blocked**, 60 declarations, 263 packages uncached. Six
  empty functions and 56 no-effect event callbacks remain separately identified.
- Added **124 source comparisons** with manual expectations from the original slot
  and mod switches: 54 slot reads, 54 emptiness checks, six equipped-weapon reads,
  ten mod reads. Preserved the source's enum6 quirk (Found checks Grip while the
  returned identifier reads Muzzle); did not change the Unreal game rules.
- Reduced programs from 25,416,759 to **1,172,793 bytes** (95.4% fewer) by retaining
  only referenced property descriptors. Shared source fixture baselines reduced
  2,006,308 to **293,181 bytes** (85.4% fewer), preserving all cases and checksums.
  Removed redundant audit state/trace copies that slowed accessibility inspection.
- Fixed a source-type import shadowed by a local variable; corrected a standalone
  test invocation to use unittest discovery. The earlier full suite had passed;
  the invocation error was a missing test-module import path, not a game failure.
- **99 Python /62 JavaScript tests pass**, editor build succeeds. Native browser:
  **101 functions /303 generic /259 source comparisons** pass. Actual scene:
  **24 input /35 metric /4 event /124 inventory read** cases pass; horizontal
  movement 0.757 units. Runtime states/frames are restored after fixtures.
  Source screenshots and DOM proofs saved under verification/source-inventory/.
- Inventory writes, equip/unequip gameplay, persistence, UI and notifications are
  still incomplete. Animations retain deferred 1:1 validation; lighting remains
  last priority. Broader systems do not become green from these read-only checks.

## 2026-10-15 · Original inventory searches and loop bounds

- Strict Engine.KismetArrayLibrary.Array_Length adapter uses original source array,
  property owner/type and verified context offset. Reuses existing verified flow
  stack execution for source loops; no Unreal startup or new scan was required.
- Unlocked CountItemByID, FindItemByID and HasItemByID: **104 translated /396
  blocked**. Empty callbacks and uncached packages remain explicitly separated.
- 24 independent comparisons cover empty/missing/duplicate/case-insensitive IDs,
  negative quantities and int32 maximum. Preserved original CountItemByID quirk:
  it returns the last matching stack quantity rather than summing quantities.
- **100 Python /62 JS tests pass**, editor build succeeds. Browser audit passes
  **312 generic /283 source cases**. Actual scene passes **24 input /35 metric
  /4 event /148 inventory read checks**, horizontal movement 0.671 units, no console
  errors. Saved screenshots and DOM evidence: verification/source-search/.
- Checklist refreshed with current program and screenshot hashes: ten scoped
  checkpoints verified. Complete inventory mutations, UI and gameplay stay open.

## 2026-10-15 · Original reload arithmetic and native prerequisites

- Added typed Min, Max, SelectInt and exact int32-to-double conversion using
  installed UE5.7 KismetMathLibrary.inl contracts. Incorrect types/arity reject.
- Original CalculateReloadAmmo now executes: **105 translated /395 blocked**.
  Added 12 independent expected-result cases for normal, partial, empty, full,
  negative/over-capacity and int32 boundary inputs. No extra clamping was invented.
- **101 Python /63 JS tests pass**, editor build succeeds. Integrated browser:
  **315 generic /295 source comparisons**. Actual actor scene: **24 inputs /35
  metrics /4 events /160 inventory cases**, horizontal displacement 0.660 units;
  no browser errors. Saved evidence under verification/source-reload/.
- Fixed horizontal overflow in the audit table and an intermediate Windows text
  encoding regression; visually confirmed the final UTF-8 report fits the panel.
- Inventory writes remain blocked by original dirty-property/OnRep notifications,
  array mutation and native/object dependencies. Full reload gameplay remains
  separate from its verified arithmetic; no full system status was set to green.

## 2026-10-16 · Original damage and direction calculations

- Added typed UE5.7 Lerp, FMin/FMax and InRange_FloatFloat primitives, preserving
  inclusivity, reversed bounds, extrapolation and finite double behavior.
- Fixed const reference parameters being treated as outputs. Required input is
  preserved, const output/write targets reject, mutable reference input remains
  required. This fixes original Thresholds passing without inventing thresholds.
- Read one original source type (6,814 bytes), reused the existing registry,
  exports and parsed packages. No Unreal startup or full rescan.
- **107 translated /393 blocked**. Added 14 independently expected damage cases
  and 17 direction cases: effective/max boundaries, equal/reversed ranges,
  negative/un-clamped values, inclusive angle limits and source branch priority.
- **104 Python /64 JS tests pass**, editor build succeeds. Integrated browser
  audit: **321 generic /326 source comparisons**. Scene verification now exposes
  separate character calculation results with package/bytecode identities.
- Full damage application, traces, movement state/configuration, Mover and
  animations remain incomplete. Callee count does not make these systems green.
- Final live scene: **24 inputs /35 metrics /4 events /160 inventory /31 character
  calculations**, horizontal movement 0.760 units, no console errors. Loading
  briefly exceeded the browser inspection timeout; it finished without reload
  or game errors. Evidence saved with current program/bytecode/screenshot hashes.
- Checklist now has **11 scoped verified checkpoints**; full systems retain their
  yellow/red status. Source calculations are checked against matching audit cases.

## 2026-10-16 · Original item table and inventory data rules

- Added generic rich source value/constructor parsing in blueprint_values.py:
  source enum mappings, arrays, FText localization identity, asset references,
  native Vector/Rotator values. Unsupported members/history/identities reject
  the whole constructor/table; no fields or rows are silently dropped.
- Bounded parser read: S_ItemData, four enum dependencies and DT_Items, **118,463
  original bytes**. Reused all existing scan/export data, without starting Unreal.
- Exact Engine.DataTableFunctionLibrary.GetDataTableRowFromName adapter validates
  original library, default table, row schema, parameter owners and VM offset.
  Runtime supports case-insensitive row identity, copy semantics and unchanged
  OutRow on a missing name; null/missing/incompatible tables fail explicitly.
- Unlocked **ten original functions**, from item lookup through weight/value,
  compatibility/stack/swap checks and ammo search. **117 translated /383 blocked**;
  six empty functions, 56 no-effect callbacks and 263 uncached packages are separate.
- **77 independent source cases** added: all 16 original records, missing and
  case-insensitive IDs, selected localized text/numeric members, quantity/weight
  limits, storage swaps and ammo search. Expected values come from original
  tagged data and branch/arithmetic inspection, not the executed outputs.
- Preserved source quirks: CanStackWith subtracts max stack from current quantity;
  FindAmmoInCarry resets FoundIndex to zero before searching. Negative capacity
  and successful empty-search results are original behavior, not replacements.
- Added table/member fixture hash checks, typed runtime and compiler rejection
  tests, sparse row/default/copy/localization tests; **109 Python /66 JS pass**,
  editor build succeeds. Browser audit: **351 generic /403 source comparisons**.
- Rich data asset identities remain references: rendering/playing their assets,
  full mutations, UI, persistence, notifications and replication are incomplete.
- Final visible scene verification: **24 inputs /35 metrics /4 events /237 inventory
  cases /31 character calculations**; horizontal movement 0.509 units, no console
  errors. Saved screenshot and DOM evidence: verification/source-item-data/.
- Browser inspection initially timed out while the hidden scene awaited animation
  frames. Presenting the integrated browser resumed it and all checks passed.
  Keep browser visibility enabled before live QA to avoid background throttling.


## 2026-10-17 · Original inventory mutations and notifications

166 translated /334 blocked; 498 generic +498 source comparisons pass in the
integrated browser. Scene verification passes 24 inputs, 35 metrics, 4 events,
332 inventory cases and 31 character calculations. Horizontal movement: 0.7458.
122 Python tests, 77 JS tests and editor build pass. Added strict generic array
writes, source struct constants, dirty witnesses and transactional multicast
emissions with optional translated same-instance listeners. Original merge,
remove, weight/encumbrance, currency and weapon-mod rules are preserved.
Source input-state/backpack/implant dependencies cost only 52,026 bytes of
bounded parser reads; no Unreal process or rescan. See
[notification contracts](ue2three-blueprint-effects.md) for source quirks,
resource bounds, failures fixed and remaining object/UI/network work.
Evidence is local under verification/source-inventory-effects/. Checklist: 13
scoped green checkpoints; broad gameplay systems remain yellow/red.


## 2026-10-18 · Original equipment tables and stat events

173 translated /327 blocked. The generic reader now preserves imported class
identities plus MetaClass constraints as data, and persistent event frames retain
source schemas. Original weapon records (3 x73 fields), armor and shield records
are readable. Seven extra parser inputs total 124,118 bytes; no Unreal launch,
rescan, export or upload. Source weapon, armor/shield, reserve-ammo and apply/clear
stat cases preserve original fallback and notification behavior.
124 Python/79 JS tests and editor build pass. Browser: 519 generic +523 source
comparisons; scene: 24 inputs/35 metrics/4 events/357 inventory-equipment/31
character calculations, horizontal movement 0.60284. Evidence directory:
verification/source-equipment-data/. The visible audit includes before/result/
expected tables. Checklist has 14 scoped green checkpoints; whole systems remain
partial. See ue2three-blueprint-effects.md for source quirks and remaining wiring.
