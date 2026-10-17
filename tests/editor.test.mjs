import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { validateScene, History } from '../src/editor/scene-data.mjs';
import { checkGLB, encodeBytes, decodeBytes } from '../src/editor/asset-store.mjs';
import { loadCatalog, createScene, BUILTIN_SCENES } from '../src/editor/scene-catalog.mjs';
import { saveRevision, loadRevisions, forkScene, sceneStorageKey } from '../src/editor/scene-revisions.mjs';
const { SketchfabClient } = createRequire(import.meta.url)('../src/editor/sketchfab-client.js');
const item = () => ({ id: 'one', prefab: 'tree', name: 'Albero', position: [1, 2, 3], rotation: [0, 0.5, 0], scale: [1, 2, 1], collider: true });
const scene = () => ({ version: 1, objects: [item()] });

test('scene round-trip preserves independent transforms and rejects invalid imports', () => {
    assert.deepEqual(validateScene(JSON.parse(JSON.stringify(scene()))), scene());
    for (const modify of [s => s.version = 2, s => s.objects.push(item()), s => s.objects[0].position[0] = NaN,
        s => s.objects[0].scale[1] = -1, s => s.objects[0].prefab = 'unknown', s => s.objects = Array(501).fill(item())]) {
        const data = scene(); modify(data); assert.throws(() => validateScene(data));
    }
});
test('history supports undo, redo, branching and bounded memory', () => {
    const h = new History({ version: 1, objects: [] }, 3);
    h.push(scene()); const second = scene(); second.objects[0].position[0] = 25; h.push(second);
    assert.deepEqual(h.undo(), scene()); assert.deepEqual(h.redo(), second);
    h.undo(); const branch = scene(); branch.objects[0].name = 'Nuovo'; h.push(branch);
    assert.equal(h.redo(), undefined); h.push({ version: 1, objects: [] });
    assert.equal(h.states.length, 3); assert.equal(h.index, 2);
});
test('named scenes preserve separate identities and map associations', () => {
    const data = new Map(); const storage = { getItem: k => data.get(k) || null, setItem: (k, v) => data.set(k, v) };
    createScene(storage, 'Quartiere con abitanti', 'liberty-city', 'city-test-1');
    createScene(storage, 'Quartiere vuoto', 'liberty-city', 'city-test-2');
    const catalog = loadCatalog(storage);
    assert.equal(catalog.length, BUILTIN_SCENES.length + 2); assert.equal(catalog.at(-2).world, 'liberty-city');
    assert.notEqual(catalog.at(-2).id, catalog.at(-1).id);
    assert.throws(() => createScene(storage, 'Duplicato', 'sketchbook', 'city-test-1'));
    const cityScene = { version: 1, world: 'liberty-city', objects: [{ ...item(), prefab: 'vehicle' }, { ...item(), id: 'person', prefab: 'pedestrian' }] };
    assert.deepEqual(validateScene(cityScene), cityScene);
    assert.throws(() => validateScene({ ...cityScene, world: 'unknown' }));
});
test('revisions preserve the first state and forks never overwrite their source', () => {
    const data = new Map(); const storage = {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
    const key = sceneStorageKey('sandbox'); storage.setItem(key, JSON.stringify(scene()));
    for (let i=0;i<25;i++) { const state=scene(); state.objects[0].position[0]=i; saveRevision(storage,key,state,`Revision ${i}`,String(i)); }
    const revisions=loadRevisions(storage,key); assert.equal(revisions.length,20); assert.equal(revisions[0].scene.objects[0].position[0],0);
    forkScene(storage,{id:'sandbox',world:'sketchbook'},revisions[0].scene,'My branch','branch-1');
    assert.equal(storage.getItem(key),JSON.stringify(scene()));
    assert.equal(JSON.parse(storage.getItem(sceneStorageKey('branch-1'))).objects[0].position[0],0);
    assert.equal(loadCatalog(storage).at(-1).parentId,'sandbox');
    assert.throws(()=>forkScene(storage,{id:'sandbox',world:'sketchbook'},scene(),'Duplicate','branch-1'));
});
test('two city player links share the streaming world but keep independently saved actors and rigs', () => {
    const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
    const scenes=loadCatalog(storage), normal=scenes.find(s=>s.id==='urban-photoreal'), dds=scenes.find(s=>s.id==='urban-photoreal-dds');
    assert.equal(normal.world,'liberty-city');assert.equal(dds.world,normal.world);
    assert.equal(normal.playerProfile,undefined);assert.equal(dds.playerProfile,'dds');
    assert.equal(normal.spawn,dds.spawn);
    assert.notEqual(sceneStorageKey(normal.id),sceneStorageKey(dds.id));
});
test('DDS test scene and forks preserve their player profile without changing original maps', () => {
    const data = new Map(), storage = {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
    const parent = loadCatalog(storage).find(s=>s.id==='dds-portland');
    assert.equal(parent.world,'liberty-city'); assert.equal(parent.playerProfile,'dds');
    forkScene(storage,parent,{version:1,world:'liberty-city',objects:[]},'DDS branch','dds-branch');
    assert.equal(loadCatalog(storage).at(-1).playerProfile,'dds');
    assert.equal(loadCatalog(storage).find(s=>s.id==='liberty-city').playerProfile,undefined);
    assert.equal(storage.getItem(sceneStorageKey('dds-portland')),null);
});
test('search encodes terms, translates common Italian nouns and omits invalid relevance sort', async () => {
    let request;
    const client = new SketchfabClient(async url => { request = new URL(url); return { ok: true, json: async () => ({ results: [] }) }; });
    await client.search('auto', { animated: true, maxFaces: 10000 });
    assert.equal(request.searchParams.get('q'), 'car'); assert.equal(request.searchParams.get('sort_by'), null);
    assert.equal(request.searchParams.get('max_face_count'), '10000'); assert.equal(request.searchParams.get('animated'), 'true');
    await client.search('car & truck'); assert.equal(request.searchParams.get('q'), 'car & truck');
});
test('pagination cannot send the user token to another origin', async () => {
    let calls = 0; const client = new SketchfabClient(async () => { calls++; }); client.token = 'test-only-token';
    await assert.rejects(client.search('car', { next: 'https://example.com/v3/search' }), /URL Sketchfab/);
    assert.equal(calls, 0);
});
test('download requires a user token and accepts glTF ZIP responses', async () => {
    const client = new SketchfabClient(async () => ({ ok: true, json: async () => ({ gltf: { url: 'https://example.com/model.zip' } }) }));
    await assert.rejects(client.download('model123'), /token/); client.token = 'test-only-token';
    assert.equal(await client.download('model123'), 'https://example.com/model.zip');
});
test('download returns only HTTPS GLB and reports rate limiting', async () => {
    let headers;
    const client = new SketchfabClient(async (url, options) => { headers = options.headers; return { ok: true, json: async () => ({ glb: { url: 'https://example.com/model.glb' } }) }; });
    client.token = 'test-only-token'; assert.equal(await client.download('model123'), 'https://example.com/model.glb');
    assert.equal(headers.Authorization, 'Token test-only-token');
    const limited = new SketchfabClient(async () => ({ ok: false, status: 429 }));
    await assert.rejects(limited.search('tree'), /Limite Sketchfab/);
});
test('portable asset round-trip is byte-exact and refuses archives / external resources', async () => {
    const file = await readFile(new URL('../build/assets/car.glb', import.meta.url));
    const bytes = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    checkGLB(bytes); assert.deepEqual(new Uint8Array(decodeBytes(encodeBytes(bytes))), new Uint8Array(bytes));
    assert.throws(() => checkGLB(new TextEncoder().encode('PK not a GLB archive').buffer));
    const json = JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'https://example.com/file.bin' }] });
    const length = Math.ceil(json.length / 4) * 4; const invalid = new ArrayBuffer(20 + length), view = new DataView(invalid);
    [0x46546c67, 2, invalid.byteLength, length, 0x4e4f534a].forEach((v, i) => view.setUint32(i * 4, v, true));
    new Uint8Array(invalid, 20).set(new TextEncoder().encode(json.padEnd(length)));
    assert.throws(() => checkGLB(invalid), /risorse esterne/);
});

