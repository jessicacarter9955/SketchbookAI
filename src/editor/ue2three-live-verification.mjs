// Explicit QA fixtures act on the actual player input hook and are restored.
// They are not gameplay rules or permanent changes to source defaults.
export async function verifyLiveBlueprintInputs(player, runtime, fixture) {
    const snapshot = runtime.snapshot(), results = [];
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
                movementDistance = player.position.distanceTo(position);
                if (!Number.isFinite(movementDistance) || movementDistance < 0.05) throw new Error('Player did not move during permitted source sprint');
            }
            player.triggerAction(action, false);
            await new Promise(requestAnimationFrame);
        }
        if (!results.length) throw new Error('No applicable live source fixtures');
        return {schema_version: 1, checked: results.length, status: 'passed', movement_distance: movementDistance, results,
                scope: 'Original sprint/jump prerequisites applied to the real scene input; excludes complete Mover, timers, stamina consumption and replication'};
    } finally {
        runtime.restore(snapshot);
        for (const [action, pressed] of Object.entries(priorActions)) player.triggerAction(action, pressed);
    }
}
