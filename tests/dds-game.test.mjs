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

test('shop and saved inventory reject inherited object keys',()=>{
 const s=new DdsGameState({version:1,owned:['__proto__','constructor','toString','rifle'],equipped:'__proto__'});
 assert.deepEqual(s.owned,['rifle']);assert.equal(s.equipped,'rifle');
 const before=s.snapshot();
 for(const id of ['__proto__','constructor','toString']) {
  assert.equal(s.equip(id),false);assert.equal(s.buy(id).ok,false);
  assert.deepEqual(s.snapshot(),before);
 }
});


test('merchant UI eligibility matches atomic purchases for funds, capacity and raid status',()=>{
    const s=new DdsGameState();
    for(const id of ['rifle-ammo','pistol-ammo','medkit'])assert.equal(s.canBuy(id).ok,true);
    const original=s.snapshot();
    for(const id of ['constructor','__proto__','not-in-shop']){
        assert.equal(s.canBuy(id).message,'Articolo non disponibile.');
        assert.equal(s.buy(id).ok,false);
    }
    assert.deepEqual(s.snapshot(),original);
    s.credits=0;
    assert.equal(s.canBuy('medkit').message,'Crediti insufficienti.');
    assert.equal(s.buy('medkit').ok,false);
    s.credits=1000;
    s.medkits=10;
    assert.equal(s.canBuy('medkit').message,'Spazio o capacità insufficienti.');
    assert.equal(s.buy('medkit').ok,false);
    s.medkits=2;
    s.ammo.rifle.reserve=999;
    assert.equal(s.canBuy('rifle-ammo').ok,false);
    s.ammo.rifle.reserve=90;
    s.maxWeight=s.currentWeight+0.01;
    assert.equal(s.canBuy('medkit').ok,false);
    s.maxWeight=18;
    s.medkits=0;
    s.carryCapacity=s.usedSlots;
    assert.equal(s.canBuy('medkit').ok,false);
    const before=s.snapshot();
    assert.equal(s.buy('medkit').ok,false);
    assert.deepEqual(s.snapshot(),before);
    const extracted=new DdsGameState();extracted.extracted=true;
    assert.equal(extracted.canBuy('medkit').message,'Incursione conclusa.');
    const dead=new DdsGameState();dead.health=0;
    assert.equal(dead.canBuy('medkit').ok,false);
    const valid=new DdsGameState();
    const quote=valid.canBuy('medkit');
    assert.equal(quote.ok,true);
    assert.equal(valid.buy('medkit').ok,true);
    assert.equal(valid.credits,205);
    assert.equal(valid.medkits,3);
});

test('case pickup respects weight and slots, and rejected pickups are atomic',()=>{
    const s=new DdsGameState(), before=s.snapshot();
    s.maxWeight=s.currentWeight+1.9;
    assert.equal(s.canCollect('case').ok,false);
    assert.equal(s.collect('case'),false);
    assert.deepEqual(s.snapshot(),before);
    s.maxWeight=18;
    s.carryCapacity=s.usedSlots;
    assert.equal(s.collect('case'),false);
    assert.deepEqual(s.snapshot(),before);
    s.carryCapacity++;
    assert.equal(s.canCollect('case').ok,true);
    assert.equal(s.collect('case'),true);
    assert.equal(s.collect('case'),false);
    assert.equal(s.usedSlots,before.medkits>0?4:3);
});

test('supply pickup refuses overweight and missing stack slots without consuming crate',()=>{
    const s=new DdsGameState(), original=s.snapshot();
    s.maxWeight=s.currentWeight+1;
    assert.equal(s.canCollect('supplies').ok,false);
    assert.equal(s.collect('supplies'),false);
    assert.deepEqual(s.snapshot(),original);
    s.maxWeight=18;
    s.medkits=0;s.ammo.rifle.reserve=0;s.ammo.pistol.reserve=0;
    s.carryCapacity=2;
    const before=s.snapshot();
    assert.equal(s.usedSlots,0);
    assert.equal(s.canCollect('supplies').ok,false);
    assert.equal(s.collect('supplies'),false);
    assert.deepEqual(s.snapshot(),before);
    s.carryCapacity=3;
    assert.equal(s.canCollect('supplies').ok,true);
    assert.equal(s.collect('supplies'),true);
    assert.equal(s.medkits,1);
    assert.equal(s.ammo.rifle.reserve,60);
    assert.equal(s.ammo.pistol.reserve,24);
    assert.equal(s.collect('supplies'),false);
});

