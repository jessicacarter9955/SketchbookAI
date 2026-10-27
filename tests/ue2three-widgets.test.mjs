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

test('native virtual TextBlock text dispatch preserves authored FText data',()=>{
  const operation=effect('SetText',textValue);
  operation.dispatch='EX_VirtualFunction';
  const result=executeBlueprint(program(operation),{Txt_Label:ref},{},{native:native()});
  assert.equal(result.effects.length,1);
  assert.equal(result.effects[0].dispatch,'EX_VirtualFunction');
  assert.equal(result.effects[0].method,'SetText');
});

test('native text color preserves source FSlateColor and rejects unbound style rules or non-finite channels',()=>{
  const rgba={R:0.25,G:0.5,B:0.75,A:1};
  const linear={type:'StructProperty',source:'/Script/CoreUObject',native:'LinearColor',
    fields:Object.fromEntries(['R','G','B','A'].map(name=>[name,{type:'FloatProperty'}])),
    default:{R:0,G:0,B:0,A:0},member_order:['R','G','B','A']};
  const schema={type:'StructProperty',source:'/Script/SlateCore',native:'SlateColor',
    fields:{SpecifiedColor:linear,ColorUseRule:{type:'ByteProperty',enum:['/Script/SlateCore','ESlateColorStylingMode'],
      enum_values:{'ESlateColorStylingMode::UseColor_Specified':0,'ESlateColorStylingMode::UseColor_ColorTable':1,
        'ESlateColorStylingMode::UseColor_Foreground':2,'ESlateColorStylingMode::UseColor_Foreground_Subdued':3,
        'ESlateColorStylingMode::UseColor_UseStyle':4},default:0}},
    default:{SpecifiedColor:{R:1,G:0,B:1,A:1},ColorUseRule:0},member_order:['SpecifiedColor','ColorUseRule']};
  const operation=effect('SetText',textValue);
  operation.method='SetColorAndOpacity';
  operation.identity=['/Script/UMG','TextBlock','SetColorAndOpacity'];
  operation.parameter={schema,value:{op:'typed_literal',schema,value:{SpecifiedColor:rgba,ColorUseRule:0}}};
  const result=executeBlueprint(program(operation),{Txt_Label:ref},{},{native:native()});
  assert.equal(result.effects.length,1);
  assert.deepEqual(result.effects[0].parameter,{SpecifiedColor:rgba,ColorUseRule:0});
  const bad=structuredClone(operation);
  bad.parameter.value.value.SpecifiedColor.B=Infinity;
  assert.throws(()=>executeBlueprint(program(bad),{Txt_Label:ref},{},{native:native()}),
    /Invalid typed source member/);
  const style=structuredClone(operation);style.parameter.value.value.ColorUseRule=2;
  assert.throws(()=>executeBlueprint(program(style),{Txt_Label:ref},{},{native:native()}),/style binding/);
});

test('native Border material brush emits the exact source material reference',()=>{
  const borderClass=['/Script/UMG','Border'];
  const border={kind:'source_native_widget',source_package:pkg,source_owner_index:1,
    source_field:'Border_Selection',widget_id:'border-original-1',declared_class:borderClass};
  const schema={type:'ObjectProperty',class:['/Script/Engine','MaterialInstanceConstant'],default:null};
  const material={asset:'/Game/Materials.M_UI_Border',declared_class:['/Script/Engine','MaterialInstanceConstant']};
  const command={op:'native_widget_effect',source_owner_index:1,source_binding_required:true,
    visual_1to1_certified:false,identity:['/Script/UMG','Border','SetBrushFromMaterial'],
    dispatch:'EX_FinalFunction',method:'SetBrushFromMaterial',
    receiver:{op:'get',scope:'self',field:'Border_Selection'},receiver_field:'Border_Selection',
    receiver_schema:{type:'ObjectProperty',class:borderClass,reference_kind:'runtime_native_widget',default:null},
    parameter:{schema,value:{op:'typed_literal',schema,value:material}}};
  const p=program(command);
  p.self_reads=['Border_Selection'];
  p.field_types.self={Border_Selection:'ObjectProperty'};
  p.schemas.self={Border_Selection:{type:'ObjectProperty',class:borderClass,reference_kind:'runtime_native_widget'}};
  const bindings={source_package:pkg,source_owner_index:1,widgets:{Border_Selection:{
    reference:border,source_field:'Border_Selection',source_owner_index:1,
    declared_class:borderClass,binding_complete:true}}};
  const result=executeBlueprint(p,{Border_Selection:border},{},{native:bindings});
  assert.deepEqual(result.effects[0].identity,['/Script/UMG','Border','SetBrushFromMaterial']);
  assert.deepEqual(result.effects[0].parameter,material);
  const bad=structuredClone(command);
  bad.parameter.schema.class=['/Script/Engine','SoundWave'];
  bad.parameter.value.schema.class=['/Script/Engine','SoundWave'];
  bad.parameter.value.value.declared_class=['/Script/Engine','SoundWave'];
  assert.throws(()=>executeBlueprint(program(bad),{Border_Selection:border},{},{native:bindings}),
    /Unsupported or unbound original UMG context contract/);
});