test('local credentials load only on loopback and do not override manual input', async () => {
    let calls = 0;
    const client = new SketchfabClient(async () => { calls++; return { ok: true, json: async () => ({token:'local-test-credential-0000'}) }; });
    assert.equal(await client.loadLocalToken({hostname:'example.com'}), false);
    assert.equal(calls, 0);
    assert.equal(await client.loadLocalToken({hostname:'127.0.0.1'}), true);
    assert.equal(client.token, 'local-test-credential-0000');
    client.token = 'manual'; await client.loadLocalToken({hostname:'localhost'});
    assert.equal(client.token, 'manual');
});


test('local Sketchfab JSON accepts unique valid token pools and preserves manual overrides', async () => {
    const a = 'a'.repeat(32), b = 'b'.repeat(32);
    let calls = 0, authorization = [];
    const client = new SketchfabClient(async (url, options) => {
        calls++;
        if (url === '/.local/sketchfab.json') return { ok: true, json: async () => ({
            token: a, tokens: [a, b, '', 'not-a-token', null, b]
        }) };
        authorization.push(options.headers.Authorization);
        return { ok: true, json: async () => ({ results: [] }) };
    });
    assert.equal(await client.loadLocalToken({hostname:'example.com'}), false);
    assert.equal(calls, 0);
    assert.equal(await client.loadLocalToken({hostname:'localhost'}), true);
    assert.equal(client.credentialCount, 2);
    for(let i=0;i<10;i++) await client.search('car');
    assert.ok(authorization.every(header => header === `Token ${a}` || header === `Token ${b}`));
    client.token = 'manual-selection';
    assert.equal(client.credentialCount, 1);
    await client.search('tree');
    assert.equal(authorization.at(-1), 'Token manual-selection');
});
test('invalid pooled Sketchfab token is removed after 401 without rate-limit retries', async () => {
    const token = 'x'.repeat(32);
    let requests = 0;
    const client = new SketchfabClient(async (url) => {
        if (url === '/.local/sketchfab.json') return {ok:true,json:async()=>({tokens:[token]})};
        requests++; return {ok:false,status:401};
    });
    assert.equal(await client.loadLocalToken({hostname:'127.0.0.1'}), true);
    await assert.rejects(client.download('demoUid'), /valido/);
    assert.equal(client.credentialCount, 0);
    assert.equal(requests, 1);
});

