import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {saFileSector} from '../src/editor/sa-local-map.mjs';
import {WORLD_IDS} from '../src/editor/island-data.mjs';
import {BUILTIN_SCENES} from '../src/editor/scene-catalog.mjs';
const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('GTA SA local scene can be opened after importing real assets, not placeholders',()=>{
 assert.ok(WORLD_IDS.includes('san-andreas'));
 assert.ok(BUILTIN_SCENES.some(scene=>scene.id==='san-andreas-local'&&scene.world==='san-andreas'));
 assert.match(source('sa-navigation.html'),/id="sa-play"/);
 assert.match(source('src/editor/start.js'),/new SanAndreasRuntime\(world\)/);
 assert.match(source('src/editor/SanAndreasRuntime.js'),/Nessuna geometria San Andreas importata/);
 assert.doesNotMatch(source('src/editor/SanAndreasRuntime.js'),/BoxGeometry|SphereGeometry|mockSector/);
});
test('GTA SA binary node file naming validation does not accept other files or sectors',()=>{
 for(let i=0;i<64;i++)assert.equal(saFileSector('nodes'+i+'.dat'),i);
 for(const x of ['nodes64.dat','nodes-1.dat','nodes.txt','nodes1.dat.exe','other1.dat'])assert.equal(saFileSector(x),null);
});
test('original GLB geometry is used for rendering, raycast ground and Cannon collision',()=>{
 const s=source('src/editor/SanAndreasRuntime.js');
 assert.match(s,/GLTFLoader/);assert.match(s,/CANNON.Trimesh/);
 assert.match(s,/new THREE.Raycaster/);assert.match(s,/MAX_ACTIVE_COLLIDERS/);
 assert.match(s,/buildSanAndreasNetwork/);
 assert.match(source('src/editor/sa-viewer.js'),/saveSanAndreasFiles\('geometry',files\)/);
});
