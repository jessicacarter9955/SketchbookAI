import test from 'node:test';
import assert from 'node:assert/strict';
import {
    expandAnimationAliases,
    safeLocalBaseURL,
    stripRootMotionTracks,
    validateCharacterManifest,
    validateCharacterRig
} from '../src/editor/ue2three-manifest.mjs';

const fingerprint='a'.repeat(64);
const manifest = overrides => ({
    schema_version:1,
    kind:'character',
    recipe_id:'hero',
    fingerprint,
    mesh:'character.glb',
    clips:{idle:'clip-idle.glb',run:'clip-run.glb'},
    runtime:{
        root_motion:'strip_root_transform',
        root_bone:'root',
        required_bones:['root','pelvis'],
        attachments:{weapon:'hand_r'},
        animation_aliases:{start_forward:'run'}
    },
    ...overrides
});

test('ue2three manifest accepts a portable local character definition',()=>{
    assert.equal(validateCharacterManifest(manifest()).recipe_id,'hero');
    assert.equal(safeLocalBaseURL('build/local-scenes/ue2three/hero'),'build/local-scenes/ue2three/hero/');
    assert.throws(()=>safeLocalBaseURL('https://example.com/hero'),/local relative/);
    assert.throws(()=>safeLocalBaseURL('../hero'),/local relative/);
});

test('root motion policy removes only the configured root transform tracks',()=>{
    const tracks=[
        {name:'root.position'},{name:'root.quaternion'},{name:'pelvis.position'},
        {name:'Armature/root.position'},{name:'hand_r.quaternion'}
    ];
    assert.deepEqual(stripRootMotionTracks(tracks,{root_motion:'strip_root_translation',root_bone:'root'}).map(t=>t.name),
        ['root.quaternion','pelvis.position','hand_r.quaternion']);
    assert.deepEqual(stripRootMotionTracks(tracks,{root_motion:'strip_root_transform',root_bone:'root'}).map(t=>t.name),
        ['pelvis.position','hand_r.quaternion']);
    assert.equal(stripRootMotionTracks(tracks,{root_motion:'preserve'}).length,tracks.length);
});

test('rig validation resolves required bones and named attachments',()=>{
    const names=new Set(['root','pelvis','hand_r']);
    const root={getObjectByName:name=>names.has(name)?{name}:null};
    const attachments=validateCharacterRig(root,manifest());
    assert.equal(attachments.weapon.name,'hand_r');
    names.delete('pelvis');
    assert.throws(()=>validateCharacterRig(root,manifest()),/pelvis/);
});

test('generic attachment asset metadata validates socket and runtime transform',()=>{
    const definition={file:'attachment-tool.glb',bone:'hand_r',transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}};
    const candidate=manifest({attachment_assets:{tool:definition}});
    assert.equal(validateCharacterManifest(candidate).attachment_assets.tool.bone,'hand_r');
    const root={getObjectByName:name=>['root','pelvis','hand_r'].includes(name)?{name}:null};
    assert.equal(validateCharacterRig(root,candidate).weapon.name,'hand_r');
    assert.throws(()=>validateCharacterManifest(manifest({attachment_assets:{tool:{...definition,file:'../weapon.glb'}}})),/attachment asset entry/);
    const invalidTransform=manifest({attachment_assets:{tool:{...definition,transform:{position:[0,NaN,0]}}}});
    assert.throws(()=>validateCharacterManifest(invalidTransform),/position transform/);
});

test('animation aliases clone source clips without overwriting real clips',()=>{
    const make=name=>({name,clone(){return make(this.name);}});
    const clips=[make('idle'),make('run')];
    const expanded=expandAnimationAliases(clips,manifest().runtime);
    assert.deepEqual(expanded.map(c=>c.name),['idle','run','start_forward']);
    assert.notEqual(expanded[2],clips[1]);
    assert.throws(()=>expandAnimationAliases(clips,{animation_aliases:{missing:'walk'}}),/missing clip walk/);
});

test('source socket transforms require finite coordinates and a unit quaternion',()=>{
    const socket={position:[-.07,-.01,.02],quaternion:[0,0,0,1],scale:[1,1,1]};
    const definition={file:'rifle.glb',bone:'hand_r',socket:'palm_r_Socket',socket_transform:socket};
    assert.equal(validateCharacterManifest(manifest({attachment_assets:{rifle:definition}})).attachment_assets.rifle.socket,'palm_r_Socket');
    for (const invalid of [{...socket,quaternion:[0,0,0,0]}, {...socket,position:[0,NaN,0]}, {...socket,scale:[1,-1,1]}]) {
        assert.throws(()=>validateCharacterManifest(manifest({attachment_assets:{rifle:{...definition,socket_transform:invalid}}})),/socket/);
    }
});

test('invalid remote filenames and aliases are rejected early',()=>{
    assert.throws(()=>validateCharacterManifest(manifest({mesh:'../evil.glb'})),/mesh filename/);
    const bad=manifest();bad.runtime.animation_aliases={go:'../run'};
    assert.throws(()=>validateCharacterManifest(bad),/animation aliases/);
});
