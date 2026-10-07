# Unreal reference implementations used by the urban branch

This branch intentionally ports ideas from real Unreal Engine projects rather than treating the city system as an isolated Three.js demo.

## RoadForge
Source: https://github.com/YuuhenR/roadforge-osm-ue5-procedural-city
License: MIT. RoadForge Contributors, 2026.

Used as the primary reference for:
- OSM-driven road generation
- spline/resampling architecture
- lane markings
- raised curbs and sidewalks
- bridge/elevated-road concepts
- street-light scattering
- cinematic urban lighting setup

The mirrored asphalt/concrete textures under `assets/roadforge/` are documented upstream as CC0.

## UNREAL-Procedural-Cities
Source: https://github.com/Erisbv-zz/UNREAL-Procedural-Cities
License: MIT. Tobias Elinder, 2017.

Used as a reference for:
- plot subdivision
- floor-count variation
- facade breakup
- balconies on lower residential buildings
- roof/service details
- green/simple plots

Sketchbook does not bundle ambiguous third-party FBX/texture assets from that repository unless their individual redistribution rights are verified.
