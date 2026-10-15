import test from 'node:test';
import assert from 'node:assert/strict';
import {urbanNetworks} from '../src/editor/urban-navigation.mjs';
import {intersectionForSegment,trafficSignalState,trafficSignalSpeedLimit,URBAN_SIGNAL} from '../src/editor/urban-traffic-signals.mjs';
const config={blocksX:4,blocksZ:4,blockSize:42,roadWidth:10,sidewalkWidth:3.5};
const roads=urbanNetworks(config).roads;
const ew=roads.find(s=>intersectionForSegment(s,config)?.axis==='eastWest');
const ns=roads.find(s=>intersectionForSegment(s,config)?.axis==='northSouth');

test('real lanes use four-way signals; boundary lanes stay uncontrolled',()=>{
 assert.ok(ew&&ns,'Both street directions have controllable segments');
 assert.ok(roads.some(s=>!trafficSignalState(s,config,0).controlled));
 assert.equal(trafficSignalState(ew,config,0).green,true);
 assert.equal(trafficSignalState(ns,config,0).green,false);
});
test('east-west and north-south greens never conflict; all-red protects phase swap',()=>{
 for(let t=0;t<24;t+=.25){
  const a=trafficSignalState(ew,config,t),b=trafficSignalState(ns,config,t);
  assert.ok(!(a.green&&b.green),'Conflicting green lights at '+t);
 }
 assert.equal(trafficSignalState(ew,config,10).phase,'allRed');
 assert.equal(trafficSignalState(ns,config,12).green,true);
 assert.equal(trafficSignalState(ns,config,22).phase,'allRed');
});
test('red lights decelerate before stop line and green restores cruise',()=>{
 const atStop=trafficSignalSpeedLimit(ew,.95,config,13,8);
 assert.equal(atStop.state.green,false);
 assert.equal(atStop.limit,0);
 assert.equal(atStop.stop,true);
 const approaching=trafficSignalSpeedLimit(ew,.7,config,13,8);
 assert.ok(approaching.limit>=0&&approaching.limit<=8);
 assert.equal(trafficSignalSpeedLimit(ew,.95,config,3,8).limit,8);
});
