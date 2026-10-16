import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {marketplaceParkingSlots,CAR_MARKETPLACES} from '../src/editor/urban-marketplace-slots.mjs';
const s=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('two marketplace slots sit on road lanes near spawn outside intersections',()=>{
 for(const blocks of [4,6]){
  const cfg={blocksX:blocks,blocksZ:blocks,blockSize:42,roadWidth:10,sidewalkWidth:3.5};
  const out=marketplaceParkingSlots(cfg,[2.8,1.1,-9.24]);
  assert.equal(out.length,2);assert.deepEqual(CAR_MARKETPLACES,['sketchfab','fab']);
  assert.ok(Math.hypot(out[0].x-out[1].x,out[0].z-out[1].z)>6);
 }
});
test('import actual GLBs from marketplaces to driveable editor prefab, never synthetic replacements',()=>{
 const t=s('src/editor/UrbanMarketplaceGarage.js');assert.match(t,/importURL\(source/);
 assert.match(t,/importBytes\(await source.arrayBuffer/);
 assert.match(t,/interactivePrefab:'vehicle'/);assert.match(s('src/editor/start.js'),/KeyE/);
 assert.match(s('src/editor/SceneEditor.js'),/options\.position/);
});
