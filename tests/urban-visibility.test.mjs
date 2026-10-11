import test from 'node:test';
import assert from 'node:assert/strict';
import {segmentBoxEntry2D,viewBlockedByBuilding,isHiddenBehindBuildings,isOccludedSector,isOccludedTree,simulationCadence,advanceSimulationClock} from '../src/editor/urban-visibility.mjs';
const block={x:0,z:0,w:10,d:10,height:16,style:'brick'};
const eye={x:0,y:2,z:22};
test('opaque building blocks targets behind it, but never ones in front or above roof',()=>{
 assert.ok(viewBlockedByBuilding(eye,{x:0,y:2,z:-18},block));
 assert.equal(viewBlockedByBuilding(eye,{x:0,y:2,z:12},block),false);
 assert.equal(viewBlockedByBuilding(eye,{x:0,y:50,z:-18},block),false);
 assert.equal(viewBlockedByBuilding(eye,{x:40,y:2,z:-18},block),false);
 assert.equal(viewBlockedByBuilding(eye,{x:0,y:2,z:-18},{...block,style:'glass'}),false);
 assert.ok(segmentBoxEntry2D(eye,{x:0,y:2,z:-18},{...block,rotation:Math.PI/2})!==null);
});
test('all corners must be hidden before occluding a whole city sector',()=>{
 const cluster={x:0,z:-30,size:12,buildings:[{b:{height:10},index:1}]};
 assert.equal(isOccludedSector({x:0,y:2,z:80},cluster,[block,{...block,z:-30}]),true);
 assert.equal(isOccludedSector({x:0,y:30,z:80},cluster,[block,{...block,z:-30}]),false);
 assert.equal(isHiddenBehindBuildings(eye,[{x:0,y:2,z:-18},{x:25,y:2,z:-18}],[block]),false);
});
test('trees behind walls can be culled but nearby foliage stays',()=>{
 assert.equal(isOccludedTree(eye,{x:0,z:-30,y:0,scale:1},[block]),true);
 assert.equal(isOccludedTree(eye,{x:0,z:0,y:0,scale:1},[block]),false);
});
test('simulation intervals progressively drop while close interactions stay responsive',()=>{
 assert.equal(simulationCadence(5,false),0);
 assert.equal(simulationCadence(80,true),.08);
 assert.equal(simulationCadence(160,false),.45);
 assert.equal(simulationCadence(200,true),.8);
 assert.equal(simulationCadence(400,true),Infinity);
 const npc={};
 assert.equal(advanceSimulationClock(npc,.03,80,true),0);
 assert.equal(advanceSimulationClock(npc,.05,80,true),.08);
 assert.equal(advanceSimulationClock(npc,.016,310,false),0);
 assert.ok(advanceSimulationClock(npc,.016,310,false,true)>0);
});
