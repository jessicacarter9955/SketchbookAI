# ue2three saved handoff · 2026-10-13

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

30 translated functions: 24 with source behavior and six empty
callbacks. 470 functions are blocked in parsed packages; 60 delegate signatures
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
4. Add local-call/out-parameter support and native adapters incrementally, with
   exact source ownership and explicit unsupported dependencies.
5. Connect complete translated paths to runtime only when their required state
   and native dependencies exist; getters alone do not make a game system green.
6. Regenerate reports, check in the integrated browser, save screenshots, push.

Last browser result: 30 functions / 90 generic scenarios + 32 DDS comparisons
passed. Cases live in `tests/fixtures/dds-blueprints.json`; their bytecode hashes
must match the parsed source. Open the Blueprint audit with
`&fixtures=dds-blueprints.json` for these DDS-specific comparisons. Animation
checks remain deferred. Native preview server supports `pythonw` without stderr.

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
