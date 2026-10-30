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

test('source Kismet MakeLiteralText retains invariant FText identity and history',()=>{
  const value={history:'invariant',text:'Hello 🌍',flags:2};
  const call={op:'native_call',identity:['/Script/Engine','KismetSystemLibrary','MakeLiteralText'],
    parameter_types:['TextProperty'],return_type:'TextProperty',
    args:[{op:'typed_literal',schema:{type:'TextProperty'},value}]};
  const p={...program(call),field_types:{local:{Text:'TextProperty'}}};
  assert.deepEqual(executeBlueprint(p,{},{}).outputs.Text,value);
  const wrong=structuredClone(call);
  wrong.identity[1]='KismetTextLibrary';
  assert.throws(()=>executeBlueprint(program(wrong),{},{}),/Unsupported original native object call/);
});

test('original KismetSystemLibrary.MakeLiteralString preserves source FString without coercion', () => {
  const call = value => ({op:'native_call',
    identity:['/Script/Engine','KismetSystemLibrary','MakeLiteralString'],
    parameter_types:['StrProperty'],return_type:'StrProperty',
    args:[{op:'typed_literal',schema:{type:'StrProperty'},value}]});
  for (const value of ['', 'Actor_A', '😀']) {
    assert.equal(executeBlueprint(program(call(value)),{},{}).outputs.Text, value);
  }
  assert.throws(() => executeBlueprint(program(call(34)),{},{}), /Invalid/);
  const foreign = call('Actor_A');
  foreign.identity[1] = 'KismetStringLibrary';
  assert.throws(() => executeBlueprint(program(foreign),{},{}),
      /Unsupported original native object call/);
});

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

test('source FStrings concatenate through the shared Kismet native family runtime',()=>{
  const concat=(left,right)=>({op:'native_call',
    identity:['/Script/Engine','KismetStringLibrary','Concat_StrStr'],
    parameter_types:['StrProperty','StrProperty'],return_type:'StrProperty',
    args:[left,right].map(value=>({op:'typed_literal',schema:{type:'StrProperty'},value}))});
  assert.equal(executeBlueprint(program(concat('Player_', '😀')),{},{})
    .outputs.Text,'Player_😀');
  const malformed=concat('a','b');
  malformed.args[1].schema.type='NameProperty';
  assert.throws(()=>executeBlueprint(program(malformed),{},{}),/parameter type differs/);
});
