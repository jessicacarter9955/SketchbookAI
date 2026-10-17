import test from 'node:test';
import assert from 'node:assert/strict';
import {DISTRICT_PRESET,generateDistrictPlan,districtGround,districtDeckHeight,districtIsLand} from '../src/editor/district-data.mjs';

test('four districts are reproducible with distinct building typologies',()=>{
 const a=generateDistrictPlan(DISTRICT_PRESET),b=generateDistrictPlan(DISTRICT_PRESET);
 assert.deepEqual(a,b);
 assert.deepEqual(a.zones.map(z=>z.id),['ny','sf','rio','miami']);
 assert.equal(a.spawns.length,5);
 for(const zone of a.zones){
   const buildings=a.buildings.filter(b=>b.district===zone.id);
   assert.ok(buildings.length>=12,zone.id+' should be occupied');
   assert.ok(new Set(buildings.map(b=>b.floors)).size>=3,zone.id+' must vary elevations');
   assert.ok(buildings.every(b=>b.theme===zone.theme));
 }
 assert.equal(new Set(a.zones.map(d=>d.theme)).size,4);
});
test('water channel and bridge maintain positive clearance and walkable approaches',()=>{
 const plan=generateDistrictPlan();
 assert.ok(!districtIsLand(0,125),'the bay must be water rather than hidden ground');
 assert.ok(districtDeckHeight(0,125)>districtGround(0,125)+8,'elevated viaduct');
 assert.equal(districtDeckHeight(0,185),null,'bridge should not affect other coast');
 assert.equal(plan.roads.filter(r=>r.kind==='bridge').length,1);
 assert.deepEqual(plan.routes.find(r=>r.district==='bridge').points[0],[-116,125]);
 assert.ok(plan.roads.every(r=>r.kind==='bridge'||districtIsLand((r.a.x+r.b.x)/2,(r.a.z+r.b.z)/2)));
 for(const spawn of plan.spawns.slice(0,4)){
   assert.ok(districtIsLand(spawn.position[0],spawn.position[2]),spawn.id);
 }
});
test('the coast has beachfront, four different street meshes and livable scale',()=>{
 const p=generateDistrictPlan();
 assert.ok(p.roads.length>120);
 assert.ok(p.plants.length>130);
 assert.ok(p.beaches.length>=2);
 assert.ok(p.roads.some(x=>x.kind==='avenue'));
 assert.ok(p.roads.some(x=>x.kind==='local'));
 assert.ok(p.buildings.every(b=>b.floors>=2&&b.floors<=32));
 assert.ok(p.routes.some(x=>x.district==='sf'));
 assert.ok(p.pedRoutes.length>=4);
});
