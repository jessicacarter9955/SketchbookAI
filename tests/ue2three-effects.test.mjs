import test from 'node:test';
import assert from 'node:assert/strict';
import { executeBlueprint } from '../src/editor/ue2three-blueprint.mjs';
import { BlueprintActorRuntime, bindBlueprintInputs } from '../src/editor/ue2three-blueprint-runtime.mjs';
import { verifyLiveBlueprintInputs } from '../src/editor/ue2three-live-verification.mjs';
import { evaluateNativeMath } from '../src/editor/ue2three-native-math.mjs';

test('typed persistent event arrays retain copies, resize defaults and transactional frames',()=>{
    const element={type:'IntProperty',default:0},schema={type:'ArrayProperty',element,default:[]};
    const target={op:'get',scope:'persistent',frame:2,field:'Items'},output={...target,field:'Out'};
    const c=value=>({op:'constant',value}),ev=value=>({op:'evaluate',value});
    const steps=[ev({op:'array_literal',target,element,elements:[c(1),c(2)]}),
        ev({op:'array_mutate',operation:'Array_Append',target,element,value:target}),
        ev({op:'array_get',array:target,index:c(1),target:output,element}),
        ev({op:'array_mutate',operation:'Array_Remove',target,element,index:c(0)}),
        ev({op:'array_mutate',operation:'Array_Set',target,element,index:c(4),value:c(9),resize:c(true)})];
    const program={schema_version:1,status:'translated_straight_line',input_fields:[],output_fields:[],
        persistent_types:{'2':{Items:'ArrayProperty',Out:'IntProperty'}},persistent_schemas:{'2':{Items:schema}},
        steps:[...steps,{op:'return',value:c(null)}]};
    const frames={'2':{Items:[88],Out:-1}},before=structuredClone(frames);
    const result=executeBlueprint(program,{},{},{frames});
    assert.deepEqual(result.frames['2'].Items,[2,1,2,0,9]);assert.equal(result.frames['2'].Out,2);
    assert.deepEqual(frames,before);
    const cleared=executeBlueprint({...program,steps:[...steps,ev({op:'array_mutate',operation:'Array_Clear',target,element}),{op:'return',value:c(null)}]});
    assert.deepEqual(cleared.frames['2'].Items,[]);
    assert.throws(()=>executeBlueprint({...program,persistent_schemas:{}},{},{},{frames}),/typed source array/);
    assert.deepEqual(frames,before);
});

const constant = value => ({op:'constant',value});
const get = (field,scope='self') => ({op:'get',field,scope});
const schema = {type:'StructProperty',member_order:['Name','HP'],fields:{Name:{type:'NameProperty',default:'None'},HP:{type:'DoubleProperty',default:0}},default:{Name:'None',HP:-1}};
const arraySchema = {type:'ArrayProperty',element:schema,default:[]};
const end = {op:'return',value:constant(null)};
const base = {schema_version:1,status:'translated_straight_line',source_owner_index:2,source_export_index:3,
    input_fields:[],output_fields:[],self_reads:['Items'],self_writes:['Items'],field_types:{self:{Items:'ArrayProperty'}},schemas:{self:{Items:arraySchema}}};
const mutation = (operation,extra={}) => ({op:'evaluate',value:{op:'array_mutate',operation,target:get('Items'),element:schema,...extra}});
const run = (steps,self={Items:[{Name:'Original',HP:9}]}) => executeBlueprint({...base,steps:[...steps,end]},self);

const audioStruct = (name, fields, memberType='DoubleProperty') => ({type:'StructProperty',source:'/Script/CoreUObject',native:name,
    fields:Object.fromEntries(fields.map(field=>[field,{type:memberType}])),default:Object.fromEntries(fields.map(field=>[field,0])),member_order:fields});
const audioObject = identity => ({type:'ObjectProperty',...(identity?{class:identity}:{}),default:null});
const spawnSoundLocationSchemas = [audioObject(),audioObject(['/Script/Engine','SoundBase']),audioStruct('Vector',['X','Y','Z']),
    audioStruct('Rotator',['Pitch','Yaw','Roll']),{type:'FloatProperty'},{type:'FloatProperty'},{type:'FloatProperty'},
    audioObject(['/Script/Engine','SoundAttenuation']),audioObject(['/Script/Engine','SoundConcurrency']),{type:'BoolProperty'}];
