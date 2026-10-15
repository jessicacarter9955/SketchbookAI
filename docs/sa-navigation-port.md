# GTA San Andreas navigation import

This branch is for GTA gameplay porting, NOT img2threejs.

The browser game includes Three.js pedestrian, traffic and DDS weapon event systems. The binary parser now reads the same GTA SA node and link record format used by SanAndreasUnity's NodeFile.cs.

To import **legally obtained** game data:
```sh
node tools/import-sa-paths.mjs /path/to/nodes-files build/local-scenes/sa-navigation/navigation.json
```

Place nodes0.dat to nodes63.dat in the input folder. The tool exports separate pedestrian and vehicle networks with cross-sector links. There are no bundled Rockstar assets or procedural substitutions.

Current limitation: GTA San Andreas geometry, textures and corresponding collision meshes are not yet connected to these imported paths. The existing playable preview is still Sketchbook's procedural city. The import alone does not provide a playable SA map.
