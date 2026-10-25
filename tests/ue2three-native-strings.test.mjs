import test from 'node:test';
import assert from 'node:assert/strict';
import {executeBlueprint} from '../src/editor/ue2three-blueprint.mjs';

const identity = name => ['/Script/Engine', 'KismetStringLibrary', name];
const contract = (name, type, value) => ({op:'native_call',identity:identity(name),
  parameter_types:[type],return_type:'StrProperty',args:[{
    op:'typed_literal',schema:{type},value
  }]});
function program(call) {
  return {schema_version:1,status:'translated_straight_line',
    source_owner_index:1,source_export_index:1,
    input_fields:[],output_fields:['Text'],self_reads:[],self_writes:[],
    field_types:{local:{Text:'StrProperty'}},steps:[
      {op:'set',scope:'local',field:'Text',value:call},
      {op:'return',value:{op:'constant',value:null}}
    ]};
}

test('source FName to FString preserves exact bone token identity',()=>{
  for (const bone of ['Bone_Spine_02', 'Clavicle_L', 'None']) {
    const call = contract('Conv_NameToString','NameProperty',bone);
    assert.equal(executeBlueprint(program(call),{},{}).outputs.Text,bone);
  }
});

test('source int32 conversion preserves original signed range without JS coercion',()=>{
  for (const number of [-2147483648,-172,0,1,2147483647]) {
    assert.equal(executeBlueprint(program(contract('Conv_IntToString','IntProperty',number)),{},{})
      .outputs.Text,String(number));
  }
  for (const invalid of [2147483648,-2147483649,1.25,'12',null,NaN,Infinity]) {
    assert.throws(()=>executeBlueprint(program(contract('Conv_IntToString','IntProperty',invalid)),{},{}),
      /Invalid original native object int32 parameter|Invalid source|Invalid typed source member/);
  }
});

test('native strings reject unrelated method identity and source parameter schemas',()=>{
  const valid = contract('Conv_NameToString','NameProperty','Chest');
  const forged = structuredClone(valid);
  forged.identity[1] = 'FakeStringLibrary';
  assert.throws(()=>executeBlueprint(program(forged),{},{}), /Unsupported original native object call/);
  const wrongType = structuredClone(valid);
  wrongType.args[0].schema.type = 'StrProperty';
  assert.throws(()=>executeBlueprint(program(wrongType),{},{}), /parameter type differs/);
  const wrongSignature = structuredClone(valid);
  wrongSignature.parameter_types=['StrProperty'];
  assert.throws(()=>executeBlueprint(program(wrongSignature),{},{}), /Unsupported original native object call/);
});