const typedAudioArgument = (contract, value, sourceSchema=contract) => ({contract,schema:sourceSchema,value:{op:'typed_literal',schema:sourceSchema,value}});
const spawnSoundLocationCall = () => ({op:'native_audio_vfx',identity:['/Script/Engine','GameplayStatics','SpawnSoundAtLocation'],
    dispatch:'EX_CallMath',receiver:null,receiver_schema:null,parameter_schemas:spawnSoundLocationSchemas,
    parameters:spawnSoundLocationSchemas.map((contract,index)=>{
        const values=[null,{asset:'/Game/Sounds/Test.Test',declared_class:['/Script/Engine','SoundBase']},
            {X:10,Y:20,Z:30},{Pitch:0,Yaw:90,Roll:0},1,0.8,0,null,null,true];
        if(values[index]===null)return {contract,schema:contract,value:constant(null)};
        return typedAudioArgument(contract,values[index]);
    }),return_schema:audioObject(['/Script/Engine','AudioComponent'])});

test('native audio/VFX calls retain the exact API, typed argument order, and explicit requests',()=>{
    const call=spawnSoundLocationCall(),later=structuredClone(call);
    later.parameters[4].value.value=0.5;
    const program={...base,source_owner_index:8,steps:[
        {op:'evaluate',value:call},{op:'evaluate',value:later},{op:'return',value:constant(null)}]};
    const result=executeBlueprint(program);
    assert.equal(result.effects.length,2);
    assert.equal(result.effects[0].op,'native_audio_vfx');
    assert.deepEqual(result.effects[0].identity,['/Script/Engine','GameplayStatics','SpawnSoundAtLocation']);
    assert.deepEqual(result.effects[0].arguments,[null,{asset:'/Game/Sounds/Test.Test',declared_class:['/Script/Engine','SoundBase']},
        {X:10,Y:20,Z:30},{Pitch:0,Yaw:90,Roll:0},1,0.8,0,null,null,true]);
    assert.deepEqual(result.effects[0].argument_schemas[2],audioStruct('Vector',['X','Y','Z']));
    assert.equal(result.effects[1].arguments[4],0.5);
    assert.throws(()=>executeBlueprint({...program,steps:[{op:'return',value:call}]}),/Unresolved native audio\/VFX return value/);
    const wrong=structuredClone(call);wrong.identity[2]='PlaySoundAtLocation';
    assert.throws(()=>executeBlueprint({...program,steps:[{op:'evaluate',value:wrong},end]}),/Unsupported original native audio\/VFX call contract/);
    const wrongType=structuredClone(call);wrongType.parameters[4].schema={type:'DoubleProperty'};
    wrongType.parameters[4].contract={type:'DoubleProperty'};wrongType.parameter_schemas[4]={type:'DoubleProperty'};
    assert.throws(()=>executeBlueprint({...program,steps:[{op:'evaluate',value:wrongType},end]}),/Unsupported original native audio\/VFX call contract/);
    const report={schema_version:1,project:'Source.uproject',packages:{'/Game/Source':{
        default_state:{},functions:{Effect:program}}}};
    const runtime=new BlueprintActorRuntime(report,report.project);
    runtime.call('/Game/Source','Effect');
    assert.equal(runtime.audioVfxRequests.length,2);
    assert.deepEqual(runtime.snapshot().audioVfxRequests,runtime.audioVfxRequests);
    const snapshot=runtime.snapshot();runtime.audioVfxRequests.length=0;runtime.restore(snapshot);
    assert.equal(runtime.audioVfxRequests.length,2);
});

test('native component calls preserve Accessed None skipping and reject non-native receiver values',()=>{
    const receiverSchema={type:'ObjectProperty',class:['/Script/Engine','AudioComponent'],
        reference_kind:'runtime_native_component',default:null};
    const call={op:'native_audio_vfx',identity:['/Script/Engine','AudioComponent','SetVolumeMultiplier'],
        dispatch:'EX_FinalFunction',receiver:get('Audio'),receiver_schema:receiverSchema,
        parameter_schemas:[{type:'FloatProperty'}],parameters:[{contract:{type:'FloatProperty'},schema:{type:'FloatProperty'},
            value:constant(0.5)}],return_schema:null};
    const program={...base,self_reads:['Audio'],field_types:{self:{Audio:'ObjectProperty'}},schemas:{self:{Audio:receiverSchema}},
        steps:[{op:'evaluate',value:call},end]};
    const skipped=executeBlueprint(program,{Audio:null});
    assert.equal(skipped.effects.length,0);assert.match(skipped.trace[0].message,/Accessed None/);
    assert.throws(()=>executeBlueprint(program,{Audio:{asset:'/Engine/AudioComponent.AudioComponent',
        declared_class:['/Script/Engine','AudioComponent']}}),/native object reference/);
});

