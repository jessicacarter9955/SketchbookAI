import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {safeMapPath, mapAssetURL, configureMapLights, mapValidationSummary, fitDirectionalShadow} from '../tools/ue2three/map-presentation.mjs';
import {installMapOutputPass} from '../src/editor/ue2three-output.mjs';

const path = 'build/local-scenes/ue2three/projects/example/maps/Level.glb';
const hash = 'a'.repeat(64);

test('visible source checks distinguish actor coverage from material and lighting fidelity', () => {
  const rows = mapValidationSummary({transforms: {matched: 152, mismatched: 0, skipped: 1},
    landscapes: [{repaired_vertices: 3072}], material_fallbacks: Array(8).fill({})});
  assert.match(rows[0], /152 coerenti, 0 diverse, 1 non confrontabili/);
  assert.match(rows[1], /3072 vertici/);
  assert.match(rows[2], /8 ripieghi.*ancora da verificare/);
  assert.match(rows[3], /approssimata/);
  assert.match(mapValidationSummary(null)[0], /non disponibile/);
  assert.match(mapValidationSummary({transforms: {matched: NaN, mismatched: -1, skipped: 0}})[0], /non disponibile/);
  assert.ok(mapValidationSummary({material_graphs: {Grid: {
    root_connections: 'direct_connections_recovered', connection_count: 66}}}).some(row => /66 collegamenti diretti.*da tradurre/.test(row)));
});

test('directional shadow frustum contains a map far from world origin without moving source light',()=>{
  const root=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(20,4,30));
  mesh.position.set(2000,100,-3000);root.add(mesh);
  const sun=new THREE.DirectionalLight(0xffeedd,3);sun.position.set(2100,250,-2900);
  sun.target.position.copy(mesh.position);root.add(sun,sun.target);root.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(mesh),before=sun.position.clone();
  assert.equal(fitDirectionalShadow(sun,bounds),true);
  sun.shadow.camera.updateMatrixWorld(true);
  for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]) {
    const projected=new THREE.Vector3(x,y,z).project(sun.shadow.camera);
    assert.ok(Math.abs(projected.x)<=1 && Math.abs(projected.y)<=1 && Math.abs(projected.z)<=1,JSON.stringify(projected));
  }
  assert.deepEqual(sun.position,before);
});

test('composer encodes final pixels once after FXAA without changing its existing passes', () => {
  const fxaa = {name: 'FXAA'};
  const composer = {passes: [fxaa], addPass(pass) {this.passes.push(pass);}};
  const output = installMapOutputPass(composer);
  assert.deepEqual(composer.passes, [fxaa, output]);
  assert.match(output.material.fragmentShader, /LinearTosRGB/);
  assert.equal(output.material.toneMapped, false);
  assert.equal(installMapOutputPass(composer), output);
  assert.equal(composer.passes.length, 2);
  output.dispose();
});

test('map cache uses the exported checksum, not a page bundle label', async () => {
  let requests = 0;
  const url = await mapAssetURL(path, {revision: 'weapon-root', fetchManifest: async (url, options) => {
    requests++;
    assert.equal(url, '/build/local-scenes/ue2three/projects/example/map-manifest.json');
    assert.equal(options.cache, 'no-store');
    return {ok: true, json: async () => ({maps: [{filename: 'Other.glb', output_sha256: 'b'.repeat(64)},
      {filename: 'Level.glb', output_sha256: hash}]})};
  }});
  assert.equal(url, '/' + path + '?revision=' + hash);
  assert.equal(requests, 1);
});

test('an explicit asset checksum avoids a manifest request', async () => {
  assert.equal(await mapAssetURL(path, {revision: hash, fetchManifest: () => {throw Error('unexpected fetch');}}),
    '/' + path + '?revision=' + hash);
});

test('nested asset export maps reuse the manifest located alongside their maps folder',async()=>{
  const nested='build/local-scenes/ue2three/projects/example/dds-assets/maps/maps/Level.glb';
  await mapAssetURL(nested,{fetchManifest:async url=>{
    assert.equal(url,'/build/local-scenes/ue2three/projects/example/dds-assets/maps/map-manifest.json');
    return {ok:true,json:async()=>({maps:[{filename:'Level.glb',output_sha256:hash}]})};
  }});
});

test('recovered original map assemblies use exact content-addressed catalog identity without certifying the map',async()=>{
  const recovered='build/local-scenes/ue2three/projects/example/recovered-maps/'+'b'.repeat(20)+'/model.glb';
  assert.equal(safeMapPath(recovered),recovered);
  const url=await mapAssetURL(recovered,{fetchManifest:async url=>{
    assert.equal(url,'/build/local-scenes/ue2three/projects/example/recovered-map-catalog.json');
    return {ok:true,json:async()=>({maps:[{model:'recovered-maps/'+'b'.repeat(20)+'/model.glb',sha256:hash,complete_level:false}]})};
  }});
  assert.equal(url,'/'+recovered+'?revision='+hash);
  assert.throws(()=>safeMapPath(recovered.replace('b'.repeat(20),'invalid')),/Percorso/);
});

test('old exports remain loadable without a manifest and never reuse an unversioned URL', async () => {
  for (const fetchManifest of [async () => {throw Error('offline');},
    async () => ({ok: false}), async () => ({ok: true, json: async () => ({maps: []})})]) {
    assert.equal(await mapAssetURL(path, {fetchManifest, now: () => 123}), '/' + path + '?revision=123');
  }
});

test('map requests reject paths outside migrated projects and encoded traversal', () => {
  for (const value of ['/Game/Level', path + '?x=1', path.replace('Level', '..'),
    path.replace('Level', '%2e%2e'), 'build/other/maps/Level.glb']) {
    assert.throws(() => safeMapPath(value), /Percorso mappa/);
  }
  assert.equal(safeMapPath(path.replaceAll('/', '\\')), path);
});

test('source light values and geometry stay intact with a bounded shadow budget', () => {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 1, 3), new THREE.MeshStandardMaterial({color: 0x448877}));
  const sun = new THREE.DirectionalLight(0xffeedd, 3);
  const extraSun = new THREE.DirectionalLight(0xffffff, 0.1);
  const point = new THREE.PointLight(0x33ffaa, 5, 30);
  point.castShadow = true;
  sun.position.set(4, 12, 8);
  root.add(mesh, sun, extraSun, point);
  const before = {position: sun.position.toArray(), color: sun.color.toArray(), intensity: sun.intensity,
    mesh: mesh.geometry.attributes.position.array.slice(), material: mesh.material.color.toArray()};
  const renderer = {shadowMap: {}};
  assert.deepEqual(configureMapLights(renderer, root), {sourceDirectional: 2, shadowLights: 1});
  assert.equal(renderer.shadowMap.enabled, true);
  assert.equal(renderer.useLegacyLights, false);
  assert.equal(renderer.outputColorSpace, THREE.SRGBColorSpace);
  assert.equal(sun.castShadow, true);
  assert.equal(extraSun.castShadow, false);
  assert.equal(point.castShadow, false);
  assert.equal(sun.shadow.mapSize.x, 2048);
  assert.deepEqual(sun.position.toArray(), before.position);
  assert.deepEqual(sun.color.toArray(), before.color);
  assert.equal(sun.intensity, before.intensity);
  assert.deepEqual(mesh.geometry.attributes.position.array, before.mesh);
  assert.deepEqual(mesh.material.color.toArray(), before.material);
  assert.equal(mesh.receiveShadow, true);
});
