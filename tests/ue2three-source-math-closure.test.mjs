import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {executeBlueprint} from '../src/editor/ue2three-blueprint.mjs';
import {evaluateNativeMath as math} from '../src/editor/ue2three-native-math.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/dds-cbp_fixers_mover_abp-math-chain.json',import.meta.url),'utf8'));
test('original strafe-warp function executes BreakVector, Abs, MapRangeClamped, float32 cast and VLerp',()=>{
 const p=fixture.functions.Get_StrafeWarpDirection;
 const state={...p.source_defaults,Trj_CurrentAngularVelocity:{X:0,Y:0,Z:60},
  LastNonZeroVelocity:{X:10,Y:20,Z:30},Trj_NearFutureVelocity:{X:30,Y:40,Z:50}};
 const result=executeBlueprint(p,state);
 assert.deepEqual(result.outputs.ReturnValue,{X:20,Y:30,Z:40});
 assert.equal(p.source_bytecode_sha256,'959258fb8f0fd4a61faa238a235596c688ebc95471cc2f5456f25426281f61c2');
});
test('original VLerp retains witnessed float32 alpha and extrapolates without clamping',()=>{
 const a={X:0,Y:1,Z:2},b={X:10,Y:11,Z:12};
 assert.deepEqual(math('VLerp',[a,b,2]),{X:20,Y:21,Z:22});
 assert.equal(math('VLerp',[a,b,0.1]).X,10*Math.fround(0.1));
 for(const args of [[],[a,b,true],[a,b,Infinity],[a,b,1e39],[a,{...b,Z:NaN},0.5]])
  assert.throws(()=>math('VLerp',args),/Invalid native/);
});
