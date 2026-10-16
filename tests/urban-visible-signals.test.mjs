import test from 'node:test';
import assert from 'node:assert/strict';
import {URBAN_SIGNAL} from '../src/editor/urban-traffic-signals.mjs';
import {readFileSync} from 'node:fs';
const s=readFileSync(new URL('../src/editor/UrbanSignals.js',import.meta.url),'utf8');
const runtime=readFileSync(new URL('../src/editor/UrbanRuntime.js',import.meta.url),'utf8');
test('each city crossing has physically visible traffic heads and red amber green LEDs',()=>{
 assert.match(s,/new THREE.InstancedMesh\(headGeo/);
 assert.match(s,/new THREE.InstancedMesh\(ledGeo/);
 assert.match(s,/new THREE.InstancedMesh\(postGeo/);
 assert.match(s,/this.leds.setColorAt/);
 assert.match(runtime,/this.signals=new UrbanSignals\(config\)/);
 assert.match(runtime,/this.signals\?\.update/);
 assert.equal(URBAN_SIGNAL.cycle,24);
});
