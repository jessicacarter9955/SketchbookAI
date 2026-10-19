import test from 'node:test';
import assert from 'node:assert/strict';
import {verifySourceCases} from '../src/editor/ue2three-source-verification.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

function source() {
    const program={schema_version:1,status:'translated_straight_line',source_bytecode_sha256:'bytecode',source_export_index:3,source_owner_index:2,
        self_reads:['Count'],self_writes:['Count'],input_fields:['Value'],output_fields:[],
        field_types:{self:{Count:'IntProperty'},local:{Value:'IntProperty'}},schemas:{},steps:[
            {op:'set',scope:'self',field:'Count',value:{op:'get',scope:'local',field:'Value'}},
            {op:'evaluate',value:{op:'mark_dirty',field:'Count',source_rep_index:7}},
            {op:'return',value:{op:'constant',value:null}}]};
    const report={schema_version:1,content_sha256:'current',project:'Original.uproject',packages:{'/Game/Original':{
        functions:{Write:program},event_programs:{Entry:{source_bytecode_sha256:'event'}},source:{source_sha256:'original'},default_state:{Count:0}}},
        type_sources:{'/Game/Type':{source_sha256:'type'}}};
    const fixture={cases:[{package:'/Game/Original',function:'Write',source_bytecode_sha256:'bytecode',self:{Count:0},inputs:{Value:2},outputs:{},
        state:{Count:2},effects:[{op:'mark_dirty',field:'Count',source_rep_index:7}],runtime:'inventory',dependencies:{Entry:'event'},types:{'/Game/Type':'type'}}]};
    return {report,fixture};
}

test('portable source verifier compares state and ordered effects without granting visual acceptance',()=>{
    const {report,fixture}=source(),before=structuredClone(fixture),proof=verifySourceCases(report,fixture);
    assert.equal(proof.source_cases,1);assert.equal(proof.inventory_checked,1);assert.match(proof.scope,/excludes browser/);
    assert.equal(proof.programs_content_sha256,'current');assert.equal(proof.evidence[0].source_cases[0].resulting_state.Count,2);
    assert.deepEqual(fixture,before);assert.equal(report.packages['/Game/Original'].default_state.Count,0);assert.equal(proof.screenshot_sha256,undefined);
});

test('portable source verifier rejects stale bytecode, events, types and altered expectations',()=>{
    for(const corrupt of [f=>f.source_bytecode_sha256='stale',f=>f.dependencies.Entry='stale',f=>f.types['/Game/Type']='stale',
        f=>f.state.Count=true,f=>f.effects=[],f=>f.outputs={Unexpected:1}]){
        const {report,fixture}=source();corrupt(fixture.cases[0]);assert.throws(()=>verifySourceCases(report,fixture),/Source case 1/);
    }
});

test('portable source verifier requires original shared-state and table witnesses',()=>{
    const {report,fixture}=source();fixture.cases[0].base_state='original';
    fixture.shared_states={original:{package:'/Game/Original',source_sha256:'original',state:{Count:0}}};
    assert.equal(verifySourceCases(report,fixture).source_cases,1);
    fixture.shared_states.original.source_sha256='different';assert.throws(()=>verifySourceCases(report,fixture),/original source package/);
    delete fixture.cases[0].base_state;fixture.cases[0].tables={'/Game/Table':'table'};
    assert.throws(()=>verifySourceCases(report,fixture),/fixture table differs/);
    assert.throws(()=>verifySourceCases(report,{cases:[]}),/bounded source cases/);
    delete fixture.cases[0].tables;delete fixture.cases[0].state;delete fixture.cases[0].effects;
    assert.throws(()=>verifySourceCases(report,fixture),/independent expected/);
});

test('object and related-state fixtures require explicit source bindings and dependency witnesses',()=>{
    for(const corrupt of [
        f=>f.fixture_objects={Count:{kind:'actor',package:'/Game/Original',source_sha256:'original'}},
        f=>f.query_states={'/Game/Other':{package:'/Game/Other',self:{Count:7}}},
        f=>f.query_dependencies={'/Game/Other':{Read:'stale'}}]) {
        const {report,fixture}=source();corrupt(fixture.cases[0]);
        assert.throws(()=>verifySourceCases(report,fixture),/Fixture|fixture/);
    }
});

test('verification command writes only outside source project and preserves its input files',async t=>{
    const folder=await fs.mkdtemp(path.join(os.tmpdir(),'ue2three-source-qa-'));
    t.after(()=>fs.rm(folder,{recursive:true,force:true}));
    const project=path.join(folder,'original','Original.uproject'),programs=path.join(folder,'programs.json'),fixtures=path.join(folder,'cases.json');
    await fs.mkdir(path.dirname(project));await fs.writeFile(project,'{}');
    const data=source();data.report.project=project;
    const originalText=JSON.stringify(data.report);await fs.writeFile(programs,originalText);await fs.writeFile(fixtures,JSON.stringify(data.fixture));
    const command=fileURLToPath(new URL('../tools/ue2three/verify-blueprints.mjs',import.meta.url)),args=[command,'--programs',programs,'--fixtures',fixtures];
    assert.throws(()=>execFileSync(process.execPath,[...args,'--output',programs],{stdio:'pipe'}),/must not overwrite an input/);
    assert.throws(()=>execFileSync(process.execPath,[...args,'--output',path.join(path.dirname(project),'proof.json')],{stdio:'pipe'}),/outside the original Unreal project/);
    assert.match(execFileSync(process.execPath,args,{encoding:'utf8'}),/PASS/);
    const proof=JSON.parse(await fs.readFile(path.join(folder,'blueprint-offline-verification.json'),'utf8'));
    assert.equal(proof.source_cases,1);assert.equal(proof.fixture_sha256.length,64);assert.equal(await fs.readFile(programs,'utf8'),originalText);
});
