# Little Big Catch · Three.js Fishing Incremental

A standalone original browser fishing game inspired by the progression loop of casual fishing incrementals. This is an independent prototype, **not** the proprietary Steam game or a copy of its assets. The implementation does not incorporate Wawa Sensei code, whose repository lacks an explicit reuse license.

## Play
- WASD/arrows or on-screen joystick to walk. Hold then release click/tap over water to cast. Click/tap on a red ! to hook.
- Fish fill a small backpack. Walk to barrel and press E (or tap Sell) to exchange fish for coins.
- Spend coins in the 14-branch upgrade shop (SPACE). Grow your backpack, rods, fish per bobber, lure, cast, rare fish, coin multiplier, magnet, fish density, passive anglers, drones, crate deliveries and auto fishing.
- Gather driftwood; when the boat is ready, sell everything and go to the next island. Four distinct biomes with persistent upgrades.
- Open EDITOR to resize terrain, place objects, and import/export maps as JSON. Progress and maps autosave in localStorage.

## Development
`npm install && npm run dev`
`npm test`
`npm run build`

Tested economics with Node's built-in test runner. Production build requires npm dependencies (three.js + Vite). Source is an original procedural 3D implementation, no third-party assets embedded.

## Project boundaries
The playable prototype reproduces the **core first-hour loop**, with 4 islands, and does **not** claim to contain all ~12 Steam game islands, original mini games, achievements or exact balance. Future development can extend gameplay from src/systems.js and scene generation from src/main.js. Source design may be modified commercially; external sources and references retain their respective rights.

## Code organization
- src/systems.js: pure progression and economy logic, testable without Three.js
- src/main.js: procedural rendering, character, island, fish, fishing lines, interactions, editor UI
- src/style.css: responsive HUD and skill tree
- tests/economy.test.js: automatic economy assertions