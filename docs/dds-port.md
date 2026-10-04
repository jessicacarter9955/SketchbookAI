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

Next batches: weapon and action animation integration; then single-player
inventory, equipping, aiming, shooting and reloading. AI and multiplayer follow.

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

The source kit's included licence restricts asset redistribution and identifies
some separately licensed animations (including downed states). Git commits contain
original integration tools/code, not the purchased source or exported asset bytes.
Check the relevant asset licences before distributing a build containing them.
