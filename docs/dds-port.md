# DDS → Portland playtest

The independent `dds-portland` scene uses the existing Liberty City geometry and
collisions. Original scenes keep their original character. Scene copies preserve
the DDS player profile.

## Local asset export

Requires an editable DDS project with its Content directory and Unreal Engine 5.7.
From the repository in PowerShell:

```powershell
.\tools\export-dds.ps1 -Project 'C:\path\to\VIPExtractionKitDDS.uproject'
```

The command starts a hidden Unreal Python commandlet. Follow
`.local/unreal-export/export.log`; successful completion prints `DDS_EXPORT_DONE`.
The isolated export project links the source Content folder without saving source
packages. Both the scratch project and `build/local-scenes/dds` are gitignored.
The full source inventory is written locally as `inventory.json`.

Then run `npm run editor` and open
`http://127.0.0.1:8401/editor.html?scene=dds-portland&play=1`.
WASD moves, Shift sprints, Space jumps, mouse drag / arrow keys rotate the camera,
F2 opens the scene editor. `tests/dds-smoke.html` checks the real exported skeleton,
animation playback, map collisions, movement, jumping, camera and respawning.

## Batch 1 scope

Exports the UEFN mannequin and ten locomotion clips. Animation root travel is
removed because the character capsule drives position. Intermediate start/stop
and vehicle states currently alias existing clips; they are not faithful DDS
vehicle animations. The layered Unreal mannequin material uses a neutral Three.js
material for this first batch. This is a gameplay port, not Unreal Blueprint or
Motion Matching execution inside a browser.

The subsequent batches below add weapon integration and the single-player loop.

## Batch 2 scope

Exports rifle and pistol meshes plus ready, aim, fire, reload and equip/unequip
clips (21 exported character clips total). Upper-body weapon poses run after
locomotion, so the legs remain animated while carrying a weapon. A calibrated
right-hand grip follows the reload animation. The DDS camera uses a wider view.
In the animation test stage, 1/2 select rifle/pistol, 3 holsters, right mouse aims,
and R previews reload. Ammo and hit detection arrive in batch 3.

Export is incremental: existing files are reused. Set `DDS_EXPORT_FORCE=1` in the
environment when source assets change and need re-exporting. The browser smoke
test additionally checks both weapon grips, scale, aim and reload animation.

## Batch 3: single-player training raid

The DDS scene now has an independent saved inventory and a complete training loop:
destroy three targets, collect the case and interact with the green extraction
zone. A supply crate gives ammunition and a medkit. Course placements are checked
against the GTA map for ground height, line of sight and a continuous ground path.
It is a new training scenario, not a conversion of the DDS demo's complete raid
content or Blueprint systems.

- **1 / 2 / 3:** rifle / pistol / holster. **I:** inventory and weapon selection.
- **Left click:** shoot (hold for automatic rifle). **Right mouse / V:** aim.
- **R:** reload from reserve; changing weapon cancels the reload.
- **E:** collect nearby loot / extract. **H:** use a medkit. **C:** crouch.
- **WASD / Shift / Space:** movement / sprint / jump. **F2:** editor.

Shots use a camera aim ray followed by a muzzle ray: cover can stop a bullet even
when the third-person camera sees its target. Fire cadence, ammunition, target
damage, reload timing, fall damage, healing and extraction are enforced by the
game state. Inventory/editor/focus loss prevents accidental continued firing.
Inventory, loot and target progress are saved under each scene's own key; a new
raid resets that progress. The source maps remain unchanged.

23 source animation sequences are exported, plus a reversed rifle equip clip.
This includes locomotion, crouch, weapon poses, fire, reload, equip and a healing
gesture. It does **not** mean all 1,590 source sequences are converted into
playable actions. Full motion matching, traversal, downed states, other weapon
families, original raid content, AI and multiplayer remain outside these batches.
The mannequin still uses a neutral material and car states use fallback clips.

Verification: `npm test`, `npm run build`, and `tests/dds-smoke.html` for actual
skinned meshes, animations, city collisions, damage, cover, ammo, loot, inventory,
focus/editor transitions, saved extraction and restarting. Source/exported assets
remain local; the reproducible exporter, runtime and tests are versioned.

The source kit's included licence restricts asset redistribution and identifies
some separately licensed animations (including downed states). Git commits contain
original integration tools/code, not the purchased source or exported asset bytes.
Check the relevant asset licences before distributing a build containing them.

## Playtest corrections and residents

Aim and locomotion now share one animation mixer with disjoint upper/lower bone
tracks. This prevents static aim poses being overwritten. Firing layers recoil
over the held aim; exported weapon animations drive the pistol slide/rifle.
Releasing left mouse while holding right mouse preserves camera dragging. Aim
also follows camera pitch and uses a shoulder offset. `tests/dds-aim-smoke.html`
checks 120 frames of sustained aim, simultaneous buttons and changing shot
destinations rather than just checking that an animation starts.

Six additional real mannequins appear near spawn: Mara (guide), Nico (shop), two
stationary training mannequins and two walking residents. All have persistent
health, take bullet damage and fall when killed; they never retaliate. E opens
dialogue or purchases near a living contact. Their routes and spawn points are
checked against map ground/obstacles. Death is a procedural fall, not a licensed
Unreal death animation. A new raid restores residents and releases old physics,
animation and shadow registrations.

Inventory now has primary/secondary equipment, a 12-slot backpack, item details,
weight, credits and consumables. The layout follows verified source widget
structures, with original artwork; it is not a pixel-identical UMG port.
Armor/shields/stash remain visibly unavailable. The local shop validates credits,
capacity and proximity before saving purchases. See `dds-inventory-reference.md`.

The broader offline toolchain starts in `tools/ue2three`; see `ue2three.md` for
the architecture, current inspection-only scope and conversion acceptance gates.
