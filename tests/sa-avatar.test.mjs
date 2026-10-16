import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const s=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('CJ-like imported avatar uses actual GLB skin, preserving native physics and vehicle seat controls',()=>{
 const editor=s('src/editor/SceneEditor.js'),actors=s('src/editor/ActorLayer.js'),garage=s('src/editor/StreetLabGarage.js');
 assert.match(garage,/value="avatar"/);assert.match(garage,/importPlayerAvatar/);
 assert.match(editor,/localStorage\.setItem\(this.storageKey\+'\.avatar'/);
 assert.match(editor,/skin\.userData\.streetlabAvatar=true/);
 assert.match(actors,/sceneEditor\?\.applyPlayerAvatar/);
 assert.match(s('src/editor/start.js'),/await sceneEditor.restorePlayerAvatar/);
});
