# Experimental Three.js humanoid rig

**Isolated branch:** `experiment/procedural-humanoid-rig`

This proof of concept is **not imported or enabled by the main urban branch**.
It uses native Three.js `Group` pivots for hips, spine, neck, shoulders,
elbows, wrists, hips, knees and ankles with independently movable mesh parts.
It is not an automatic rigging/skinning algorithm and does not alter the
original `boxman.glb` source asset.

## Manual preview
Open the existing procedural-city game with `&play=1&rigDemo=1` added
to the editor URL; move close to an NPC and press **E**. During the dialogue
the experimental jointed stand-in temporarily replaces that NPC's visual
model, animates its neck/spine/right shoulder/right elbow, and is removed
after closing the conversation. Other NPCs remain unchanged.

Example: `editor.html?scene=urban-photoreal&play=1&rigDemo=1`.
The default game URL has no new rig behavior.

## Resource isolation
- Existing urban CI trigger only matches `urban-procedural-vehicles`.
- No new branch push CI, model downloads, neural inference or GPU work.
- No new runtime dependencies; only `three` already in the project.
- Changes to this experiment remain separate unless explicitly merged.

## Limitations
The temporary avatar is a newly built articulated mesh, NOT joints inferred
from `boxman.glb`. If the GLB has a suitable skeleton, use existing
`humanoid-rig.mjs` bone inspection and animate those bones instead.
