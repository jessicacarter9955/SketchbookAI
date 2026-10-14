import test from 'node:test';
import assert from 'node:assert/strict';
import { BlueprintActorRuntime, bindBlueprintInputs, loadBlueprintActorRuntime } from '../src/editor/ue2three-blueprint-runtime.mjs';

function fixture() {
    const predicate = {schema_version: 1, status: 'translated_straight_line', input_fields: [], output_fields: ['Allowed'],
        self_reads: ['Stamina'], self_writes: [], field_types: {self: {Stamina: 'DoubleProperty'}, local: {Allowed: 'BoolProperty'}},
        steps: [{op: 'set', field: 'Allowed', boolean: true, value: {op: 'math', name: 'Greater_DoubleDouble', args: [
            {op: 'get', scope: 'self', field: 'Stamina'}, {op: 'constant', value: 10}]}},
            {op: 'return', value: {op: 'constant', value: null}}]};
    const report = {schema_version: 1, project: 'Source.uproject', packages: {'/Game/Vitals': {default_state: {Stamina: 100}, functions: {CanSprint: predicate}}},
        character_guards: {run: {package: '/Game/Vitals', function: 'CanSprint', output: 'Allowed'}}};
    const runtime = new BlueprintActorRuntime(report, report.project);
    const player = {actions: {run: {isPressed: false}}, triggerAction(name, pressed) { this.actions[name].isPressed = pressed; }};
    return {report, runtime, player};
}
test('source prerequisite actually controls player input and releases held sprint', () => {
    const {runtime, player} = fixture();
    const original = player.triggerAction, binding = bindBlueprintInputs(player, runtime);
    assert.equal(player.triggerAction('run', true), true); assert.equal(player.actions.run.isPressed, true);
    runtime.states['/Game/Vitals'].Stamina = 0;
    binding.enforceHeld(); assert.equal(player.actions.run.isPressed, false);
    assert.equal(player.triggerAction('run', true), false);
    runtime.states['/Game/Vitals'].Stamina = 100;
    assert.equal(player.triggerAction('run', true), true);
    binding.dispose(); assert.equal(player.triggerAction, original);
});
test('runtime rejects another source project and invalid map paths', async () => {
    const {report} = fixture();
    assert.throws(() => new BlueprintActorRuntime(report, 'Other.uproject'), /does not match/);
    await assert.rejects(loadBlueprintActorRuntime('../outside.glb', report.project), /Invalid migrated/);
});
test('failed source predicate denies the input; state snapshots restore exactly', () => {
    const {runtime, player} = fixture();
    const snapshot = runtime.snapshot(); bindBlueprintInputs(player, runtime);
    runtime.states['/Game/Vitals'].Stamina = 'invalid';
    assert.equal(player.triggerAction('run', true), false);
    runtime.restore(snapshot); assert.equal(runtime.states['/Game/Vitals'].Stamina, 100);
    assert.equal(player.triggerAction('run', true), true);
});

test('source metric getters use actor state and invalidate cached values', () => {
    const {report, runtime} = fixture();
    report.packages['/Game/Vitals'].functions.Ratio = {schema_version: 1, status: 'translated_straight_line',
        input_fields: [], output_fields: [], self_reads: ['Stamina'], self_writes: [],
        steps: [{op: 'return', value: {op: 'math', name: 'Divide_DoubleDouble', args: [
            {op: 'get', scope: 'self', field: 'Stamina'}, {op: 'constant', value: 100}]}}]};
    // Test fixture returns a named ratio just as the original percent functions do.
    const program = report.packages['/Game/Vitals'].functions.Ratio;
    program.output_fields = ['Ratio'];
    program.steps.unshift({op: 'set', field: 'Ratio', value: program.steps[0].value});
    report.character_metrics = [{package: '/Game/Vitals', function: 'Ratio', output: 'Ratio', current: 'Stamina'}];
    assert.equal(runtime.readMetrics()[0].value, 1);
    runtime.states['/Game/Vitals'].Stamina = 25;
    assert.equal(runtime.readMetrics()[0].value, 0.25);
    const snapshot = runtime.snapshot(); runtime.states['/Game/Vitals'].Stamina = 0;
    runtime.restore(snapshot); assert.equal(runtime.readMetrics()[0].value, 0.25);
});
