import test from 'node:test';
import assert from 'node:assert/strict';
import { executeBlueprint } from '../src/editor/ue2three-blueprint.mjs';

// Synthetic reflected EX_SetArray contracts; NOT an original DDS bytecode replay.
const constant = value => ({op:'constant',value});
const items = {op:'get',scope:'self',field:'Items'};
function setArray(element, values, initial=[]) {
    const schema={type:'ArrayProperty',element,default:[]};
    // Struct values are reflected local inputs, never untyped Blueprint constants.
    const names=values.map((_,index)=>'Item'+index);
    const locals=Object.fromEntries(names.map((name,index)=>[name,values[index]]));
    const localSchemas=Object.fromEntries(names.map(name=>[name,element]));
    const localTypes=Object.fromEntries(names.map(name=>[name,element.type]));
    const program={schema_version:1,status:'translated_straight_line',
        input_fields:names,output_fields:[],
        field_types:{self:{Items:'ArrayProperty'},local:localTypes},
        schemas:{self:{Items:schema},local:localSchemas},
        steps:[{op:'evaluate',source_index:1,value:{
            op:'array_literal',target:items,element,
            elements:names.map(name=>({op:'get',scope:'local',field:name}))
        }},{op:'return',source_index:2,value:constant(null)}]};
    return executeBlueprint(program,{Items:initial},locals);
}

test('UE5.7 EX_SetArray rejects a FloatProperty temporary-slot default that overflows binary32',()=>{
    const element={type:'FloatProperty',default:1e40};
    const initial=[4];
    assert.throws(()=>setArray(element,[2],initial),/float32 assignment overflow/);
    assert.deepEqual(initial,[4]);
    assert.equal(element.default,1e40);
});

test('UE5.7 EX_SetArray validates nested FloatProperty temporary defaults before source expression',()=>{
    const element={type:'StructProperty',source:'/Game/DDS',
        fields:{Ratio:{type:'FloatProperty',default:1e40},
            Precise:{type:'DoubleProperty',default:0.1}},
        member_order:['Ratio','Precise'],default:{Ratio:1e40,Precise:0.1}};
    const initial=[{Ratio:1,Precise:2}];
    assert.throws(()=>setArray(element,[{Ratio:2,Precise:3}],initial),
        /float32 assignment overflow/);
    assert.deepEqual(initial,[{Ratio:1,Precise:2}]);
    assert.equal(element.default.Ratio,1e40);
});

test('UE5.7 EX_SetArray still stores final nested FloatProperty values as binary32 and DoubleProperty as binary64',()=>{
    const element={type:'StructProperty',source:'/Game/DDS',
        fields:{Ratio:{type:'FloatProperty',default:-0},
            Precise:{type:'DoubleProperty',default:0.1}},
        member_order:['Ratio','Precise'],default:{Ratio:-0,Precise:0.1}};
    const original={Ratio:0.1,Precise:0.1};
    const initial=[{Ratio:4,Precise:4}];
    const result=setArray(element,[original,{Ratio:-0,Precise:0.1}],initial);
    assert.deepEqual(result.state.Items,[{Ratio:Math.fround(0.1),Precise:0.1},
        {Ratio:-0,Precise:0.1}]);
    assert.ok(Object.is(result.state.Items[1].Ratio,-0));
    assert.ok(Object.is(element.default.Ratio,-0));
    assert.equal(original.Ratio,0.1);
    assert.deepEqual(initial,[{Ratio:4,Precise:4}]);
});
