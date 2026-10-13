import { executeBlueprint } from '/src/editor/ue2three-blueprint.mjs';
const status = document.querySelector('#status');
try {
    const path = new URLSearchParams(location.search).get('programs');
    if (!path || !/^build\/local-scenes\/ue2three\/projects\/[A-Za-z0-9_-]+\/blueprint-programs\.json$/.test(path))
        throw new Error('Percorso programmi non valido');
    const response = await fetch('/' + path, {cache: 'no-store'});
    if (!response.ok) throw new Error('Programmi Blueprint non disponibili');
    const report = await response.json();
    let passed = 0, scenarios = 0;
    const evidence = [];
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
                    } else self[name] = boolean || program.field_types?.self?.[name] === 'BoolProperty' ? !!(sample % 2) : sample;
                }
                for (const name of program.input_fields || []) inputs[name] = program.field_types?.local?.[name] === 'BoolProperty' ? !!(sample % 2) : 1;
                const result = executeBlueprint(program, self, inputs);
                // Independently check each translated source assignment against
                // the provided fixture or literal; this does not emulate native calls.
                for (const step of program.steps.filter(step => step.op === 'set')) {
                    if (step.value.op === 'get' && step.value.scope !== 'self') continue;
                    if (step.value.op === 'math') continue;
                    const expected = step.value.op === 'get' ? self[step.value.field] : step.value.value;
                    const actual = step.scope === 'self' ? result.state[step.field] : result.outputs[step.field];
                    if ((step.scope === 'self' || program.output_fields.includes(step.field)) && JSON.stringify(actual) !== JSON.stringify(expected))
                        throw new Error(`Output differente: ${program.name}.${step.field}`);
                }
                // Golden boundary cases for actual DDS source predicates, not
                // substitutes for the game's Vitality/Mover simulation.
                if (program.name === 'IsAlive' && result.outputs['bIsAlive '] !== (self.CurrentHealth > 0)) throw new Error('IsAlive differs from source health predicate');
                if (program.name === 'HasStamina' && result.outputs['bHasStamina '] !== (self.CurrentStamina >= inputs.RequiredAmount)) throw new Error('HasStamina differs from source stamina predicate');
                outputs.push({self, inputs, result}); scenarios++;
            }
            const row = document.createElement('tr');
            for (const text of [program.name, '🟢 PASS · 3 scenari', JSON.stringify(outputs.at(-1).result.outputs)]) {
                const cell = document.createElement('td'); cell.textContent = text; row.append(cell);
            }
            row.children[1].className = 'pass'; document.querySelector('#results').append(row);
            evidence.push({package: packageName, function: program.name, source_bytecode_sha256: program.source_bytecode_sha256, outputs}); passed++;
        }
    }
    status.textContent = `PASS: ${passed} funzioni sorgenti eseguite (${report.counts.no_op_functions || 0} vuote nel sorgente), ${scenarios} scenari. ${report.counts.blocked || 0} funzioni bloccate; ${report.counts.declarations || 0} sole dichiarazioni; ${report.missing_cached_packages.length} pacchetti senza bytecode in cache. Questo non verifica il gioco completo.`;
    status.className = 'pass';
    const reasons = Object.entries(report.packages).flatMap(([name, data]) => data.blocked.map(row => ({package: name, ...row})));
    document.querySelector('#blocked').textContent = JSON.stringify({fingerprint: report.fingerprint, reasons, missing_cached_packages: report.missing_cached_packages, evidence}, null, 2);
} catch (error) {
    status.textContent = 'FAIL: ' + error.message; status.className = 'fail';
}
