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
