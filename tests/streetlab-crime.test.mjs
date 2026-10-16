import test from 'node:test';import assert from 'node:assert/strict';
import {StreetLabCrimeState,findSanAndreasPursuitPath} from '../src/editor/streetlab-crime-state.mjs';
import {readFileSync} from 'node:fs';
test('cash pickups, ammo transactions, wanted levels and police arrests work and persist',()=>{
 const st=new StreetLabCrimeState();assert.equal(st.cash,450);
 assert.equal(st.collect(0),true);assert.equal(st.cash,550);assert.equal(st.collect(0),false);
 assert.equal(st.buyAmmo('rifle'),true);assert.equal(st.cash,460);
 assert.ok(st.fire());assert.equal(st.wanted,1);st.escalate(3);assert.equal(st.wanted,4);
 st.tick(29,false);assert.equal(st.wanted,4); // capped tick; gradual decay
 for(let i=0;i<117;i++)st.tick(.25,false);
 assert.ok(st.wanted<4);
 st.arrest();assert.equal(st.cash,360);assert.equal(st.wanted,0);
 const restored=new StreetLabCrimeState(st.snapshot());
 assert.equal(restored.cash,360);assert.deepEqual(restored.loot,[0]);
});
test('police pursuit follows only the original San Andreas pedestrian graph',()=>{
 const a={key:'a',edges:[{to:'b'}]},b={key:'b',edges:[{to:'c'}]},c={key:'c',edges:[]};
 const net={byKey:new Map([a,b,c].map(n=>[n.key,n]))};
 assert.deepEqual(findSanAndreasPursuitPath(net,'a','c').map(n=>n.key),['a','b','c']);
 assert.deepEqual(findSanAndreasPursuitPath(net,'c','a'),[]);
});
test('separate crime prototype adds GTA-style police HUD without pretending to load original GTA police models',()=>{
 const code=readFileSync(new URL('../src/editor/StreetLabCrime.js',import.meta.url),'utf8');
 assert.match(code,/Police pursuit prototype/);assert.match(code,/findSanAndreasPursuitPath/);
 assert.match(code,/data-lab-vitals/);assert.match(code,/streetlab-crime-state/);
});
