import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretWorldCommand} from '../src/editor/world-commands.mjs';

test('Italian rain command triggers visual rain',()=>{
 const result=interpretWorldCommand('Fai piovere!');
 assert.equal(result.type,'rain');
 assert.equal(result.enabled,true);
 assert.equal(result.intensity,1);
});
test('Italian heavy and light rain variants',()=>{
 assert.equal(interpretWorldCommand('pioggia intensa').intensity,1.7);
 assert.equal(interpretWorldCommand('pioggia leggera').intensity,.55);
});
test('English commands start and stop rain',()=>{
 assert.equal(interpretWorldCommand('make it rain').enabled,true);
 assert.equal(interpretWorldCommand('stop rain').enabled,false);
});
test('Italian stop does not accidentally start rain',()=>{
 assert.equal(interpretWorldCommand('smetti di piovere').enabled,false);
 assert.equal(interpretWorldCommand('ferma la pioggia').enabled,false);
});
test('Other prompts never silently claim to work',()=>{
 assert.equal(interpretWorldCommand('add a castle').type,'unsupported');
 assert.equal(interpretWorldCommand('').type,'help');
});
