import test from 'node:test';
import assert from 'node:assert/strict';
import {executeBlueprint} from '../src/editor/ue2three-blueprint.mjs';

const ref={realm:'world',actor_id:'player',declared_class:['/Script/Engine','Actor']};
const schema={type:'ObjectProperty',class:['/Script/Engine','Actor'],reference_kind:'runtime_actor',default:null};
const context=(role=3)=>({mode:'standalone',net_drivers:0,realm:'world',actors:{player:{reference:ref,
    native_base:['/Script/Engine','Character'],force_net_update_override:false,local_role:role}}});
function program(method){return {schema_version:1,status:'translated_straight_line',source_owner_index:1,
    input_fields:['Owner'],output_fields:[],field_types:{local:{Owner:'ObjectProperty'}},schemas:{local:{Owner:schema}},
    steps:[{op:'return',value:{op:'native_actor_role',identity:['/Script/Engine','Actor',method],dispatch:'EX_FinalFunction',
        target:{op:'get',scope:'local',field:'Owner'},actor_schema:schema,return_type:method==='HasAuthority'?'BoolProperty':'ByteProperty'}}]};}
test('role queries use the bound original role and never infer multiplayer support',()=>{
    assert.equal(executeBlueprint(program('HasAuthority'),{},{Owner:ref},{native:context(3)}).value,true);
    assert.equal(executeBlueprint(program('HasAuthority'),{},{Owner:ref},{native:context(2)}).value,false);
    assert.equal(executeBlueprint(program('GetLocalRole'),{},{Owner:ref},{native:context(1)}).value,1);
    assert.throws(()=>executeBlueprint(program('GetRemoteRole'),{},{Owner:ref},{native:context()}),/role binding/);
    assert.throws(()=>executeBlueprint(program('HasAuthority'),{},{Owner:ref},{native:{...context(),net_drivers:1}}),/standalone/);
    assert.throws(()=>executeBlueprint(program('HasAuthority'),{},{Owner:{...ref,actor_id:'foreign'}},{native:context()}),/foreign/);
    assert.equal(executeBlueprint(program('HasAuthority'),{},{Owner:null},{native:context()}).value,false);
});
