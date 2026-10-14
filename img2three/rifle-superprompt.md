# LIME CARBINE — SOURCE-LOCKED THREE.JS RECONSTRUCTION
Source: img2three/viewer/public/ref/rifle.webp (RGBA photograph cut directly from the user's original green-carbine image, not an AI-generated substitution).
Target: native Three.js scene geometry. DO NOT output another 2D image.

Reconstruct only the lime-green carbine in the provided image as a high-fidelity, photorealistic, fully interactive Three.js model. Treat the original photo as the authoritative source, not a loose design inspiration. Preserve its visible-side silhouette, scale, color distribution, distinctive controls, handguard, black brace, grip, magazine with AMEND2 markings, and accessory-rail profile. No generic reimagining, no low-poly stylization, no uniform wall thickness.

Observe the input photo before implementing geometry: annotate reference-facing contours, normalized component regions, the handguard and its dark slot openings, magazine taper, the original pistol-grip angle, accessory rail, barrel front, the trigger-guard space, and all salient high-frequency details. Encode component hierarchy and dimensions in the source, not just prose.

Image-side likeness is locked: use the actual photo texture on the outward-facing surfaces, not an AI-generated substitute. Never overwrite its markings, details or exact palette with generic diffuse fills. Preserve side UV projection without unwanted smearing/stretching. Derive roughness, metallic, normals and AO independently of the reference's baked lighting.

Build *real depth* behind the source-facing surface: variable cross-sections (receiver thicker than the handguard, handgrip, stock/brace and magazine separately), curved high-segment rim of the barrel, visible hollow muzzle, dimensional rail edges, fillets and mechanical gaps at major component boundaries. Shape the hidden side conservatively; do NOT invent geometry which compromises the source-facing likeness. No fake black rectangle in lieu of an aperture; do not paint a pretend hole when the object can be modeled with opening walls.

Three.js PBR: green coated metal, polymer/rubber grip, black brace/magazine and dark machined metal must have different roughness/metalness. Realistic reflections, contact shading, softbox-like HDR environment, physically consistent normals. No chrome-white sides, billboard cards or accidental flat-extrusion sidewalls.

Quality gate: screenshots at source-facing, three-quarter, frontal-end and rear angles. Refuse to call the model photoreal 9/10 if the muzzle is capped, object proportions drift, side walls appear featureless or visual reference detail is lost. Keep code and testable browser preview on img2threejs-runner; preserve other gallery assets and the original reference source.