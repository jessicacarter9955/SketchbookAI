# WorldBLD native Unreal city-block experiment (no GPU activated)

Goal: create one **native WorldBLD / RoadBLD / CityBLD** block, with four streets, two-lane road presets, sidewalks, four intersections, parcels and buildings; then save actual Unreal assets and native-editor screenshots. Do NOT claim the JSON planning file is a rendered city.

## Present evidence and blockers (2026-10-16)

- Playwright Chromium navigated the real WorldBLD and Lightning sites and saved screenshots (GitHub Actions run 38893147945).
- WorldBLD is free as a hub; RoadBLD and CityBLD are PREMIUM with a seven-day free trial. Do not activate the trial until a compatible Unreal workstation has been verified.
- WorldBLD lists Linux/macOS as an Enterprise entitlement, while Lightning Studio environments are Linux. **Do not assume WorldBLD works on Lightning's free/Indie tier.**
- Official WorldBLD MCP toolset currently expects Unreal 5.8.3 and compatible plugin builds. Official CityBLD MCP cannot draw new blocks or place new buildings from scratch: those actions must be made with native UE viewport tools.
- The most faithful deployment path is a **Windows cloud GPU** with UE 5.8.3, WorldBLD plugins, RoadBLD, CityBLD, and a license/trial. Windows cloud GPUs are NOT proven free here and may require verified cloud signup and quota approvals.
- Lightning free CPU is appropriate for source prep, code, asset manifests and CI only until Linux entitlement and plugin build compatibility are verified. Switching it to GPU will not make Windows-only plugins work.

## What exists here

- `city-block-plan.json`: dimensional specification for four streets and a closed city block, building targets and native tool acceptance gates.
- `validate-block.cjs`: CPU-only structural validation, not a world-generation engine.
- `probe.cjs`: real, read-only browser navigation and screenshots.
- `lightning_runner.py`: safe dry-run by default. Does not create an account, activate a GPU, or subscribe to any service. To permit a GPU execution, both `--execute --allow-gpu` and environment `LIGHTNING_ALLOW_GPU=YES` must be passed; an account API key and existing Studio/teamspace are also required. The script always attempts `studio.stop()` after execution or failure.
- The actual WorldBLD scene, saved UE assets and viewport screenshots remain **not built**, and are required to mark this task as done.

## Native WorldBLD acceptance steps (after Windows Unreal/WorldBLD are legitimately available)

1. Install UE 5.8.3 and the compatible WorldBLD hub and RoadBLD/CityBLD plugin versions.
2. Open a blank Unreal level; activate an authorized seven-day trial when the editor and plugins work.
3. Select Modern Essentials Kit (or licensed equivalent); in RoadBLD draw **four** two-lane roads whose center lines are specified in `city-block-plan.json` (UE dimensions are centimeters), completing a rectangular loop.
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
