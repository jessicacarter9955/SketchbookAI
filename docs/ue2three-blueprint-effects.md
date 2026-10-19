# Typed array writes and local source notifications

The generic compiler recognizes exact Engine imports and original property owners.
DDS is the source fixture, not a collection of replacement game rules.

## Supported operations

* Typed `Array_Length`, `Array_IsValidIndex`, `Array_Get`, `Array_Set`,
  `Array_Remove`, `Array_Clear`, `Array_Add` and `Array_Append`.
* Original user struct constants, using the source member declaration order.
* `NetPushModelHelpers.MarkPropertyDirtyFromRepIndex`: retains the original
  property name/index witness as local bookkeeping. This is **not networking**.
* Typed multicast emissions. Same-instance translated source handlers may be
  explicitly registered with `BlueprintActorRuntime.subscribe`. They run
  synchronously in insertion order over a copied invocation list.
* Exact UE5.7 double `SelectFloat` for original weight/capacity calculations.

Array writes copy values. Expanding Set initializes holes using the original
element defaults, including nonzero user struct defaults. Invalid Remove/Set
indices warn without changing the array. A result exceeding the 100,000 element
runtime resource bound fails explicitly. Self append copies the source first.
Const input mutation, incompatible element schemas and wrong property owners
block translation. Unresolved struct schemas also block complete functions.

Root calls are transactions: state, persistent frames, dirty bookkeeping and
notifications commit only after every nested call/listener succeeds. Diagnostic
notifications retain the most recent 1,000 events. Snapshot/restore includes
listeners and diagnostics; subscription IDs remain monotonic across restore.

## Source contracts checked locally

No Unreal process is needed for these reads:

* `Engine/Source/Runtime/Engine/Private/KismetArrayLibrary.cpp`:
  GenericArray_Add/Remove/Set/Clear/Append/IsValidIndex.
* `Engine/Source/Runtime/Core/Public/UObject/ScriptDelegates.h`:
  ProcessMulticastDelegate copies the invocation list and visits it forwards.
* `Engine/Source/Runtime/Engine/Private/Net/NetPushModelHelpers.cpp`:
  MarkPropertyDirtyFromRepIndex uses the runtime ClassReps index. Serialized
  FProperty.RepIndex does not provide that mapping; it must not be substituted.
* `Engine/Source/Runtime/Engine/Classes/Kismet/KismetMathLibrary.inl`:
  SelectFloat accepts doubles and chooses A exactly when the Boolean is true.

## Source behavior preserved, including surprising payloads

* Slot OnRep notifications pass the original **empty slot literal**, rather than
  the current slot. Currency OnRep sends zero amounts. Weight OnRep sends zero
  weight/capacity and false, even when the actual state differs.
* RecalculateWeight broadcasts encumbrance once on every path, and a second time
  through OnRep when the state changes. It does not update bIsEncumbered.
* TryMergeIntoCarry fills existing matching stacks, marks CarryContents dirty,
  and does not broadcast a UI update or create a new slot.
* SetWeaponMod reconstructs HP as -1. Its melee branch omits the dirty/OnRep
  calls used by primary/secondary weapons. These differences are preserved.
* Server_AddCurrency rejects nonpositive amounts. The translated local body is
  verified; source server authority, RPC transport and replication are not.
* Original DT_Implants contains zero rows. Missing implant data and bonuses
  retain the original zero/false fallback. No implant records were invented.

## Remaining work

Original object creation, cross-object delegate bindings, native components,
complete inventory transfer/equip/save flows and UI listeners remain blocked.
The subscription API does not imply that original BeginPlay/widget wiring has
been migrated. Full multiplayer remains unimplemented. Source comparisons are
manual expectations from original bytecode/data; they are not an Unreal runtime
equivalence test. Animations retain the user's deferred verification status.

Browser proofs compare output, selected state, ordered effects and source hashes.
The progress report requires current program checksums and screenshot checksums
before enabling scoped green checkpoints. Whole game areas stay yellow/red.

## Equipment data follow-up · 2026-10-18

Original DT_Weapons now retains three complete 73-field records. ClassProperty
values preserve the imported class identity plus the source MetaClass constraint;
only Class/BlueprintGeneratedClass imports are accepted. These are data-only
references, including camera-shake classes. No camera-shake execution or class
construction is implied. Original armor/shield rows and their six/five fields
are also retained. Persistent struct/array/object frames now carry their exact
source schemas and initialize from original defaults, with transactional copies.

New original functions include GetWeaponData, GetArmorData, GetShieldData,
GetReserveAmmoForWeapon, GetCombat_CurrentWeaponData and armor/shield stat event
bodies. Tests preserve these additional source quirks:

* GetShieldData assigns Found=true in both success and missing-row branches.
* Missing weapon data has AmmoType=0; reserve-ammo lookup still counts light
  ammo through that original fallback.
* Applying armor/shield uses maximum HP for any negative CurrentHP, accepts
  zero as zero, and leaves above-maximum positive values unclamped.
* Clearing armor resets armor HP/capacity but retains movement/stamina penalties.
  Clearing shield also resets mitigation. These are source behaviors.

