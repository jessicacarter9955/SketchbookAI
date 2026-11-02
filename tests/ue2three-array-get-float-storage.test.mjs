import test from 'node:test';
import assert from 'node:assert/strict';
import { executeBlueprint } from '../src/editor/ue2three-blueprint.mjs';

// Synthetic reflected UE5.7 out-pin fixtures; no original DDS replay.
const c = value => ({op:'constant',value});
const get = (scope,field) => ({op:'get',scope,field});
const F = {type:'FloatProperty',default:0};
const D = {type:'DoubleProperty',default:0};
const packet = {type:'StructProperty',source:'/Game/DDS',fields:{Approx:F,Exact:D},
    default:{Approx:0,Exact:0},member_order:['Approx','Exact']};

function run(element,items,index){
    const array={type:'ArrayProperty',element,default:[]};
    const program={schema_version:1,status:'translated_straight_line',
        input_fields:['Index'],output_fields:['Out'],
        field_types:{self:{Items:'ArrayProperty'},local:{Index:'IntProperty',Out:element.type}},
        schemas:{self:{Items:array},local:{Out:element}},
        steps:[
            {op:'evaluate',source_index:10,value:{op:'array_get',
                array:get('self','Items'),index:get('local','Index'),
                target:get('local','Out'),element}},
            {op:'return',source_index:11,value:get('local','Out')},
        ]};
    return executeBlueprint(program,{Items:items},{Index:index});
}

test('UE5.7 Array_Get copies FloatProperty elements to binary32 out storage',()=>{
    const items=[0.1,-0];
    const result=run(F,items,0);
    assert.equal(result.outputs.Out,Math.fround(0.1));
    assert.equal(result.value,Math.fround(0.1));
    assert.equal(result.trace[0].value,Math.fround(0.1));
    assert.ok(Object.is(run(F,items,1).value,-0));
    assert.equal(items[0],0.1);
    assert.equal(run(D,[0.1],0).value,0.1);
});

test('UE5.7 Array_Get recursively stores nested FloatProperty while preserving DoubleProperty',()=>{
    const items=[{Approx:1/3,Exact:1/3}];
    const result=run(packet,items,0);
    assert.deepEqual(result.outputs.Out,{Approx:Math.fround(1/3),Exact:1/3});
    assert.deepEqual(result.value,{Approx:Math.fround(1/3),Exact:1/3});
    assert.deepEqual(items,[{Approx:1/3,Exact:1/3}]);
});

test('Array_Get rejects overflow before writing a reflected out pin',()=>{
    const items=[{Approx:1e40,Exact:0.1}];
    assert.throws(()=>run(packet,items,0),/float32 assignment overflow/);
    assert.deepEqual(items,[{Approx:1e40,Exact:0.1}]);
});
