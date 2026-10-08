# Urban third-party notices

The urban branch is informed by two MIT-licensed Unreal Engine references:

- YuuhenR/roadforge-osm-ue5-procedural-city (RoadForge), MIT. Reference concepts: OSM road geometry, lane markings, segmented curbs, sidewalks, junction cleanup, bridge/layer semantics and building metadata.
- Erisbv-zz/UNREAL-Procedural-Cities, with the original master-thesis lineage at magnificus/Procedural-Cities, MIT. Reference concepts: road/layout versus plot/building generation, editable generator parameters, facade decomposition, balconies, roof/service-volume breakup and playable-city validation.

No Unreal uasset content from these projects is claimed or bundled.

Poly Haven resources used by the visual layer are CC0. The CI fetcher downloads checksum-verifiable glTF/material/HDRI inputs. Downloaded files must not be claimed present merely because a manifest entry exists.

RoadForge textures under assets/roadforge come from the upstream CC0 texture folder; checksums are pinned in tools/fetch-urban-kits.py.

OpenStreetMap-derived datasets must retain the attribution required by the ODbL.

SketchbookAI JavaScript is an independent adaptation of these ideas unless a source file carries a more specific notice. Any future substantial source-code port must retain the relevant upstream MIT copyright and license notice beside that port.

## Contemporary architecture and lawn inspection

`UrbanTowers.js` models three original building types: a curtain-wall tower with faceted curved corners, a stone setback tower and a terraced residential building. These are custom procedural meshes, not scanned or downloaded skyscrapers. `UrbanLawns.js` adds curved blade geometry with distance-based levels of detail.

Additional CC0 Poly Haven inputs fetched at 2K: `concrete_tile_facade`, `white_sandstone_blocks_02`, `grass_ground`; the asset studio uses the `modern_buildings_2` HDRI. The production skyline uses its own local reflection capture. Screenshots from `urban-assets.html` are actual WebGL renders. The models are a realism improvement in progress, not a claim of achieved photorealism.
