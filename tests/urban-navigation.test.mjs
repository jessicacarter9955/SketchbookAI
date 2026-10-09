import test from 'node:test';
import assert from 'node:assert/strict';
import {urbanNetworks,shortestUrbanPath,safeFollowingSpeed} from '../src/editor/urban-navigation.mjs';
import {DEFAULT_URBAN} from '../src/editor/urban-data.mjs';
test('AI cars are generated on directional driving lanes',()=>{
  const n=urbanNetworks({...DEFAULT_URBAN,blocksX:4,blocksZ:4});
  assert.equal(n.roads.length,4*5*4);
  assert.ok(n.roads.every(s=>s.type==='lane'&&s.length>0));
  assert.ok(n.roads.every(s=>{const x=s.b.x-s.a.x,z=s.b.z-s.a.z;return (x===0)!==(z===0);}));
});
test('pedestrian paths use only sidewalk and zebra links',()=>{
  const n=urbanNetworks({...DEFAULT_URBAN,blocksX:4,blocksZ:4});
  assert.ok(n.crosswalks.length>0);
  const a=n.pedestrians.nodes[0],b=n.pedestrians.nodes.at(-1);
  const path=shortestUrbanPath(n.pedestrians,a,b);
  assert.ok(path.length>5);
  for(let i=1;i<path.length;i++){
    const from=n.pedestrians.byKey.get(`${Math.round(path[i-1].x*100)}:${Math.round(path[i-1].z*100)}`);
    const to=`${Math.round(path[i].x*100)}:${Math.round(path[i].z*100)}`;
    assert.ok(from.edges.some(e=>e.to===to&&['sidewalk','crosswalk'].includes(e.type)));
  }
});
test('traffic slows down before a vehicle ahead',()=>{
  assert.equal(safeFollowingSpeed(2,9),0);
  assert.ok(safeFollowingSpeed(8,9)<safeFollowingSpeed(20,9));
  assert.equal(safeFollowingSpeed(100,9),9);
});

import {URBAN_CAPTURE_VIEWS,validateUrbanCaptureViews} from '../tools/urban-camera-presets.mjs';
test('dense-population visual proof includes a conversation camera and unique screenshots',()=>{
  assert.equal(validateUrbanCaptureViews(),true);
  assert.ok(URBAN_CAPTURE_VIEWS.some(v=>v.kind==='dialogue'));
  assert.ok(URBAN_CAPTURE_VIEWS.some(v=>v.kind==='car'));
  assert.ok(URBAN_CAPTURE_VIEWS.some(v=>v.kind==='pedestrian'));
  assert.ok(URBAN_CAPTURE_VIEWS.length>=6);
});

import {inspectHumanoidRig,findHumanoidJoint} from '../src/editor/humanoid-rig.mjs';
test('Three.js humanoid rig detector only accepts real bones',()=>{
  const rightArm={name:'upper_arm.R',type:'Bone',isBone:true,children:[]};
  const head={name:'head',type:'Bone',isBone:true,children:[]};
  const staticMesh={name:'upper_arm.R',type:'Mesh',isMesh:true,children:[]};
  const hierarchy={traverse(fn){for(const n of [rightArm,head,staticMesh])fn(n);}};
  const info=inspectHumanoidRig(hierarchy);
  assert.equal(info.boneCount,2);
  assert.equal(info.supportsRealArmGesture,true);
  assert.equal(findHumanoidJoint(hierarchy),rightArm);
  const unrigged={traverse(fn){fn(staticMesh);}};
  assert.equal(inspectHumanoidRig(unrigged).supportsRealArmGesture,false);
  assert.equal(findHumanoidJoint(unrigged),null);
});
