import test from 'node:test';
import assert from 'node:assert/strict';
import { executeBlueprint } from '../src/editor/ue2three-blueprint.mjs';

// Reflected KismetArrayLibrary contract fixtures; NOT original DDS bytecode replay.
const constant = value => ({op:'constant',value});
const field = (scope,name) => ({op:'get',scope,field:name});
function setWithGrowth(element,item,index=2,initial=[]) {
    const schema={type:'ArrayProperty',element,default:[]};
    const program={schema_version:1,status:'translated_straight_line',
        input_fields:['Item'],output_fields:[],
        field_types:{self:{Items:'ArrayProperty'},local:{Item:element.type}},
        schemas:{self:{Items:schema},local:{Item:element}},
        steps:[{op:'evaluate',source_index:1,value:{
            op:'array_mutate',operation:'Array_Set',target:field('self','Items'),
            element,index:constant(index),resize:constant(true),value:field('local','Item')
        }},{op:'return',source_index:2,value:constant(null)}]};
    return executeBlueprint(program,{Items:initial},{Item:item});
}

test('UE5.7 generic Array_Set growth stores reflected FloatProperty defaults at binary32 precision',()=>{
    const element={type:'FloatProperty',default:0.1};
    const result=setWithGrowth(element,2);
    assert.deepEqual(result.state.Items,[Math.fround(0.1),Math.fround(0.1),2]);
    assert.equal(result.trace[0].operation,'Array_Set');
    const negative=setWithGrowth({type:'FloatProperty',default:-0},1);
    assert.ok(Object.is(negative.state.Items[0],-0));
    assert.ok(Object.is(negative.state.Items[1],-0));
});

test('UE5.7 Array_Set growth copies nested reflected FloatProperty defaults without losing DoubleProperty',()=>{
    const element={type:'StructProperty',source:'/Game/DDS',
        fields:{Ratio:{type:'FloatProperty',default:0.1},
            Precise:{type:'DoubleProperty',default:0.1}},
        member_order:['Ratio','Precise'],default:{Ratio:0.1,Precise:0.1}};
    const input={Ratio:3,Precise:3};
    const result=setWithGrowth(element,input);
    assert.deepEqual(result.state.Items,[
        {Ratio:Math.fround(0.1),Precise:0.1},
        {Ratio:Math.fround(0.1),Precise:0.1},
        input
    ]);
    assert.equal(element.default.Ratio,0.1);
    assert.equal(input.Ratio,3);
});

test('Array_Set rejects overflowing reflected default before growing source array',()=>{
    const element={type:'StructProperty',source:'/Game/DDS',
        fields:{Ratio:{type:'FloatProperty',default:1e40}},
        member_order:['Ratio'],default:{Ratio:1e40}};
    const initial=[{Ratio:1}];
    assert.throws(()=>setWithGrowth(element,{Ratio:2},3,initial),
        /float32 assignment overflow/);
    assert.deepEqual(initial,[{Ratio:1}]);
});
