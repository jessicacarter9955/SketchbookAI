import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeEffectBridge, SourceComponentEffects, SourceWaveAudio, attachNativeEffects, nativeEffectCoverage} from '../src/editor/ue2three-native-effects.mjs';
import {BlueprintActorRuntime} from '../src/editor/ue2three-blueprint-runtime.mjs';

const engine='/Script/Engine', identity=[engine,'GameplayStatics','PlaySound2D'];
const effect = n => ({op:'native_audio_vfx',identity,dispatch:'EX_CallMath',receiver:null,package:'/Game/Original',arguments:[n]});

test('committed native effects execute serially; missing and failing adapters remain visible',async()=>{
    const bridge=new NativeEffectBridge(),calls=[];
    bridge.register(identity,async e=>{await Promise.resolve();calls.push(e.arguments[0]);if(e.arguments[0]===2)throw Error('unavailable');return {scope:'test'};});
    const first=effect(1);bridge.enqueue([first,effect(2),effect(3)]);first.arguments[0]=99;
    bridge.enqueue([{...effect(4),identity:[engine,'GameplayStatics','Unknown']}]);
    await bridge.flush();assert.deepEqual(calls,[1,2,3]);
    assert.deepEqual(bridge.receipts.map(x=>x.status),['executed','blocked','executed','blocked']);
    assert.equal(bridge.receipts[3].code,'adapter_missing');assert.equal(bridge.pending,0);
});

test('bounded queue reports overflow, cancels disposed work and never silently replays',async()=>{
    const bridge=new NativeEffectBridge({limit:2});let calls=0;
    bridge.register(identity,()=>{calls++;});bridge.enqueue([effect(1),effect(2),effect(3)]);
    assert.equal(bridge.receipts[0].code,'queue_full');bridge.dispose();await bridge.flush();
    assert.equal(calls,0);assert.equal(bridge.pending,0);assert.throws(()=>bridge.enqueue([]),/disposed/);
});

function sourceFixture() {
    const object = className=>({type:'ObjectProperty',...(className?{class:[engine,className]}:{}),default:null});
    const schemas=[object(),object('SoundBase'),{type:'FloatProperty'},{type:'FloatProperty'},{type:'FloatProperty'},object('SoundConcurrency'),object('Actor'),{type:'BoolProperty'}];
    const values=[null,null,1,1,0,null,null,true];
    const call={op:'native_audio_vfx',identity,dispatch:'EX_CallMath',receiver:null,receiver_schema:null,
        parameter_schemas:schemas,parameters:schemas.map((schema,i)=>({contract:schema,schema,value:{op:'constant',value:values[i]}})),return_schema:null};
    const program={schema_version:1,status:'translated_straight_line',input_fields:[],output_fields:[],self_reads:[],self_writes:[],steps:[{op:'evaluate',value:call},{op:'return',value:{op:'constant',value:null}}]};
    const report={schema_version:1,project:'Original.uproject',packages:{'/Game/Original':{default_state:{},functions:{Play:program}}}};
    return {runtime:new BlueprintActorRuntime(report,report.project),program,report};
}

test('transaction failure emits no browser effect; restore does not replay history; delivery failure cannot rollback state',async()=>{
    const {runtime,program}=sourceFixture();const bridge=new NativeEffectBridge();let calls=0;
    bridge.register(identity,()=>{calls++;});const detach=attachNativeEffects(runtime,bridge);
    runtime.call('/Game/Original','Play');await bridge.flush();assert.equal(calls,1);
    const snapshot=runtime.snapshot();runtime.restore(snapshot);await bridge.flush();assert.equal(calls,1);
    program.steps.splice(1,0,{op:'evaluate',value:{op:'unsupported'}});
    assert.throws(()=>runtime.call('/Game/Original','Play'));await bridge.flush();assert.equal(calls,1);
    program.steps.splice(1,1);runtime.onCommittedEffects(()=>{throw Error('status failed');});
    runtime.call('/Game/Original','Play');await bridge.flush();assert.equal(calls,2);assert.equal(runtime.effectDeliveryErrors.length,1);
    detach();runtime.call('/Game/Original','Play');await bridge.flush();assert.equal(calls,2);
});

test('source component bindings require exact identities and preserve linear RGBA without inventing VFX',async()=>{
    const bridge=new NativeEffectBridge(),components=new SourceComponentEffects();components.install(bridge);
    const ref={kind:'source_native_component',realm:'world1',actor_id:'player1',source_package:'/Game/Original',source_owner_index:2,
        source_field:'Fx',declared_class:['/Script/Niagara','NiagaraComponent']};
    const received=[];components.bind(ref,{linearColors:new Map([['OriginalColor',{set:(...args)=>received.push(args)}]])});
    const color={R:0.2,G:0.3,B:0.4,A:0.5};
    const request={...effect(0),identity:['/Script/Niagara','NiagaraComponent','SetVariableLinearColor'],receiver:ref,arguments:['OriginalColor',color]};
    bridge.enqueue([request,{...request,receiver:{...ref,actor_id:'foreign'}},{...request,arguments:['Missing',color]}]);await bridge.flush();
    assert.deepEqual(received,[[0.2,0.3,0.4,0.5].map(Math.fround)]);
    assert.deepEqual(bridge.receipts.map(r=>r.status),['executed','blocked','blocked']);
});