test('native ProgressBar SetPercent preserves a source float effect and binding',()=>{
  const progressClass=['/Script/UMG','ProgressBar'];
  const progress={kind:'source_native_widget',source_package:pkg,source_owner_index:1,
    source_field:'Progress',widget_id:'progress-original-1',declared_class:progressClass};
  const schema={type:'FloatProperty',default:0};
  const operation={op:'native_widget_effect',source_owner_index:1,source_binding_required:true,
    visual_1to1_certified:false,identity:['/Script/UMG','ProgressBar','SetPercent'],
    dispatch:'EX_FinalFunction',method:'SetPercent',
    receiver:{op:'get',scope:'self',field:'Progress'},receiver_field:'Progress',
    receiver_schema:{type:'ObjectProperty',class:progressClass,reference_kind:'runtime_native_widget',default:null},
    parameter:{schema,value:{op:'constant',value:0.5}}};
  const p=program(operation);
  p.self_reads=['Progress'];
  p.field_types.self={Progress:'ObjectProperty'};
  p.schemas.self={Progress:{type:'ObjectProperty',class:progressClass,reference_kind:'runtime_native_widget'}};
  const bindings={source_package:pkg,source_owner_index:1,widgets:{Progress:{reference:progress,
    source_field:'Progress',source_owner_index:1,declared_class:progressClass,binding_complete:true}}};
  const result=executeBlueprint(p,{Progress:progress},{},{native:bindings});
  assert.deepEqual(result.effects[0].identity,['/Script/UMG','ProgressBar','SetPercent']);
  assert.equal(result.effects[0].parameter,0.5);
  const bad=structuredClone(operation);
  bad.parameter.schema.type='DoubleProperty';
  assert.throws(()=>executeBlueprint(program(bad),{Progress:progress},{},{native:bindings}),
    /Unsupported or unbound original UMG context contract/);
});

test('native Image SetBrushFromTexture preserves the typed texture and match-size flag',()=>{
  const imageClass=['/Script/UMG','Image'];
  const image={kind:'source_native_widget',source_package:pkg,source_owner_index:1,
    source_field:'Img_ItemIcon',widget_id:'img-original-1',declared_class:imageClass};
  const textureSchema={type:'ObjectProperty',class:['/Script/Engine','Texture2D'],default:null};
  const boolSchema={type:'BoolProperty',default:false};
  const texture={asset:'/Game/UI/T_InventoryIcon',declared_class:['/Script/Engine','Texture2D']};
  const operation={op:'native_widget_effect',source_owner_index:1,source_binding_required:true,
    visual_1to1_certified:false,identity:['/Script/UMG','Image','SetBrushFromTexture'],
    dispatch:'EX_VirtualFunction',method:'SetBrushFromTexture',
    receiver:{op:'get',scope:'self',field:'Img_ItemIcon'},receiver_field:'Img_ItemIcon',
    receiver_schema:{type:'ObjectProperty',class:imageClass,reference_kind:'runtime_native_widget',default:null},
    parameter_schemas:[textureSchema,boolSchema],
    parameters:[{op:'typed_literal',schema:textureSchema,value:texture},{op:'constant',value:false}]};
  const p=program(operation);
  p.self_reads=['Img_ItemIcon'];
  p.field_types.self={Img_ItemIcon:'ObjectProperty'};
  p.schemas.self={Img_ItemIcon:{type:'ObjectProperty',class:imageClass,reference_kind:'runtime_native_widget'}};
  const bindings={source_package:pkg,source_owner_index:1,widgets:{Img_ItemIcon:{reference:image,
    source_field:'Img_ItemIcon',source_owner_index:1,declared_class:imageClass,binding_complete:true}}};
  const result=executeBlueprint(p,{Img_ItemIcon:image},{},{native:bindings});
  assert.deepEqual(result.effects[0].identity,['/Script/UMG','Image','SetBrushFromTexture']);
  assert.deepEqual(result.effects[0].parameters,[texture,false]);
  const bad=structuredClone(operation);
  bad.parameter_schemas[0].class=['/Script/Engine','SoundWave'];
  assert.throws(()=>executeBlueprint(program(bad),{Img_ItemIcon:image},{},{native:bindings}),
    /Unsupported or unbound original UMG context contract/);
});

