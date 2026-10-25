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

test('Unreal FString.Len retains UTF-16 code-unit semantics with typed int output',()=>{
  const typed = input => ({op:'native_call',identity:identity('Len'),parameter_types:['StrProperty'],
    return_type:'IntProperty',args:[{op:'typed_literal',schema:{type:'StrProperty'},value:input}]});
  const run = input => {
    const p = {schema_version:1,status:'translated_straight_line',
      source_owner_index:1,source_export_index:1,input_fields:[],output_fields:['Length'],
      self_reads:[],self_writes:[],field_types:{local:{Length:'IntProperty'}},
      steps:[{op:'set',scope:'local',field:'Length',value:typed(input)},
             {op:'return',value:{op:'constant',value:null}}]};
    return executeBlueprint(p,{},{}).outputs.Length;
  };
  for(const [str,length] of [['',0],['Ammo',4],['😀',2],['A😀B',4]])
    assert.equal(run(str),length);
  assert.throws(()=>run(42),/Invalid original native object string parameter|Invalid source|Invalid typed source member/);
  const wrong=typed('Actor');
  wrong.parameter_types=['NameProperty'];
  const p={...program(wrong),field_types:{local:{Text:'IntProperty'}}};
  assert.throws(()=>executeBlueprint(p,{},{}),/Unsupported original native object call/);
});

test('source combat bone-zone Contains uses Unreal four-parameter ASCII-insensitive mode',()=>{
  const sourceCall=(search,substring,caseSensitive=false,fromEnd=false)=>({
    op:'native_call',identity:identity('Contains'),
    parameter_types:['StrProperty','StrProperty','BoolProperty','BoolProperty'],
    return_type:'BoolProperty',args:[
      {op:'typed_literal',schema:{type:'StrProperty'},value:search},
      {op:'typed_literal',schema:{type:'StrProperty'},value:substring},
      {op:'typed_literal',schema:{type:'BoolProperty'},value:caseSensitive},
      {op:'typed_literal',schema:{type:'BoolProperty'},value:fromEnd},
    ]});
  const run=call=>executeBlueprint({...program(call),
    field_types:{local:{Text:'BoolProperty'}}},{},{}).outputs.Text;
  assert.equal(run(sourceCall('Head_BONE','head')),true);
  assert.equal(run(sourceCall('Spine_02','head')),false);
  assert.equal(run(sourceCall('','')),true);
  assert.throws(()=>run(sourceCall('Böne','bö')),/Unicode FString.Contains case folding/);
  assert.throws(()=>run(sourceCall('Head','head',true,false)),/search mode is not supported/);
  assert.throws(()=>run(sourceCall('Head','head',false,true)),/search mode is not supported/);
  const invalid=sourceCall('head','head');invalid.args[2].schema.type='StrProperty';
  assert.throws(()=>run(invalid),/parameter type differs/);
});
