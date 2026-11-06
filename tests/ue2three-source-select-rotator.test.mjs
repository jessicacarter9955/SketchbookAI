import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateNativeMath as math} from '../src/editor/ue2three-native-math.mjs';
test('source BP_DemoRoom SelectRotator chooses A for true and B for false',()=>{
 const a={Pitch:0,Yaw:90,Roll:90},b={Pitch:0,Yaw:-90,Roll:90};
 assert.deepEqual(math('SelectRotator',[a,b,true]),a);
 assert.deepEqual(math('SelectRotator',[a,b,false]),b);
 const selected=math('SelectRotator',[a,b,true]);
 selected.Yaw=1; assert.equal(a.Yaw,90);
});
test('SelectRotator retains source winding and negative zero',()=>{
 const a={Pitch:-0,Yaw:720,Roll:-450},b={Pitch:0,Yaw:0,Roll:0};
 const out=math('SelectRotator',[a,b,true]);
 assert.ok(Object.is(out.Pitch,-0));assert.equal(out.Yaw,720);assert.equal(out.Roll,-450);
});
test('SelectRotator rejects non-source signatures and malformed rotations',()=>{
 const a={Pitch:0,Yaw:0,Roll:0};
 for(const args of [[],[a,a],[a,a,1],[a,a,'true'],[a,{X:0,Y:0,Z:0},true],[a,{...a,Yaw:Infinity},false]])
  assert.throws(()=>math('SelectRotator',args),/Invalid native/);
});
