import test from 'node:test';
import assert from 'node:assert/strict';
import { executeBlueprint } from '../src/editor/ue2three-blueprint.mjs';

const program = {schema_version: 1, status: 'translated_straight_line', output_fields: ['State'], steps: [
    {op: 'set', field: 'State', value: {op: 'get', scope: 'self', field: 'WeaponState'}, source_index: 3},
    {op: 'return', value: {op: 'get', scope: 'local', field: 'State'}, source_index: 5}
]};
test('translated source getter preserves its actual input and outputs without modifying the actor', () => {
    for (const value of [false, true, 0, 1, 2, {Magazine: 17, Kind: 'source fixture'}]) {
        const self = {WeaponState: value};
        const result = executeBlueprint(program, self);
        assert.deepEqual(result.value, value); assert.deepEqual(result.outputs.State, value);
        assert.equal(result.trace[0].source_index, 3);
        if (typeof value === 'object') { result.value.Magazine = 0; assert.equal(value.Magazine, 17); }
    }
});
test('missing state and unsupported instructions fail instead of pretending to execute', () => {
    assert.throws(() => executeBlueprint(program), /Missing self/);
    assert.throws(() => executeBlueprint({...program, steps: [{op: 'nativeCall'}]}), /Unsupported Blueprint instruction/);
    assert.throws(() => executeBlueprint({...program, steps: []}), /no result/);
});
test('Boolean outputs cannot silently coerce source values', () => {
    const booleanProgram = {...program, steps: [{...program.steps[0], boolean: true}, program.steps[1]]};
    assert.throws(() => executeBlueprint(booleanProgram, {WeaponState: 1}), /Expected Boolean/);
    assert.equal(executeBlueprint(booleanProgram, {WeaponState: true}).value, true);
});
test('unsafe property paths and nonfinite constants are rejected', () => {
    assert.throws(() => executeBlueprint({...program, output_fields: ['__proto__']}), /Unsupported Blueprint/);
    assert.throws(() => executeBlueprint({...program, steps: [{op: 'return', value: {op: 'constant', value: NaN}}]}), /Invalid Blueprint constant/);
});
test('original property types distinguish byte enums, Boolean values and struct data', () => {
    const typed = {...program, field_types: {self: {WeaponState: 'ByteProperty'}, local: {State: 'ByteProperty'}}};
    assert.equal(executeBlueprint(typed, {WeaponState: 2}).value, 2);
    assert.throws(() => executeBlueprint(typed, {WeaponState: 256}), /invalid Byte/);
    assert.throws(() => executeBlueprint(typed, {WeaponState: true}), /invalid Byte/);
    typed.field_types.self.WeaponState = typed.field_types.local.State = 'StructProperty';
    assert.deepEqual(executeBlueprint(typed, {WeaponState: {}}).value, {});
    assert.throws(() => executeBlueprint(typed, {WeaponState: 2}), /invalid Struct/);
});
test('source state updates are explicit and do not leak on a failed execution', () => {
    const mutation = {...program, output_fields: [], steps: [
        {op: 'set', scope: 'self', field: 'WeaponState', boolean: true, value: {op: 'constant', value: false}},
        {op: 'return', value: {op: 'constant', value: null}}
    ]};
    const actor = {WeaponState: true};
    assert.equal(executeBlueprint(mutation, actor).state.WeaponState, false);
    assert.equal(actor.WeaponState, true);
    assert.throws(() => executeBlueprint({...mutation, steps: [mutation.steps[0], {op: 'nativeCall'}]}, actor), /Unsupported/);
    assert.equal(actor.WeaponState, true);
});
test('original comparison and Boolean math do not coerce their arguments', () => {
    const evaluate = (name, values) => executeBlueprint({...program, output_fields: [], steps: [
        {op: 'return', value: {op: 'math', name, args: values.map(value => ({op: 'constant', value}))}}
    ]}).value;
    assert.equal(evaluate('Greater_DoubleDouble', [0, 0]), false);
    assert.equal(evaluate('Greater_DoubleDouble', [0.001, 0]), true);
    assert.equal(evaluate('GreaterEqual_DoubleDouble', [25, 25]), true);
    assert.equal(evaluate('EqualEqual_ByteByte', [1, 2]), false);
    assert.equal(evaluate('BooleanAND', [true, false]), false);
    assert.throws(() => evaluate('BooleanAND', [1, true]), /Invalid native math/);
    assert.throws(() => evaluate('Greater_DoubleDouble', ['1', 0]), /Invalid native math/);
    assert.throws(() => evaluate('Divide_DoubleDouble', [1, 0]), /Unsupported native math/);
});
test('conditional jumps take the original false branch and keep output defaults', () => {
    const conditional = {schema_version: 1, status: 'translated_control_flow', output_fields: ['Result'],
        input_fields: ['Condition'], field_types: {local: {Condition: 'BoolProperty', Result: 'NameProperty'}},
        steps: [
            {op: 'branch', value: {op: 'get', scope: 'local', field: 'Condition'}, target: 2},
            {op: 'set', field: 'Result', value: {op: 'constant', value: 'Holster_Back_R'}},
            {op: 'return', value: {op: 'get', scope: 'local', field: 'Result'}}
        ]};
    assert.equal(executeBlueprint(conditional, {}, {Condition: true}).value, 'Holster_Back_R');
    assert.equal(executeBlueprint(conditional, {}, {Condition: false}).value, 'None');
    assert.throws(() => executeBlueprint(conditional), /Missing Blueprint input/);
    assert.throws(() => executeBlueprint(conditional, {}, {Condition: 1}), /BoolProperty/);
});
test('invalid jump destinations and loops stop without mutating caller state', () => {
    const flow = {schema_version: 1, status: 'translated_control_flow', output_fields: [], steps: [{op: 'jump', target: 0}]};
    assert.throws(() => executeBlueprint(flow), /budget exceeded/);
    flow.steps[0].target = 1;
    assert.throws(() => executeBlueprint(flow), /Invalid Blueprint jump target/);
    flow.steps = [{op: 'end'}];
    assert.throws(() => executeBlueprint(flow), /without return/);
});
