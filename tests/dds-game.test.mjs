import test from 'node:test';
import assert from 'node:assert/strict';
import {DdsGameState,WEAPONS} from '../src/editor/dds-game-state.mjs';
test('ammo, fire cadence, reload timing and switching cannot duplicate rounds',()=>{
    const s=new DdsGameState(); assert.ok(s.fire()); assert.equal(s.ammo.rifle.magazine,29); assert.equal(s.fire(),null);
    assert.ok(s.reload()); s.tick(1); assert.equal(s.fire(),null); assert.equal(s.ammo.rifle.magazine,29);
    s.equip('pistol'); s.tick(10); assert.equal(s.ammo.rifle.magazine,29); assert.equal(s.ammo.pistol.reserve,48);
    s.equip('rifle'); s.reload(); s.tick(WEAPONS.rifle.reload); assert.deepEqual(s.ammo.rifle,{magazine:30,reserve:89});
    s.ammo.rifle.magazine=0; s.ammo.rifle.reserve=3; assert.equal(s.fire(),null); s.reload();s.tick(3);assert.deepEqual(s.ammo.rifle,{magazine:3,reserve:0});
    assert.equal(s.equip('unknown'),false); s.equip(null);assert.equal(s.reload(),false);
});
test('loot is collected once, health is bounded and extraction requires both objectives',()=>{
    const s=new DdsGameState(); assert.equal(s.extract(),false); assert.ok(s.collect('supplies')); assert.equal(s.collect('supplies'),false);
    assert.ok(s.collect('case')); assert.equal(s.extract(),false); for(let i=0;i<3;i++)s.hitTarget(i,100);
    s.damage(70); assert.ok(s.heal());assert.equal(s.health,80); assert.equal(s.medkits,2);
    assert.ok(s.extract()); assert.equal(s.fire(),null);assert.equal(s.extract(),false);
    const dead=new DdsGameState();dead.damage(100);assert.equal(dead.heal(),false);assert.equal(dead.fire(),null);
});
test('saved inventory survives reload while transient timers reset; corrupt saves are sanitized',()=>{
    const s=new DdsGameState();s.fire();s.collect('case');s.hitTarget(1,34);s.reload();
    const restored=new DdsGameState(JSON.parse(JSON.stringify(s.snapshot())));assert.deepEqual(restored.snapshot(),s.snapshot());assert.equal(restored.reloadRemaining,0);
    const invalid=new DdsGameState({version:1,health:999,owned:['bogus','rifle','rifle'],ammo:{rifle:{magazine:-5,reserve:Infinity}},targets:[NaN,999,-1]});
    assert.equal(invalid.health,100);assert.deepEqual(invalid.owned,['rifle']);assert.deepEqual(invalid.targets,[100,100,0]);assert.deepEqual(invalid.ammo.rifle,{magazine:0,reserve:90});
});
test('shop checks currency and carrying limits before changing inventory',()=>{
    const s=new DdsGameState();assert.ok(s.buy('rifle-ammo').ok);assert.equal(s.credits,190);assert.equal(s.ammo.rifle.reserve,150);
    const before=JSON.stringify(s.snapshot());assert.equal(s.buy('unknown').ok,false);assert.equal(JSON.stringify(s.snapshot()),before);
    s.credits=0;assert.equal(s.buy('medkit').ok,false);s.credits=1000;s.medkits=10;assert.equal(s.buy('medkit').ok,false);assert.equal(s.credits,1000);
    s.ammo.rifle.reserve=998;assert.equal(s.buy('rifle-ammo').ok,false);assert.equal(s.ammo.rifle.reserve,998);
    s.npcHealth.merchant=0;assert.equal(new DdsGameState(s.snapshot()).npcHealth.merchant,0);
    const ended=new DdsGameState();ended.health=0;assert.equal(ended.buy('medkit').ok,false);assert.equal(ended.credits,250);
});
