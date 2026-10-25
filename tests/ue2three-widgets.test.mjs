import test from 'node:test';
import assert from 'node:assert/strict';
import {executeBlueprint} from '../src/editor/ue2three-blueprint.mjs';

const pkg='/Game/Original/WBP_Test';
const klass=['/Script/UMG','TextBlock'];
const ref={kind:'source_native_widget',source_package:pkg,source_owner_index:1,
  source_field:'Txt_Label',widget_id:'txt-original-1',declared_class:klass};
const textValue={history:'empty',text:'',flags:0};
const textSchema={type:'TextProperty',default:textValue};
const byteSchema={type:'ByteProperty',default:0};

function effect(method,value,{sourceClass=klass}={}) {
  const text=method==='SetText';
  return {op:'native_widget_effect',source_owner_index:1,source_binding_required:true,
    visual_1to1_certified:false,identity:text?['/Script/UMG','TextBlock','SetText']:
      ['/Script/UMG','Widget','SetVisibility'],
    dispatch:text?'EX_FinalFunction':'EX_VirtualFunction',method,
    receiver:{op:'get',scope:'self',field:'Txt_Label'},receiver_field:'Txt_Label',
    receiver_schema:{type:'ObjectProperty',class:sourceClass,reference_kind:'runtime_native_widget',default:null},
    parameter:{schema:text?textSchema:byteSchema,value:text
      ? {op:'typed_literal',schema:textSchema,value} : {op:'constant',value}}};
}
function program(command) {
  return {schema_version:1,status:'translated_straight_line',
    source_owner_index:1,source_export_index:1,input_fields:[],output_fields:[],
    self_reads:['Txt_Label'],self_writes:[],
    field_types:{self:{Txt_Label:'ObjectProperty'}},
    schemas:{self:{Txt_Label:{type:'ObjectProperty',class:klass,reference_kind:'runtime_native_widget'}}},
    steps:[{op:'evaluate',value:command},{op:'return',value:{op:'constant',value:null}}]};
}
function native(binding=ref) {
  return {source_package:pkg,source_owner_index:1,widgets:{
    Txt_Label:{reference:binding,source_field:'Txt_Label',source_owner_index:1,
      declared_class:klass,binding_complete:true}}};
}

test('native UMG source text action requires witness, emits a typed ordered UI effect',()=>{
  const result=executeBlueprint(program(effect('SetText',textValue)),{Txt_Label:ref},{},{native:native()});
  assert.equal(result.effects.length,1);
  assert.deepEqual(result.effects[0].identity,['/Script/UMG','TextBlock','SetText']);
  assert.equal(result.effects[0].source_field,'Txt_Label');
  assert.equal(result.effects[0].widget_id,'txt-original-1');
  assert.deepEqual(result.effects[0].parameter,textValue);
  assert.deepEqual(result.state,{Txt_Label:ref});
});

test('native UMG source visibility honors five authored ESlateVisibility bytes',()=>{
  for(let v=0;v<=4;v++){
    const x=executeBlueprint(program(effect('SetVisibility',v)),{Txt_Label:ref},{},{native:native()});
    assert.equal(x.effects[0].parameter,v);
  }
  assert.throws(()=>executeBlueprint(program(effect('SetVisibility',5)),{Txt_Label:ref},{},{native:native()}),
    /ESlateVisibility/);
});

test('native widget unresolved/foreign references never create fake effects',()=>{
  assert.throws(()=>executeBlueprint(program(effect('SetText',textValue)),{Txt_Label:ref},{},{native:{source_package:pkg,source_owner_index:1}}),
    /source binding/);
  const forged={...ref,source_package:'/Game/Foreign'};
  assert.throws(()=>executeBlueprint(program(effect('SetText',textValue)),{Txt_Label:forged},{},{native:native()}),
    /unavailable or foreign/);
  const empty=executeBlueprint(program(effect('SetVisibility',0)),{Txt_Label:null},{},{native:native()});
  assert.equal(empty.effects.length,0);
  assert.ok(empty.trace.some(item=>item.message?.includes('Accessed None')));
});

test('native UMG rejects altered function identity and incompatible source type',()=>{
  const forged=effect('SetText',textValue);
  forged.identity=['/Script/UMG','Fake','SetText'];
  assert.throws(()=>executeBlueprint(program(forged),{Txt_Label:ref},{},{native:native()}),
    /context contract/);
  const wrong=effect('SetText',123);
  assert.throws(()=>executeBlueprint(program(wrong),{Txt_Label:ref},{},{native:native()}),
    /FText|typed source/);
});
