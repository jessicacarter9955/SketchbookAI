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

test('restored Blueprint delegate listeners keep unique subscription IDs in a fresh runtime', () => {
    const {report, runtime} = fixture();
    const data = report.packages['/Game/Vitals'];
    data.delegate_signatures = {OnChanged: {parameters: []}};
    data.functions.OnChanged = {parameters: []};
    runtime.subscribe('/Game/Vitals', 'OnChanged', 'OnChanged');
    const snapshot = runtime.snapshot();
    assert.equal(snapshot.nextBindingId, 2);

    const restored = new BlueprintActorRuntime(report, report.project);
    restored.restore(snapshot);
    const unsubscribe = restored.subscribe('/Game/Vitals', 'OnChanged', 'OnChanged');
    const bindings = restored.bindings['/Game/Vitals'].OnChanged;
    assert.deepEqual(bindings.map(binding => binding.id), [1, 2]);
    unsubscribe();
    assert.deepEqual(restored.bindings['/Game/Vitals'].OnChanged.map(binding => binding.id), [1]);
});

test('legacy Blueprint snapshots and rewinds never reuse an active delegate ID', () => {
    const {report, runtime} = fixture();
    const data = report.packages['/Game/Vitals'];
    data.delegate_signatures = {OnChanged: {parameters: []}};
    data.functions.OnChanged = {parameters: []};
    runtime.subscribe('/Game/Vitals', 'OnChanged', 'OnChanged');
    const legacy = runtime.snapshot();
    delete legacy.nextBindingId;
    const restored = new BlueprintActorRuntime(report, report.project);
    restored.restore(legacy);
    restored.subscribe('/Game/Vitals', 'OnChanged', 'OnChanged');
    assert.deepEqual(restored.bindings['/Game/Vitals'].OnChanged.map(binding => binding.id), [1, 2]);

    const oldSnapshot = restored.snapshot();
    restored.subscribe('/Game/Vitals', 'OnChanged', 'OnChanged'); // ID 3
    restored.restore(oldSnapshot);
    restored.subscribe('/Game/Vitals', 'OnChanged', 'OnChanged'); // ID 4
    assert.deepEqual(restored.bindings['/Game/Vitals'].OnChanged.map(binding => binding.id), [1, 2, 4]);
});


test('metric-only source reports initialize a runtime and expose their original values', async () => {
    const {report} = fixture();
    delete report.character_guards;
    report.packages['/Game/Vitals'].default_state.MaxStamina = 100;
    report.packages['/Game/Vitals'].functions.GetStamina = {
        schema_version: 1, status: 'translated_straight_line', input_fields: [],
        output_fields: ['Value'], self_reads: ['Stamina'], self_writes: [],
        steps: [{op: 'set', field: 'Value', value: {op: 'get', scope: 'self', field: 'Stamina'}},
            {op: 'return', value: {op: 'constant', value: null}}]
    };
    report.character_metrics = [{
        package: '/Game/Vitals', function: 'GetStamina', output: 'Value',
        current: 'Stamina', maximum: 'MaxStamina'
    }];
    const path = 'build/local-scenes/ue2three/projects/dds/maps/Island.glb';
    const runtime = await loadBlueprintActorRuntime(path, report.project, async (url, options) => {
        assert.equal(url, 'build/local-scenes/ue2three/projects/dds/blueprint-programs.json');
        assert.equal(options.cache, 'no-store');
        return {ok: true, status: 200, json: async () => report};
    });
    assert.ok(runtime instanceof BlueprintActorRuntime);
    assert.equal(runtime.readMetrics()[0].value, 100);
    runtime.states['/Game/Vitals'].Stamina = 27.5;
    assert.equal(runtime.readMetrics()[0].value, 27.5);
});

test('callable source programs without movement guards remain available; empty reports do not', async () => {
    const {report} = fixture();
    delete report.character_guards;
    const path = 'build/local-scenes/ue2three/projects/dds/maps/Island.glb';
    const load = payload => loadBlueprintActorRuntime(path, report.project, async () => ({
        ok: true, status: 200, json: async () => payload
    }));
    const runtime = await load(report);
    assert.ok(runtime instanceof BlueprintActorRuntime);
    assert.equal(runtime.call('/Game/Vitals', 'CanSprint').outputs.Allowed, true);
    assert.equal(await load({...report, packages: {'/Game/Vitals': {default_state: {Stamina: 100}, functions: {}}}}), null);
    assert.equal(await loadBlueprintActorRuntime(path, report.project, async () => ({ok: false, status: 404})), null);
});

test('HUD metrics from two outputs of the same source function stay distinct across cached reads', () => {
    const {report, runtime} = fixture();
    const data = report.packages['/Game/Vitals'];
    runtime.states['/Game/Vitals'].MaxStamina = 150;
    data.functions.ReadVitals = {
        schema_version: 1, status: 'translated_straight_line',
        input_fields: [], output_fields: ['Current', 'Maximum'],
        self_reads: ['Stamina', 'MaxStamina'], self_writes: [],
        steps: [
            {op: 'set', field: 'Current', value: {op: 'get', scope: 'self', field: 'Stamina'}},
            {op: 'set', field: 'Maximum', value: {op: 'get', scope: 'self', field: 'MaxStamina'}},
            {op: 'return', value: {op: 'constant', value: null}}
        ]
    };
    report.character_metrics = ['Current', 'Maximum'].map(output => ({
        package: '/Game/Vitals', function: 'ReadVitals', output,
        current: 'Stamina', maximum: 'MaxStamina'
    }));
    assert.deepEqual(runtime.readMetrics().map(metric => metric.value), [100, 150]);
    assert.deepEqual(runtime.readMetrics().map(metric => metric.value), [100, 150]);
    runtime.states['/Game/Vitals'].Stamina = 37.5;
    assert.deepEqual(runtime.readMetrics().map(metric => metric.value), [37.5, 150]);
    runtime.states['/Game/Vitals'].MaxStamina = 175;
    assert.deepEqual(runtime.readMetrics().map(metric => metric.value), [37.5, 175]);
    const saved = runtime.snapshot();
    runtime.states['/Game/Vitals'].Stamina = 0;
    runtime.restore(saved);
    assert.deepEqual(runtime.readMetrics().map(metric => metric.value), [37.5, 175]);
});
