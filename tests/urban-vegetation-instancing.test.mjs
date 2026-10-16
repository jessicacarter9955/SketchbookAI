import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const s=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('HD vegetation uses source Poly Haven tree GLTF geometry with true GPU batching',()=>{
 const src=s('src/editor/UrbanVegetation.js');
 assert.match(src,/new THREE.InstancedMesh/);
 assert.match(src,/scene-lod'\+level\+'\.gltf'/);
 assert.match(src,/instance\.count=0/);
 assert.match(src,/instanceMatrix\.needsUpdate=true/);
 assert.doesNotMatch(src,/root\.clone\(true\)/);
});
test('HD city loader no longer false-fails at 50s while GLTF is still progressing',()=>{
 const src=s('src/editor/UrbanRuntime.js');
 assert.doesNotMatch(src,/Timeout dettaglio HD:.*50000/);
 assert.match(src,/const value=await task\(\)/);
 assert.match(src,/await this.prepareAllPhotorealDetails\(\)/);
 assert.match(src,/if\(lod\.isLOD&&lod\.visible\)lod\.update/);
});
