# Image-reference → Three.js: permanent working contract

This standard applies to **every asset built in this img2threejs branch**.

1. Primary image is the authoritative visual target. Preserve identifiable silhouette, camera angle, visible proportions, color distribution, material identity and small details. AI-generated additional views are **hypotheses** for missing geometry, NEVER evidence that overrides the real front reference.
2. Use original img2threejs workflow (assessment, spec, generation, validation) wherever supported; add a rigorously labeled correction/refinement stage for photorealistic scene geometry. Never pass a primitive-only blockout off as a finished asset.
3. Physically plausible PBR materials: roughness/metalness/IOR/reflections/transparency/normal maps as appropriate; subtle studio lighting and contact shadows. For transparent architecture glass, account for recessed interiors and avoid washed-out plastic.
4. Build **true 3D**, not flat camera-facing billboards, fake light-field surfaces or a single pasted image. Geometry must remain useful from front, oblique and rear angles.
5. For each subject generate reference-constrained auxiliary views (e.g., 3/4, opposite profile) if needed; label unseen surfaces as **inferred**. Do not claim mathematical 1:1 reconstruction from one image.
6. Use a single interactive viewer for the original supplied subjects: tower, compact purple pistol, long purple cylindrical pistol, lime-green rifle, and multi-trunk tree. Let user choose models, orbit, zoom and save screenshots.
7. Run Vite build and automatic WebGL/Chromium smoke tests of the real viewer. Compare screenshots with the primary image; fix silhouette, proportion, color and material problems before declaring an asset completed.
8. For games prefer GPU instancing / shared geometry, trimmed texture memory, selective shadows and optional LOD; provide an optimized GLB export where possible for static production assets.
9. Do not ask the user to repeat the quality specifications or re-upload existing references when available.
10. Status reports must separate **implemented**, **compiled**, **WebGL-tested**, and **visually approved** (the latter only when comparable evidence exists). Use honest quality estimates; prioritize fidelity over feature/checklist theater.

> User standard: TOP QUALITY · PHOTO-REALISTIC · AS CLOSE TO ORIGINAL REFERENCE (1:1 AIM) AS EVIDENCE ALLOWS · MAKE MISSING VIEWS AUTOMATICALLY.