test('nested audit suppression retains source receipts without executing external effects',async()=>{
    const {runtime}=sourceFixture();const bridge=new NativeEffectBridge();let calls=0;
    bridge.register(identity,()=>{calls++;});attachNativeEffects(runtime,bridge);
    const first=runtime.suppressExternalEffects(),second=runtime.suppressExternalEffects();
    runtime.call('/Game/Original','Play');first();first();runtime.call('/Game/Original','Play');
    await bridge.flush();assert.equal(calls,0);assert.equal(runtime.audioVfxRequests.length,2);
    second();runtime.call('/Game/Original','Play');await bridge.flush();assert.equal(calls,1);
});

test('audio component volume uses its source gain and exact binding, independent of object field order',async()=>{
    const bridge=new NativeEffectBridge(),components=new SourceComponentEffects();components.install(bridge);
    const ref={kind:'source_native_component',realm:'w',actor_id:'a',source_package:'/Game/Original',source_owner_index:2,
        source_field:'Audio',declared_class:[engine,'AudioComponent']};
    const received=[];components.bind(ref,{context:{currentTime:3},sourceVolume:0.8,gain:{gain:{setValueAtTime:(...args)=>received.push(args)}}});
    bridge.enqueue([{...effect(0),identity:[engine,'AudioComponent','SetVolumeMultiplier'],
        receiver:Object.fromEntries(Object.entries(ref).reverse()),arguments:[0.5]}]);await bridge.flush();
    assert.deepEqual(received,[[0.4,3]]);
});

const hash='a'.repeat(64);
function audioFixture() {
    const voices=[];const context={state:'running',destination:{},decodeAudioData:async()=>({duration:4}),
        createBufferSource:()=>{const source={connect(){},disconnect(){},stop(){},playbackRate:{},start:(...args)=>{source.startArgs=args;}};voices.push(source);return source;},
        createGain:()=>({connect(){},disconnect(){},gain:{value:0}})};
    const manifest={schema_version:1,assets:{'/Game/Original.Sound':{kind:'SoundWave',url:'/build/local-scenes/ue2three/sound.wav',sha256:hash,
        source_settings_verified:true,volume:0.8,pitch:1.1,loop:false}}};
    let fetches=0;const driver=new SourceWaveAudio(context,manifest,{fetchImpl:async()=>{fetches++;return {ok:true,arrayBuffer:async()=>new ArrayBuffer(4)};},digest:async()=>hash});
    const request={...effect(0),arguments:[{kind:'source_self',source_package:'/Game/Original'},
        {asset:'/Game/Original.Sound'},0.5,1.2,-1,null,null,true]};
    return {driver,context,voices,manifest,request,fetches:()=>fetches};
}

test('verified local WAV playback caches decoding, preserves volume/pitch and clamps negative source start',async()=>{
    const {driver,voices,request,fetches}=audioFixture();
    const a=await driver.play2D(request),b=await driver.play2D(request);
    assert.equal(a.scope,'verified_wave_ui_2d');assert.equal(b.status,undefined);assert.equal(fetches(),1);
    assert.equal(voices[0].playbackRate.value,Math.fround(1.2)*1.1);assert.deepEqual(voices[0].startArgs,[0,0]);
    driver.dispose();assert.equal(driver.voices.size,0);
});

test('audio missing assets, hashes, gestures, source policies and unsupported sound graphs fail explicitly',async()=>{
    for (const [mutate,code] of [
        [f=>f.request.arguments[1].asset='/Game/Missing.Sound','audio_asset_missing'],
        [f=>f.driver.digest=async()=>'b'.repeat(64),'audio_hash_mismatch'],
        [f=>f.context.state='suspended','audio_gesture_required'],
        [f=>f.request.arguments[5]={asset:'/Game/Concurrency.C'},'audio_policy_untranslated'],
        [f=>f.manifest.assets['/Game/Original.Sound'].kind='SoundCue','audio_asset_missing'],
        [f=>f.manifest.assets['/Game/Original.Sound'].url='https://example.com/sound.wav','audio_asset_missing'],
        [f=>f.manifest.assets['/Game/Original.Sound'].source_settings_verified=false,'audio_settings_missing']]) {
        const f=audioFixture();mutate(f);await assert.rejects(()=>f.driver.play2D(f.request),error=>error.code===code);assert.equal(f.voices.length,0);
    }
    const f=audioFixture();f.request.arguments[1]=null;assert.equal((await f.driver.play2D(f.request)).status,'skipped');
});

test('coverage counts original call sites and identifies their function without claiming runtime fidelity',()=>{
    const {report}=sourceFixture();const rows=nativeEffectCoverage(report);
    assert.equal(rows.length,1);assert.equal(rows[0].call_sites,1);assert.equal(rows[0].sources[0].function,'Play');
});
