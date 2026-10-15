import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const get=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('San Andreas viewer ships a real Three.js import page, without fake map assets',()=>{
 const html=get('sa-navigation.html'),script=get('src/editor/sa-viewer.js'),pack=get('tools/package-urban-preview.py');
 assert.match(html,/sa-navigation/);
 assert.match(html,/id="sa-nodes"/);assert.match(html,/id="sa-meshes"/);
 assert.match(script,/parseSanAndreasNodeFile/);
 assert.match(script,/buildSanAndreasNetwork/);
 assert.match(script,/GLTFLoader/);assert.match(script,/THREE\.LineSegments/);
 assert.doesNotMatch(script,/BoxGeometry|CityRuntime|placeholder/i);
 assert.match(pack,/sa-viewer\.bundle\.js/);
});
test('viewer does not fetch or transmit proprietary GTA assets to public services',()=>{
 const script=get('src/editor/sa-viewer.js'),html=get('sa-navigation.html');
 assert.doesNotMatch(script,/\bfetch\(/);
 assert.doesNotMatch(script,/XMLHttpRequest/);
 assert.match(script,/URL\.createObjectURL\(file\)/);
 assert.match(script,/Nessun file è stato inviato/);
});
