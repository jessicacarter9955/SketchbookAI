import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const s=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('3D traffic lights reflect all-red and terrain heights with safe GPU instancing',()=>{
 const src=s('src/editor/UrbanSignals.js');
 assert.match(src,/phase!==head.axis/);
 assert.match(src,/urbanGroundHeight\(x,z,config\)/);
 assert.match(src,/new THREE.InstancedMesh/);
});
test('large HD city is opt-in and reports drawcalls and low FPS occlusion budget',()=>{
 assert.match(s('src/editor/start.js'),/query.get\('cityBlocks'\)/);
 assert.match(s('src/editor/start.js'),/cityBenchmarkSuffix/);
 assert.match(s('src/editor/start.js'),/\.benchmark-/);
 assert.match(s('src/editor/UrbanRuntime.js'),/draw calls/);
 assert.match(s('src/editor/UrbanRuntime.js'),/this.fps<40\?540:320/);
});
