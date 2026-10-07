import test from 'node:test';
import assert from 'node:assert/strict';
import { geoJSONToPrefabs } from '../src/editor/geojson-import.mjs';

const sample={type:'FeatureCollection',features:[
 {type:'Feature',properties:{highway:'residential',name:'Via Test'},geometry:{type:'LineString',coordinates:[[9.0,45.0],[9.0002,45.0],[9.0002,45.0002]]}},
 {type:'Feature',properties:{building:'yes','building:levels':'4',name:'Casa'},geometry:{type:'Polygon',coordinates:[[[9.0003,45.0],[9.0004,45.0],[9.0004,45.0001],[9.0003,45.0001],[9.0003,45.0]]]}}
]};
test('OSM-like GeoJSON becomes editable Sketchbook roads and buildings',()=>{
 const out=geoJSONToPrefabs(sample); const roads=out.objects.filter(o=>o.prefab==='road'), buildings=out.objects.filter(o=>o.prefab==='building');
 assert.equal(roads.length,2); assert.equal(buildings.length,1);
 assert.ok(roads.every(r=>r.scale[2]>0)); assert.equal(buildings[0].name,'Casa'); assert.ok(buildings[0].scale[1]>0);
});
test('GeoJSON importer rejects unrelated geometry',()=>{
 assert.throws(()=>geoJSONToPrefabs({type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Point',coordinates:[9,45]}}]}),/Nessuna/);
});