test('native sound calls bind EX_Self to the exact source world context',()=>{
    const selfSchema={type:'ObjectProperty',class:['/Script/Engine','Pawn'],reference_kind:'source_self',
        source_owner_index:8,default:null};
    const parameters=[audioObject(),audioObject(['/Script/Engine','SoundBase']),{type:'FloatProperty'},
        {type:'FloatProperty'},{type:'FloatProperty'},audioObject(['/Script/Engine','SoundConcurrency']),
        audioObject(['/Script/Engine','Actor']),{type:'BoolProperty'}];
    const values=[{schema:selfSchema,contract:parameters[0],value:{op:'native_self',source_owner_index:8,class:['/Script/Engine','Pawn']}},
        typedAudioArgument(parameters[1],{asset:'/Game/Sounds/UI.UI',declared_class:['/Script/Engine','SoundBase']}),
        ...[1,1,0].map((value,index)=>typedAudioArgument(parameters[index+2],value)),
        {schema:parameters[5],contract:parameters[5],value:constant(null)},
        {schema:parameters[6],contract:parameters[6],value:constant(null)},
        typedAudioArgument(parameters[7],false)];
    const call={op:'native_audio_vfx',identity:['/Script/Engine','GameplayStatics','PlaySound2D'],dispatch:'EX_CallMath',
        receiver:null,receiver_schema:null,parameter_schemas:parameters,parameters:values,return_schema:null};
    const program={...base,source_owner_index:8,steps:[{op:'evaluate',value:call},end]};
    const result=executeBlueprint(program,{}, {},{native:{source_owner_index:8,source_package:'/Game/Source'}});
    assert.deepEqual(result.effects[0].arguments[0],{kind:'source_self',source_package:'/Game/Source',
        source_owner_index:8,declared_class:['/Script/Engine','Pawn']});
    assert.throws(()=>executeBlueprint(program),/Blueprint self reference is unavailable/);
});

test('SetArray constructs typed slots before evaluating source expressions and copies structs',()=>{
    const integer={type:'IntProperty',default:0};
    const program={...base,field_types:{self:{Items:'ArrayProperty'}},schemas:{self:{Items:{type:'ArrayProperty',element:integer,default:[]}}},steps:[
        {op:'evaluate',value:{op:'array_literal',target:get('Items'),element:integer,elements:[
            {op:'array_length',array:get('Items')},{op:'array_length',array:get('Items')}]}},end]};
    const self={Items:[90,80,70]};assert.deepEqual(executeBlueprint(program,self).state.Items,[1,2]);assert.deepEqual(self.Items,[90,80,70]);
    const struct={op:'typed_literal',schema,value:{Name:'Source',HP:17}};
    const result=run([{op:'evaluate',value:{op:'array_literal',target:get('Items'),element:schema,elements:[struct,struct]}}]);
    result.state.Items[0].HP=4;assert.equal(result.state.Items[1].HP,17);assert.equal(struct.value.HP,17);
    assert.deepEqual(run([{op:'evaluate',value:{op:'array_literal',target:get('Items'),element:schema,elements:[]}}]).state.Items,[]);
});

test('SetArray rejects incompatible schemas and rolls back partial construction on invalid elements',()=>{
    const self={Items:[{Name:'Original',HP:9}]}, literal={op:'array_literal',target:get('Items'),element:schema,elements:[{op:'typed_literal',schema,value:schema.default},constant(true)]};
    assert.throws(()=>run([{op:'evaluate',value:literal}],self),/typed source struct/);assert.deepEqual(self.Items,[{Name:'Original',HP:9}]);
    literal.element={type:'IntProperty',default:0};assert.throws(()=>run([{op:'evaluate',value:literal}]),/typed source array literal/);
});

