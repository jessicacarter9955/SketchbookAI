import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {validateUnrealDistrictManifest,loadUnrealDistricts,UE_DISTRICTS}
 from '../src/editor/UeDistrictImport.js';

const entry=(id='ny')=>({
 source_type:'UNREAL_NATIVE_LEVEL',url:id+'/scene.glb',license:'CC0',
 source_url:'https://github.com/example/free-unreal-source',
 placement:{position:[-165,0,-172],rotationY:0,scale:1},coverage:'architecture-only'
});
test('DDS UE2Three district manifest must carry safe genuine Unreal origin',()=>{
 assert.deepEqual(UE_DISTRICTS,['ny','sf','rio','miami']);
 const m=validateUnrealDistrictManifest({version:1,districts:{ny:entry()}});
 assert.equal(m.districts.ny.url,'build/local-scenes/ue2three-districts/ny/scene.glb');
 for(const invalid of [
  {...entry(),url:'../../private.glb'},
  {...entry(),source_type:'procedural_preview'},
  {...entry(),license:'Unknown'},
  {...entry(),source_url:'javascript:alert(1)'},
  {...entry(),placement:{position:[Infinity,0,0]}}
 ])assert.throws(()=>validateUnrealDistrictManifest({version:1,districts:{ny:invalid}}));
});
test('404 exposes procedural preview truthfully, without pretending Unreal assets exist',async()=>{
 const r=await loadUnrealDistricts({fetcher:async()=>({status:404,ok:false})});
 assert.equal(r.items.length,0);assert.equal(r.missing,true);
});
test('real PBR glTF loads, tags provenance and keeps correct authored transform',async()=>{
 const mock=new THREE.Group();
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(1,2,1),
   new THREE.MeshStandardMaterial({map:new THREE.Texture()}));mock.add(mesh);
 const response={ok:true,json:async()=>({version:1,districts:{ny:entry()}})};
 const r=await loadUnrealDistricts({fetcher:async()=>response,
   loader:{loadAsync:async name=>{assert.match(name,/ny\/scene\.glb$/);return {scene:mock};}}});
 assert.equal(r.items.length,1);
 assert.equal(r.items[0].meshes,1);
 assert.equal(r.items[0].coverage,'architecture-only');
 assert.deepEqual(mock.position.toArray(),[-165,0,-172]);
 assert.equal(mock.userData.ue2three.license,'CC0');
});
test('GLB with no real PBR texture does not replace procedural city',async()=>{
 const scene=new THREE.Group();
 scene.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()));
 const r=await loadUnrealDistricts({
  fetcher:async()=>({ok:true,json:async()=>({version:1,districts:{rio:entry('rio')}})}),
  loader:{loadAsync:async()=>({scene})}});
 assert.equal(r.items.length,0);
 assert.equal(r.errors[0].id,'rio');
});
