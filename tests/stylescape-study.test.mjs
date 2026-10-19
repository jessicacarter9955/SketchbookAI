import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {DEFAULT_URBAN,generateUrbanPlan} from '../src/editor/urban-data.mjs';
import {stylescapeLayout,STYLESCAPE_BIOMES,stylescapeHeight,stylescapeTileAt,
  stylescapeGroundAt,stylescapeSpawns,stylescapePlacement} from '../src/editor/stylescape-study-data.mjs';
import {buildStylescapeTerrainMesh,createStylescapeTerrainBody} from '../src/editor/StylescapeStudy.js';
const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const setup=()=>stylescapeLayout(generateUrbanPlan(DEFAULT_URBAN).bounds);

test('six themed contiguous biomes are outside, not overwriting any city road or Miami sea',()=>{
  const plan=generateUrbanPlan(DEFAULT_URBAN),layout=stylescapeLayout(plan.bounds);
  assert.equal(layout.tiles.length,6);
  assert.deepEqual(layout.tiles.map(t=>t.id),STYLESCAPE_BIOMES.map(t=>t.id));
  assert.ok(layout.bounds.minX>plan.bounds.maxX+900);
  assert.equal(layout.originalKit,false);
  assert.ok(layout.source.includes('cosmos.leartesstudios.com'));
  const spawns=stylescapeSpawns(layout);
  assert.equal(spawns.length,6);
  assert.equal(new Set(spawns.map(s=>s.id)).size,6);
  for(const spawn of spawns){
    assert.ok(spawn.id.startsWith('stylescape-'));
    assert.ok(stylescapeTileAt(layout,spawn.position[0],spawn.position[2]));
    assert.ok(stylescapeGroundAt(layout,spawn.position[0],spawn.position[2])<spawn.position[1]);
    assert.ok(spawn.position[0]<2500,'must remain inside physics bounds');
  }
  assert.equal(stylescapeGroundAt(layout,0,0),null);
});

test('heightfield and render mesh share source height at all corners, and adjoining seams match',()=>{
  const layout=setup();
  for(const tile of layout.tiles){
    const geometry=buildStylescapeTerrainMesh(tile,26);
    const verts=geometry.getAttribute('position'),normal=geometry.getAttribute('normal');
    assert.equal(verts.count,27*27);
    assert.ok(normal.getY(0)>.5,'upper normals must face sky');
    for(const i of [0,13,27*27-1]){
      assert.ok(Math.abs(verts.getY(i)-stylescapeHeight(tile,verts.getX(i),verts.getZ(i)))<.0001);
    }
    assert.equal(stylescapeHeight(tile,tile.x+tile.size/2,tile.z),5);
    assert.ok(stylescapePlacement(tile,25,323).every(p=>Math.hypot(p.x-tile.x,p.z-tile.z)>=25));
    geometry.dispose();
  }
  const left=layout.tiles[0],right=layout.tiles[1],mid=(left.x+right.x)/2;
  assert.ok(Math.abs(stylescapeHeight(left,mid,left.z)-stylescapeHeight(right,mid,right.z))<.001);
});

test('real Cannon Heightfield stops a dynamic actor falling at biome spawn',()=>{
  const layout=setup(),tile=layout.tiles[0];
  const physics=new CANNON.World({gravity:new CANNON.Vec3(0,-9.81,0)});
  const terrain=createStylescapeTerrainBody(tile,36);
  assert.ok(terrain.shapes[0] instanceof CANNON.Heightfield);
  physics.addBody(terrain);
  const sphere=new CANNON.Body({mass:1,
    position:new CANNON.Vec3(tile.x,stylescapeHeight(tile,tile.x,tile.z)+7,tile.z)});
  sphere.addShape(new CANNON.Sphere(.45));
  physics.addBody(sphere);
  for(let i=0;i<230;i++)physics.step(1/60);
  const surface=stylescapeHeight(tile,tile.x,tile.z);
  assert.ok(sphere.position.y>surface+.20,'body fell through biome terrain '+sphere.position.y);
  assert.ok(sphere.position.y<surface+1.9,'body should settle on ground '+sphere.position.y);
});

test('new study is spawnable from the real player selector and a direct link',()=>{
  const urban=source('src/editor/UrbanRuntime.js'),boot=source('src/editor/start.js');
  assert.match(urban,/stylescapeSpawns\(this\.stylescapeLayout\)/);
  assert.match(urban,/stylescapeTileAt\(layout,point\.x,point\.z\)/);
  assert.match(urban,/this\.stylescapeStudy=study/);
  assert.match(urban,/stylescapeGroundAt\(this\.stylescapeLayout,x,z\)/);
  assert.match(boot,/query\.get\('spawn'\)/);
  assert.match(source('src/editor/scene-catalog.mjs'),/id: 'stylescape-biomes'/);
  assert.match(source('src/editor/StylescapeStudy.js'),/commercialKitImported:false/);
  assert.doesNotMatch(source('tools/fetch-stylescape-study.py'),/['"]stylescape-hd\.zip['"]/);
});

test('all new materials are from Poly Haven CC0, not from a commercial demo',()=>{
  const src=source('tools/fetch-stylescape-study.py');
  assert.match(src,/forrest_ground_01/);
  assert.match(src,/mossy_rock/);
  assert.match(src,/snow_02/);
  assert.match(src,/namaqualand_cliff_01/);
  assert.match(src,/expected_md5/);
  assert.match(src,/original_stylescape_assets/);
  assert.match(source('src/editor/StylescapeStudy.js'),/assets\/stylescape-study\/namaqualand_cliff_01\/scene\.gltf/);
});