Reading reload, sound and class references does not migrate the referenced
animations, sounds or native effects. Server-named event bodies execute locally;
authority/RPC transport, equip wiring, damage delivery and regeneration remain
separate unfinished work.

## Source component ownership and slot writes (2026-10-18)

The offline compiler follows the original generated actor class's
SimpleConstructionScript pointer, validates its original AllNodes/RootNodes
reachable tree, typed component property, ComponentClass and template owner.
Original script overrides are typed; unrecognized overrides block that component.
The runtime binds source component identities to the actual scene player using
these witnesses. Audit-only tests use an explicitly separate surrogate actor.
References carry per-runtime identity; data asset identities cannot act as Actors.

Exact direct UActorComponent::GetOwner and typed AActor::ForceNetUpdate contexts
are supported only with explicit standalone bindings and no active game/demo
net drivers. ForceNetUpdate emits a local receipt: Actor.cpp's no-driver path
has no network update. Unknown native actor subclasses and source overrides are
not accepted. Native receipts commit with state/events and snapshot transactionally.
Physical scene ownership is immutable for supported programs, across snapshots.
Original construction scripts, BeginPlay, world creation, timers and network
lifecycle remain unimplemented.

Original slot quirks retained:

- SetSlotData copies fixed-slot metadata unchanged. Melee omits dirty/OnRep.
- Storage writes do not extend arrays. Invalid indices still emit the original
  dirty -> ForceNetUpdate -> dirty -> OnRep sequence.
- ClearSlot takes an explicit OwningActor parameter. Null contexts log Accessed
  None and skip that native call; remaining source operations still execute.
  CurrentLootContainer only removes, with no notification or network receipt.
- SwapSlotData rewrites destination SlotType/index and preserves HP, but its
  direct slot notifications carry the OLD source slot data. Weight recalculates.
- MergeSlots uses original max-stack arithmetic without added clamps, resets
  reconstructed HP to -1, does not renumber remaining metadata after remove,
  and does not recalculate weight. An overfull target can transfer negatively.
- Injector and utility cycles rotate original slot structs without relabeling
  metadata; all four injector and sixteen utility occupancy patterns compared.

Contracts read from local UE5.7 source only: ActorComponent.h GetOwner,
Actor.h ForceNetUpdate, Actor.cpp ForceNetUpdate; Pawn/Character do not override
this method. Unreal was not launched. These source comparisons still do not
constitute runtime equivalence against Unreal or a complete inventory UI.

## Localized errors and original inventory event bodies (2026-10-19)

EX_SetArray uses typed source destinations and element defaults. It clears the
array first, constructs each slot before evaluating its corresponding expression,
and retains UE's sequencing when the expression reads Array_Length or Array_Get
from the destination. After nested transactional function calls it reacquires
the current state copy before assigning. Reentrant writes of the destination
remain explicitly unsupported. Legacy SetArray layouts and const-input writes
are rejected. Memory offsets are checked against original ScriptBytecodeSize.

Localized EX_TextConst retains original FText source/namespace/key and flags0.
AsLocalizable_Advanced in local UE5.7 Text.cpp returns empty FText for empty source;
this behavior is preserved. String tables, invariant/literal and dynamic text
expressions remain blocked. No localization catalog or replacement strings added.

Server_RemoveCurrency preserves original Low0/Clean1/Ghost2 enum mapping, positive
amount and affordability branches, original errors, dirty marks, OnRep and direct
notifications. The direct NewAmount payload subtracts again AFTER balance changed;
ChangeAmount is zero. These quirks are retained, not corrected.
Server_MergeStacks preserves valid-slot, identical-ID and stackable checks,
MergeSlots state/effects, carry-grid notification and post-removal source re-read
for OnItemMoved. Invalid indices and distinct Cannot Stack text identities have
independent expectations. Server_AttachMod rejection cases preserve Invalid Slot,
Wrong Item and Wrong Item Type; no positive source mod row was invented.

Use tools/ue2three/verify-blueprints.mjs with explicit --programs and --fixtures
paths for any project whose source cases are available. Default proof output is
blueprint-offline-verification.json next to the program report. It neither starts
Unreal nor drives a browser. The progress report validates current source hashes,
outputs, selected state, members and ordered effects before displaying data counts;
offline data never grants visual acceptance. Runtime and QA source checksums are
part of the program fingerprint, preventing reuse of old visual evidence after
interpreter changes. Full inventory/UI/world and multiplayer remain incomplete.

## Original injector data (2026-10-19)

The generic table/struct/enum pipeline now has the cached original S_InjectorData,
DT_Injectors and E_InjectorEffect (three inputs, 22,203 bytes). The initially
unavailable row schema was resolved by reading its actual enum dependency.
GetInjectorData is translated without special DDS runtime rules. Its one
HealthStim row preserves all nine fields, including value30, use2.7s, one use,
effect0 and original sound/montage identities. Four source comparisons include
case-insensitive ASCII lookup and two missing-row paths. Missing-row code resets
sound/montage references to null despite non-null struct constructor defaults.
No heal, timer, audio or animation execution is implied by this data migration.
