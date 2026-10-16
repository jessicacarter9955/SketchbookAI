import test from 'node:test';
import assert from 'node:assert/strict';
import {saSectorDistanceXZ,nearestSanAndreasSectors,sanAndreasResolutionStep} from '../src/editor/sa-streaming.mjs';
import {validateSaGeometryMetadata} from '../src/editor/sa-local-map.mjs';
const s=(name,x,z)=>({name,bounds:[x,0,z,x+30,80,z+30]});
test('SA chunk prioritizes visible nearby geometry, excludes distant sectors and respects budget',()=>{
 const sectors=[s('d.glb',4500,0),s('b.glb',50,0),s('a.glb',0,0),s('c.glb',175,0)];
 assert.deepEqual(nearestSanAndreasSectors(sectors,{x:0,z:0},110,2).map(x=>x.name),['a.glb','b.glb']);
 assert.equal(saSectorDistanceXZ({x:150,z:0},sectors[3].bounds),25);
 assert.deepEqual(nearestSanAndreasSectors(sectors,{x:9000,z:0},100,3).map(x=>x.name),['d.glb']);
});
test('original GLB bounds stored in IndexedDB must be finite valid and not duplicated',()=>{
 const valid=[s('district0.glb',0,0),s('district1.glb',40,0)];
 assert.equal(validateSaGeometryMetadata(valid).length,2);
 assert.equal(validateSaGeometryMetadata([{name:'road-plane.glb',bounds:[0,0,0,50,0,40]}]).length,1);
 assert.throws(()=>validateSaGeometryMetadata([s('broken.glb',3,5),s('broken.glb',2,0)]),/non valido/);
 assert.throws(()=>validateSaGeometryMetadata([{name:'../bad.glb',bounds:[0,0,0,5,5,5]}]),/non valido/);
 assert.throws(()=>validateSaGeometryMetadata([{name:'bad.glb',bounds:[0,0,0,NaN,5,5]}]),/non validi/);
});
test('adaptive render scale changes only on persistent low/high FPS, preserving GLB quality',()=>{
 assert.equal(sanAndreasResolutionStep(35,1.25,.9,1.25),1.17);
 assert.equal(sanAndreasResolutionStep(60,1,.9,1.25),1.04);
 assert.equal(sanAndreasResolutionStep(50,1,.9,1.25),1);
 assert.equal(sanAndreasResolutionStep(25,.9,.9,1.25),.9);
});
