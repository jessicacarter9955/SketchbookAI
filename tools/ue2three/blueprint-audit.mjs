import { executeBlueprint } from '/src/editor/ue2three-blueprint.mjs';
const status = document.querySelector('#status');
document.querySelector('#function-filter')?.addEventListener('input', event => {
    const term = event.target.value.toLowerCase();
    for (const row of document.querySelector('#results').rows) row.hidden = !row.cells[0].textContent.toLowerCase().includes(term);
});
try {
    const path = new URLSearchParams(location.search).get('programs');
    if (!path || !/^build\/local-scenes\/ue2three\/projects\/[A-Za-z0-9_-]+\/blueprint-programs\.json$/.test(path))
        throw new Error('Percorso programmi non valido');
    const response = await fetch('/' + path, {cache: 'no-store'});
    if (!response.ok) throw new Error('Programmi Blueprint non disponibili');
    const report = await response.json();
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
                    if (program.field_types?.self?.[name] === 'StructProperty') {
                        if (!Object.hasOwn(program.source_defaults || {}, name)) throw new Error(`Default struct sorgente assente: ${name}`);
                        self[name] = structuredClone(program.source_defaults[name]);
                    } else if (['NameProperty', 'StrProperty'].includes(program.field_types?.self?.[name])) self[name] = sample ? 'Fixture_' + sample : 'None';
                    else self[name] = boolean || program.field_types?.self?.[name] === 'BoolProperty' ? !!(sample % 2) : sample;
                }
                for (const name of program.input_fields || []) inputs[name] = program.field_types?.local?.[name] === 'BoolProperty' ? !!(sample % 2)
                    : ['NameProperty', 'StrProperty'].includes(program.field_types?.local?.[name]) ? sample ? 'Fixture_' + sample : 'None' : 1;
                const result = executeBlueprint(program, self, inputs, {functions: packageData.functions});
                // Independently check each translated source assignment against
                // the provided fixture or literal; this does not emulate native calls.
                for (const executed of result.trace.filter(step => step.op === 'set')) {
                    const step = program.steps.find(step => step.source_index === executed.source_index);
                    if (step.value.op === 'get' && step.value.scope !== 'self') continue;
                    if (step.value.op === 'math' || step.value.op === 'call' || step.value.op === 'member') continue;
                    const expected = step.value.op === 'get' ? self[step.value.field] : step.value.value;
                    const actual = executed.value;
                    if ((step.scope === 'self' || program.output_fields.includes(step.field)) && JSON.stringify(actual) !== JSON.stringify(expected))
                        throw new Error(`Output differente: ${program.name}.${step.field}`);
                }
                outputs.push({self, inputs, result}); scenarios++;
            }
            const row = document.createElement('tr');
            for (const text of [program.name, '🟢 PASS · 3 scenari', JSON.stringify(outputs.at(-1).result.outputs)]) {
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
            const result = executeBlueprint(program, test.self, test.inputs, {functions: report.packages[test.package].functions});
            for (const [field, expected] of Object.entries(test.outputs))
                if (JSON.stringify(result.outputs[field]) !== JSON.stringify(expected)) throw new Error(`Confronto sorgente fallito: ${test.function}.${field}`);
            rowsByFunction.get(JSON.stringify([test.package, test.function])).samples.push({inputs: test.inputs, state: test.self, outputs: result.outputs, expected: test.outputs});
            golden++;
        }
    }
    for (const {row, samples} of rowsByFunction.values()) {
        if (!samples.length) continue;
        row.children[1].textContent = `🟢 PASS · 3 generici · ${samples.length} confronti`;
        const details = document.createElement('details'), summary = document.createElement('summary'), pre = document.createElement('pre');
        summary.textContent = `${samples.length} casi sorgenti verificati`;
        pre.textContent = JSON.stringify(samples, null, 2); pre.style.cssText = 'max-height:260px;overflow:auto';
        details.append(summary, pre); row.children[2].append(details);
    }
    for (const entry of evidence) entry.source_cases = rowsByFunction.get(JSON.stringify([entry.package, entry.function])).samples;
    status.textContent = `PASS: ${passed} funzioni sorgenti eseguite (${report.counts.no_op_functions || 0} vuote nel sorgente), ${scenarios} scenari generici e ${golden} confronti sorgenti specifici. ${report.counts.blocked || 0} funzioni bloccate; ${report.counts.declarations || 0} sole dichiarazioni; ${report.missing_cached_packages.length} pacchetti senza bytecode in cache. Questo non verifica il gioco completo.`;
    status.className = 'pass';
    const reasons = Object.entries(report.packages).flatMap(([name, data]) => data.blocked.map(row => ({package: name, ...row})));
    document.querySelector('#blocked').textContent = JSON.stringify({project: report.project, programs_content_sha256: report.content_sha256,
        status: 'passed', fingerprint: report.fingerprint, golden_source_cases: golden, reasons, missing_cached_packages: report.missing_cached_packages, evidence}, null, 2);
} catch (error) {
    status.textContent = 'FAIL: ' + error.message; status.className = 'fail';
}
