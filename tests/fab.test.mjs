import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { FabClient }=createRequire(import.meta.url)('../src/editor/fab-client.js');

test('Fab search builder keeps free filter and encodes text',()=>{
  const c=new FabClient();
  const u=new URL(c.searchURL('vehicle & city',{free:true}));
  assert.equal(u.origin,'https://www.fab.com'); assert.equal(u.searchParams.get('q'),'vehicle & city'); assert.equal(u.searchParams.get('is_free'),'1');
});
test('prompt discovery infers useful asset category without changing text',()=>{
  const c=new FabClient();
  assert.deepEqual(c.suggestSearch('  modern sports car  '),{query:'modern sports car',category:'vehicles',free:true});
  assert.equal(c.suggestSearch('urban road network').category,'environments');
  assert.equal(c.suggestSearch('industrial facade').category,'buildings');
});
test('Fab category search is restricted to supported Fab paths',()=>{
  const c=new FabClient(), u=new URL(c.searchURL('car',{category:'vehicles',free:true}));
  assert.match(u.pathname,/vehicles-transportation/); assert.equal(u.searchParams.get('is_free'),'1');
  assert.throws(()=>c.listingURL('https://evil.example/listings/abc'),/Fab/);
  assert.match(c.listingURL('https://www.fab.com/listings/0699a70a-b75b-4e94-98df-8ff6cb5cbdba'),/fab\.com\/listings/);
});
test('Fab import handoff accepts portable model formats only',()=>{
  const c=new FabClient();
  for(const name of ['car.glb','pack.zip']) assert.equal(c.supportedFile({name}),true);
  assert.throws(()=>c.supportedFile({name:'plugin.uasset'}),/GLB/);
});
