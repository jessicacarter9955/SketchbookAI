import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ISLAND, validateIsland, islandHeight, islandCenters } from '../src/editor/island-data.mjs';
import { validateScene } from '../src/editor/scene-data.mjs';
import { forkScene, sceneStorageKey } from '../src/editor/scene-revisions.mjs';
test('procedural coast is reproducible, road approach flat, seed changes hills',()=>{
    const config=validateIsland();
    for(const x of [-30,-10,0,10,30]) assert.equal(islandHeight(x,0,config),4);
    assert.ok(islandHeight(0,300,config)<0);
    assert.equal(islandHeight(12,25,config),islandHeight(12,25,{...config}));
    assert.notEqual(islandHeight(12,25,config),islandHeight(12,25,{...config,seed:91}));
    assert.deepEqual(islandCenters(config),[0,205]);
});
test('generator config is bounded and cannot be imported into another map',()=>{
    for(const patch of [{radius:1},{gap:1000},{seed:1.5},{sky:'unknown'},{gap:NaN}]) assert.throws(()=>validateIsland({...DEFAULT_ISLAND,...patch}));
    const scene={version:1,world:'procedural-island',objects:[],generator:{...DEFAULT_ISLAND,sky:'sunset'}};
    assert.deepEqual(validateScene(scene),scene);
    assert.throws(()=>validateScene({...scene,world:'liberty-city'}));
    const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
    forkScene(storage,{id:'island-sunset',world:'procedural-island'},scene,'Island copy','island-copy');
    assert.deepEqual(JSON.parse(storage.getItem(sceneStorageKey('island-copy'))),scene);
});
