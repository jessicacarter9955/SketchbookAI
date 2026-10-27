import test from 'node:test';
import assert from 'node:assert/strict';
import {executeBlueprint} from '../src/editor/ue2three-blueprint.mjs';

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
