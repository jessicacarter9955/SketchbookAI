import test from 'node:test';
import assert from 'node:assert/strict';
import {DDS_REQUIRED_CLIPS,validateDdsExport} from '../src/editor/dds-local-assets.mjs';
const name=n=>n+'.glb';
const original={version:1,mesh:name('mannequin'),
  clips:Object.fromEntries(DDS_REQUIRED_CLIPS.map(n=>[n,name(n)])),
  weapons:{rifle:name('rifle'),pistol:name('pistol')},
  weaponClips:{rifle:name('weapon_rifle_fire'),pistol:name('weapon_pistol_fire')}};
test('DDS importer requires the original 23 animation clips and both weapons',()=>{
 const names=validateDdsExport(original);
 assert.equal(names.length,28);assert.equal(names[0],'mannequin.glb');
 assert.ok(names.includes('weapon_pistol_fire.glb'));
});
test('original missing GLBs fail loudly and never produce placeholder weapons',()=>{
 const names=validateDdsExport(original);
 assert.throws(()=>validateDdsExport(original,names.filter(n=>n!=='mannequin.glb')),/File esportato assente/);
 assert.throws(()=>validateDdsExport({...original,clips:{...original.clips,heal:undefined}}),/Animazione DDS mancante/);
});
test('import denies filename path traversal and remote URLs',()=>{
 assert.throws(()=>validateDdsExport({...original,mesh:'../mannequin.glb'}),/non valido/);
 assert.throws(()=>validateDdsExport({...original,weapons:{...original.weapons,rifle:'https://host/weapon.glb'}}),/Arma DDS mancante/);
});
