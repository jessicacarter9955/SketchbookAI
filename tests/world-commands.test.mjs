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

test('day presets support dawn, sunset, night with moon and midday',()=>{
  for(const [prompt,value] of [['alba','sunrise'],['tramonto','sunset'],['notte','night'],['luna piena','night'],['mezzogiorno','noon']]){
    const result=interpretWorldCommand(prompt);
    assert.equal(result.type,'time',prompt);assert.equal(result.value,value,prompt);
  }
});
test('season intent and seasonal foliage presets',()=>{
  for(const [prompt,value] of [['estate','summer'],['autunno','autumn'],['inverno','winter'],['primavera','spring']]){
    assert.equal(interpretWorldCommand(prompt).value,value,prompt);
  }
});
test('fog can be turned on and off safely',()=>{
  assert.equal(interpretWorldCommand('nebbia').enabled,true);
  assert.equal(interpretWorldCommand('togli la nebbia').enabled,false);
});
test('independent world instructions combine without AI or keys',()=>{
  const result=interpretWorldCommand('tramonto con pioggia e nebbia');
  assert.deepEqual(result.actions.map(a=>a.type),['rain','fog','time']);
  assert.equal(result.actions.find(a=>a.type==='time').value,'sunset');
  assert.equal(interpretWorldCommand('sole a ovest').value,'west');
});

test('snow and blizzard work as free in-city text commands',()=>{
  const snow=interpretWorldCommand('fai nevicare');
  assert.equal(snow.type,'snow');assert.equal(snow.enabled,true);
  const blizzard=interpretWorldCommand('bufera di neve');
  assert.equal(blizzard.actions.find(a=>a.type==='state').value,'blizzard');
  assert.equal(interpretWorldCommand('togli la neve').enabled,false);
});
test('twelve procedural weather presets are routed into the same city command input',()=>{
  for(const [prompt,state] of [['sereno','clear'],['cielo nuvoloso','cloudy'],
    ['temporale','storm'],['tempesta di sabbia','sandstorm'],
    ['aurora boreale','aurora'],['grandine','hail']]){
    const result=interpretWorldCommand(prompt);
    assert.equal(result.actions.find(a=>a.type==='state')?.value,state,prompt);
  }
  assert.equal(interpretWorldCommand('vento forte').actions[0].type,'wind');
});
