import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_URBAN, validateUrban, generateUrbanPlan, urbanGroundHeight } from '../src/editor/urban-data.mjs';

test('urban config validates practical city ranges',()=>{
  assert.deepEqual(validateUrban(DEFAULT_URBAN),DEFAULT_URBAN);
  assert.throws(()=>validateUrban({...DEFAULT_URBAN,blocksX:1}));
  assert.throws(()=>validateUrban({...DEFAULT_URBAN,minFloors:10,maxFloors:2}));
  assert.throws(()=>validateUrban({...DEFAULT_URBAN,roadWidth:30,blockSize:30}));
});
test('same seed creates deterministic roads and buildings',()=>{
  const a=generateUrbanPlan(DEFAULT_URBAN), b=generateUrbanPlan(DEFAULT_URBAN);
  assert.deepEqual(a,b); assert.ok(a.roads.length>10); assert.ok(a.buildings.length>10);
  assert.equal(a.spawns[0].id,'urban-center');
});
test('different seeds alter procedural building layout',()=>{
  const a=generateUrbanPlan({...DEFAULT_URBAN,seed:1}), b=generateUrbanPlan({...DEFAULT_URBAN,seed:2});
  assert.notDeepEqual(a.buildings,b.buildings);
});
test('rolling terrain changes elevation while flat stays zero',()=>{
  assert.equal(urbanGroundHeight(20,30,{...DEFAULT_URBAN,terrain:'flat'}),0);
  assert.notEqual(urbanGroundHeight(20,30,{...DEFAULT_URBAN,terrain:'rolling'}),0);
});
