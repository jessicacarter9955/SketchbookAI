import test from 'node:test';
import assert from 'node:assert/strict';
import {executeBlueprint} from '../src/editor/ue2three-blueprint.mjs';
const literal=value=>({op:'native_call',identity:['/Script/Engine','KismetSystemLibrary','MakeLiteralDouble'],
 parameter_types:['DoubleProperty'],return_type:'DoubleProperty',
 args:[{op:'typed_literal',schema:{type:'DoubleProperty'},value}]});
const program=call=>({schema_version:1,status:'translated_straight_line',source_owner_index:1,source_export_index:1,
 input_fields:[],output_fields:['Value'],self_reads:[],self_writes:[],field_types:{local:{Value:'DoubleProperty'}},
 steps:[{op:'set',scope:'local',field:'Value',value:call},{op:'return',value:{op:'constant',value:null}}]});
test('source double literal identity',()=>{
 for(const v of [0.2,0.16,575,-1.25]) assert.equal(executeBlueprint(program(literal(v)),{},{}).outputs.Value,v);
 for(const v of ['0.2',null,NaN,Infinity]) assert.throws(()=>executeBlueprint(program(literal(v)),{},{}));
 const wrong=literal(0.2);wrong.identity[1]='OtherLibrary';
 assert.throws(()=>executeBlueprint(program(wrong),{},{}));
});
