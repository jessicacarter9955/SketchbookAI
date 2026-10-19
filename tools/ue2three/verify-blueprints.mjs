import fs from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {verifySourceCases} from '../../src/editor/ue2three-source-verification.mjs';

const {values} = parseArgs({options:{programs:{type:'string'},fixtures:{type:'string'},output:{type:'string'}}});
if (!values.programs || !values.fixtures) throw new Error('Specify --programs and --fixtures for the selected source project');
async function canonical(file) {
    try { return await fs.realpath(file); }
    catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return path.join(await canonical(path.dirname(file)),path.basename(file));
    }
}
const [programs, fixtures] = await Promise.all([fs.realpath(path.resolve(values.programs)),fs.realpath(path.resolve(values.fixtures))]);
const output = await canonical(path.resolve(values.output || path.join(path.dirname(programs),'blueprint-offline-verification.json')));
if ([programs, fixtures].some(input => input.toLowerCase() === output.toLowerCase())) throw new Error('Verification output must not overwrite an input');
const [programText, fixtureText] = await Promise.all([fs.readFile(programs,'utf8'),fs.readFile(fixtures,'utf8')]);
const report = JSON.parse(programText), sourceRoot = await canonical(path.dirname(path.resolve(report.project)));
const relative = path.relative(sourceRoot,output);
if (relative === '' || !relative.startsWith('..'+path.sep) && relative !== '..' && !path.isAbsolute(relative))
    throw new Error('Verification output must remain outside the original Unreal project');
const proof = verifySourceCases(report,JSON.parse(fixtureText));
proof.fixture_sha256 = createHash('sha256').update(fixtureText).digest('hex');
proof.program_file_sha256 = createHash('sha256').update(programText).digest('hex');
await fs.mkdir(path.dirname(output),{recursive:true});
await fs.writeFile(output,JSON.stringify(proof,null,2)+'\n','utf8');
console.log(`PASS · ${proof.source_cases} source cases · ${proof.inventory_checked} inventory cases · visual verification excluded`);