test('SetArray reacquires transactional state after nested source calls and rejects reentrant writes',()=>{
    const integer={type:'IntProperty',default:0}, array={type:'ArrayProperty',element:integer,default:[]};
    const callee={...base,name:'OriginalValue',source_export_index:8,field_types:{self:{Items:'ArrayProperty'}},schemas:{self:{Items:array}},
        steps:[{op:'return',value:{op:'array_length',array:get('Items')}}]};
    const caller={...callee,name:'Construct',source_export_index:9,steps:[{op:'evaluate',value:{op:'array_literal',target:get('Items'),element:integer,
        elements:[{op:'call',function:'OriginalValue',export_index:8,bindings:[]},{op:'call',function:'OriginalValue',export_index:8,bindings:[]}]}},end]};
    const self={Items:[90,80]};assert.deepEqual(executeBlueprint(caller,self,{}, {functions:{OriginalValue:callee}}).state.Items,[1,2]);
    callee.steps.unshift({op:'evaluate',value:{op:'array_set',target:get('Items'),element:integer,index:constant(0),item:constant(44),size_to_fit:constant(false)}});
    assert.throws(()=>executeBlueprint(caller,self,{}, {functions:{OriginalValue:callee}}),/Reentrant SetArray/);
    assert.deepEqual(self.Items,[90,80]);
});

test('localized source text retains namespace, key and source string through a typed literal',()=>{
    const text={history:'base',text:'Slot In Use',namespace:'',key:'C52FCD624614FE4233E099A431659554',flags:0};
    const program={...base,steps:[{op:'return',value:{op:'typed_literal',schema:{type:'TextProperty'},value:text}}]};
    assert.deepEqual(executeBlueprint(program).value,text);
    program.steps[0].value.value={...text,key:null};assert.throws(()=>executeBlueprint(program),/FText/);
});

test('typed source array Set rejects an untyped struct value',()=>{
    assert.throws(()=>run([mutation('Array_Set',{index:constant(2),value:constant(null),resize:constant(true)})]),/typed source struct/);
});

test('array mutation copies typed values and preserves original initialized holes',()=>{
    const value={op:'typed_literal',schema,value:{Name:'New',HP:5}};
    const self={Items:[{Name:'Original',HP:9}]};
    const expanded=run([mutation('Array_Set',{index:constant(2),value,resize:constant(true)})],self);
    assert.deepEqual(expanded.state.Items,[self.Items[0],{Name:'None',HP:-1},{Name:'New',HP:5}]);
    assert.equal(self.Items.length,1);
    const removed=run([mutation('Array_Remove',{index:constant(0)})]);assert.deepEqual(removed.state.Items,[]);
    for(const index of [-1,1,2147483647]) {
        const unchanged=run([mutation('Array_Remove',{index:constant(index)})],self);
        assert.deepEqual(unchanged.state,self);assert.equal(unchanged.trace[0].op,'warning');
        assert.deepEqual(run([mutation('Array_Set',{index:constant(index),value,resize:constant(false)})],self).state,self);
    }
    for(const index of [1.5,true,2147483648]) assert.throws(()=>run([mutation('Array_Remove',{index:constant(index)})]),/array index/);
    assert.throws(()=>run([mutation('Array_Set',{index:constant(100000),value,resize:constant(true)})]),/resource limit/);
    assert.throws(()=>run([mutation('Array_Set',{index:constant(0),value,resize:constant(1)})]),/resize flag/);
    assert.throws(()=>run([mutation('Array_Set',{index:constant(0),value:constant(null),resize:constant(true)})]),/typed source struct/);
});

test('array Add returns original index; self append copies once; Clear empties and no source aliases leak',()=>{
    const add={...base,steps:[{op:'return',value:mutation('Array_Add',{value:{op:'typed_literal',schema,value:{Name:'Added',HP:3}}}).value}]};
    const result=executeBlueprint(add,{Items:[schema.default]});assert.equal(result.value,1);assert.equal(result.state.Items[1].Name,'Added');
    const doubled=run([mutation('Array_Append',{value:get('Items')})]);assert.equal(doubled.state.Items.length,2);
    doubled.state.Items[0].HP=8;assert.equal(doubled.state.Items[1].HP,9);
    assert.deepEqual(run([mutation('Array_Clear')]).state.Items,[]);
    const valid={...base,steps:[{op:'return',value:{op:'array_valid',array:get('Items'),index:constant(0)}}]};
    assert.equal(executeBlueprint(valid,{Items:[]}).value,false);assert.equal(executeBlueprint(valid,{Items:[schema.default]}).value,true);
    valid.steps[0].value.index=constant(-1);assert.equal(executeBlueprint(valid,{Items:[schema.default]}).value,false);
});

