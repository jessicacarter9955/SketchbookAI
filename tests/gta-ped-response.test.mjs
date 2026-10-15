import test from 'node:test';
import assert from 'node:assert/strict';
import {urbanNetworks} from '../src/editor/urban-navigation.mjs';
import {DEFAULT_URBAN} from '../src/editor/urban-data.mjs';
import {escapeSidewalkPath,clearPedestrianSegment,reactToPedestrianEvent,advancePedestrianResponse} from '../src/editor/gta-ped-response.mjs';
const graph=urbanNetworks({...DEFAULT_URBAN,blocksX:4,blocksZ:4}).pedestrians;
const spawn=graph.nodes[10];
const npc=()=>({x:spawn.x,z:spawn.z,seed:3,state:'walking',speed:1.2,normalSpeed:1.2,health:100});
const key=p=>Math.round(p.x*100)+':'+Math.round(p.z*100);
test('gunshot causes pedestrians to flee along connected sidewalk/crosswalk nodes',()=>{
  const a=npc(),threat={x:a.x+3,z:a.z+3};
  const reaction=reactToPedestrianEvent(a,{type:'gunshot',...threat},graph,[],3);
  assert.equal(reaction.state,'fleeing');assert.ok(reaction.path.length>1);
  for(let i=1;i<reaction.path.length;i++)
    assert.ok(graph.byKey.get(key(reaction.path[i-1])).edges.some(e=>e.to===key(reaction.path[i])&&['sidewalk','crosswalk'].includes(e.type)));
  const start=reaction.path[0],end=reaction.path.at(-1);
  assert.ok(Math.hypot(end.x-threat.x,end.z-threat.z)>Math.hypot(start.x-threat.x,start.z-threat.z));
});
test('escape edges are not allowed through building collision bounds',()=>{
  const building={x:4,z:0,w:3,d:4};
  assert.equal(clearPedestrianSegment({x:0,z:0},{x:8,z:0},[building]),false);
  const route=escapeSidewalkPath(graph,spawn,{x:spawn.x+4,z:spawn.z},[building]);
  for(let i=1;i<route.length;i++)assert.ok(clearPedestrianSegment(route[i-1],route[i],[building]));
});
test('aim is directional and triggers surrender near the player',()=>{
  const a=npc();
  assert.equal(reactToPedestrianEvent(a,{type:'aim',x:a.x-4,z:a.z,direction:{x:-1,z:0}},graph,[],3),null);
  assert.equal(reactToPedestrianEvent(a,{type:'aim',x:a.x-4,z:a.z,direction:{x:1,z:0}},graph,[],3).state,'surrender');
  assert.equal(reactToPedestrianEvent(a,{type:'gunshot',x:a.x+1000,z:a.z},graph,[],3),null);
});
test('damage can kill the target and witnesses flee, irrespective of shot cooldown',()=>{
  const a={...npc(),state:'fleeing',lastReactionAt:3};
  assert.equal(reactToPedestrianEvent(a,{type:'damage',targetSeed:3,damage:150,x:a.x,z:a.z},graph,[],3).state,'dead');
  assert.equal(reactToPedestrianEvent(a,{type:'damage',targetSeed:3,damage:20,x:a.x,z:a.z},graph,[],3).health,80);
  assert.equal(reactToPedestrianEvent(npc(),{type:'damage',targetSeed:9,damage:80,x:a.x,z:a.z},graph,[],3).state,'fleeing');
});
test('panicked agents restore walking when threat timeout expires',()=>{
  const a={...npc(),state:'fleeing',speed:3.4,path:[spawn],index:1,until:6};
  assert.equal(advancePedestrianResponse(a,5),false);
  assert.equal(advancePedestrianResponse(a,7),true);
  assert.equal(a.state,'walking');assert.equal(a.speed,1.2);
});
