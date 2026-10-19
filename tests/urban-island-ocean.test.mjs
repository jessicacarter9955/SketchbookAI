import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {DEFAULT_URBAN,generateUrbanPlan} from '../src/editor/urban-data.mjs';
import {miamiCoastLayout} from '../src/editor/urban-coast-layout.mjs';
import {waterNormals} from '../src/editor/island-water-normals.mjs';
import {urbanOceanGeometry,createUrbanIslandOcean,updateUrbanIslandOcean} from '../src/editor/urban-coast-water.mjs';
import {urbanSandHeight,buildUrbanBeachGeometry} from '../src/editor/urban-coast-sand.mjs';

const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const layout=()=>miamiCoastLayout(generateUrbanPlan(DEFAULT_URBAN).bounds,DEFAULT_URBAN.seed);

test('Miami coast reuses EXACT two-island Water shader/normal map rather than a flat material',()=>{
  const island=source('src/editor/IslandRuntime.js');
  const coastal=source('src/editor/UrbanCoast.js');
  assert.match(island,/new Water\(new THREE\.PlaneGeometry\(3000,3000\)/);
  assert.match(island,/import \{ waterNormals \} from '.\/island-water-normals\.mjs'/);
  assert.match(coastal,/createUrbanIslandOcean\(layout\)/);
  assert.doesNotMatch(coastal,/new THREE\.Mesh\(waterGeo,new THREE\.MeshPhysicalMaterial/);
  const normals=waterNormals();
  assert.equal(normals.image.width,128);
  assert.equal(normals.image.height,128);
  assert.equal(normals.wrapS,THREE.RepeatWrapping);
});

test('single reflective Water annulus surrounds all four shores WITHOUT drowning streets',()=>{
  const coast=layout(),geo=urbanOceanGeometry(coast);
  assert.equal(geo.getIndex().count,24,'four ocean strips, not four render targets');
  const dry=geo.userData.dryBounds;
  assert.ok(dry.minX<0&&dry.maxX>0&&dry.minZ<0&&dry.maxZ>0);
  const pos=geo.getAttribute('position'),ids=geo.getIndex();
  const [cx,cz]=coast.waterCenter;
  for(let i=0;i<ids.count;i+=3){
    const v=[0,1,2].map(k=>{
      const id=ids.getX(i+k);return {x:pos.getX(id)+cx,z:cz-pos.getY(id)};
    });
    const x=(v[0].x+v[1].x+v[2].x)/3,z=(v[0].z+v[1].z+v[2].z)/3;
    assert.ok(x<=dry.minX||x>=dry.maxX||z<=dry.minZ||z>=dry.maxZ,
      'water triangle covers city or beach');
  }
  const sun=new THREE.Vector3(1,2,3),ocean=createUrbanIslandOcean(coast,{sunPosition:sun});
  assert.ok(ocean.material.uniforms.time);
  assert.equal(ocean.name.includes('two-island'),true);
  assert.equal(ocean.position.y,-.23);
  updateUrbanIslandOcean(ocean,new THREE.Vector3(0,1,0),10);
  assert.equal(ocean.material.uniforms.time.value,6);
  assert.ok(ocean.material.uniforms.sunDirection.value.y>.99);
  ocean.geometry.dispose();
  ocean.material.dispose();
  geo.dispose();
});

test('photographic sand has real relief with physically walkable grade on four sides',()=>{
  const coast=layout();
  for(const side of coast.sides){
    const beach=buildUrbanBeachGeometry(side,coast);
    const normal=beach.getAttribute('normal'),uv=beach.getAttribute('uv'),pos=beach.getAttribute('position');
    assert.ok(pos.count>400);
    assert.equal(normal.count,pos.count);
    assert.equal(uv.count,pos.count);
    assert.ok(normal.getY(0)>.5,'surface normals must face sunlight');
    assert.ok(uv.getX(0)!==uv.getX(pos.count-1));
    beach.dispose();
  }
  assert.ok(urbanSandHeight(0,0,0)>.04,'beach approaches city pavement');
  assert.ok(urbanSandHeight(1,0,0)<-.15,'beach descends toward ocean');
  const coastCode=source('src/editor/UrbanCoast.js');
  assert.match(coastCode,/sand\.normalMap=normal/);
  assert.match(coastCode,/sand\.roughnessMap=rough/);
  assert.match(coastCode,/layout\.updateWater=/);
  assert.match(source('src/editor/UrbanRuntime.js'),/this\.coast\?\.updateWater\?\./);
  assert.match(source('tools/fetch-urban-coast.py'),/\["2k"\]\["jpg"\]/);
});
