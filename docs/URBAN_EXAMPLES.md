# Three actual urban asset experiments

Open `urban-examples.html` after `npm ci` and `python tools/fetch-urban-kits.py`.
The page imports the installed Three.js package directly and runs with any static HTTP server.

- Residential: 10 apartment blocks, full facades on all four sides, 2,160 modules.
- Industrial: 6 factory blocks assembled from the independent brick facade kit.
- Courtyard: mixed apartment/factory kit, central lawn, paths and benches.

These are Three.js visual prototypes, not Unreal Engine renders or City Sample imports.
Individual 3 m wall, window, door and cornice modules are assembled at native scale.
The source kit layout is never stretched over a building. The third CC0 asset is Poly Haven Tree Small 02 with actual foliage, bark and leaf materials.
The prototypes do not yet provide Sketchbook physics, editable facade modules, crowd AI,
vehicle controllers, high-quality asphalt, or a finished photoreal city. Existing editor
scenes remain available via the Editor link.

## Provenance

Poly Haven kits are CC0:
https://polyhaven.com/license
https://polyhaven.com/a/modular_urban_apartments_facade
https://polyhaven.com/a/modular_factory_facade
https://polyhaven.com/a/tree_small_02

The downloader obtains the complete glTF and relative resources at 1K and verifies each
MD5 supplied by the API. Downloads are local; they are not represented as committed assets.
No Fab, Sketchfab account, API key or Unreal installation is needed for these experiments.
