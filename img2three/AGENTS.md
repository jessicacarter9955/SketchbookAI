# img2threejs — persistent agent operating instructions

## Verify GitHub/Render tools before making availability claims

- For any request to work on this project, **do not assert that GitHub or Render is unavailable merely because you do not see a dedicated tool namespace, because an earlier reply said so, or because a prior session had different tools**.
- First inspect the runtime tool inventory, including tools available via `functions.exec` / `ALL_TOOLS`, for `mcp__GitHub__*` and `mcp__Render__*`.
- Where a suitable GitHub tool is present, **make an actual read-only call** (e.g. `mcp__GitHub__get_repo`) before declaring the connection working or broken. If a call fails, report the specific tested limitation. Do not claim access is permanently available either: reverify when needed.
- Primary repository: `jessicacarter9955/SketchbookAI`; work on isolated branch `img2threejs-runner`, never main without explicit user direction.
- User prefers **actual work on the repository, code commits, GitHub Actions build/Chromium WebGL verification and clickable live Three.js preview**, not generic plans or assurances. Work first, summarize verified outcomes afterward.

## Reference-first, native Three.js

- User original images remain the **master reference**. No AI-generated substitute and no unrelated model used to replace the reference.
- Target high-fidelity real Three.js reconstruction from front, three-quarter, back and end views. If code is an unrefined extrusion or has visibly wrong proportions, do not present it as photorealistic or 9/10.
- The user rated previous weapons and tree about 5/10. Iterate against screenshots, preferring actual multi-component geometry, correct UVs, curved natural organic geometry for the tree, suitable physically based shading, and reference comparison.
- Official examples to study for methodology: `img2threejs/img2threejs-showcase`: `src/demos/glock-ghost-protocol/`, `src/demos/awp-medusa-v2/`. Beware that `monster-tree` is a rigged character, not the same species/shape as the user's photographic tree.
- Never confuse a 2D image render from an image generator with an interactive, source-editable Three.js model.
- Report **separately** what is edited, built, browser-tested, and visually validated. Provide links only to actually existing preview/code paths.

These are repo-scoped, persistent project instructions. They are not a substitute for checking current tool access or for user-controlled ChatGPT Memory settings.
