// Explicit QA fixtures act on the actual player input hook and are restored.
// They are not gameplay rules or permanent changes to source defaults.
export async function verifyLiveBlueprintInputs(player, runtime, fixture) {
    const snapshot = runtime.snapshot(), results = [], metricResults = [];
    const guards = runtime.report.character_guards || {};
    const priorActions = Object.fromEntries([...Object.keys(guards), 'up'].map(action => [action, !!player.actions[action]?.isPressed]));
    let movementDistance = null;
    try {
        for (const test of fixture.cases) {
            const matching = Object.entries(guards).find(([, guard]) => guard.package === test.package && guard.function === test.function);
            if (!matching) continue;
            const [action, guard] = matching;
            const program = runtime.report.packages[guard.package].functions[guard.function];
            if (program.source_bytecode_sha256 !== test.source_bytecode_sha256) throw new Error('Live fixture source differs from program');
            runtime.restore(snapshot); Object.assign(runtime.states[guard.package], test.self);
            player.triggerAction(action, false);
            const expected = test.outputs[guard.output];
            if (typeof expected !== 'boolean') throw new Error('Live fixture lacks a Boolean expected output');
            player.triggerAction(action, true);
            const actual = !!player.actions[action]?.isPressed;
            if (actual !== expected) throw new Error(`Live input differs from source: ${action}`);
            results.push({action, source_function: guard.function, allowed: actual, expected, trace: runtime.last.trace});
            if (action === 'run' && expected && movementDistance === null) {
                const position = player.position.clone();
                player.triggerAction('up', true);
                for (let frame = 0; frame < 30; frame++) await new Promise(requestAnimationFrame);
                player.triggerAction('up', false);
                // Vertical falling/jumping must not count as successful walking.
                movementDistance = Math.hypot(player.position.x - position.x, player.position.z - position.z);
                if (!Number.isFinite(movementDistance) || movementDistance < 0.05) throw new Error('Player did not move during permitted source sprint');
            }
            player.triggerAction(action, false);
            await new Promise(requestAnimationFrame);
        }
        if (!results.length) throw new Error('No applicable live source fixtures');
        for (const test of fixture.cases) {
            const metric = (runtime.report.character_metrics || []).find(metric => metric.package === test.package && metric.function === test.function);
            if (!metric) continue;
            const program = runtime.report.packages[metric.package].functions[metric.function];
            if (program.source_bytecode_sha256 !== test.source_bytecode_sha256) throw new Error('Metric source differs from fixture');
            runtime.restore(snapshot); Object.assign(runtime.states[metric.package], test.self);
            const actual = runtime.readMetrics().find(result => result.function === metric.function).value;
            if (actual !== test.outputs[metric.output]) throw new Error('Original runtime metric differs from source fixture');
            metricResults.push({source_function: metric.function, value: actual, expected: test.outputs[metric.output]});
        }
        return {schema_version: 1, project: runtime.report.project, programs_content_sha256: runtime.report.content_sha256,
                checked: results.length, metrics_checked: metricResults.length, status: 'passed', movement_distance: movementDistance,
                movement_axis: 'horizontal_xz', results, metric_results: metricResults,
                scope: 'Original sprint/jump prerequisites applied to the real scene input; excludes complete Mover, timers, stamina consumption and replication'};
    } finally {
        runtime.restore(snapshot);
        for (const [action, pressed] of Object.entries(priorActions)) player.triggerAction(action, pressed);
    }
}
