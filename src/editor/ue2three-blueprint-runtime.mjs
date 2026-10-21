import { executeBlueprint } from './ue2three-blueprint.mjs';
import { SourceActorBindings } from './ue2three-objects.mjs';

export class BlueprintActorRuntime {
    constructor(report, project) {
        if (report?.schema_version !== 1 || report.project !== project) throw new Error('Blueprint project does not match the character');
        this.report = report;
        this.states = Object.create(null);
        this.frames = Object.create(null);
        this.bindings = Object.create(null);
        this.notifications = [];
        this.dirty = Object.create(null);
        this.actorBindings = new SourceActorBindings(report);
        this.nativeRequests = [];
        this.nextBindingId = 1;
        for (const [name, data] of Object.entries(report.packages)) this.states[name] = structuredClone(data.default_state || {});
        this.last = null;
        this.guardCache = new Map();
        this.metricCache = new Map();
    }
    call(packageName, functionName, inputs = {}) {
        const data = this.report.packages[packageName], program = data?.functions[functionName];
        if (!program || !Object.hasOwn(this.states, packageName)) throw new Error(`Untranslated source function: ${functionName}`);
        const result = executeBlueprint(program, this.states[packageName], inputs,
            {functions: {...data.functions, ...data.event_programs}, frames: this.frames[packageName] || {}, tables: this.report.tables || {},
                bindings: this.bindings[packageName] || {}, signatures: data.delegate_signatures || {}, native:this.actorBindings.context(packageName)});
        this.states[packageName] = result.state;
        this.frames[packageName] = result.frames;
        for (const effect of result.effects) {
            if (effect.op === 'mark_dirty') {
                this.dirty[packageName] ||= Object.create(null);
                this.dirty[packageName][effect.field] = effect.source_rep_index;
            } else if (effect.op === 'broadcast') this.notifications.push({package: packageName, ...structuredClone(effect)});
            else if (effect.op === 'force_net_update') this.nativeRequests.push({package:packageName,...structuredClone(effect)});
        }
        if (this.notifications.length > 1000) this.notifications.splice(0, this.notifications.length-1000);
        if (this.nativeRequests.length > 1000) this.nativeRequests.splice(0, this.nativeRequests.length-1000);
        return result;
    }
    bindSourceActor(sourceClass, target) {
        const wasBound = !!this.actorBindings.root;
        const binding = this.actorBindings.bind(sourceClass,target);
        if (!wasBound) for (const [packageName, component] of this.actorBindings.components)
            Object.assign(this.states[packageName], structuredClone(component.source_overrides));
        this.guardCache.clear(); this.metricCache.clear();
        return binding;
    }
    // Same-instance translated source handlers only. World/UI construction and
    // cross-object delegate wiring require their original object adapters.
    subscribe(packageName, delegate, functionName) {
        const data = this.report.packages[packageName], signature = data?.delegate_signatures?.[delegate], program = data?.functions?.[functionName];
        if (!signature || !program || !Array.isArray(program.parameters) || program.parameters.length !== signature.parameters.length
            || program.parameters.some((param, index) => !param.schema || JSON.stringify(param.schema) !== JSON.stringify(signature.parameters[index].schema)))
            throw new Error('Untranslated or incompatible original delegate handler');
        const id = this.nextBindingId++;
        this.bindings[packageName] ||= Object.create(null);
        (this.bindings[packageName][delegate] ||= []).push({id, function: functionName, export_index: program.source_export_index});
        return () => {
            const list = this.bindings[packageName]?.[delegate];
            if (list) this.bindings[packageName][delegate] = list.filter(binding => binding.id !== id);
        };
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
            // One source function can expose multiple numeric outputs; cache each output independently.
            const cacheId = JSON.stringify([metric.package, metric.function, metric.output]);
            const cached = this.metricCache.get(cacheId);
            const value = cached?.key === key ? cached.value : this.call(metric.package, metric.function).outputs[metric.output];
            if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Original metric did not return a finite number');
            this.metricCache.set(cacheId, {key, value});
            return {...metric, value, current_value: state[metric.current], maximum_value: state[metric.maximum]};
        });
    }
    snapshot() { return structuredClone({states: this.states, frames: this.frames, bindings: this.bindings, notifications: this.notifications, dirty: this.dirty, nativeRequests:this.nativeRequests, nextBindingId: this.nextBindingId}); }
    checkpointIdentity() {
        // Browser-owned checkpoint identity; this is NOT Unreal's SaveGame format.
        const packages = Object.fromEntries(Object.keys(this.report.packages).sort().map(name =>
            [name, this.report.packages[name].source?.source_sha256 ?? null]));
        const root = this.actorBindings.root;
        return {
            project: this.report.project,
            packages,
            actor: root ? {source_class:root.source_class, scs_sha256:this.actorBindings.graph.scs_sha256} : null
        };
    }
    exportCheckpoint() {
        return structuredClone({format:'ue2three-browser-checkpoint',version:1,
            identity:this.checkpointIdentity(), snapshot:this.snapshot()});
    }
    restoreCheckpoint(checkpoint) {
        if (!checkpoint || checkpoint.format !== 'ue2three-browser-checkpoint' || checkpoint.version !== 1
            || JSON.stringify(checkpoint.identity) !== JSON.stringify(this.checkpointIdentity()))
            throw new Error('Checkpoint belongs to a different Unreal source, actor binding, or format');
        const state = checkpoint.snapshot, packages = Object.keys(this.report.packages).sort();
        const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
        if (!object(state) || !object(state.states) || !object(state.frames) || !object(state.bindings)
            || !object(state.dirty) || !Array.isArray(state.notifications) || !Array.isArray(state.nativeRequests)
            || state.notifications.length > 1000 || state.nativeRequests.length > 1000
            || !Number.isSafeInteger(state.nextBindingId) || state.nextBindingId < 1
            || JSON.stringify(Object.keys(state.states).sort()) !== JSON.stringify(packages)
            || Object.entries(state.states).some(([name, data]) => !object(data)
                || Object.keys(this.report.packages[name].default_state || {}).some(field => !Object.hasOwn(data,field)))
            || Object.values(state.bindings).some(value => !object(value) ||
                Object.values(value).some(list => !Array.isArray(list) || list.length > 1000 ||
                    list.some(entry => !object(entry) || !Number.isSafeInteger(entry.id) || entry.id < 1))))
            throw new Error('Malformed or incomplete translated Blueprint checkpoint');
        // Validate before mutating runtime; restore clears derived guard/metric caches.
        this.restore(structuredClone(state));
        return true;
    }
    restore(snapshot) {
        this.states = structuredClone(snapshot.states); this.frames = structuredClone(snapshot.frames);
        this.bindings = structuredClone(snapshot.bindings || {}); this.notifications = structuredClone(snapshot.notifications || []); this.dirty = structuredClone(snapshot.dirty || {});
        this.nativeRequests = structuredClone(snapshot.nativeRequests || []);
        // A snapshot may be loaded into a fresh runtime, whose counter starts at 1.
        // Never reuse an ID held by a restored listener or one already issued here.
        const restoredIds = Object.values(this.bindings).flatMap(delegates =>
            Object.values(delegates || {}).flatMap(list =>
                Array.isArray(list) ? list.map(binding => binding.id) : []));
        const maxRestoredId = restoredIds.reduce((max, id) =>
            Number.isSafeInteger(id) && id > max ? id : max, 0);
        const savedNextId = Number.isSafeInteger(snapshot.nextBindingId) && snapshot.nextBindingId > 0
            ? snapshot.nextBindingId : 1;
        this.nextBindingId = Math.max(this.nextBindingId, savedNextId, maxRestoredId + 1);
        this.guardCache.clear(); this.metricCache.clear(); this.last = null;
    }
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
                if (player.actions[action]?.isPressed) {
                    let allowed = false;
                    try { allowed = runtime.checkAction(action); onResult(runtime.last); }
                    catch (error) { onResult({action, allowed: false, error: error.message}); }
                    if (!allowed) original.call(player, action, false);
                }
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
    // A source project can expose callable functions and HUD metrics without
    // declaring movement guards. Keep those translated programs accessible.
    const hasGuards = Object.keys(report.character_guards || {}).length > 0;
    const hasMetrics = Array.isArray(report.character_metrics) && report.character_metrics.length > 0;
    const hasFunctions = Object.values(report.packages || {}).some(data =>
        Object.keys(data?.functions || {}).length > 0);
    if (!hasGuards && !hasMetrics && !hasFunctions) return null;
    return new BlueprintActorRuntime(report, project);
}
