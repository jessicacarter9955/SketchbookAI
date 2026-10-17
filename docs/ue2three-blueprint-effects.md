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
