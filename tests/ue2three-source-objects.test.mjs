import test from 'node:test';
import assert from 'node:assert/strict';
import {executeBlueprint} from '../src/editor/ue2three-blueprint.mjs';

const c=value=>({op:'constant',value});
const end={op:'return',value:c(null)};

function fixture(){
    const ref={realm:'local',actor_id:'player',declared_class:['/Script/Engine','Actor']};
    const schema={type:'ObjectProperty',class:['/Game/Player','Player_C'],reference_kind:'runtime_actor',default:null};
    const field={type:'FloatProperty',default:0};
    const member={op:'source_actor_member',target:{op:'get',scope:'local',field:'Player'},target_schema:schema,
        package:'/Game/Player',class_object:'Player_C',class_export_index:2,declaring_package:'/Game/Player',
        declaring_class:'Player_C',declaring_export_index:2,field:'Health',schema:field};
    const native={mode:'standalone',net_drivers:0,realm:'local',source_package:'/Game/Player',source_owner_index:2,
        actors:{player:{reference:ref,native_base:['/Script/Engine','Actor'],force_net_update_override:false,
            source_class:'/Game/Player',class_object:'Player_C',source_owner_index:2,source_sha256:'source-hash'}}};
    const queries={'/Game/Player':{state:{Health:12},source_sha256:'source-hash',source_owner_index:2,field_schemas:{Health:field}}};
    const p={schema_version:1,status:'translated_straight_line',source_owner_index:2,input_fields:['Player'],output_fields:[],
        field_types:{self:{Health:'FloatProperty'},local:{Player:'ObjectProperty'}},schemas:{self:{Health:field},local:{Player:schema}},
        steps:[{op:'return',value:member}]};
    return {ref,native,queries,p};
}
test('source actor member reads current original actor state and authenticates schema and source',()=>{
    const {ref,native,queries,p}=fixture();
    assert.equal(executeBlueprint(p,{Health:90},{Player:ref},{native,queries}).value,90);
    p.steps.unshift({op:'set',scope:'self',field:'Health',value:{op:'constant',value:75}});
    assert.equal(executeBlueprint(p,{Health:90},{Player:ref},{native,queries}).value,75);
    queries['/Game/Player'].source_sha256='foreign';
    assert.throws(()=>executeBlueprint(p,{Health:90},{Player:ref},{native,queries}),/declaration binding/);
});
test('null source actor member uses original primitive ClearValue; foreign actor fails',()=>{
    const {ref,native,queries,p}=fixture();
    assert.equal(executeBlueprint(p,{Health:90},{Player:null},{native,queries}).value,0);
    assert.throws(()=>executeBlueprint(p,{Health:90},{Player:{...ref,realm:'foreign'}},{native,queries}),/foreign/);
});

test('Actor writes commit only staged source storage and roll back on subsequent failure',()=>{
    const {ref,native,queries,p}=fixture();
    const member=p.steps[0].value;
    p.steps.unshift({op:'set_actor_member',target:member,value:{op:'constant',value:75}});
    const self={Health:90},receivers={'/Game/Player':{state:self,native,functions:{},source_sha256:'source-hash'}};
    const result=executeBlueprint(p,self,{Player:ref},{native,queries,receivers});
    assert.equal(result.value,75);
    assert.equal(result.receivers['/Game/Player'].state.Health,75);
    assert.equal(self.Health,90);
    assert.equal(receivers['/Game/Player'].state.Health,90);
    p.steps.splice(1,0,{op:'evaluate',value:{op:'untranslated'}});
    assert.throws(()=>executeBlueprint(p,self,{Player:ref},{native,queries,receivers}),/Unsupported Blueprint expression/);
    assert.equal(receivers['/Game/Player'].state.Health,90);
    p.steps.splice(1,1);
    assert.throws(()=>executeBlueprint(p,self,{Player:ref},{native,queries}),/staged shared/);
});

