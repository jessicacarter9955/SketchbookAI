# CityBLD + Modern City — authentic porting lane

**Strict source policy:** a deliverable must come from an authorized, running
**WorldBLD / CityBLD / Modern City Kit** project in Unreal Engine 5.8.
No replacement buildings from other UE repositories, generic procedural-city
geometry, placeholder GLB, or fabricated screenshots.

## Current gate (not completed)

- WorldBLD download is free; CityBLD license or authorized no-card trial required.
- Official CityBLD docs list the 1.5.x series; use the newest compatible 5.8 release shown in the editor.
- Install the actual compatible *Modern City Essentials* kit through WorldBLD.
- A GPU Windows UE5.8 Editor must be live **before** starting the 7-day trial.
- No original CityBLD-exported NY GLB exists in this branch yet.

## Batch NY-001 workflow

1. Install WorldBLD, CityBLD, Modern City Essentials, Python Editor Script Plugin,
   and the built-in glTF Exporter plugin in UE 5.8 (official licensed account).
2. Use CityBLD's **editor viewport** tools to create the New York block,
   including the Modern City kit and road/parcel geometry; save the UE level.
   The WorldBLD MCP by itself does not draw new blocks.
3. In Unreal Editor select ONLY the generated actors for batch NY-001.
   Ensure converted/static geometry is available rather than preview-only procedural actors.
4. In the Unreal Python console run (update the Windows path to your checkout):
   `py "C:/SketchbookAI/tools/citybld/export_selected_citybld.py"`
   Optionally set `CITYBLD_BATCH_NAME`, `CITYBLD_EXPORT_DIR`,
   `CITYBLD_KIT_PLUGIN_NAME` (the real enabled kit plugin name) in the OS environment.
5. An honest export produces `Saved/CityBLDBatches/ny-001/ny-001.glb` and
   `manifest.json`, with real actor list, asset paths, license provenance
   metadata, SHA256 and source UE engine info.
6. Outside Unreal, run `python tools/citybld/verify_batch.py PATH_TO_BATCH_FOLDER`.
   If source, actual mesh geometry, PBR textures or checksum is missing, it **fails**.
7. Only after importing this real GLB into Three.js, compare Unreal and Three.js
   screenshots and material/transform/size fidelity. Then publish a live Netlify
   build for **manual user acceptance**, and proceed NY-002 only after approval.

## What this does not claim

This preflight is runnable/testable on GitHub without Unreal, but **it does not
run CityBLD**, generate a neighborhood, or certify visual fidelity. The physical
Unreal GPU editor, authentic kit and export binaries are mandatory. Source files
must be acquired legitimately and may be subject to restrictions on redistribution
and public preview deployment.
