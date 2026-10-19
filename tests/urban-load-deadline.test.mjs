import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {withUrbanLoadDeadline} from '../src/editor/urban-load-deadline.mjs';

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('photoreal stage deadline preserves real asynchronous loader result',async()=>{
  const mesh={genuine:true};
  assert.equal(await withUrbanLoadDeadline('original kit',()=>Promise.resolve(mesh),100),mesh);
});

test('never-settling GLTF or IndexedDB work rejects with original asset name',async()=>{
  await assert.rejects(
    withUrbanLoadDeadline('tree_small_02 LOD0',()=>new Promise(()=>{}),15),
    /tree_small_02 LOD0.*non completata entro/
  );
});

test('actual loader errors are propagated, not replaced by success or placeholders',async()=>{
  await assert.rejects(
    withUrbanLoadDeadline('facade',()=>Promise.reject(new Error('network error')),100),
    /network error/
  );
  assert.throws(()=>withUrbanLoadDeadline('',()=>null,10),/Invalid/);
});

test('real City Player HD source loads are guarded and preserve full-quality requirement',()=>{
  const runtime=source('src/editor/UrbanRuntime.js');
  const trees=source('src/editor/UrbanVegetation.js');
  const boot=source('src/editor/start.js');
  assert.match(runtime,/withUrbanLoadDeadline\('GLTF locale '/);
  assert.match(runtime,/withUrbanLoadDeadline\('Cache HD facciate'/);
  assert.match(runtime,/withUrbanLoadDeadline\('Preparazione geometrie\/shader facciate HD'/);
  assert.match(trees,/withUrbanLoadDeadline\('Vegetazione LOD'/);
  assert.match(trees,/scene-lod\$\{level\}\.gltf/);
  assert.match(boot,/visual\?\.status!=='ready'/);
  assert.doesNotMatch(runtime,/status:'ready'.*placeholder/);
});
