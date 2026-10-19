import { executeBlueprint } from '/src/editor/ue2three-blueprint.mjs';
import { blueprintFixtureState, blueprintFixtureMembers, blueprintFixtureEqual, blueprintFixtureActors } from '/src/editor/ue2three-fixtures.mjs';
const status = document.querySelector('#status');
const applyFilter = () => {
    const term = document.querySelector('#function-filter').value.toLowerCase();
    for (const row of document.querySelector('#results').rows) row.hidden = !row.cells[0].textContent.toLowerCase().includes(term);
};
document.querySelector('#function-filter')?.addEventListener('input', applyFilter);
try {
    const path = new URLSearchParams(location.search).get('programs');
    if (!path || !/^build\/local-scenes\/ue2three\/projects\/[A-Za-z0-9_-]+\/blueprint-programs\.json$/.test(path))
        throw new Error('Percorso programmi non valido');
    const response = await fetch('/' + path, {cache: 'no-store'});
    if (!response.ok) throw new Error('Programmi Blueprint non disponibili');
    const report = await response.json();
    const actors = blueprintFixtureActors(report);
    let passed = 0, scenarios = 0;
    const evidence = [], rowsByFunction = new Map();
    for (const [packageName, packageData] of Object.entries(report.packages)) {
        for (const program of Object.values(packageData.functions)) {
            const outputs = [];
            for (const sample of [0, 1, 2]) {
                const self = Object.create(null);
                const inputs = Object.create(null);
                for (const name of program.self_reads) {
                    const boolean = program.steps.some(step => step.boolean && step.value.op === 'get' && step.value.scope === 'self' && step.value.field === name);
                    if (['StructProperty', 'ArrayProperty', 'ObjectProperty'].includes(program.field_types?.self?.[name])) {
                        if (!Object.hasOwn(program.source_defaults || {}, name)) throw new Error(`Default struct sorgente assente: ${name}`);
                        self[name] = structuredClone(program.source_defaults[name]);
                    } else if (['NameProperty', 'StrProperty'].includes(program.field_types?.self?.[name])) self[name] = sample ? 'Fixture_' + sample : 'None';
                    else self[name] = boolean || program.field_types?.self?.[name] === 'BoolProperty' ? !!(sample % 2) : sample;
                }
                for (const name of program.input_fields || []) inputs[name] = program.field_types?.local?.[name] === 'BoolProperty' ? !!(sample % 2)
                    : program.schemas?.local?.[name] ? structuredClone(program.schemas.local[name].default)
                    : program.field_types?.local?.[name] === 'StructProperty' ? {}
                    : ['NameProperty', 'StrProperty'].includes(program.field_types?.local?.[name]) ? sample ? 'Fixture_' + sample : 'None' : 1;
                const result = executeBlueprint(program, self, inputs, {functions: {...packageData.functions, ...packageData.event_programs}, tables: report.tables || {}, signatures: packageData.delegate_signatures || {}, native:actors.context(packageName)});
                // Independently check each translated source assignment against
                // the provided fixture or literal; this does not emulate native calls.
                for (const executed of result.trace.filter(step => step.op === 'set')) {
                    const step = program.steps.find(step => step.source_index === executed.source_index);
                    if (executed.scope === 'persistent' || step.value.op === 'get' && step.value.scope !== 'self') continue;
                    if (['math', 'call', 'member', 'table_get', 'typed_literal', 'struct_literal', 'array_valid', 'array_mutate', 'array_set', 'array_add', 'array_literal', 'native_get_owner'].includes(step.value.op)) continue;
                    const expected = step.value.op === 'get' ? self[step.value.field] : step.value.value;
                    const actual = executed.value;
                    if ((step.scope === 'self' || program.output_fields.includes(step.field)) && JSON.stringify(actual) !== JSON.stringify(expected))
                        throw new Error(`Output differente: ${program.name}.${step.field}`);
                }
                outputs.push({self, inputs, result: {value: result.value, outputs: result.outputs}}); scenarios++;
            }
            const row = document.createElement('tr');
            const preview = Object.fromEntries(Object.entries(outputs.at(-1).result.outputs).map(([name, value]) => [name,
                value && typeof value === 'object' ? `dati originali · ${Object.keys(value).length} campi` : value]));
            for (const text of [program.name, '🟢 PASS · 3 scenari', JSON.stringify(preview)]) {
                const cell = document.createElement('td'); cell.textContent = text; row.append(cell);
            }
            row.children[1].className = 'pass'; document.querySelector('#results').append(row);
            rowsByFunction.set(JSON.stringify([packageName, program.name]), {row, samples: []});
            evidence.push({package: packageName, function: program.name, source_bytecode_sha256: program.source_bytecode_sha256, outputs}); passed++;
        }
    }
    let golden = 0;
    const fixtureName = new URLSearchParams(location.search).get('fixtures');
    if (fixtureName) {
        if (!/^[A-Za-z0-9_-]+\.json$/.test(fixtureName)) throw new Error('Nome fixture non valido');
        const fixtureResponse = await fetch('/tests/fixtures/' + fixtureName, {cache: 'no-store'});
        if (!fixtureResponse.ok) throw new Error('Fixture di confronto assente');
        const fixture = await fixtureResponse.json();
        for (const test of fixture.cases) {
            const program = report.packages[test.package]?.functions[test.function];
            if (!program || program.source_bytecode_sha256 !== test.source_bytecode_sha256) throw new Error(`Fixture sorgente non aggiornata: ${test.function}`);
            const library = {...report.packages[test.package].functions, ...report.packages[test.package].event_programs};
            for (const [name, hash] of Object.entries(test.dependencies || {}))
                if (library[name]?.source_bytecode_sha256 !== hash) throw new Error(`Dipendenza sorgente non aggiornata: ${name}`);
            for (const [name, hash] of Object.entries(test.types || {}))
                if (report.type_sources?.[name]?.source_sha256 !== hash) throw new Error(`Tipo sorgente non aggiornato: ${name}`);
            const self = blueprintFixtureState(fixture, test, report);
            const result = executeBlueprint(program, self, test.inputs, {functions: {...report.packages[test.package].functions, ...report.packages[test.package].event_programs}, tables: report.tables || {}, signatures: report.packages[test.package].delegate_signatures || {}, native:actors.context(test.package)});
            for (const [field, expected] of Object.entries(test.outputs))
                if (JSON.stringify(result.outputs[field]) !== JSON.stringify(expected)) throw new Error(`Confronto sorgente fallito: ${test.function}.${field}`);
            for (const [field, expected] of Object.entries(test.state || {}))
                if (JSON.stringify(result.state[field]) !== JSON.stringify(expected)) throw new Error(`Stato sorgente differente: ${test.function}.${field}`);
            if (test.effects && !blueprintFixtureEqual(result.effects, test.effects)) throw new Error(`Notifiche sorgenti differenti: ${test.function}`);
            const actualMembers = blueprintFixtureMembers(result.outputs, test.output_members);
            rowsByFunction.get(JSON.stringify([test.package, test.function])).samples.push({inputs: test.inputs, state: test.self,
                ...(test.source_note ? {source_note: test.source_note} : {}),
                base_state: test.base_state, outputs: result.outputs, expected: test.outputs,
                actual_members: actualMembers, expected_members: test.output_members || {},
                ...(test.effects ? {effects: result.effects, expected_effects: test.effects} : {}),
                resulting_state: test.state ? result.state : undefined, expected_state: test.state || {}, trace: test.state ? result.trace : undefined});
            golden++;
        }
    }
    for (const {row, samples} of rowsByFunction.values()) {
        if (!samples.length) continue;
        row.children[1].textContent = `🟢 PASS · 3 generici · ${samples.length} confronti`;
        const brief = value => Array.isArray(value) ? `Array · ${value.length} elementi`
            : value && typeof value === 'object' ? `Struttura · ${Object.keys(value).length} campi` : JSON.stringify(value);
        row.children[2].textContent = 'Primo confronto sorgente: ' + Object.entries(samples[0].outputs).map(([name, value]) => name+' = '+brief(value)).join(' · ');
        const details = document.createElement('details'), summary = document.createElement('summary'), pre = document.createElement('pre');
        summary.textContent = `${samples.length} casi sorgenti verificati`;
        pre.textContent = JSON.stringify(samples.map(sample => ({...(sample.source_note ? {source_note: sample.source_note} : {}), inputs: sample.inputs, outputs: sample.outputs, expected: sample.expected,
            ...(Object.keys(sample.expected_members).length ? {actual_members: sample.actual_members, expected_members: sample.expected_members} : {}),
            ...(Object.keys(sample.expected_state).length ? {resulting_state: sample.resulting_state, expected_state: sample.expected_state} : {}),
            ...(sample.effects ? {effects: sample.effects, expected_effects: sample.expected_effects} : {}),
            base_state: sample.base_state, state: sample.state, ...(sample.trace ? {trace: sample.trace} : {})})), null, 2); pre.style.cssText = 'max-height:260px;overflow:auto';
        details.append(summary);
        const sample = samples.find(sample => Object.keys(sample.expected_state).length || Object.keys(sample.expected_members).length);
        if (sample) {
            const table = document.createElement('table'), head = document.createElement('tr');
            for (const text of ['Campo', 'Prima', 'Risultato', 'Sorgente attesa']) {
                const cell = document.createElement('th'); cell.textContent = text; head.append(cell);
            }
            table.append(head);
            const add = (name, before, actual, expected) => {
                const tr = document.createElement('tr');
                for (const text of [name, before === undefined ? '—' : brief(before), brief(actual), brief(expected)]) {
                    const cell = document.createElement('td'); cell.textContent = text; tr.append(cell);
                }
                table.append(tr);
            };
            for (const [name, expected] of Object.entries(sample.expected_state))
                add(name, sample.state?.[name], sample.resulting_state[name], expected);
            for (const [output, members] of Object.entries(sample.expected_members))
                for (const [name, expected] of Object.entries(members))
                    add(output+'.'+name.replace(/_\d+_[A-F0-9]+$/, ''), undefined, sample.actual_members[output][name], expected);
            details.append(table);
        }
        details.append(pre); row.children[2].append(details);
    }
    for (const entry of evidence) entry.source_cases = rowsByFunction.get(JSON.stringify([entry.package, entry.function])).samples;
    status.textContent = `PASS: ${passed} funzioni sorgenti eseguite (${report.counts.no_op_functions || 0} vuote; ${report.counts.empty_event_functions || 0} callback senza effetti di gioco), ${scenarios} scenari generici e ${golden} confronti sorgenti specifici. ${report.counts.blocked || 0} funzioni bloccate; ${report.counts.declarations || 0} sole dichiarazioni; ${report.missing_cached_packages.length} pacchetti senza bytecode in cache. Questo non verifica il gioco completo.`;
    status.className = 'pass';
    applyFilter();
    const reasons = Object.entries(report.packages).flatMap(([name, data]) => data.blocked.map(row => ({package: name, ...row})));
    document.querySelector('#blocked').textContent = JSON.stringify({project: report.project, programs_content_sha256: report.content_sha256,
        status: 'passed', fingerprint: report.fingerprint, golden_source_cases: golden, reasons, missing_cached_packages: report.missing_cached_packages, evidence}, null, 2);
} catch (error) {
    status.textContent = 'FAIL: ' + error.message; status.className = 'fail';
}
