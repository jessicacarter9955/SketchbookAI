import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {validateScene} from '../src/editor/scene-data.mjs';
import {BUILTIN_SCENES} from '../src/editor/scene-catalog.mjs';
const s=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('separate GTA StreetLab scene shares genuine original SA geometry but independent saved objects',()=>{
 assert.ok(BUILTIN_SCENES.some(x=>x.id==='san-andreas-streetlab'&&x.world==='san-andreas'));
 assert.match(s('src/editor/start.js'),/mountStreetLabGarage/);
});
test('playable imported sports car and pedestrian preserve prefab plus assetId through save',()=>{
 for(const prefab of ['vehicle','pedestrian']){
  const scene=validateScene({version:1,world:'san-andreas',objects:[{id:'licensed-1',prefab,assetId:'licensed-asset',name:'User downloaded GLB',position:[0,1,2],rotation:[0,0,0],scale:[1,1,1],collider:false}]});
  assert.equal(scene.objects[0].prefab,prefab);assert.equal(scene.objects[0].assetId,'licensed-asset');
 }
 assert.match(s('src/editor/ActorLayer.js'),/Imported licensed drivable sports car/);
 assert.match(s('src/editor/SanAndreasPopulation.js'),/addImportedPedestrian/);
});
test('StreetLab sources are exact source pages rather than fake 3D assets',()=>{
 const code=s('src/editor/StreetLabGarage.js');assert.match(code,/sketchfab.com\/3d-models\/bmw/);
 assert.match(code,/ferrari/);assert.match(code,/porsche/);
 assert.match(code,/importBytes/);assert.match(code,/interactivePrefab/);
});
