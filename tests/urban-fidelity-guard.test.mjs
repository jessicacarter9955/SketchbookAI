import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

// These are regression contracts for the ORIGINAL urban scene, not synthetic
// screenshots. A performance change is allowed to skip/cull a mesh, NEVER to
// silently swap the authored art or open a placeholder view as "HD ready".
const read=path=>readFileSync(resolve(import.meta.dirname,'..',path),'utf8');
test('original Sketchbook actor models and independent DDS player are preserved',()=>{
  const src=read('src/editor/ActorLayer.js');
  assert.match(src,/\['boxman', 'car'\]\.map\(name => new GLTFLoader/);
  assert.match(src,/if\(profile === 'dds'\) this\.playerModel = await loadDdsPlayer\(\)/);
  assert.match(src,/new Car\(\{ \.\.\.this\.car, scene: clone\(this\.car\.scene\) \}\)/);
  assert.doesNotMatch(src,/city-soldier\.glb|city-ferrari\.glb|prepareUrbanCar|prepareUrbanPerson/);
});
test('HD city never silently falls back to lite, placeholder or premature play',()=>{
  const start=read('src/editor/start.js');
  const runtime=read('src/editor/UrbanRuntime.js');
  assert.match(runtime,/this\.mobileLite=url\.get\('quality'\)==='lite'/);
  assert.match(start,/const visual=await world\.levelRuntime\.visualPromise/);
  assert.match(start,/visual\?\.status!=='ready'/);
  assert.match(runtime,/await this\.prepareAllPhotorealDetails\(\)/);
  assert.match(runtime,/for\(const parts of streamer\.placeholders\.values\(\)\)/);
  assert.match(runtime,/streamer\.placeholders\.clear\(\)/);
  assert.match(runtime,/photorealReady=errors\.length===0/);
});
test('original imported PBR glTF assets, lighting and urban texture pipeline are required',()=>{
  const runtime=read('src/editor/UrbanRuntime.js');
  const architecture=read('src/editor/UrbanArchitecture.js');
  const trees=read('src/editor/UrbanVegetation.js');
  const light=read('src/editor/UrbanLighting.js');
  const props=read('src/editor/UrbanProps.js');
  for(const asset of ['modular_urban_apartments_facade','modular_factory_facade','tree_small_02','asphalt_02','concrete_pavement','leafy_grass']){
    assert.ok(runtime.includes(asset)||light.includes(asset)||trees.includes(asset),asset+' missing');
  }
  for(const asset of ['street_lamp_01','painted_wooden_bench','metal_trash_can'])
    assert.ok(props.includes(asset),asset+' missing');
  assert.match(architecture,/instanceArchitecture\(source\)/);
  assert.match(architecture,/mesh\.geometry|node\.geometry/);
  assert.match(trees,/scene-lod\$\{level\}\.gltf/);
  assert.match(light,/scene\.environment=environment\.texture/);
  assert.match(runtime,/this\.loadPhotorealArchitecture|loadPhotorealArchitecture\(group/);
});
test('WebGPU benchmark remains separate; it cannot replace the original City Player',()=>{
  const file=read('urban-webgpu.html');
  const game=read('editor.html');
  assert.match(file,/city-benchmark\.mjs/);
  assert.match(game,/editor\.bundle\.js|src\/editor\/start\.js/);
  assert.doesNotMatch(game,/city-benchmark\.mjs/);
});
