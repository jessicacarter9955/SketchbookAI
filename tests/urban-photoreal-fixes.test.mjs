import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {groundedVehicleSkinOffset} from '../src/editor/urban-grounding.mjs';
import {nextUrbanPedestrianRoute} from '../src/editor/urban-agent-recovery.mjs';
import {nextUrbanCarSegment} from '../src/editor/urban-car-routing.mjs';
import {miamiCoastLayout} from '../src/editor/urban-coast-layout.mjs';
import {urbanNetworks} from '../src/editor/urban-navigation.mjs';
import {DEFAULT_URBAN,generateUrbanPlan} from '../src/editor/urban-data.mjs';

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('imported vehicle body cannot sink below measured ground while wheels contact it',()=>{
  assert.equal(groundedVehicleSkinOffset(.40,0,4),-.34);
  assert.equal(groundedVehicleSkinOffset(1.2,0,4),-.78);
  assert.equal(groundedVehicleSkinOffset(.4,0,0),null,'airborne body retains offset instead of sticking to floor');
  assert.equal(groundedVehicleSkinOffset(Number.NaN,0,4),null);
  assert.match(source('src/editor/ActorLayer.js'),/importedVehicleVisual/);
  assert.match(source('src/editor/ActorLayer.js'),/groundedVehicleSkinOffset/);
});

test('pedestrian picks reachable nonzero-distance destinations on the real sidewalk graph',()=>{
  const graph=urbanNetworks(DEFAULT_URBAN);
  const origin=graph.nodes[0];
  const last=[];
  for(let leg=1;leg<=4;leg++){
    const path=nextUrbanPedestrianRoute(graph,origin,3,leg);
    assert.ok(path.length>1,'must walk, not run walk animation in place');
    const end=path.at(-1);
    assert.ok(Math.hypot(end.x-origin.x,end.z-origin.z)>=8);
    last.push(end.x+':'+end.z);
  }
  assert.ok(new Set(last).size>1,'successive journeys should not target the same node forever');
});

test('road continuation respects directed lanes and does not reset cars onto occupied entry',()=>{
  const roads=[
    {a:{x:0,z:0},b:{x:10,z:0}},
    {a:{x:10,z:0},b:{x:20,z:0}},
    {a:{x:10,z:2},b:{x:10,z:12}}
  ];
  assert.equal(nextUrbanCarSegment(roads,0,0),1);
  assert.equal(nextUrbanCarSegment(roads,0,0,[{seg:1,t:.05}]),2);
  assert.equal(nextUrbanCarSegment(roads,0,0,[{seg:1,t:.05},{seg:2,t:.04}]),null);
  assert.match(source('src/editor/UrbanPopulation.js'),/if\(next===null\)\{a\.t=\.985/);
});

test('Miami shoreline lies beyond city roads, has a wide sand band and aligned palms',()=>{
  const plan=generateUrbanPlan(DEFAULT_URBAN),layout=miamiCoastLayout(plan.bounds,DEFAULT_URBAN.seed);
  assert.ok(layout.beachStart>plan.bounds.maxX);
  assert.ok(layout.shoreX>layout.beachStart+50);
  assert.ok(layout.seaCenter-layout.seaWidth/2>=layout.shoreX);
  assert.ok(layout.palms.length>=8);
  assert.ok(layout.palms.every(p=>p.x>plan.bounds.maxX&&p.x<layout.shoreX&&p.z>=plan.bounds.minZ-1&&p.z<=plan.bounds.maxZ+1));
  assert.match(source('src/editor/UrbanRuntime.js'),/addUrbanMiamiCoast\(group,plan,config,box\)/);
  assert.match(source('src/editor/UrbanCoast.js'),/new THREE\.InstancedMesh/);
});

test('HD trees use original trunk-foot vertices, not asymmetrical crown center',()=>{
  const vegetation=source('src/editor/UrbanVegetation.js');
  assert.match(vegetation,/point\.fromBufferAttribute\(positions,i\)\.applyMatrix4/);
  assert.match(vegetation,/const center=baseCount>=3\?/);
  assert.match(vegetation,/root\.position\.set\(-center\.x,-bounds\.min\.y,-center\.z\)/);
});
