import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveDdsAssets,selectedDdsAssetSource} from '../src/editor/dds-asset-resolver.mjs';
const clips=Object.fromEntries(['idle','run','crouch_walk','heal','rifle_aim','rifle_fire','rifle_reload','pistol_aim','pistol_fire','pistol_reload'].map(id=>[id,'clip-'+id+'.glb']));
test('selects legacy unless opted into migrated 48-asset character',()=>{
 assert.equal(selectedDdsAssetSource(''),'legacy');
 assert.equal(selectedDdsAssetSource('?ddsAssets=ue2three'),'ue2three');
});
test('normalizes old DDS and ue2three manifests without dropping ammo gameplay',()=>{
 const old=resolveDdsAssets({mesh:'mannequin.glb',clips,weapons:{pistol:'pistol.glb',rifle:'rifle.glb'}});
 assert.equal(old.weapons.rifle,'rifle.glb');
 const newer=resolveDdsAssets({mesh:'character.glb',clips:{...clips,weapon_rifle_fire:'rifle-shot.glb'},attachment_assets:{rifle:{file:'attachment-rifle.glb'},pistol:{file:'attachment-pistol.glb'}}},'ue2three');
 assert.equal(newer.weapons.pistol,'attachment-pistol.glb');
 assert.equal(newer.weaponClips.rifle,'rifle-shot.glb');
 assert.match(newer.base,/ue2three/);
});
test('rejects unsafe files and incomplete exports',()=>{
 assert.throws(()=>resolveDdsAssets({mesh:'../x.glb',clips,weapons:{rifle:'rifle.glb',pistol:'pistol.glb'}}),/Invalid/);
 assert.throws(()=>resolveDdsAssets({mesh:'x.glb',clips:{},weapons:{}}),/missing/);
});
