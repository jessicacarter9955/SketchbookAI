// Shared source-state fixtures avoid repeating complete inventories per case.
import { SourceActorBindings } from './ue2three-objects.mjs';
export function blueprintFixtureActors(report) {
    const bindings = new SourceActorBindings(report);
    if (report.character_source) bindings.bind(report.character_source.package, {fixture:'explicit standalone source actor'});
    return bindings;
}
export function blueprintFixtureState(fixture, test, report) {
    for (const [name, hash] of Object.entries(test.tables || {}))
        if (report.table_sources?.[name]?.source_sha256 !== hash) throw new Error('Source fixture table differs from source');
    if (!test.base_state) return structuredClone(test.self || {});
    const base = Object.hasOwn(fixture.shared_states || {}, test.base_state) ? fixture.shared_states[test.base_state] : null;
    if (!base || base.package !== test.package || report.packages?.[base.package]?.source?.source_sha256 !== base.source_sha256)
        throw new Error('Shared fixture state differs from its original source package');
    for (const [name, hash] of Object.entries(base.types || {}))
        if (report.type_sources?.[name]?.source_sha256 !== hash) throw new Error('Shared fixture type differs from source');
    return {...structuredClone(base.state), ...structuredClone(test.self || {})};
}

// Explicit DATA-only object fixtures. These never register spawned actors in
// the game runtime and must not be used as scene/lifecycle acceptance evidence.
export function blueprintFixtureEnvironment(fixture,test,report,actors) {
    const self=blueprintFixtureState(fixture,test,report), native=actors.context(test.package);
    const bindings=Object.entries(test.fixture_objects || {});
    if (bindings.length>64 || bindings.length && !native) throw new Error('Fixture object binding requires a bounded original actor context');
    for (const [field,binding] of bindings) {
        if (['__proto__','constructor','prototype'].includes(field)) throw new Error('Invalid fixture object field');
        const schema=report.packages[test.package]?.functions[test.function]?.schemas?.self?.[field];
        const data=report.packages[binding.package],meta=data?.class_metadata;
        if (!schema || !data || typeof binding.source_sha256!=='string' || !binding.source_sha256 || data.source?.source_sha256!==binding.source_sha256
            || JSON.stringify(schema.class)!==JSON.stringify([binding.package,meta?.object])) throw new Error('Fixture object source class differs');
        if (binding.kind==='component' && schema.reference_kind==='runtime_component') {
            self[field]=actors.componentReference(binding.package);
        } else if (binding.kind==='actor' && schema.reference_kind==='runtime_actor'
            && meta.native_base?.[0]==='/Script/Engine' && ['Actor','Pawn','Character'].includes(meta.native_base[1])
            && meta.force_net_update_override===false) {
            const id='fixture-actor-'+Object.keys(native.actors).length;
            const reference={realm:native.realm,actor_id:id,declared_class:['/Script/Engine','Actor']};
            native.actors[id]={reference,source_class:binding.package,class_object:meta.object,
                native_base:meta.native_base,force_net_update_override:false};
            self[field]=reference;
        } else throw new Error('Unsupported explicit fixture object kind');
    }
    const overrides=test.query_states || {};
    if (Object.keys(overrides).some(name=>!actors.components.has(name))) throw new Error('Fixture query state belongs to an unbound component');
    for (const [name,functions] of Object.entries(test.query_dependencies || {}))
        for (const [method,hash] of Object.entries(functions))
            if (report.packages[name]?.functions?.[method]?.source_bytecode_sha256!==hash) throw new Error('Fixture component query dependency differs');
    const requireQueries=value=>{
        if (!value || typeof value!=='object') return;
        if (value.op==='component_query' && test.query_dependencies?.[value.package]?.[value.function]
            !== report.packages[value.package]?.functions?.[value.function]?.source_bytecode_sha256)
            throw new Error('Fixture lacks an original component query witness');
        for (const child of Object.values(value)) requireQueries(child);
    };
    requireQueries(report.packages[test.package]?.functions?.[test.function]?.steps);
    const queries=Object.fromEntries([...actors.components].map(([name,component])=>{
        const data=report.packages[name],sample=overrides[name];
        if (sample && (sample.package!==name || typeof sample.source_sha256!=='string' || !sample.source_sha256
            || sample.source_sha256!==data.source.source_sha256)) throw new Error('Fixture query state source differs');
        const state=sample ? blueprintFixtureState(fixture,sample,report) : structuredClone(data.default_state);
        const context=actors.context(name);
        if (native) context.actors=structuredClone(native.actors);
        return [name,{state,source_sha256:component.source.source_sha256,functions:{...data.functions,...data.event_programs},
            signatures:data.delegate_signatures,native:context}];
    }));
    return {self,native,queries};
}

export const blueprintFixtureEqual = (a, b) => a === b || a !== null && b !== null && typeof a === 'object' && typeof b === 'object'
    && Array.isArray(a) === Array.isArray(b) && Object.keys(a).length === Object.keys(b).length
    && Object.keys(a).every(key => Object.hasOwn(b, key) && blueprintFixtureEqual(a[key], b[key]));

export function blueprintFixtureMembers(outputs, expected) {
    const actual = {};
    for (const [output, members] of Object.entries(expected || {})) {
        if (!Object.hasOwn(outputs, output) || !outputs[output] || typeof outputs[output] !== 'object') throw new Error('Missing source output structure');
        actual[output] = {};
        for (const [member, value] of Object.entries(members)) {
            if (['__proto__', 'constructor', 'prototype'].includes(member) || !Object.hasOwn(outputs[output], member)
                || !blueprintFixtureEqual(outputs[output][member], value)) throw new Error('Source output member differs: ' + output + '.' + member);
            actual[output][member] = structuredClone(outputs[output][member]);
        }
    }
    return actual;
}
