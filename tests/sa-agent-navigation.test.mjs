import test from 'node:test';
import assert from 'node:assert/strict';
import {createSanAndreasSpatialIndex,nodesNear,nextSanAndreasEdge,stepOriginalPath} from '../src/editor/sa-agent-navigation.mjs';
const a={key:'a',x:0,y:5,z:0,edges:[{to:'b',length:10}]},
 b={key:'b',x:10,y:5,z:0,edges:[{to:'a',length:10},{to:'c',length:10}]},
 c={key:'c',x:20,y:5,z:0,edges:[{to:'b',length:10}]};
const net={nodes:[a,b,c],byKey:new Map([a,b,c].map(n=>[n.key,n]))};
test('SA spatial indexing selects local legal nodes in adjacent world cells',()=>{
 const index=createSanAndreasSpatialIndex(net,10);
 assert.deepEqual(nodesNear(index,1,0,5).map(n=>n.key),['a']);
 assert.deepEqual(nodesNear(index,9,0,12).map(n=>n.key),['b','a','c']);
});
test('vehicle routes traverse the real directed edges and interpolate the true positions',()=>{
 const state={key:'a',to:null,t:0,turns:0};
 const p=stepOriginalPath(net,state,.1,20,0);
 assert.equal(state.to,'b');assert.equal(p.x,2);assert.equal(p.y,5);assert.ok(p.heading>1);
 const p2=stepOriginalPath(net,state,.1,20,0);
 assert.equal(p2.x,4);
});
test('SA path selection respects roadblocks and does not invent connections',()=>{
 assert.equal(nextSanAndreasEdge(net,{key:'c',edges:[]}),null);
 const blocked={...b,roadBlock:true};
 const graph={...net,byKey:new Map([['a',a],['b',blocked],['c',c]])};
 assert.equal(nextSanAndreasEdge(graph,a),null);
});
