# WorldBLD native Unreal city-block experiment (no GPU activated)

Goal: create one **native WorldBLD / RoadBLD / CityBLD** block, with four streets, two-lane road presets, sidewalks, four intersections, parcels and buildings; then save actual Unreal assets and native-editor screenshots. Do NOT claim the JSON planning file is a rendered city.

## Present evidence and blockers (2026-10-16)

- Playwright Chromium navigated the real WorldBLD and Lightning sites and saved screenshots (GitHub Actions run 38893147945).
- WorldBLD is free as a hub; RoadBLD and CityBLD are PREMIUM with a seven-day free trial. Do not activate the trial until a compatible Unreal workstation has been verified.
- WorldBLD lists Linux/macOS as an Enterprise entitlement, while Lightning Studio environments are Linux. **Do not assume WorldBLD works on Lightning's free/Indie tier.**
- Official WorldBLD MCP toolset currently expects Unreal 5.8.3 and compatible plugin builds. Official CityBLD MCP cannot draw new blocks or place new buildings from scratch: those actions must be made with native UE viewport tools.
- The most faithful deployment path is a **Windows cloud GPU** with UE 5.8.3, WorldBLD plugins, RoadBLD, CityBLD, and a license/trial. Windows cloud GPUs are NOT proven free here and may require verified cloud signup and quota approvals.
- Lightning free CPU is appropriate for source prep, code, asset manifests and CI only until Linux entitlement and plugin build compatibility are verified. Switching it to GPU will not make Windows-only plugins work.

## Real Windows compatibility tests — 2026-10-16

**Verified by executing GitHub Actions on `windows-latest`, not by assuming specs.**
- WorldBLD 5.8 official full plugin ZIP is publicly retrievable with HTTP byte-ranges: **2,537,684,720 bytes** (~2.36 GiB). We downloaded only tiny ranges of its ZIP index, never its licensed full archive.
- The official `WorldBLD.uplugin` inside the ZIP declares version **1.4.12**, `EngineVersion: 5.8.0`. All three relevant native modules—`WorldBLDBootstrap`, `WorldBLDRuntime`, and `WorldBLDEditor`—explicitly contain `PlatformAllowList: ["Win64"]`. The ZIP contains three Windows DLLs and **zero Linux .so binaries**. This is direct proof Lightning's Linux GPU cannot run this distributed WorldBLD build. Stop prioritizing Lightning for *native WorldBLD*.
- The GitHub Windows runner had **146.85 GiB of free storage** in the test, but **UnrealEditor.exe was not installed**. Windows CPU runner can verify file formats but cannot build/render a native WorldBLD level without an authorized Unreal install.
- The authenticated GitHub connector returned **404** for private `EpicGames/UnrealEngine` source. A linked Epic account/engine installer is a distinct prerequisite; do not replace it with unrelated GitHub repositories.
- GitHub's Windows GPU larger runner costs **$0.102/minute** and requires **an organization on GitHub Team/Enterprise**. It cannot be started simply by switching a personal public repository to `runs-on: windows-gpu`. GitHub standard Windows CPU runners remain free on public repos.
- Genuine **native WorldBLD** requires Windows Unreal 5.8.3 and active RoadBLD/CityBLD license/trial. Alternatives to vet for a *legitimate* Windows GPU desktop include iRender's no-card, manually reviewed free trial (Windows RTX 4090) and paid Windows cloud GPU VMs; neither is provisioned or approved. Do not launch billable compute without explicit charge ceiling.
- Official WorldBLD 5.8 binaries and license-bearing plugin assets must **never** be committed to this public GitHub repo. Install them inside an authorized workstation only.

**Evidence:** [Windows official ZIP compatibility and metadata run](https://github.com/jessicacarter9955/SketchbookAI/actions/runs/38899249813), [no-GPU native Unreal project static validation](https://github.com/jessicacarter9955/SketchbookAI/actions/runs/38899480083).

## What exists here

- `city-block-plan.json`: dimensional specification for four streets and a closed city block, building targets and native tool acceptance gates.
- `validate-block.cjs`: CPU-only structural validation, not a world-generation engine.
- `generate-osm.cjs`: generates a **synthetic, valid OSM/StreetMap file** with four connected 2-lane roads and ten building footprint ways; CI puts `worldbld-city-block.osm` in its downloadable artifact. This is native GIS input intended for CityBLD's documented OpenStreetMap import, **not yet imported or rendered**.
- `probe.cjs`: real, read-only browser navigation and screenshots.
- `lightning_runner.py`: safe dry-run by default. Does not create an account, activate a GPU, or subscribe to any service. To permit a GPU execution, both `--execute --allow-gpu` and environment `LIGHTNING_ALLOW_GPU=YES` must be passed; an account API key and existing Studio/teamspace are also required. The script always attempts `studio.stop()` after execution or failure.
- The actual WorldBLD scene, saved UE assets and viewport screenshots remain **not built**, and are required to mark this task as done.

## Native WorldBLD acceptance steps (after Windows Unreal/WorldBLD are legitimately available)

1. Install UE 5.8.3 and the compatible WorldBLD hub and RoadBLD/CityBLD plugin versions.
2. Open a blank Unreal level; activate an authorized seven-day trial when the editor and plugins work.
3. Select Modern Essentials Kit (or licensed equivalent). Prefer the **native OSM import** workflow documented by WorldBLD: import the CI-generated `worldbld-city-block.osm` using Unreal's StreetMap asset integration, then use RoadBLD/CityBLD to convert the four street ways into its actual roads and blocks. If the installed version doesn't support automatic import, draw the four two-lane roads manually in the RoadBLD viewport using coordinates in `city-block-plan.json`.
4. Validate four intersections and sidewalks. In CityBLD select the district, use its native viewport block tools to form an enclosed urban block; subdivide into approximately 12 parcels and generate 8–12 low-rise buildings.
5. Save the Unreal level and all project content. Reopen to ensure all generated actors and meshes persist.
6. Capture actual editor screenshots plus a map of placed actors and a run log as durable artifacts. Only then declare the job complete.
7. Stop billed GPU compute, **also on failure** to prevent uncontrolled charges, preserving checkpoint files for retry. Never assume screenshot existence without verifying artifacts.

## CPU-only tests

```sh
node tools/worldbld-browser/validate-block.cjs
python -m py_compile tools/worldbld-browser/lightning_runner.py
python tools/worldbld-browser/lightning_runner.py
```

No tokens or passwords should ever be committed in this public repository or uploaded into screenshots/logs. Use GitHub Actions encrypted secrets only after a user completes service authentication. GitHub OAuth cannot be completed by an ordinary GitHub App token.
