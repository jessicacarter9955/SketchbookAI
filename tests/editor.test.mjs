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


test('procedural city scenes accept validated generator state', async () => {
    const { DEFAULT_URBAN } = await import('../src/editor/urban-data.mjs');
    const city = { version: 1, world: 'procedural-city', objects: [], generator: { ...DEFAULT_URBAN } };
    assert.deepEqual(validateScene(city), city);
    assert.throws(() => validateScene({ ...city, generator: { ...DEFAULT_URBAN, blocksX: 1 } }));
});