test('Actor struct member writes preserve untouched fields in the same staged property',()=>{
    const {ref,native,queries,p}=fixture(),member=p.steps[0].value;
    const vector={type:'StructProperty',source:'/Script/CoreUObject',native:'Vector',
        fields:{X:{type:'DoubleProperty'},Y:{type:'DoubleProperty'},Z:{type:'DoubleProperty'}},
        default:{X:0,Y:0,Z:0},member_order:['X','Y','Z']};
    member.schema=vector;p.field_types.self.Health='StructProperty';p.schemas.self.Health=vector;
    queries['/Game/Player'].field_schemas.Health=vector;
    p.steps.unshift({op:'set_actor_member',target:member,member_field:'X',value:{op:'constant',value:1/3}});
    const self={Health:{X:1,Y:2,Z:3}},receivers={'/Game/Player':{state:self,native,functions:{},source_sha256:'source-hash'}};
    const result=executeBlueprint(p,self,{Player:ref},{native,queries,receivers});
    assert.deepEqual(result.value,{X:1/3,Y:2,Z:3});
    assert.deepEqual(self.Health,{X:1,Y:2,Z:3});
});


test('UE5.7 source Actor EX_Context FloatProperty writes store binary32 without mutating caller state',()=>{
    const {ref,native,queries,p}=fixture(),member=p.steps[0].value;
    p.steps.unshift({op:'set_actor_member',target:member,value:c(0.1)});
    const self={Health:90},receivers={'/Game/Player':{state:self,native,functions:{},source_sha256:'source-hash'}};
    const run=()=>executeBlueprint(p,self,{Player:ref},{native,queries,receivers});
    const rounded=run();
    assert.equal(rounded.value,Math.fround(0.1));
    assert.equal(rounded.receivers['/Game/Player'].state.Health,Math.fround(0.1));
    assert.equal(rounded.trace.find(step=>step.op==='set_actor_member').value,Math.fround(0.1));
    assert.equal(self.Health,90);
    p.steps[0].value=c(-0);
    assert.ok(Object.is(run().value,-0));
    p.steps[0].value=c(1e40);
    assert.throws(run,/float32 assignment overflow/);
    assert.equal(receivers['/Game/Player'].state.Health,90);

    // The same EX_Context write must not downcast a reflected DoubleProperty.
    const double={type:'DoubleProperty',default:0};
    member.schema=double;p.field_types.self.Health='DoubleProperty';p.schemas.self.Health=double;
    queries['/Game/Player'].field_schemas.Health=double;
    p.steps[0].value=c(0.1);
    assert.equal(run().value,0.1);
});

test('UE5.7 source Actor struct FloatProperty member writes preserve other reflected fields',()=>{
    const {ref,native,queries,p}=fixture(),member=p.steps[0].value;
    const schema={type:'StructProperty',source:'/Game/Player',
        fields:{R:{type:'FloatProperty',default:0},G:{type:'FloatProperty',default:0},
            Precise:{type:'DoubleProperty',default:0}},
        default:{R:0,G:0,Precise:0},member_order:['R','G','Precise']};
    member.schema=schema;p.field_types.self.Health='StructProperty';p.schemas.self.Health=schema;
    queries['/Game/Player'].field_schemas.Health=schema;
    p.steps.unshift({op:'set_actor_member',target:member,member_field:'R',value:c(0.1)});
    const self={Health:{R:2,G:3,Precise:0.1}};
    const receivers={'/Game/Player':{state:self,native,functions:{},source_sha256:'source-hash'}};
    const run=()=>executeBlueprint(p,self,{Player:ref},{native,queries,receivers});
    assert.deepEqual(run().value,{R:Math.fround(0.1),G:3,Precise:0.1});
    assert.deepEqual(self.Health,{R:2,G:3,Precise:0.1});
    p.steps[0].value=c(-0);
    assert.ok(Object.is(run().value.R,-0));
    p.steps[0].member_field='Precise';p.steps[0].value=c(0.1);
    assert.equal(run().value.Precise,0.1);
    p.steps[0].member_field='R';p.steps[0].value=c(1e40);
    assert.throws(run,/float32 assignment overflow/);
    assert.deepEqual(receivers['/Game/Player'].state.Health,self.Health);
});

