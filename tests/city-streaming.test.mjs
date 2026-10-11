import test from 'node:test';
import assert from 'node:assert/strict';
import {distanceToSector,selectCitySectors,CITY_STREAM} from '../src/editor/city-streaming.mjs';

const sector=(id,x,z)=>({id,bounds:[[x,0,z],[x+40,20,z+40]]});
const origin={x:0,z:0}, first=sector('player',0,0), behind=sector('behind',-450,0),
      ahead=sector('ahead',300,0), invisible=sector('out-of-view',0,400),
      far=sector('far',1200,0);
test('distance is measured from sector AABB, not center',()=>{
  assert.equal(distanceToSector(origin,first.bounds),0);
  assert.equal(distanceToSector({x:80,z:0},first.bounds),40);
});
test('streaming always retains nearby physics and loads only visible distance tiles',()=>{
  const result=selectCitySectors([far,invisible,behind,ahead,first],origin,origin,s=>s.id==='ahead');
  assert.deepEqual(result.map(s=>s.id),['player','ahead']);
});
test('hysteresis keeps recently viewed sectors briefly but not the whole map',()=>{
  assert.ok(CITY_STREAM.retainBubble>CITY_STREAM.collisionBubble);
  assert.ok(CITY_STREAM.retainView>CITY_STREAM.prefetchView);
  const result=selectCitySectors([sector('bubble',230,0),sector('no',900,0)],origin,origin,()=>false,{retain:true});
  assert.deepEqual(result.map(s=>s.id),['bubble']);
});
