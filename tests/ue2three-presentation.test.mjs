import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {safeMapPath, mapAssetURL, configureMapLights} from '../tools/ue2three/map-presentation.mjs';
import {installMapOutputPass} from '../src/editor/ue2three-output.mjs';

const path = 'build/local-scenes/ue2three/projects/example/maps/Level.glb';
const hash = 'a'.repeat(64);

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
