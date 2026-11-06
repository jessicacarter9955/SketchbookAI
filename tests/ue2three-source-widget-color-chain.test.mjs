import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {executeBlueprint} from '../src/editor/ue2three-blueprint.mjs';
const load=name=>JSON.parse(readFileSync(new URL('./fixtures/dds-'+name+'-color-chain.json',import.meta.url),'utf8'));
function binding(fixture,name){
 const functions={...fixture.functions,...fixture.event_programs},program=functions[name];
 const schemas=Object.assign({},fixture.field_schemas,...Object.values(functions).map(p=>p.schemas?.self||{}));
 const state=structuredClone(fixture.default_state),widgets={};
 for(const [field,schema] of Object.entries(schemas)){
  if(schema.reference_kind!=='runtime_native_widget')continue;
  const reference={kind:'source_native_widget',source_package:fixture.package,
    source_owner_index:program.source_owner_index,source_field:field,
    widget_id:'source-'+field,declared_class:schema.class};
  state[field]=reference;widgets[field]={reference,source_field:field,
    source_owner_index:program.source_owner_index,declared_class:schema.class,binding_complete:true};
 }
 const native={source_package:fixture.package,source_owner_index:program.source_owner_index,widgets};
 return {program,state,options:{functions,native}};
}
test('original SetDotColor export executes its entire source chain with float32 RGBA',()=>{
 const fixture=load('wbp_teammatedot'),b=binding(fixture,'SetDotColor');
 const color={R:0.25,G:0.5,B:0.75,A:1};
 const result=executeBlueprint(b.program,b.state,{DotColor:color},b.options);
 assert.equal(result.effects.length,1);
 assert.deepEqual(result.effects[0].identity,['/Script/UMG','Image','SetColorAndOpacity']);
 assert.equal(result.effects[0].source_field,'PlayerDot');
 assert.deepEqual(result.effects[0].parameter,color);
 assert.deepEqual(result.state,b.state);
 assert.equal(b.program.source_bytecode_sha256,'fd7065fc09da3ca5092c047f985cd855ec0532b1b7636c2c555195dcb445173c');
 const bad=binding(fixture,'SetDotColor');
 assert.throws(()=>executeBlueprint(bad.program,bad.state,{DotColor:{...color,R:Infinity}},bad.options),/Invalid|finite/);
 const unbound=binding(fixture,'SetDotColor');delete unbound.options.native.widgets.PlayerDot;
 assert.throws(()=>executeBlueprint(unbound.program,unbound.state,{DotColor:color},unbound.options),/binding/);
});
test('original OnInitialized follows its original ubergraph entry and all color operations',()=>{
 const fixture=load('wb_crosshair'),b=binding(fixture,'OnInitialized');
 const result=executeBlueprint(b.program,b.state,{},b.options);
 assert.deepEqual(result.effects.map(e=>e.identity),[
   ['/Script/UMG','Border','SetBrushColor'],['/Script/UMG','TextBlock','SetColorAndOpacity'],
   ['/Script/UMG','Image','SetColorAndOpacity']]);
 assert.deepEqual(result.effects[0].parameter,{R:0,G:0,B:0,A:Math.fround(0.8)});
 assert.deepEqual(result.effects[2].parameter,{R:0,G:0,B:0,A:0});
 assert.deepEqual(result.effects[1].parameter,{SpecifiedColor:{R:1,G:1,B:1,A:0.75},ColorUseRule:0});
});
test('Image LinearColor cannot be reinterpreted as a TextBlock SlateColor contract',()=>{
 const fixture=load('wbp_teammatedot'),b=binding(fixture,'SetDotColor');
 const program=structuredClone(b.program);
 program.steps[0].value.identity[1]='TextBlock';
 assert.throws(()=>executeBlueprint(program,b.state,{DotColor:{R:0,G:0,B:0,A:1}},b.options),/contract/);
});
