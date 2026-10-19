// Reusable data comparisons, independent of browser rendering and source project.
import {executeBlueprint} from './ue2three-blueprint.mjs';
import {blueprintFixtureState, blueprintFixtureMembers, blueprintFixtureEqual, blueprintFixtureActors} from './ue2three-fixtures.mjs';

export function verifySourceCases(report, fixture) {
    if (report?.schema_version !== 1 || typeof report.content_sha256 !== 'string' || !report.content_sha256 || typeof report.project !== 'string' || !report.packages
        || !Array.isArray(fixture?.cases) || !fixture.cases.length || fixture.cases.length > 100000)
        throw new Error('Original programs and bounded source cases are required');
    const actors = blueprintFixtureActors(report), evidence = new Map();
    let checked = 0, inventory = 0;
    for (const sample of fixture.cases) {
        try {
            const data = report.packages[sample.package], program = data?.functions?.[sample.function];
            if (!program || typeof program.source_bytecode_sha256 !== 'string' || !program.source_bytecode_sha256 || program.source_bytecode_sha256 !== sample.source_bytecode_sha256)
                throw new Error('Source bytecode differs');
            if (!Object.keys(sample.outputs || {}).length && !Object.keys(sample.state || {}).length
                && !Object.keys(sample.output_members || {}).length && !Object.hasOwn(sample,'effects'))
                throw new Error('An independent expected output, state, member or effect list is required');
            const library = {...data.functions, ...data.event_programs};
            for (const [name, hash] of Object.entries(sample.dependencies || {}))
                if (library[name]?.source_bytecode_sha256 !== hash) throw new Error('Source dependency differs: '+name);
            for (const [name, hash] of Object.entries(sample.types || {}))
                if (report.type_sources?.[name]?.source_sha256 !== hash) throw new Error('Source type differs: '+name);
            const result = executeBlueprint(program, blueprintFixtureState(fixture, sample, report), sample.inputs,
                {functions:library, tables:report.tables, signatures:data.delegate_signatures, native:actors.context(sample.package)});
            for (const [key, expected] of Object.entries(sample.outputs || {}))
                if (!blueprintFixtureEqual(result.outputs[key], expected)) throw new Error('Source output differs: '+key);
            for (const [key, expected] of Object.entries(sample.state || {}))
                if (!blueprintFixtureEqual(result.state[key], expected)) throw new Error('Source state differs: '+key);
            if (sample.effects && !blueprintFixtureEqual(result.effects, sample.effects)) throw new Error('Source ordered effects differ');
            const members = blueprintFixtureMembers(result.outputs, sample.output_members);
            const key = JSON.stringify([sample.package, sample.function]);
            if (!evidence.has(key)) evidence.set(key, {package:sample.package, function:sample.function,
                source_bytecode_sha256:program.source_bytecode_sha256, source_cases:[]});
            evidence.get(key).source_cases.push({runtime:sample.runtime, inputs:sample.inputs, outputs:result.outputs, expected:sample.outputs || {},
                ...(sample.state ? {resulting_state:result.state, expected_state:sample.state} : {}),
                ...(sample.effects ? {effects:result.effects, expected_effects:sample.effects} : {}),
                ...(sample.output_members ? {actual_members:members, expected_members:sample.output_members} : {})});
            checked++; if (sample.runtime === 'inventory') inventory++;
        } catch (error) { throw new Error(`Source case ${checked+1} · ${sample.function}: ${error.message}`, {cause:error}); }
    }
    return {schema_version:1,status:'passed',project:report.project,programs_content_sha256:report.content_sha256,
        scope:'Offline source data comparisons only; excludes browser, scene, network and visual acceptance',
        source_cases:checked,inventory_checked:inventory,evidence:[...evidence.values()]};
}
