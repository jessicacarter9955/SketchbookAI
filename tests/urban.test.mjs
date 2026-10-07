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

test('low-rise districts respect the requested floor limit even downtown',()=>{
  for(const seed of [42,1847,1,700]){
    const plan=generateUrbanPlan({...DEFAULT_URBAN,seed,minFloors:3,maxFloors:7});
    assert.ok(plan.buildings.every(b=>b.floors>=3&&b.floors<=7&&!b.isTower));
    assert.ok(plan.buildings.every(b=>b.height===b.floors*3));
  }
});

test('building massing is deterministic, typed and bounded',()=>{
  const allowed=new Set(['stepped','crown','slab','courtyard','setback','corner']);
  const plan=generateUrbanPlan({...DEFAULT_URBAN,blocksX:10,blocksZ:10,seed:42});
  assert.ok(plan.buildings.length>30);
  assert.ok(plan.buildings.every(b=>allowed.has(b.massing)));
  assert.ok(plan.buildings.every(b=>b.rotation===0||b.rotation===Math.PI/2));
  assert.ok(new Set(plan.buildings.map(b=>b.massing)).size>=4);
  assert.deepEqual(plan.buildings,generateUrbanPlan({...DEFAULT_URBAN,blocksX:10,blocksZ:10,seed:42}).buildings);
});