test('struct literal follows the source member order and validates every field',()=>{
    const literal={op:'struct_literal',schema,fields:{HP:constant(-1),Name:constant('None')}};
    const program={...base,steps:[{op:'return',value:literal}]};
    assert.deepEqual(executeBlueprint(program).value,schema.default);
    literal.fields.HP=constant(true);assert.throws(()=>executeBlueprint(program),/typed source member/);
    delete literal.fields.HP;assert.throws(()=>executeBlueprint(program),/struct literal/);
});

test('data-only class references retain the source base class and cannot masquerade as another class',()=>{
    const klass={type:'ClassProperty',class:['/Script/CoreUObject','Class'],meta_class:['/Script/Engine','CameraShakeBase'],default:null};
    const value={asset:'/Game/Camera/Original.Original_C',declared_class:klass.class,meta_class:klass.meta_class};
    const program={...base,steps:[{op:'return',value:{op:'typed_literal',schema:klass,value}}]};
    assert.deepEqual(executeBlueprint(program).value,value);
    program.steps[0].value.value={...value,meta_class:['/Script/Engine','Actor']};
    assert.throws(()=>executeBlueprint(program),/asset identity/);
    program.steps[0].value.value=null;assert.equal(executeBlueprint(program).value,null);
});

test('typed persistent frames initialize source defaults, copy writes and reject corrupt stored structs transactionally',()=>{
    const frameGet={op:'get',scope:'persistent',frame:10,field:'Stored'};
    const program={...base,persistent_types:{10:{Stored:'StructProperty'}},persistent_schemas:{10:{Stored:schema}},steps:[{op:'return',value:frameGet}]};
    assert.deepEqual(executeBlueprint(program).value,schema.default);
    const frames={10:{Stored:{Name:'Original',HP:true}}};
    assert.throws(()=>executeBlueprint(program,{}, {},{frames}),/typed source member/);assert.equal(frames[10].Stored.HP,true);
    program.steps.unshift({op:'set',scope:'persistent',frame:10,field:'Stored',value:{op:'typed_literal',schema,value:{Name:'New',HP:42}}});
    const written=executeBlueprint(program,{}, {},{frames});assert.equal(written.value.HP,42);assert.equal(frames[10].Stored.HP,true);
    written.value.HP=0;assert.equal(written.frames[10].Stored.HP,42);
});

function delegateFixture() {
    const number={type:'DoubleProperty',default:0};
    const signatures={Changed:{export_index:20,parameters:[{name:'Value',schema:number}]}};
    const emitter={...base,self_reads:['Counter'],self_writes:[],field_types:{self:{Counter:'DoubleProperty'}},schemas:{},steps:[
        {op:'evaluate',value:{op:'mark_dirty',field:'Counter',source_rep_index:7}},
        {op:'evaluate',value:{op:'broadcast',delegate:'Changed',...signatures.Changed,args:[get('Counter')]}},end]};
    const handler=(factor,id)=>({...base,name:'Handler'+id,source_export_index:id,parameters:[{name:'Received',schema:number}],
        input_fields:['Received'],field_types:{local:{Received:'DoubleProperty'},self:{Counter:'DoubleProperty'}},schemas:{},steps:[
        {op:'set',scope:'self',field:'Counter',value:{op:'math',name:'Add_DoubleDouble',args:[
            {op:'math',name:'Multiply_DoubleDouble',args:[get('Counter'),constant(factor)]},get('Received','local')]}},end]});
    const functions={Emit:emitter,First:handler(10,4),Second:handler(100,5)};
    const report={schema_version:1,project:'Original.uproject',packages:{'/Game/Source':{functions,delegate_signatures:signatures,default_state:{Counter:2}}}};
    return {runtime:new BlueprintActorRuntime(report,report.project),report,functions,signatures};
}

test('original multicast emits typed payloads and invokes translated handlers synchronously in insertion order',()=>{
    const {runtime}=delegateFixture();
    const remove=runtime.subscribe('/Game/Source','Changed','First');runtime.subscribe('/Game/Source','Changed','Second');
    const result=runtime.call('/Game/Source','Emit');
    assert.equal(result.state.Counter,2202); // First:2*10+2=22; second:22*100+2=2202, same captured payload.
    assert.deepEqual(result.effects,[{op:'mark_dirty',field:'Counter',source_rep_index:7},
        {op:'broadcast',delegate:'Changed',parameters:{Value:2},listeners:2}]);
    assert.equal(runtime.dirty['/Game/Source'].Counter,7);assert.equal(runtime.notifications.length,1);
    remove();remove();assert.equal(runtime.bindings['/Game/Source'].Changed.length,1);
});

