// Shared source-state fixtures avoid repeating complete inventories per case.
export function blueprintFixtureState(fixture, test, report) {
    if (!test.base_state) return structuredClone(test.self || {});
    const base = Object.hasOwn(fixture.shared_states || {}, test.base_state) ? fixture.shared_states[test.base_state] : null;
    if (!base || base.package !== test.package || report.packages?.[base.package]?.source?.source_sha256 !== base.source_sha256)
        throw new Error('Shared fixture state differs from its original source package');
    for (const [name, hash] of Object.entries(base.types || {}))
        if (report.type_sources?.[name]?.source_sha256 !== hash) throw new Error('Shared fixture type differs from source');
    return {...structuredClone(base.state), ...structuredClone(test.self || {})};
}
