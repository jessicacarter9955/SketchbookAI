import test from 'node:test';
import assert from 'node:assert/strict';
import { executeBlueprint } from '../src/editor/ue2three-blueprint.mjs';

// These are reflected KismetArrayLibrary write-path tests, not a complete
// source-cache replay or a claim of additional translated DDS functions.
const literal = value => ({op:'constant',value});
const get = (scope, field) => ({op:'get',scope,field});
const arrayOperations = ['Array_Set','Array_Add','Array_AddUnique','Array_Insert','Array_Append'];
function run(operation, initial, incoming, type = 'FloatProperty', index = 0, resize = false) {
    const element = {type,default:0};
    const arraySchema = {type:'ArrayProperty',element,default:[]};
    const isAppend = operation === 'Array_Append';
    const expr = {op:'array_mutate',operation,target:get('self','Values'),element,
        value:get('local',isAppend ? 'Incoming' : 'Value')};
    if (['Array_Set','Array_Insert'].includes(operation)) expr.index = literal(index);
    if (operation === 'Array_Set') expr.resize = literal(resize);
    if (['Array_AddUnique','Array_Insert'].includes(operation)) {
        expr.identity = ['/Script/Engine','KismetArrayLibrary',operation];
        expr.dispatch = 'EX_FinalFunction';
    }
    const program = {schema_version:1,status:'translated_straight_line',
        input_fields:[isAppend ? 'Incoming' : 'Value'],output_fields:[],
        field_types:{self:{Values:'ArrayProperty'},local:{[isAppend ? 'Incoming' : 'Value']:isAppend ? 'ArrayProperty' : type}},
        schemas:{self:{Values:arraySchema},local:isAppend ? {Incoming:arraySchema} : {}},
        steps:[{op:'evaluate',source_index:1,value:expr},
            {op:'return',source_index:2,value:literal(null)}]};
    return executeBlueprint(program,{Values:initial},{[isAppend ? 'Incoming' : 'Value']:incoming});
}

test('UE5.7 generic KismetArrayLibrary FloatProperty mutations store binary32', () => {
    for (const operation of arrayOperations) {
        const input = operation === 'Array_Append' ? [0.1,-0] : 0.1;
        const result = run(operation,[2],input);
        const expected = operation === 'Array_Set' ? [Math.fround(0.1)]
            : operation === 'Array_Insert' ? [Math.fround(0.1),2]
            : operation === 'Array_Append' ? [2,Math.fround(0.1),-0]
            : [2,Math.fround(0.1)];
        assert.deepEqual(result.state.Values,expected,operation);
        assert.equal(result.trace[0].operation,operation);
    }
    assert.ok(Object.is(run('Array_Add',[],-0).state.Values[0],-0));
    assert.ok(Object.is(run('Array_Append',[],[-0]).state.Values[0],-0));
    assert.deepEqual(run('Array_Set',[],0.1,'FloatProperty',2,true).state.Values,
        [0,0,Math.fround(0.1)]);
    // AddUnique compares reflected FloatProperty values, not binary64 inputs.
    assert.deepEqual(run('Array_AddUnique',[Math.fround(0.1)],0.1).state.Values,[Math.fround(0.1)]);
});

test('UE5.7 generic KismetArrayLibrary retains DoubleProperty binary64 precision', () => {
    for (const operation of arrayOperations) {
        const incoming = operation === 'Array_Append' ? [0.1] : 0.1;
        const values = run(operation,[2],incoming,'DoubleProperty').state.Values;
        assert.ok(values.includes(0.1),operation);
    }
});

test('FloatProperty overflow fails before array growth, insertion or partial append', () => {
    for (const operation of arrayOperations) {
        const input = operation === 'Array_Append' ? [0.1,1e40] : 1e40;
        const initial = [2];
        assert.throws(() => run(operation,initial,input),/float32 assignment overflow/,operation);
        assert.deepEqual(initial,[2],operation);
    }
    assert.throws(() => run('Array_Set',[],1e40,'FloatProperty',3,true),
        /float32 assignment overflow/);
    // A non-writable Array_Set slot must remain a no-op even for an overflow input.
    assert.deepEqual(run('Array_Set',[2],1e40,'FloatProperty',7,false).state.Values,[2]);
    // Existing source array values are not mutated if append validation fails.
    assert.deepEqual(run('Array_Append',[2],[0.1,1e40],'DoubleProperty').state.Values,
        [2,0.1,1e40]);
});
