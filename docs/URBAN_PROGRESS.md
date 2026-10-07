# Urban procedural vehicles — branch status

Updated: 2026-10-07

## Completed
- Procedural City world type with deterministic seed and configurable blocks, roads, sidewalks, floors, density, terrain and sky.
- RoadForge-inspired roads using verified upstream CC0 asphalt/concrete textures.
- Unreal Procedural-Cities-inspired lot subdivision, facade variation, balconies and roof details.
- Playable vehicle spawn reusing Sketchbook ActorLayer and vehicle controller.
- OSM/GeoJSON import into local metric scene coordinates.
- Editor Log / Diagnostics panel.
- Fab source beside Sketchfab: free search, categories and portable GLB/ZIP import.
- Prompt-aware Fab discovery maps descriptions such as modern sports car, urban road network and industrial facade to useful categories.
- Residential, industrial and courtyard CC0 visual experiments.
- GitHub Actions visual-verification workflow for editor and urban experiment screenshots.

## Verification
- Fab prompt/search unit slice executed with Node on 2026-10-07: 4 passed, 0 failed.
- npm test includes editor, surfaces, island, urban, GeoJSON, Fab and DDS tests.
- urban-ci.yml runs dependency install, verified CC0 asset fetch, full tests, production build, Chromium and screenshot capture.
- No successful browser screenshot artifact is claimed here yet; visual evidence is pending.

## Recent commits
- 4e4005b — prompt-aware Fab asset discovery.
- b65da01 — tests for Fab prompt category inference.

## Next
1. Add richer Fab listing provenance and preview handoff while keeping acquisition on Fab.
2. Produce and retain browser screenshots from CI.
3. Add traffic route data and AI traffic on the existing Sketchbook vehicle implementation.
4. Extend OSM import from primitive segments toward generated road graph and blocks.
5. Continue replacing placeholder vegetation/building surfaces with redistributable CC0 or permissive assets where mobile performance allows.

See docs/UNREAL_URBAN_REFERENCES.md for source-project provenance.
