import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {supercarParkingSlots} from '../src/editor/urban-supercar-slots.mjs';
import {PHOTO_SUPERCARS} from '../src/editor/urban-supercars.mjs';

const file=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('Urban Photoreal produces three well separated Sketchfab supercar parking spaces near player',()=>{
    for (const blocks of [2,4,6]) {
        const config={blocksX:blocks,blocksZ:blocks,blockSize:42,roadWidth:10,sidewalkWidth:3.5};
        const spawn=[0,2,0];
        const cars=supercarParkingSlots(config,spawn,[[12,2,6]]);
        assert.equal(cars.length,3,'expected three parking spots for '+blocks+'x'+blocks);
        for(const p of cars) {
            assert.ok(Math.hypot(p.x-spawn[0],p.z-spawn[2])>=6);
            assert.ok(Math.hypot(p.x-spawn[0],p.z-spawn[2])<=38);
            assert.ok(Math.hypot(p.x-12,p.z-6)>5.3,'must not collide with existing car');
            assert.ok(Number.isFinite(p.heading));
        }
        for(let i=0;i<cars.length;i++)for(let j=i+1;j<cars.length;j++)
            assert.ok(Math.hypot(cars[i].x-cars[j].x,cars[i].z-cars[j].z)>6);
    }
});
test('Urban Photoreal supercar names and real Sketchfab IDs retain source attribution',()=>{
    assert.deepEqual(PHOTO_SUPERCARS.map(x=>x.name),['BMW M4 G82','Ferrari F40','Lamborghini Aventador SV']);
    assert.ok(PHOTO_SUPERCARS.every(x=>x.uid.length===32&&x.source.includes('sketchfab.com')&&x.license==='CC BY'));
    const boot=file('src/editor/start.js');
    assert.match(boot,/installPhotorealSupercars\(world,sceneEditor/);
    assert.match(boot,/scene=urban-photoreal|urban-photoreal/);
    const actor=file('src/editor/ActorLayer.js');
    assert.match(actor,/actor\.userData\.importedCar=item\.assetId/);
    assert.match(actor,/actor = new Car\(/);
    assert.match(actor,/actor\.wheels\.forEach/);
});
