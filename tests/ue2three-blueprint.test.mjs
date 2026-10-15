import test from 'node:test';
import assert from 'node:assert/strict';
import { executeBlueprint } from '../src/editor/ue2three-blueprint.mjs';

test('event calls retain typed per-instance frames and execute the original flow stack', () => {
    const event = {schema_version: 1, status: 'translated_control_flow', source_export_index: 2, source_owner_index: 3,
        input_fields: [], output_fields: [], persistent_types: {'2': {Value: 'BoolProperty'}},
        field_types: {self: {Enabled: 'BoolProperty'}}, steps: [
            {op: 'push_flow', target: 4}, {op: 'jump', target: 2},
            {op: 'set', scope: 'self', field: 'Enabled', value: {op: 'get', scope: 'persistent', frame: 2, field: 'Value'}},
            {op: 'pop_flow'}, {op: 'return', value: {op: 'constant', value: null}}]};
    const wrapper = {schema_version: 1, status: 'translated_straight_line', source_owner_index: 3, output_fields: [],
        input_fields: ['Input'], field_types: {local: {Input: 'BoolProperty'}}, persistent_types: event.persistent_types,
        steps: [{op: 'set', scope: 'persistent', frame: 2, field: 'Value', value: {op: 'get', scope: 'local', field: 'Input'}},
            {op: 'evaluate', value: {op: 'call', function: 'Graph@15', export_index: 2, bindings: []}},
            {op: 'return', value: {op: 'constant', value: null}}]};
    const actor = {Enabled: false}, frames = {};
    const result = executeBlueprint(wrapper, actor, {Input: true}, {functions: {'Graph@15': event}, frames});
    assert.equal(result.state.Enabled, true); assert.equal(result.frames['2'].Value, true);
    assert.deepEqual(actor, {Enabled: false}); assert.deepEqual(frames, {});
    assert.equal(executeBlueprint(event, actor, {}, {frames: result.frames}).state.Enabled, true);
    assert.equal(executeBlueprint(event, actor).state.Enabled, false);
    assert.throws(() => executeBlueprint(wrapper, actor, {Input: 1}, {functions: {'Graph@15': event}, frames}), /BoolProperty/);
    assert.deepEqual(frames, {});
    assert.throws(() => executeBlueprint({...event, steps: [{op: 'pop_flow'}]}, actor), /empty flow stack/);
    const conditional = {...event, steps: [{op: 'push_flow', target: 3},
        {op: 'pop_flow', value: {op: 'constant', value: false}}, {op: 'invalid'}, event.steps[4]]};
    assert.equal(executeBlueprint(conditional, actor).value, null);
    assert.throws(() => executeBlueprint({...conditional, steps: [conditional.steps[0],
        {...conditional.steps[1], value: {op: 'constant', value: 0}}, ...conditional.steps.slice(2)]}, actor), /Boolean/);
});

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
    assert.equal(evaluate('Divide_DoubleDouble', [1, 0]), 0);
    assert.throws(() => evaluate('Divide_IntInt', [1, 0]), /Unsupported native math/);
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
test('nested source calls return out parameters through the original local reference', () => {
    const callee = {schema_version: 1, status: 'translated_straight_line', source_export_index: 2, source_owner_index: 3,
        input_fields: ['Input'], output_fields: ['Allowed'], field_types: {local: {Input: 'BoolProperty', Allowed: 'BoolProperty'}},
        steps: [{op: 'set', field: 'Allowed', value: {op: 'get', scope: 'local', field: 'Input'}},
            {op: 'return', value: {op: 'constant', value: null}}]};
    const caller = {...callee, input_fields: [], output_fields: [], source_export_index: 1,
        field_types: {local: {Result: 'BoolProperty'}}, steps: [
            {op: 'evaluate', value: {op: 'call', function: 'Predicate', export_index: 2, bindings: [
                {mode: 'input', parameter: 'Input', value: {op: 'constant', value: true}},
                {mode: 'output', parameter: 'Allowed', target: {op: 'get', scope: 'local', field: 'Result'}}]}},
            {op: 'return', value: {op: 'get', scope: 'local', field: 'Result'}}]};
    caller.steps[0].source_index = 12;
    const result = executeBlueprint(caller, {}, {}, {functions: {Predicate: callee}});
    assert.equal(result.value, true);
    assert.equal(result.trace[0].source_index, 12);
    assert.throws(() => executeBlueprint(caller), /dependency/);
    assert.throws(() => executeBlueprint(caller, {}, {}, {functions: {Predicate: {...callee, source_owner_index: 4}}}), /dependency/);
});
test('recursive source calls are bounded and cannot leak state after failure', () => {
    const recursive = {schema_version: 1, status: 'translated_straight_line', source_export_index: 1, source_owner_index: 3,
        output_fields: [], steps: [{op: 'evaluate', value: {op: 'call', function: 'Recursive', export_index: 1, bindings: []}}]};
    const state = {Flag: true};
    assert.throws(() => executeBlueprint(recursive, state, {}, {functions: {Recursive: recursive}}), /depth exceeded/);
    assert.equal(state.Flag, true);
});
test('nested source struct reads require existing members and preserve caller data', () => {
    const read = {schema_version: 1, status: 'translated_straight_line', input_fields: ['Data'], output_fields: [],
        field_types: {local: {Data: 'StructProperty'}}, steps: [{op: 'return', value: {op: 'member', field: 'Inner',
            value: {op: 'get', scope: 'local', field: 'Data'}}}]};
    const input = {Data: {Inner: {Quantity: 4}}};
    const result = executeBlueprint(read, {}, input); result.value.Quantity = 1;
    assert.equal(input.Data.Inner.Quantity, 4);
    assert.throws(() => executeBlueprint(read, {}, {Data: {}}), /Missing source struct member/);
    read.steps[0].value.field = '__proto__';
    assert.throws(() => executeBlueprint(read, {}, input), /Unsupported/);
});
