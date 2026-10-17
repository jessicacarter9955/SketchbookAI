import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('boot diagnostics expose copy select download even when game bundle fails',()=>{
 const editor=read('editor.html'),telemetry=read('src/editor/city-telemetry.js');
 const bootScript=editor.includes('build/editor.bundle.js')?'build/editor.bundle.js':'src/editor/start.js';
 assert.ok(editor.indexOf('src/editor/city-telemetry.js')<editor.indexOf(bootScript));
 for(const text of ['data-city-copy','data-city-select','data-city-download','navigator.clipboard.writeText','logText.select()','city-copy-text'])assert.ok(telemetry.includes(text),text);
});
test('loading diagnostics are user-selectable on touch screens and DDS fallback is explicit',()=>{
 const css=read('src/editor/city-telemetry.css'),telemetry=read('src/editor/city-telemetry.js');
 assert.match(css,/-webkit-user-select:text!important/);
 assert.match(css,/touch-action:pan-y!important/);
 assert.match(telemetry,/urban-photoreal-dds/);
 assert.match(telemetry,/Apri la città senza DDS/);
});
