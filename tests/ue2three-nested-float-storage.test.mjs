import test from 'node:test';
import assert from 'node:assert/strict';
import { executeBlueprint } from '../src/editor/ue2three-blueprint.mjs';

// Reflected-schema regression fixtures, not original DDS source bytecode replay.
const c = value => ({op:'constant',value});
const get = (scope,field) => ({op:'get',scope,field});
const F = {type:'FloatProperty',default:0};
const D = {type:'DoubleProperty',default:0};
const row = {type:'StructProperty',source:'/Game/DDS',fields:{Ratio:F,Precise:D},
    member_order:['Ratio','Precise'],default:{Ratio:0,Precise:0}};
const items = {type:'ArrayProperty',element:row,default:[]};
const packet = {type:'StructProperty',source:'/Game/DDS',
    fields:{Scalar:F,Exact:D,Series:items},member_order:['Scalar','Exact','Series'],
    default:{Scalar:0,Exact:0,Series:[]}};
const original = () => ({Ratio:0.1,Precise:0.1});
const expected = () => ({Ratio:Math.fround(0.1),Precise:0.1});
const end = {op:'return',value:c(null)};

test('UE5.7 EX_Let copies nested StructProperty and ArrayProperty FloatProperty fields as binary32',()=>{
    const program={schema_version:1,status:'translated_straight_line',
        input_fields:['Incoming'],output_fields:[],
        field_types:{self:{Packet:'StructProperty'},local:{Incoming:'StructProperty'}},
        schemas:{self:{Packet:packet},local:{Incoming:packet}},
        steps:[{op:'set',scope:'self',field:'Packet',value:get('local','Incoming'),source_index:1},
            {op:'return',value:get('self','Packet'),source_index:2}]};
    const self={Packet:structuredClone(packet.default)};
    const incoming={Scalar:0.1,Exact:0.1,Series:[original(),{Ratio:-0,Precise:1/3}]};
    const result=executeBlueprint(program,self,{Incoming:incoming});
    assert.equal(result.state.Packet.Scalar,Math.fround(0.1));
    assert.equal(result.state.Packet.Exact,0.1);
    assert.deepEqual(result.value.Series[0],expected());
    assert.ok(Object.is(result.value.Series[1].Ratio,-0));
    assert.equal(result.value.Series[1].Precise,1/3);
    assert.equal(result.trace[0].value.Series[0].Ratio,Math.fround(0.1));
    assert.equal(incoming.Series[0].Ratio,0.1);
    assert.deepEqual(self,{Packet:packet.default});

    const overflow={...incoming,Series:[original(),{Ratio:1e40,Precise:0}]};
    assert.throws(()=>executeBlueprint(program,self,{Incoming:overflow}),/float32 assignment overflow/);
    assert.deepEqual(self,{Packet:packet.default});
    assert.equal(overflow.Series[0].Ratio,0.1);
});

function runArray(operation,incoming,initial=[]){
    const target=get('self','Items'), input=get('local','Incoming');
    const isAppend=operation==='Array_Append';
    const expr=operation==='EX_SetArray'
        ? {op:'array_literal',target,element:row,elements:[input]}
        : operation==='Array_Add'
            ? {op:'array_add',target,item:input,element:row}
            : operation==='Array_Set'
                ? {op:'array_set',target,index:c(0),item:input,size_to_fit:c(true),element:row}
                : {op:'array_mutate',operation,target,value:input,element:row};
    const inputSchema=isAppend ? items : row;
    const program={schema_version:1,status:'translated_straight_line',
        input_fields:['Incoming'],output_fields:[],
        field_types:{self:{Items:'ArrayProperty'},local:{Incoming:inputSchema.type}},
        schemas:{self:{Items:items},local:{Incoming:inputSchema}},
        steps:[{op:'evaluate',source_index:1,value:expr},end]};
    return executeBlueprint(program,{Items:initial},{Incoming:incoming});
}

test('UE5.7 typed array writes recursively round struct FloatProperty but retain DoubleProperty',()=>{
    for(const operation of ['Array_Add','Array_Set','EX_SetArray','Array_Append']){
        const incoming=operation==='Array_Append' ? [original(),{Ratio:-0,Precise:1/3}] : original();
        const result=runArray(operation,incoming);
        assert.deepEqual(result.state.Items[0],expected(),operation);
        if(operation==='Array_Append'){
            assert.ok(Object.is(result.state.Items[1].Ratio,-0));
            assert.equal(result.state.Items[1].Precise,1/3);
        }
        if(operation==='Array_Append') assert.equal(incoming[0].Ratio,0.1);
        else assert.equal(incoming.Ratio,0.1);
    }
});

test('Nested FloatProperty overflow rejects whole reflected write without changing source inputs',()=>{
    for(const operation of ['Array_Add','Array_Set','EX_SetArray','Array_Append']){
        const incoming=operation==='Array_Append' ? [original(),{Ratio:1e40,Precise:0}]
            : {Ratio:1e40,Precise:0};
        const self=[original()];
        assert.throws(()=>runArray(operation,incoming,self),/float32 assignment overflow/,operation);
        assert.deepEqual(self,[original()],operation);
        if(operation==='Array_Append') assert.equal(incoming[0].Ratio,0.1);
        else assert.equal(incoming.Ratio,1e40);
    }
});
