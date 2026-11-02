import test from 'node:test';
import assert from 'node:assert/strict';
import { executeBlueprint } from '../src/editor/ue2three-blueprint.mjs';

// Synthetic reflected UE5.7 pin schemas: NOT an original DDS bytecode replay.
const rotator = {
    type:'StructProperty',source:'/Script/CoreUObject',native:'Rotator',
    fields:{Pitch:{type:'DoubleProperty'},Yaw:{type:'DoubleProperty'},Roll:{type:'DoubleProperty'}},
    default:{Pitch:0,Yaw:0,Roll:0},member_order:['Pitch','Yaw','Roll'],
};
const get = field => ({op:'get',scope:'local',field});
const outputs = ['Roll','Pitch','Yaw'];
const program = {
    schema_version:1,status:'translated_straight_line',
    input_fields:['Input'],output_fields:outputs,
    field_types:{local:{Input:'StructProperty',Roll:'FloatProperty',Pitch:'FloatProperty',Yaw:'FloatProperty'}},
    schemas:{local:{Input:rotator}},
    steps:[
        {op:'evaluate',source_index:12,value:{
            op:'math_outputs',name:'BreakRotator',components:outputs,
            args:[get('Input')],targets:outputs.map(field=>({...get(field),type:'FloatProperty'})),
        }},
        {op:'return',source_index:13,value:get('Pitch')},
    ],
};

test('UE5.7 BreakRotator writes binary32 FloatProperty out pins from double FRotator',()=>{
    const input={Pitch:0.1,Yaw:1/3,Roll:-0};
    const result=executeBlueprint(program,{}, {Input:input});
    assert.equal(result.value,Math.fround(0.1));
    assert.equal(result.outputs.Pitch,Math.fround(0.1));
    assert.equal(result.outputs.Yaw,Math.fround(1/3));
    assert.ok(Object.is(result.outputs.Roll,-0));
    assert.equal(result.trace[0].targets[1].value,Math.fround(0.1));
    assert.ok(Object.is(result.trace[0].targets[0].value,-0));
    assert.equal(input.Pitch,0.1);
    assert.ok(Object.is(input.Roll,-0));
});

test('UE5.7 BreakRotator rejects finite doubles overflowing a FloatProperty out pin',()=>{
    const input={Pitch:1e40,Yaw:0.5,Roll:0.25};
    assert.throws(()=>executeBlueprint(program,{}, {Input:input}),/float32 assignment overflow/);
    assert.deepEqual(input,{Pitch:1e40,Yaw:0.5,Roll:0.25});
});

test('BreakRotator refuses output pins declared as DoubleProperty instead of source FloatProperty',()=>{
    const changed=structuredClone(program);
    changed.field_types.local.Pitch='DoubleProperty';
    assert.throws(()=>executeBlueprint(changed,{}, {Input:{Pitch:1,Yaw:2,Roll:3}}),/output type differs/);
});