test('native Widget.SetFocus emits a witnessed zero-argument source UI effect',()=>{
  const focus=effect('SetVisibility',0);
  focus.identity=['/Script/UMG','Widget','SetFocus'];focus.method='SetFocus';focus.dispatch='EX_FinalFunction';
  delete focus.parameter;
  const result=executeBlueprint(program(focus),{Txt_Label:ref},{},{native:native()});
  assert.equal(result.effects.length,1);
  assert.deepEqual(result.effects[0].identity,['/Script/UMG','Widget','SetFocus']);
  assert.equal(result.effects[0].method,'SetFocus');
  assert.equal(Object.hasOwn(result.effects[0],'parameter'),false);
  const forged=structuredClone(focus);forged.identity[1]='UserWidget';
  assert.throws(()=>executeBlueprint(program(forged),{Txt_Label:ref},{},{native:native()}),
    /Unsupported or unbound original UMG context contract/);
});

test('native Image.SetBrushFromTexture retains Texture2D identity and bMatchSize',()=>{
  const imageClass=['/Script/UMG','Image'];
  const reference={kind:'source_native_widget',source_package:pkg,source_owner_index:1,
    source_field:'Img_Icon',widget_id:'image-original-1',declared_class:imageClass};
  const schema={type:'ObjectProperty',class:['/Script/Engine','Texture2D'],default:null};
  const texture={asset:'/Game/UI.T_Icon',declared_class:['/Script/Engine','Texture2D']};
  const operation={op:'native_widget_effect',source_owner_index:1,source_binding_required:true,
    visual_1to1_certified:false,identity:['/Script/UMG','Image','SetBrushFromTexture'],
    dispatch:'EX_VirtualFunction',method:'SetBrushFromTexture',
    receiver:{op:'get',scope:'self',field:'Img_Icon'},receiver_field:'Img_Icon',
    receiver_schema:{type:'ObjectProperty',class:imageClass,reference_kind:'runtime_native_widget',default:null},
    parameter:{schema,value:{op:'typed_literal',schema,value:texture}},
    options:{bMatchSize:{schema:{type:'BoolProperty'},value:{op:'constant',value:false}}}};
  const p=program(operation);
  p.self_reads=['Img_Icon'];
  p.field_types.self={Img_Icon:'ObjectProperty'};
  p.schemas.self={Img_Icon:{type:'ObjectProperty',class:imageClass,reference_kind:'runtime_native_widget'}};
  const native={source_package:pkg,source_owner_index:1,widgets:{Img_Icon:{
    reference,source_field:'Img_Icon',source_owner_index:1,declared_class:imageClass,binding_complete:true}}};
  const result=executeBlueprint(p,{Img_Icon:reference},{},{native});
  assert.equal(result.effects.length,1);
  assert.deepEqual(result.effects[0].identity,['/Script/UMG','Image','SetBrushFromTexture']);
  assert.deepEqual(result.effects[0].parameter,texture);
  assert.equal(result.effects[0].match_size,false);
  const bad=structuredClone(operation);
  bad.options.bMatchSize.value.value=1;
  assert.throws(()=>executeBlueprint(program(bad),{Img_Icon:reference},{},{native}),
    /Invalid typed source member/);
  bad.options.bMatchSize.value.value=false;
  bad.parameter.schema.class=['/Script/Engine','SoundWave'];
  assert.throws(()=>executeBlueprint(program(bad),{Img_Icon:reference},{},{native}),
    /Unsupported or unbound original UMG context contract/);
});
