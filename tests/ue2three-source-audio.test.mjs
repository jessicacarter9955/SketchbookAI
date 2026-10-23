import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceAudioManifestPath,verifiedSourceSounds,SourceAudioPlayback,loadSourceAudioPlayback}
    from '../src/editor/ue2three-source-audio.mjs';

const map='build/local-scenes/ue2three/projects/VIPExtractionKitDDS-23a280ac11/maps/GalleryLevel.glb';
const a='a'.repeat(64),b='b'.repeat(64);
const entry={asset:'/Game/Sounds/Footstep.Footstep',kind:'SoundWave',source_sha256:a,
    output_sha256:b,filename:'audio/footstep.wav'};
const manifest={schema_version:1,sounds:[entry]};

test('only content-addressed original Unreal SoundWave exports resolve to local project URLs',()=>{
    assert.equal(sourceAudioManifestPath(map),
        'build/local-scenes/ue2three/projects/VIPExtractionKitDDS-23a280ac11/audio-manifest.json');
    assert.equal(verifiedSourceSounds(manifest,map).get(entry.asset),
        '/build/local-scenes/ue2three/projects/VIPExtractionKitDDS-23a280ac11/audio/footstep.wav');
    assert.throws(()=>sourceAudioManifestPath('../../private.glb'),/Invalid source map path/);
    for(const changes of [{filename:'../private.wav'},{filename:'https://elsewhere/footstep.wav'},
        {kind:'SoundCue'},{source_sha256:'fake'},{asset:'/Engine/Fake'}])
        assert.throws(()=>verifiedSourceSounds({schema_version:1,sounds:[{...entry,...changes}]},map),
            /Invalid or duplicate original audio export/);
    assert.throws(()=>verifiedSourceSounds({schema_version:1,sounds:[entry,entry]},map),/duplicate/);
});

test('only witnessed PlaySound2D with supported ABI plays; missing source audio is never substituted',async()=>{
    const created=[],statuses=[];
    const audio=new SourceAudioPlayback({sounds:verifiedSourceSounds(manifest,map),
        createAudio:src=>{const node={src,events:[],addEventListener(name){this.events.push(name);},
            play(){this.started=true;return Promise.resolve();}};created.push(node);return node;},
        onStatus:status=>statuses.push(status)});
    const request={identity:['/Script/Engine','GameplayStatics','PlaySound2D'],
        arguments:[null,{asset:entry.asset},0.8,1.2,0.5,null,null,false]};
    const runtime={audioVfxRequests:[request]};audio.update(runtime);audio.update(runtime);
    await Promise.resolve();
    assert.equal(created.length,1);assert.equal(created[0].src,
        '/build/local-scenes/ue2three/projects/VIPExtractionKitDDS-23a280ac11/audio/footstep.wav');
    assert.equal(created[0].volume,0.8);assert.equal(created[0].playbackRate,1.2);
    assert.equal(created[0].currentTime,0.5);assert.equal(created[0].started,true);
    assert.equal(audio.counts.played,1);assert.equal(statuses.length,2);
    runtime.audioVfxRequests.push({...request,arguments:[null,{asset:'/Game/Missing.Missing'},1,1,0,null,null,false]});
    audio.update(runtime);assert.equal(audio.counts.missing,1);assert.equal(created.length,1);
    runtime.audioVfxRequests.push({...request,identity:['/Script/Engine','GameplayStatics','PlaySoundAtLocation']});
    audio.update(runtime);assert.equal(audio.counts.unsupported,1);
    runtime.audioVfxRequests.push({...request,arguments:[null,{asset:entry.asset},2,1,0,null,null,false]});
    audio.update(runtime);assert.equal(audio.counts.unsupported,2);
});

test('missing manifest means zero original sounds, not generated fallback',async()=>{
    const player=await loadSourceAudioPlayback(map,async(url,options)=>{
        assert.equal(url,'/'+sourceAudioManifestPath(map));assert.equal(options.cache,'no-store');
        return {status:404,ok:false};});
    assert.equal(player.sounds.size,0);
    assert.equal(player.handle({identity:['/Script/Engine','GameplayStatics','PlaySound2D'],
        arguments:[null,{asset:entry.asset},1,1,0,null,null,false]}).status,'missing');
});
