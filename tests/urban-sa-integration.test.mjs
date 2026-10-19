import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as CANNON from 'cannon-es';
import {DEFAULT_URBAN,generateUrbanPlan} from '../src/editor/urban-data.mjs';
import {miamiCoastLayout} from '../src/editor/urban-coast-layout.mjs';
import {makeUrbanPedestrianSARoute,advanceUrbanPedestrianSA} from '../src/editor/urban-sa-adapter.mjs';
import {createUrbanAgentCollider,syncUrbanAgentCollider,disposeUrbanAgentColliders} from '../src/editor/urban-agent-physics.mjs';
import {createUrbanPoliceDispatch,recordUrbanPoliceIncident,
  advanceUrbanPoliceDispatch,urbanPolicePursuitTarget} from '../src/editor/urban-police-dispatch.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('Urban pedestrian advances on actual legal sidewalk links using SA stepOriginalPath',()=>{
  const path=[{x:0,z:0},{x:10,z:0},{x:10,z:8}];
  const route=makeUrbanPedestrianSARoute({x:0,z:0},path);
  assert.ok(route&&route.network.byKey.size===3);
  const first=advanceUrbanPedestrianSA(route,.1,2,3);
  assert.ok(first.x>.19&&first.x<.21);assert.equal(first.z,0);
  let finished=false,pose;
  for(let i=0;i<120;i++){
    pose=advanceUrbanPedestrianSA(route,.1,2,3);
    if(pose.finished){finished=true;break;}
  }
  assert.ok(finished);
  assert.ok(Math.abs(pose.x-10)<.01&&Math.abs(pose.z-8)<.01);
  assert.match(read('src/editor/UrbanPopulation.js'),/advanceUrbanPedestrianSA\(/);
});

test('scripted cars/pedestrians have genuine nearby Cannon kinematic rigid bodies',()=>{
  const world={physicsWorld:{
    bodies:new Set(),addBody(b){this.bodies.add(b);},removeBody(b){this.bodies.delete(b);}
  },levelRuntime:{groundAt(){return 0;}}};
  const car={object:{position:{x:1,y:1,z:3},rotation:{y:0}}};
  const pedestrian={object:{position:{x:3,y:1,z:3},rotation:{y:0}}};
  syncUrbanAgentCollider(world,car,'car',{x:0,z:0});
  syncUrbanAgentCollider(world,pedestrian,'pedestrian',{x:0,z:0});
  assert.equal(world.physicsWorld.bodies.size,2);
  assert.equal(car.collider.type,CANNON.Body.KINEMATIC);
  assert.ok(car.collider.shapes[0] instanceof CANNON.Box);
  assert.ok(pedestrian.collider.shapes[0] instanceof CANNON.Sphere);
  assert.equal(car.collider.position.y,.79);
  syncUrbanAgentCollider(world,car,'car',{x:500,z:500});
  assert.equal(world.physicsWorld.bodies.size,1);
  disposeUrbanAgentColliders(world,[car,pedestrian]);
  assert.equal(world.physicsWorld.bodies.size,0);
});

test('police wanted state is incident-driven and has no invented officers',()=>{
  const state=createUrbanPoliceDispatch();
  recordUrbanPoliceIncident(state,{type:'aim',x:0,z:0},1);
  assert.equal(state.wanted,0);
  recordUrbanPoliceIncident(state,{type:'gunshot',x:1,z:2},3);
  assert.equal(state.wanted,1);
  recordUrbanPoliceIncident(state,{type:'vehicle-impact',x:1,z:2},3.2);
  assert.equal(state.incidentCount,1,'repeated events are debounced');
  recordUrbanPoliceIncident(state,{type:'vehicle-impact',x:1,z:2},6);
  assert.equal(state.incidentCount,2);
  assert.equal(urbanPolicePursuitTarget(state,{x:2,z:3},7).wanted,1);
  assert.equal(urbanPolicePursuitTarget(state,{x:1000,z:1000},7),null);
  advanceUrbanPoliceDispatch(state,130);
  assert.equal(state.wanted,0);
  assert.match(read('src/editor/UrbanPopulation.js'),/recordUrbanPoliceIncident/);
});

test('urban streetlamps are anchored at midblocks outside the vehicle road edge',()=>{
  const plan=generateUrbanPlan(DEFAULT_URBAN);
  assert.ok(plan.lamps.length>20);
  for(const l of plan.lamps){
    const road=plan.roads.find(r=>r.axis===l.roadAxis&&
      Math.abs((r.axis==='x'?r.z:r.x)-(r.axis==='x'?l.z:l.x))<DEFAULT_URBAN.roadWidth/2+DEFAULT_URBAN.sidewalkWidth+1);
    assert.ok(road);
    const center=road.axis==='x'?road.z:road.x;
    const perp=road.axis==='x'?l.z:l.x;
    assert.ok(Math.abs(perp-center)>DEFAULT_URBAN.roadWidth/2+1);
    const along=road.axis==='x'?l.x:l.z;
    const crossings=plan.roads.filter(r=>r.axis!==road.axis).map(r=>r.axis==='z'?r.x:r.z);
    assert.ok(Math.min(...crossings.map(v=>Math.abs(v-along)))>=DEFAULT_URBAN.blockSize/2-.01);
  }
  assert.match(read('src/editor/UrbanRuntime.js'),/CANNON\.Vec3\(\.22,2\.38,\.22\)/);
});

test('four contiguous PBR shoreline sides surround the city and use imported palm GLB',()=>{
  const plan=generateUrbanPlan(DEFAULT_URBAN);
  const coast=miamiCoastLayout(plan.bounds,DEFAULT_URBAN.seed);
  assert.deepEqual(coast.sides.map(s=>s.name),['east','west','north','south']);
  assert.ok(coast.sides.every(s=>s.palms.length>5));
  assert.equal(coast.allPalms.length,coast.sides.reduce((n,s)=>n+s.palms.length,0));
  for(const p of coast.allPalms)
    assert.ok(p.x>plan.bounds.maxX||p.x<plan.bounds.minX||
      p.z>plan.bounds.maxZ||p.z<plan.bounds.minZ);
  assert.match(read('src/editor/UrbanCoast.js'),/palm-detailed\.glb/);
  assert.match(read('src/editor/UrbanCoast.js'),/sand-nor_gl\.jpg/);
  assert.match(read('tools/fetch-urban-coast.py'),/palm-detailed-a8777b8c/);
  assert.match(read('src/editor/UrbanRuntime.js'),/this\.coast\.loadOriginalAssets\(\)/);
});

test('ambient collision shapes actually contact dynamic player-like rigid bodies',()=>{
  const world=new CANNON.World({gravity:new CANNON.Vec3(0,0,0)});
  const traffic=createUrbanAgentCollider('car');
  traffic.position.set(0,0,0);
  const player=new CANNON.Body({mass:3,position:new CANNON.Vec3(0,0,2.2)});
  player.addShape(new CANNON.Sphere(.65));
  world.addBody(traffic);world.addBody(player);
  world.step(1/60);
  assert.ok(world.contacts.length>0,'no Cannon contact between ambient car and dynamic player');
});
