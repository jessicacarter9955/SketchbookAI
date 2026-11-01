import test from 'node:test';
import assert from 'node:assert/strict';
import { executeBlueprint } from '../src/editor/ue2three-blueprint.mjs';

// UE5.7 EX_Let -> EX_StructMemberContext writes through the reflected member
// FProperty, not through a JavaScript Number assignment with binary64 storage.
const literal = value => ({op:'constant',value});
const ret = {op:'return',value:literal(null)};
const get = (scope,field) => ({op:'get',scope,field});

test('UE5.7 reflected struct FloatProperty member writes round to binary32, unlike DoubleProperty', () => {
    const schema={type:'StructProperty',fields:{
        Ratio:{type:'FloatProperty',default:0},Precise:{type:'DoubleProperty',default:0}},
        default:{Ratio:0,Precise:0}};
    const target=get('local','Pair');
    const program={schema_version:1,status:'translated_straight_line',input_fields:[],output_fields:['Pair'],
        field_types:{local:{Pair:'StructProperty'}},schemas:{local:{Pair:schema}},
        steps:[{op:'set_member',target,field:'Ratio',member_type:'FloatProperty',value:literal(0.1),source_index:1},
            {op:'set_member',target,field:'Precise',member_type:'DoubleProperty',value:literal(0.1),source_index:2},
            {op:'return',value:target,source_index:3}]};
    const result=executeBlueprint(program);
    assert.equal(result.value.Ratio,Math.fround(0.1));
    assert.equal(result.value.Precise,0.1);
    assert.equal(result.outputs.Pair.Ratio,Math.fround(0.1));
    assert.equal(result.trace[0].value,Math.fround(0.1));
    assert.deepEqual(schema.default,{Ratio:0,Precise:0});

    const write = value => ({...program,steps:[{...program.steps[0],value:literal(value)},program.steps[2]]});
    assert.ok(Object.is(executeBlueprint(write(-0)).value.Ratio,-0));
    assert.equal(executeBlueprint(write(1e-50)).value.Ratio,0);
    assert.throws(()=>executeBlueprint(write(1e40)),/float32 assignment overflow/);
    assert.throws(()=>executeBlueprint(write(NaN)),/Invalid typed source member/);
    assert.throws(()=>executeBlueprint({...program,steps:[{...program.steps[0],member_type:'DoubleProperty'},program.steps[2]]}),
        /assignment type/);
});

test('UE5.7 typed FloatProperty Array_Add and Array_Set store binary32 and reject overflow', () => {
    const element={type:'FloatProperty',default:0};
    const schema={type:'ArrayProperty',element,default:[]};
    const target=get('self','Values');
    const base={schema_version:1,status:'translated_straight_line',input_fields:['Value'],
        output_fields:[],field_types:{self:{Values:'ArrayProperty'},local:{Value:'FloatProperty'}},
        schemas:{self:{Values:schema}}};
    const add={...base,steps:[{op:'evaluate',source_index:1,value:{op:'array_add',
        target,item:get('local','Value'),element}},ret]};
    const set={...base,input_fields:['Value','Index','Fit'],
        field_types:{...base.field_types,local:{Value:'FloatProperty',Index:'IntProperty',Fit:'BoolProperty'}},
        steps:[{op:'evaluate',source_index:1,value:{op:'array_set',
            target,index:get('local','Index'),item:get('local','Value'),
            size_to_fit:get('local','Fit'),element}},ret]};
    const initial={Values:[2]};
    assert.deepEqual(executeBlueprint(add,initial,{Value:0.1}).state.Values,[2,Math.fround(0.1)]);
    assert.deepEqual(executeBlueprint(set,initial,{Value:0.1,Index:0,Fit:false}).state.Values,[Math.fround(0.1)]);
    assert.ok(Object.is(executeBlueprint(add,{Values:[]},{Value:-0}).state.Values[0],-0));
    assert.deepEqual(executeBlueprint(set,{Values:[]},{Value:0.1,Index:2,Fit:true}).state.Values,
        [0,0,Math.fround(0.1)]);
    assert.throws(()=>executeBlueprint(add,initial,{Value:1e40}),/float32 assignment overflow/);
    assert.throws(()=>executeBlueprint(set,initial,{Value:1e40,Index:0,Fit:false}),/float32 assignment overflow/);
    // UE Array_Set with size-to-fit disabled does not write out-of-range slots.
    assert.deepEqual(executeBlueprint(set,initial,{Value:1e40,Index:5,Fit:false}).state.Values,[2]);
    assert.deepEqual(initial,{Values:[2]});
});

test('UE5.7 EX_SetArray FloatProperty elements round at slot storage, preserving signed zero', () => {
    const element={type:'FloatProperty',default:0};
    const target=get('self','Values');
    const program={schema_version:1,status:'translated_straight_line',input_fields:[],output_fields:[],
        field_types:{self:{Values:'ArrayProperty'}},
        schemas:{self:{Values:{type:'ArrayProperty',element,default:[]}}},
        steps:[{op:'evaluate',source_index:1,value:{op:'array_literal',target,element,
            elements:[literal(0.1),literal(-0),literal(1e-50)]}},ret]};
    const state={Values:[4,5]};
    const result=executeBlueprint(program,state);
    assert.equal(result.state.Values[0],Math.fround(0.1));
    assert.ok(Object.is(result.state.Values[1],-0));
    assert.equal(result.state.Values[2],0);
    assert.deepEqual(state.Values,[4,5]);
    const invalid={...program,steps:[{...program.steps[0],value:{
        ...program.steps[0].value,elements:[literal(1e40)]}},ret]};
    assert.throws(()=>executeBlueprint(invalid,state),/float32 assignment overflow/);
    assert.deepEqual(state.Values,[4,5]);
});