function generatedObjectFixture(){
    const callerPackage='/Game/HUD',targetPackage='/Game/QuestTracker';
    const callerOwner=5,targetOwner=2,objectId='quest-tracker-1';
    const schema={type:'ObjectProperty',class:[targetPackage,'WBP_QuestTracker_C'],
        reference_kind:'runtime_source_object',default:null};
    const reference={kind:'source_object',object_id:objectId,source_package:targetPackage,source_owner_index:targetOwner,
        declared_class:[targetPackage,'WBP_QuestTracker_C'],owner_package:callerPackage,
        owner_export_index:callerOwner,owner_field:'WBP_HUD_QuestTracker'};
    const intSchema={type:'IntProperty',default:0};
    const native={mode:'standalone',net_drivers:0,source_package:targetPackage,source_owner_index:targetOwner,
        world_context_bound:false,source_objects:{[objectId]:{binding_complete:true,reference,
            source_package:targetPackage,class_object:'WBP_QuestTracker_C',class_export_index:targetOwner,
            source_sha256:'tracker-source',owner_package:callerPackage,owner_export_index:callerOwner,
            owner_field:'WBP_HUD_QuestTracker'}}};
    const descriptor={schema_version:1,name:'InitQuestTracker',status:'translated_straight_line',
        source_owner_index:targetOwner,source_export_index:8,parameters:[],source_parameters:[
            {name:'Result',mode:'output',schema:intSchema}],input_fields:[],output_fields:['Result'],
        self_reads:[],self_writes:['Count'],persistent_types:{},field_types:{self:{Count:'IntProperty'},local:{Result:'IntProperty'}},
        schemas:{},steps:[{op:'set',scope:'self',field:'Count',value:c(17)},
            {op:'set',scope:'local',field:'Result',value:c(42)},end]};
    const caller={schema_version:1,status:'translated_straight_line',source_owner_index:callerOwner,
        source_export_index:6,input_fields:[],output_fields:['Result'],field_types:{self:{WBP_HUD_QuestTracker:'ObjectProperty'},
            local:{Result:'IntProperty'}},schemas:{self:{WBP_HUD_QuestTracker:schema},local:{Result:intSchema}},
        steps:[]};
    const call={op:'component_call',target:{op:'get',scope:'self',field:'WBP_HUD_QuestTracker'},
        package:targetPackage,class_object:'WBP_QuestTracker_C',class_export_index:targetOwner,
        receiver_schema:schema,reference_owner:{scope:'self',field:'WBP_HUD_QuestTracker'},
        function:'InitQuestTracker',export_index:8,dispatch:'EX_LocalVirtualFunction',
        context_offset:23,transactional_outputs_safe:true,bindings:[{mode:'output',parameter:'Result',
            schema:intSchema,target:{op:'get',scope:'local',field:'Result'}}]};
    caller.steps=[{op:'evaluate',value:call},end];
    const queries={[targetPackage]:{source_sha256:'tracker-source',source_owner_index:targetOwner,
        object_id:objectId,state:{Count:1},field_schemas:{Count:intSchema},functions:{InitQuestTracker:descriptor},native}};
    const rootNative={mode:'standalone',net_drivers:0,source_package:callerPackage,source_owner_index:callerOwner};
    const receivers={[callerPackage]:{state:{WBP_HUD_QuestTracker:reference},functions:{},native:rootNative},
        [targetPackage]:{state:{Count:1},functions:{InitQuestTracker:descriptor},native,source_sha256:'tracker-source',object_id:objectId}};
    return {caller,call,descriptor,intSchema,native,queries,receivers,reference,schema,callerPackage,targetPackage};
}

