# ARCADELAB · Two Original Incremental Arcade Game Concepts

A playable web concept inspired by arcade incremental games, with original procedural art and a colorful Supercell-like interface. This is NOT the source code of either commercial game and does not imply affiliation.

## Modes
- **Black Hole**: drag / WASD to move. Physically pull asteroids, gems, planets and stars. Eight upgrade trees, five escalating sectors, burst and overdrive.
- **Keep Fishing**: click the water once per line, click biting floats (!), fill and sell backpack, independently cast multiple rods, improve bait, income and automation, unlock five ocean themes.

## Run
Static site. Open `index.html` (ES modules need an HTTP server). Run `python3 -m http.server 4173` then visit http://localhost:4173. `npm test` for deterministic economy tests; `npm run build` copies static files to `dist`.

Save data is in localStorage per mode. Editing progression and upgrade values is done in `economy.js`, environment/visual code in `app.js`, UI in `app.css`.

Controls: mouse/touch, WASD / arrows (black hole), SPACE triggers special/casting, 1/2 switch games.