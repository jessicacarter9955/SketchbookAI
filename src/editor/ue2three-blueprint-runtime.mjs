import { executeBlueprint } from './ue2three-blueprint.mjs';

export class BlueprintActorRuntime {
    constructor(report, project) {
        if (report?.schema_version !== 1 || report.project !== project) throw new Error('Blueprint project does not match the character');
        this.report = report;
        this.states = Object.create(null);
        this.frames = Object.create(null);
        for (const [name, data] of Object.entries(report.packages)) this.states[name] = structuredClone(data.default_state || {});
        this.last = null;
        this.guardCache = new Map();
        this.metricCache = new Map();
    }
    call(packageName, functionName, inputs = {}) {
        const data = this.report.packages[packageName], program = data?.functions[functionName];
        if (!program || !Object.hasOwn(this.states, packageName)) throw new Error(`Untranslated source function: ${functionName}`);
        const result = executeBlueprint(program, this.states[packageName], inputs,
            {functions: {...data.functions, ...data.event_programs}, frames: this.frames[packageName] || {}, tables: this.report.tables || {}});
        this.states[packageName] = result.state;
        this.frames[packageName] = result.frames;
        return result;
    }
    checkAction(action) {
        const guard = this.report.character_guards?.[action];
        if (!guard) return true;
        const program = this.report.packages[guard.package]?.functions[guard.function];
        const key = JSON.stringify(program.self_reads.map(field => this.states[guard.package][field]));
        const cached = this.guardCache.get(action);
        if (cached?.key === key) { this.last = cached.result; return this.last.allowed; }
        const result = this.call(guard.package, guard.function);
        const allowed = result.outputs[guard.output];
        if (typeof allowed !== 'boolean') throw new Error('Original input prerequisite did not return Boolean');
        this.last = {action, allowed, source: guard.function, trace: result.trace};
        this.guardCache.set(action, {key, result: this.last});
        return allowed;
    }
    readMetrics() {
        return (this.report.character_metrics || []).map(metric => {
            const program = this.report.packages[metric.package].functions[metric.function];
            const state = this.states[metric.package];
            const key = JSON.stringify(program.self_reads.map(field => state[field]));
            const cacheId = JSON.stringify([metric.package, metric.function]);
            const cached = this.metricCache.get(cacheId);
            const value = cached?.key === key ? cached.value : this.call(metric.package, metric.function).outputs[metric.output];
            if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Original metric did not return a finite number');
            this.metricCache.set(cacheId, {key, value});
            return {...metric, value, current_value: state[metric.current], maximum_value: state[metric.maximum]};
        });
    }
    snapshot() { return {states: structuredClone(this.states), frames: structuredClone(this.frames)}; }
    restore(snapshot) { this.states = structuredClone(snapshot.states); this.frames = structuredClone(snapshot.frames); this.guardCache.clear(); this.metricCache.clear(); this.last = null; }
}

export function bindBlueprintInputs(player, runtime, onResult = () => {}) {
    const original = player.triggerAction;
    const wrapped = function(action, pressed) {
        if (pressed && runtime.report.character_guards?.[action]) {
            let allowed = false;
            try { allowed = runtime.checkAction(action); onResult(runtime.last); }
            catch (error) { onResult({action, allowed: false, error: error.message}); }
            if (!allowed) { original.call(this, action, false); return false; }
        }
        original.call(this, action, pressed);
        return true;
    };
    player.triggerAction = wrapped;
    return {
        enforceHeld() {
            for (const action of Object.keys(runtime.report.character_guards || {}))
                if (player.actions[action]?.isPressed) wrapped.call(player, action, true);
        },
        dispose() { if (player.triggerAction === wrapped) player.triggerAction = original; }
    };
}

export async function loadBlueprintActorRuntime(mapPath, project, fetchImpl = fetch) {
    if (!mapPath) return null;
    const match = /^build\/local-scenes\/ue2three\/projects\/([A-Za-z0-9_-]+)\/maps\/[A-Za-z0-9_.-]+\.glb$/.exec(mapPath);
    if (!match) throw new Error('Invalid migrated map path for Blueprint runtime');
    const url = `build/local-scenes/ue2three/projects/${match[1]}/blueprint-programs.json`;
    const response = await fetchImpl(url, {cache: 'no-store'});
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Source Blueprint programs could not be loaded');
    const report = await response.json();
    if (!Object.keys(report.character_guards || {}).length) return null;
    return new BlueprintActorRuntime(report, project);
}