test('supply pickup computes only granted amounts near stack caps',()=>{
    const s=new DdsGameState();
    s.medkits=10;s.ammo.rifle.reserve=995;s.ammo.pistol.reserve=999;
    s.maxWeight=s.currentWeight+0.05;
    assert.equal(s.canCollect('supplies').ok,true);
    assert.equal(s.collect('supplies'),true);
    assert.equal(s.ammo.rifle.reserve,999);
    assert.equal(s.ammo.pistol.reserve,999);
    assert.equal(s.medkits,10);
    const full=new DdsGameState();
    full.medkits=10;full.ammo.rifle.reserve=999;full.ammo.pistol.reserve=999;
    assert.equal(full.canCollect('supplies').ok,false);
    const before=full.snapshot();
    assert.equal(full.collect('supplies'),false);
    assert.deepEqual(full.snapshot(),before);
});

test('unknown, dead and extracted pickups do not mutate inventory',()=>{
    for(const state of [new DdsGameState(),new DdsGameState({version:1,health:0}),new DdsGameState({version:1,extracted:true})]){
        const before=state.snapshot();
        for(const kind of ['constructor','__proto__','case','supplies']){
            if(state.health && !state.extracted && ['case','supplies'].includes(kind))continue;
            assert.equal(state.collect(kind),false);
            assert.deepEqual(state.snapshot(),before);
        }
    }
});

test('saved weapon IDs must be primitive strings; invalid equip requests are atomic',()=>{
    const s=new DdsGameState({version:1,owned:[['rifle'],'pistol','rifle',123],equipped:['rifle']});
    assert.deepEqual(s.owned,['pistol','rifle']);
    assert.equal(s.equipped,'pistol');
    const before=s.snapshot();
    assert.equal(s.equip(['rifle']),false);
    assert.equal(s.equip({toString:()=> 'rifle'}),false);
    assert.deepEqual(s.snapshot(),before);
    assert.equal(s.equip('rifle'),true);
});

test('completed and failed raids reject equipment, healing and target mutations',()=>{
    const complete=new DdsGameState();
    complete.damage(40);
    complete.collect('case');
    for(let i=0;i<3;i++)assert.equal(complete.hitTarget(i,100),true);
    assert.equal(complete.extract(),true);
    const snapshot=complete.snapshot();
    assert.equal(complete.heal(),false);
    assert.equal(complete.equip(null),false);
    assert.equal(complete.equip('pistol'),false);
    assert.equal(complete.hitTarget(0,20),false);
    assert.deepEqual(complete.snapshot(),snapshot);

    const failed=new DdsGameState();
    failed.damage(100);
    const deadSnapshot=failed.snapshot();
    assert.equal(failed.equip(null),false);
    assert.equal(failed.heal(),false);
    assert.equal(failed.hitTarget(0,10),false);
    assert.deepEqual(failed.snapshot(),deadSnapshot);
});

test('defeated targets cannot be damaged again',()=>{
    const s=new DdsGameState();
    assert.equal(s.hitTarget(0,100),true);
    assert.equal(s.hitTarget(0,10),false);
    assert.equal(s.targets[0],0);
});


test('completed raids are immune to subsequent damage, including after save reload',()=>{
    const s=new DdsGameState();
    assert.equal(s.collect('case'),true);
    for(let i=0;i<3;i++)assert.equal(s.hitTarget(i,100),true);
    assert.equal(s.extract(),true);
    const before=s.snapshot();
    s.damage(75);
    s.damage(Infinity);
    assert.deepEqual(s.snapshot(),before);
    const restored=new DdsGameState(before);
    restored.damage(100);
    assert.deepEqual(restored.snapshot(),before);
});

test('fatal damage cancels a pending reload and dead players cannot resume it',()=>{
    const s=new DdsGameState();
    assert.ok(s.fire());
    assert.equal(s.reload(),true);
    assert.ok(s.reloadRemaining>0);
    s.damage(100);
    assert.equal(s.health,0);
    assert.equal(s.reloadRemaining,0);
    const ammo=structuredClone(s.ammo);
    s.tick(10);
    assert.deepEqual(s.ammo,ammo);
    s.damage(50);
    assert.equal(s.health,0);
});