test('one-time JSON setup persists across new Sketchfab clients and can be revoked', async () => {
    const saved = { value: [] };
    const store = { load: async () => saved.value, save: async tokens => { saved.value = [...tokens]; },
        clear: async () => { saved.value = []; } };
    const a = 'a'.repeat(32), b = 'b'.repeat(32);
    const first = new SketchfabClient();
    assert.equal(await first.saveSavedTokens(JSON.stringify({tokens:[a,b,a]}), store), 2);
    assert.equal(first.credentialCount, 2);
    const calls = [];
    const reopened = new SketchfabClient(async (_, options) => {
        calls.push(options.headers.Authorization);
        return {ok:true,json:async()=>({results:[]})};
    });
    assert.equal(await reopened.loadSavedTokens(store), true);
    assert.equal(reopened.credentialCount, 2);
    await reopened.search('Ferrari');
    assert.ok(['Token ' + a, 'Token ' + b].includes(calls[0]));
    await reopened.clearSavedTokens(store);
    const afterClear = new SketchfabClient();
    assert.equal(await afterClear.loadSavedTokens(store), false);
    assert.equal(afterClear.credentialCount, 0);
});
test('invalid Sketchfab credential JSON cannot overwrite stored credentials', async () => {
    const store = { load: async () => [], save: async () => { throw Error('Must not be called'); } };
    const client = new SketchfabClient();
    await assert.rejects(client.saveSavedTokens('{"tokens":["short"]}', store), /token valido/);
    await assert.rejects(client.saveSavedTokens('{"tokens":[}', store), /JSON/);
});
test('manual credentials supersede saved browser credentials without implicitly persisting edits', async () => {
    const saved = 's'.repeat(32);
    const store = { load: async () => [saved] };
    let auth = null;
    const client = new SketchfabClient(async (_, options) => {
        auth = options.headers.Authorization; return {ok:true,json:async()=>({results:[]})};
    });
    await client.loadSavedTokens(store);
    client.token = 'manual';
    await client.search('BMW');
    assert.equal(auth, 'Token manual');
    client.token = '';
    await client.search('BMW');
    assert.equal(auth, 'Token ' + saved);
});

