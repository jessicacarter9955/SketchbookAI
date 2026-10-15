import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSanAndreasNodeFile,buildSanAndreasNetwork} from '../src/editor/sa-paths.mjs';
function sample(){
  const buf=new ArrayBuffer(20+3*28+2*4+768+4),v=new DataView(buf);let o=0;
  const u8=x=>{v.setUint8(o++,x);},i16=x=>{v.setInt16(o,x,true);o+=2;},
    u16=x=>{v.setUint16(o,x,true);o+=2;},u32=x=>{v.setUint32(o,x,true);o+=4;};
  [3,1,2,0,2].forEach(u32);
  const n=(id,x,base,linkCount)=>{
    u32(0);u32(0);i16(x*8);i16(0);i16(0);i16(0x7ffe);
    u16(base);u16(0);u16(id);u8(16);u8(0);u32(linkCount);
  };
  n(0,0,0,0);n(1,10,0,1);n(2,20,1,1);
  u16(0);u16(2);u16(0);u16(1);o+=768;
  u8(80);u8(80);u8(0);u8(1);
  return buf;
}
test('San Andreas sector parser reads original node positions and types',()=>{
  const d=parseSanAndreasNodeFile(sample(),0);
  assert.deepEqual(d.counts,{cars:1,peds:2,navs:0,links:2});
  assert.equal(d.nodes[1].x,10);
  assert.equal(d.nodes[1].pathWidth,2);
  assert.equal(d.nodes[0].kind,'vehicle');
});
test('cross-linked GTA pedestrian nodes form a connected network',()=>{
  const d=buildSanAndreasNetwork([parseSanAndreasNodeFile(sample(),0)]);
  assert.equal(d.nodes.length,2);
  assert.equal(d.byKey.get('0:1').edges[0].to,'0:2');
  assert.equal(d.byKey.get('0:2').edges[0].to,'0:1');
});
test('malformed binary sectors reject truncated or inconsistent data',()=>{
  assert.throws(()=>parseSanAndreasNodeFile(new ArrayBuffer(5),0),/truncated header/);
  const v=sample();new DataView(v).setUint32(4,400,true);
  assert.throws(()=>parseSanAndreasNodeFile(v,0),/count mismatch/);
});
