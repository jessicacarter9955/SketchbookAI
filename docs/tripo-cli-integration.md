# Tripo CLI in SketchbookAI (optional, isolated from original DDS)

This integration **does not replace or modify any Unreal DDS source packages**.
Tripo is an optional way to create new GLB assets, texture or rig imported meshes.
It is not an Unreal-to-Three.js source compiler or proof of DDS fidelity.

## Real connectivity check

The official [Tripo CLI](https://developers.tripo3d.ai/en/docs/cli) supports
`npx tripo-cli@latest doctor`, `tripo make`, and `tripo mcp`.

A dedicated GitHub Actions workflow, `.github/workflows/tripo-cli.yml`,
checks CLI availability on push. It then runs `doctor` if your account secret
is configured. **No generation commands run and no credits are spent by this workflow.**
A green Actions run without a secret means only CLI installation succeeded,
*not* that a Tripo account is connected.

To enable account checks without putting secrets into chat or repository files:
1. Sign in to the international [Tripo developer console](https://developers.tripo3d.ai).
2. Create an API key in your own account.
3. Open this GitHub repository's Settings > Secrets and variables > Actions >
   New repository secret. Name it exactly `TRIPO_API_KEY` and add your key.
4. Re-run the workflow or push a harmless update to its tracked documentation,
   then read the Actions job's `doctor` output for auth/network/balance status.

If you prefer local browser sign-in, run `npx tripo-cli@latest login` and
authorize the verification code yourself. Do not paste API keys in a chat.
The CLI can also expose `tripo mcp` to compatible MCP hosts, but that does
not automatically make it a connected ChatGPT plugin.

## Source/asset isolation

- Input references and source Unreal assets are immutable; never overwrite them.
- Write Tripo-generated assets under `tripo-out/`, which is gitignored, until
  manually inspected and explicitly approved for game integration.
- Generation, rigging and texture tasks consume Tripo credits. Obtain explicit
  scope and cost agreement before starting any billed Tripo task.
- Do not use Tripo-created assets to mark original DDS animation, mannequin,
  weapon, material or Blueprint conversions as source-accurate.

As of 17 October 2026, the connected Drive DDS folder inspection did not return
the original `.uproject` file or actual `.uasset` and `.umap` binaries in the
checked subfolders. Codex's local export/cache artifacts were not committed.
Original-game replay requires that source and the matching cached conversion.