test('generated source object Context reads require an exact package, class and instance binding',()=>{
    const f=generatedObjectFixture();
    const member={op:'component_member',target:{op:'get',scope:'self',field:'WBP_HUD_QuestTracker'},
        package:f.targetPackage,class_object:'WBP_QuestTracker_C',class_export_index:2,receiver_schema:f.schema,
        reference_owner:{scope:'self',field:'WBP_HUD_QuestTracker'},
        field:'Count',schema:f.intSchema};
    f.caller.steps=[{op:'return',value:member}];
    assert.equal(executeBlueprint(f.caller,f.receivers[f.callerPackage].state,{},
        {native:f.receivers[f.callerPackage].native,queries:f.queries}).value,1);
    f.receivers[f.callerPackage].state.WBP_HUD_QuestTracker={...f.reference,owner_field:'Other'};
    assert.throws(()=>executeBlueprint(f.caller,f.receivers[f.callerPackage].state,{},
        {native:f.receivers[f.callerPackage].native,queries:f.queries}),/property owner/);
    f.receivers[f.callerPackage].state.WBP_HUD_QuestTracker={...f.reference,object_id:'foreign'};
    assert.throws(()=>executeBlueprint(f.caller,f.receivers[f.callerPackage].state,{},
        {native:f.receivers[f.callerPackage].native,queries:f.queries}),/another instance/);
});

test('generated source object calls preserve out parameters and commit atomically',()=>{
    const f=generatedObjectFixture(),root=f.receivers[f.callerPackage];
    const result=executeBlueprint(f.caller,root.state,{},
        {native:root.native,queries:f.queries,receivers:f.receivers});
    assert.equal(result.outputs.Result,42);
    assert.equal(result.receivers[f.targetPackage].state.Count,17);
    assert.equal(f.receivers[f.targetPackage].state.Count,1);

    f.receivers[f.targetPackage].object_id='another-instance';
    assert.throws(()=>executeBlueprint(f.caller,root.state,{},
        {native:root.native,queries:f.queries,receivers:f.receivers}),/another instance/);
    f.receivers[f.targetPackage].object_id=f.reference.object_id;

    f.caller.steps.splice(1,0,{op:'evaluate',value:{op:'unsupported'}});
    assert.throws(()=>executeBlueprint(f.caller,root.state,{},
        {native:root.native,queries:f.queries,receivers:f.receivers}),/Unsupported Blueprint expression/);
    assert.equal(f.receivers[f.targetPackage].state.Count,1);
});

test('null generated-object contexts clear typed members and skip calls without changing out storage',()=>{
    const f=generatedObjectFixture(),rootState={WBP_HUD_QuestTracker:null};
    f.receivers[f.callerPackage].state=rootState;
    const struct={type:'StructProperty',source:'/Script/CoreUObject',native:'Vector',
        fields:{X:{type:'DoubleProperty',default:9},Y:{type:'DoubleProperty'},Z:{type:'DoubleProperty'}},
        default:{X:9,Y:4,Z:5},member_order:['X','Y','Z']};
    const member={op:'component_member',target:{op:'get',scope:'self',field:'WBP_HUD_QuestTracker'},
        package:f.targetPackage,class_object:'WBP_QuestTracker_C',class_export_index:2,receiver_schema:f.schema,
        reference_owner:{scope:'self',field:'WBP_HUD_QuestTracker'},
        field:'Offset',schema:struct};
    f.caller.output_fields=[];f.caller.steps=[{op:'return',value:member}];
    assert.deepEqual(executeBlueprint(f.caller,rootState,{},
        {native:f.receivers[f.callerPackage].native,queries:f.queries}).value,{X:0,Y:0,Z:0});

    f.caller.output_fields=['Result'];f.caller.input_fields=['Result'];
    f.caller.steps=[{op:'evaluate',value:f.call},end];
    const result=executeBlueprint(f.caller,rootState,{Result:9},
        {native:f.receivers[f.callerPackage].native,queries:f.queries,receivers:f.receivers});
    assert.equal(result.outputs.Result,9);
    assert.equal(result.receivers[f.targetPackage].state.Count,1);
});
