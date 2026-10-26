import test from 'node:test';
import assert from 'node:assert/strict';
import {executeBlueprint} from '../src/editor/ue2three-blueprint.mjs';

const literal = (type,value) => ({op:'typed_literal',schema:{type},value});
const native = (name,types,result,args,library='KismetTextLibrary') => ({op:'native_call',
    identity:['/Script/Engine',library,name],parameter_types:types,return_type:result,args});
const toText = value => native('Conv_StringToText',['StrProperty'],'TextProperty',[value]);
const toString = value => native('Conv_TextToString',['TextProperty'],'StrProperty',[value]);
const run = value => executeBlueprint({schema_version:1,status:'translated_straight_line',input_fields:[],
    output_fields:[],steps:[{op:'return',value}]}).value;

test('original Kismet text conversions preserve Unicode and invariant flags including empty text', () => {
    for (const text of ['', 'Original 😀', 'Inventory_Rifle']) {
        const value = toText(literal('StrProperty',text));
        assert.deepEqual(run(value),{history:text === '' ? 'empty' : 'invariant',text,flags:2});
        assert.equal(run(toString(value)),text);
    }
    assert.equal(run(native('Conv_NameToText',['NameProperty'],'TextProperty',[
        literal('NameProperty','Rifle_Reload')])).text,'Rifle_Reload');
});

test('nested source native calls preserve ABI and reject spoofed module, schema and return types', () => {
    const concat=native('Concat_StrStr',['StrProperty','StrProperty'],'StrProperty',[
        literal('StrProperty','Original '),literal('StrProperty','Title')],'KismetStringLibrary');
    assert.equal(run(toText(concat)).text,'Original Title');
    assert.throws(()=>run(toText(toText(literal('StrProperty','X')))),/parameter type differs/);
    assert.throws(()=>run({...toText(literal('StrProperty','X')),identity:['/Script/Engine','Foreign','Conv_StringToText']}),/Unsupported original/);
    assert.throws(()=>run(toString(literal('TextProperty',{history:'invariant',flags:0,text:'X'}))),/FText/);
    assert.throws(()=>run(toString(literal('StrProperty','X'))),/parameter type differs/);
});

test('invariant text is copied into typed local storage and returned without inventing localization', () => {
    const schema={type:'TextProperty',default:{history:'empty',text:'',flags:0}};
    const program={schema_version:1,status:'translated_straight_line',input_fields:[],output_fields:['Title'],
        field_types:{local:{Title:'TextProperty'}},schemas:{local:{Title:schema}},steps:[
            {op:'set',scope:'local',field:'Title',value:toText(literal('StrProperty','Original'))},
            {op:'return',value:toString({op:'get',scope:'local',field:'Title'})}]};
    const result=executeBlueprint(program);
    assert.equal(result.value,'Original');
    assert.deepEqual(result.outputs.Title,{history:'invariant',text:'Original',flags:2});
});
