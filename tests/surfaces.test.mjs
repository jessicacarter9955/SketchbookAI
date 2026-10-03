import test from 'node:test';
import assert from 'node:assert/strict';
import { clipTriangle, triangleArea, collectSurface, insideBounds, validateSurfaceEdits } from '../src/editor/surface-data.mjs';
import { validateScene, History } from '../src/editor/scene-data.mjs';
import { forkScene, sceneStorageKey } from '../src/editor/scene-revisions.mjs';
const edit = {id:'grass',name:'Prato',style:'grass',texture:'grass.png',bounds:[0,-1,0,2,1,2],seed:42,density:20,height:.5};
test('area selection clips crossing triangles exactly at its border',()=>{
    const clipped=clipTriangle([[-10,0,-10],[10,0,-10],[0,0,20]],edit.bounds);
    assert.ok(clipped.flat().every(p=>insideBounds(p,edit.bounds)));
    assert.ok(Math.abs(clipped.reduce((n,t)=>n+triangleArea(t),0)-4)<1e-7);
});
test('surface selection respects material, height band, and rejects walls',()=>{
    const tris=[[[0,0,0],[0,0,2],[2,0,0]],[[0,0,0],[0,0,2],[2,0,0]],[[0,4,0],[0,4,2],[2,4,0]],[[0,0,0],[0,1,0],[0,0,2]]];
    const vertices=new Float32Array(tris.flatMap(t=>t.flatMap(p=>[...p,0,0,1,1,1])));
    const found=collectSurface(vertices,tris.map((t,i)=>({start:i*3,count:3,texture:i===1?'road.png':'grass.png'})),edit);
    assert.equal(found.area,2); assert.equal(found.triangles.length,1);
});
test('surface edits survive scene, history and independent revision branches',()=>{
    const scene=validateScene({version:1,world:'liberty-city',objects:[],mapEdits:[edit]});
    assert.deepEqual(scene.mapEdits,[edit]);
    const history=new History(scene); history.push({...scene,mapEdits:[]}); assert.deepEqual(history.undo(),scene);
    const data=new Map(), storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
    forkScene(storage,{id:'portland-lab',world:'liberty-city'},scene,'Grass branch','grass-branch');
    assert.deepEqual(JSON.parse(data.get(sceneStorageKey('grass-branch'))),scene);
    for(const bad of [{bounds:[0,0,0,201,1,1]},{density:41},{style:'unknown'},{height:NaN},{bounds:[0,0,0,1,21,1]}]) assert.throws(()=>validateSurfaceEdits([{...edit,...bad}]));
    assert.throws(()=>validateScene({...scene,world:'sketchbook'}));
});
