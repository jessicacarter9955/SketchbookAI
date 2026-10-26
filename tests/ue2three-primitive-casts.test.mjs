import test from 'node:test';
import assert from 'node:assert/strict';
import { executeBlueprint } from '../src/editor/ue2three-blueprint.mjs';

const cast = (conversion, value) => ({op:'primitive_cast', conversion,
    source_type:conversion === 3 ? 'DoubleProperty' : 'FloatProperty',
    return_type:conversion === 3 ? 'FloatProperty' : 'DoubleProperty', value});
const constant = value => ({op:'constant', value});
const run = value => executeBlueprint({schema_version:1, status:'translated_straight_line',
    input_fields:[], output_fields:[], steps:[{op:'return',value}]}).value;

test('UE5 float conversion rounds to IEEE754 float32 before widening', () => {
    assert.equal(run(cast(3,constant(16777217))),16777216);
    assert.equal(run(cast(4,cast(3,constant(0.1)))),0.10000000149011612);
    assert.equal(run(cast(4,constant(0.1))),Math.fround(0.1));
    assert.ok(Object.is(run(cast(3,constant(-0))),-0));
    assert.equal(run(cast(3,constant(1e-50))),0);
});

test('primitive casts reject unsupported contracts and non-finite float32 results', () => {
    assert.throws(()=>run({...cast(3,constant(1)),conversion:1}),/cast contract/);
    assert.throws(()=>run({...cast(3,constant(1)),source_type:'IntProperty'}),/cast contract/);
    assert.throws(()=>run({...cast(3,constant(1)),return_type:'DoubleProperty'}),/cast contract/);
    for (const value of [null,true,'0.1']) assert.throws(()=>run(cast(3,constant(value))),/cast input/);
    assert.throws(()=>run(cast(3,constant(Number.MAX_VALUE))),/Non-finite original primitive cast result/);
    assert.throws(()=>executeBlueprint({schema_version:1,status:'translated_straight_line',input_fields:['Wrong'],
        output_fields:[],field_types:{local:{Wrong:'IntProperty'}},steps:[{op:'return',
            value:cast(3,{op:'get',scope:'local',field:'Wrong'})}]},{},{Wrong:1}),/cast source type differs/);
});