test('saved imported vehicle keeps real drivable prefab instead of reverting to static scenery', () => {
    const entry={id:'bmw-test',prefab:'vehicle',assetId:'asset-bmw-001',name:'Sketchfab · BMW M4 G82',
        position:[6,2,5],rotation:[0,Math.PI/2,0],scale:[1,1,1],collider:false};
    const roundtrip=validateScene({version:1,world:'liberty-city',objects:[entry]});
    assert.equal(roundtrip.objects[0].prefab,'vehicle');
    assert.equal(roundtrip.objects[0].assetId,'asset-bmw-001');
    assert.equal(roundtrip.objects[0].name,entry.name);
});
test('Sketchfab BMW Ferrari Lamborghini positions remain close to the spawn',async()=>{
    const {SUPERCARS,supercarPositions,fitVehicleVisual}=await import('../src/editor/supercars.mjs');
    const THREE=await import('three');
    assert.deepEqual(SUPERCARS.map(c=>c.brand),['BMW','Ferrari','Lamborghini']);
    assert.ok(SUPERCARS.every(c=>c.license==='CC BY'&&c.uid.length===32));
    const positions=supercarPositions({x:40,y:2,z:100});
    assert.deepEqual(positions,[[26,2,110],[33,2,110],[19,2,110]]);
    assert.ok(positions.every(p=>p[0]>=19&&p[0]<=33&&p[2]===110), 'Cars remain grouped within 21m of spawn.');
    const sample=new THREE.Mesh(new THREE.BoxGeometry(2,1.4,4.6));
    const visual=fitVehicleVisual(sample,THREE);
    const box=new THREE.Box3().setFromObject(visual);
    const size=box.getSize(new THREE.Vector3());
    assert.ok(size.z>4.2 && size.z<=4.61);
    assert.ok(Math.abs(box.min.y+0.84)<0.02);
});

test('automatic car wheel rig extracts four wheels, with separate steering and suspension pivots',async()=>{
 const THREE=await import('three');
 const {rigImportedWheels,chassisHeightForGround}=await import('../src/editor/wheel-rig.mjs');
 const makeWheel=(x,z,name)=>{
    const m=new THREE.Mesh(new THREE.CylinderGeometry(.33,.33,.24,20),new THREE.MeshStandardMaterial());
    m.rotation.z=Math.PI/2;
    m.position.set(x,-.50,z);
    m.name=name;
    return m;
 };
 for(const id of ['bmw','ferrari','lamborghini']){
    const shell=new THREE.Group();
    if(id==='ferrari'){
        shell.add(makeWheel(.95,-1.35,'Object_31'));
        for(let i=0;i<4;i++)shell.add(makeWheel(i%2?0.95:-0.95,i<2?1.35:-1.35,'Object_'+(37+i)));
    }else{
        for(const [i,z] of [1.35,-1.35].entries()){
            const name=id==='bmw'?(i?'Back Wheels':'Front Wheels'):(i?'Plane08.001_4':'Plane08_3');
            const group=new THREE.Group();group.name=name;
            group.add(makeWheel(-.95,z,name+'_L'),makeWheel(.95,z,name+'_R'));
            shell.add(group);
        }
    }
    const car={wheels:[{position:new THREE.Vector3(-.95,0,1.35),wheelObject:new THREE.Group()},
        {position:new THREE.Vector3(.95,0,1.35),wheelObject:new THREE.Group()},
        {position:new THREE.Vector3(-.95,0,-1.35),wheelObject:new THREE.Group()},
        {position:new THREE.Vector3(.95,0,-1.35),wheelObject:new THREE.Group()}],
        userData:{},add(o){this.children??=[];this.children.push(o);}};
    const result=rigImportedWheels(shell,id,car,THREE);
    assert.equal(result.ready,true,id+': '+result.reason);
    assert.deepEqual(car.userData.sketchfabWheelRig.map(v=>v.index).sort(),[0,1,2,3]);
    assert.equal(car.children.length,4);
    assert.ok(car.wheels.every(w=>w.wheelObject.visible===false));
    if(id==='ferrari'){
      assert.equal(shell.getObjectByName('Object_31').visible,false,
        'Separate F40 rear hub must not remain static');
      const rearRight=car.userData.sketchfabWheelRig.find(w=>w.pivot.name.endsWith(' right:rear'));
      assert.ok(rearRight.pivot.children.length>=2,
        'Rear hub and tire must share the physics wheel pivot');
    }
 }
 const y=chassisHeightForGround(12.5,[{chassisConnectionPointLocal:{y:-.15},suspensionRestLength:.35,radius:.31}]);
 assert.ok(Math.abs(y-13.39)<.001);
});