test('failed multicast handler rolls back source state, persistent frames, notifications and dirty bookkeeping',()=>{
    const {runtime,functions}=delegateFixture();
    runtime.subscribe('/Game/Source','Changed','First');runtime.subscribe('/Game/Source','Changed','Second');
    const before=runtime.snapshot();functions.Second.steps.splice(1,0,{op:'evaluate',value:{op:'unsupported_native'}});
    assert.throws(()=>runtime.call('/Game/Source','Emit'),/Unsupported Blueprint/);assert.deepEqual(runtime.snapshot(),before);
    functions.Second.parameters[0].schema={type:'IntProperty'};
    assert.throws(()=>runtime.subscribe('/Game/Source','Changed','Second'),/incompatible/);
    assert.throws(()=>runtime.call('/Game/Source','Emit'),/incompatible/);assert.deepEqual(runtime.snapshot(),before);
});

test('unbound source notifications are observable and snapshots cannot reuse stale subscription IDs',()=>{
    const {runtime}=delegateFixture();
    assert.equal(runtime.call('/Game/Source','Emit').effects[1].listeners,0);
    const saved=runtime.snapshot();const old=runtime.subscribe('/Game/Source','Changed','First');runtime.restore(saved);
    runtime.subscribe('/Game/Source','Changed','First');old();assert.equal(runtime.bindings['/Game/Source'].Changed.length,1);
    runtime.restore(saved);assert.equal(runtime.notifications.length,1);
});

test('SelectFloat preserves UE double precision and exact Boolean selection',()=>{
    assert.equal(evaluateNativeMath('SelectFloat',[1.234567890123,9,true]),1.234567890123);
    assert.equal(evaluateNativeMath('SelectFloat',[1,9,false]),9);
    for(const args of [[1,9,1],[true,9,true],[Infinity,1,false]]) assert.throws(()=>evaluateNativeMath('SelectFloat',args),/selection/);
});

test('scene verification accepts original event dependencies, checks emitted payloads and restores runtime state',async()=>{
    const {runtime,report,functions}=delegateFixture();
    functions.CanSprint={...base,name:'CanSprint',source_bytecode_sha256:'guard',self_reads:['Counter'],self_writes:[],
        field_types:{self:{Counter:'DoubleProperty'},local:{Allowed:'BoolProperty'}},schemas:{},output_fields:['Allowed'],
        steps:[{op:'set',scope:'local',field:'Allowed',value:constant(true)},end]};
    report.packages['/Game/Source'].event_programs={Entry:{...base,name:'Entry',source_export_index:99,source_bytecode_sha256:'event',steps:[end]}};
    functions.Emit.source_bytecode_sha256='emitter';
    functions.Emit.steps.unshift({op:'evaluate',value:{op:'call',function:'Entry',export_index:99,bindings:[]}});
    report.character_guards={run:{package:'/Game/Source',function:'CanSprint',output:'Allowed'}};
    const player={actions:{run:{isPressed:false},up:{isPressed:false}},position:{x:0,z:0,clone(){return{x:this.x,z:this.z}}},triggerAction(action,pressed){this.actions[action].isPressed=pressed}};
    const binding=bindBlueprintInputs(player,runtime),before=runtime.snapshot(),oldFrame=globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame=callback=>{if(player.actions.up.isPressed)player.position.x+=.01;callback()};
    const effects=[{op:'mark_dirty',field:'Counter',source_rep_index:7},{op:'broadcast',delegate:'Changed',parameters:{Value:2},listeners:0}];
    const fixture={cases:[{package:'/Game/Source',function:'CanSprint',source_bytecode_sha256:'guard',self:{Counter:2},outputs:{Allowed:true}},
        {package:'/Game/Source',function:'Emit',source_bytecode_sha256:'emitter',self:{Counter:2},inputs:{},outputs:{},effects,dependencies:{Entry:'event'},runtime:'inventory'}]};
    try {
        const proof=await verifyLiveBlueprintInputs(player,runtime,fixture);
        assert.equal(proof.inventory_checked,1);assert.deepEqual(proof.inventory_results[0].effects,effects);assert.deepEqual(runtime.snapshot(),before);
        fixture.cases[1].effects=[];
        await assert.rejects(()=>verifyLiveBlueprintInputs(player,runtime,fixture),/effects differ/);assert.deepEqual(runtime.snapshot(),before);
    } finally {binding.dispose();if(oldFrame===undefined)delete globalThis.requestAnimationFrame;else globalThis.requestAnimationFrame=oldFrame;}
});
