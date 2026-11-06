import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateNativeMath as math} from '../src/editor/ue2three-native-math.mjs';
const ident={X:0,Y:0,Z:0,W:1};
const trans=(translation,scale={X:1,Y:1,Z:1},rotation=ident)=>({
    Rotation:{...rotation},Translation:{...translation},Scale3D:{...scale},
});
const v=(X,Y,Z)=>({X,Y,Z});
test('original Kismet Conv_IntToBool accepts only int32 and applies nonzero semantics',()=>{
    for(const input of [-2147483648,-2,-1,1,2,2147483647]) assert.equal(math('Conv_IntToBool',[input]),true);
    assert.equal(math('Conv_IntToBool',[0]),false);
    for(const args of [[],[1,2],[true],[1.2],[2147483648],['2']])
        assert.throws(()=>math('Conv_IntToBool',args),/Invalid native Conv_IntToBool/);
});
test('source MakeRelativeTransform computes offset in parent coordinates and reciprocal scaling',()=>{
    const out=math('MakeRelativeTransform',[
        trans(v(18,10,0),v(4,6,8)),trans(v(10,2,0),v(2,2,4))]);
    assert.deepEqual(out,{Rotation:ident,Translation:v(4,4,0),Scale3D:v(2,3,2)});
    const zero=math('MakeRelativeTransform',[trans(v(10,10,10)),trans(v(0,0,0),v(0,2,0))]);
    assert.deepEqual(zero.Translation,v(0,5,0));
    assert.deepEqual(zero.Scale3D,v(0,0.5,0));
});
test('source MakeRelativeTransform rotates into parent space and preserves quaternion axis',()=>{
    const s=Math.SQRT1_2,parent=trans(v(3,4,0),v(1,1,1),{X:0,Y:0,Z:s,W:s});
    const out=math('MakeRelativeTransform',[trans(v(3,5,0)),parent]);
    assert.ok(Math.abs(out.Translation.X-1)<1e-12);
    assert.ok(Math.abs(out.Translation.Y)<1e-12);
    assert.ok(Math.abs(out.Rotation.Z+s)<1e-12);
    assert.ok(Math.abs(out.Rotation.W-s)<1e-12);
});
test('source MakeRelativeTransform respects reflected negative-scale matrix fallback',()=>{
    const out=math('MakeRelativeTransform',[trans(v(6,2,0)),trans(v(4,2,0),v(-2,1,1))]);
    assert.deepEqual(out.Translation,v(-1,0,0));
    assert.deepEqual(out.Scale3D,v(-0.5,1,1));
    assert.ok(Math.abs(out.Rotation.W-1)<1e-12);
});
test('source MakeRelativeTransform rejects wrong signatures and malformed transforms',()=>{
    const good=trans(v(0,0,0));
    for(const args of [[],[good],[good,good,good],[good,{}],[{},good]])
        assert.throws(()=>math('MakeRelativeTransform',args),/Invalid native MakeRelativeTransform/);
    assert.throws(()=>math('MakeRelativeTransform',[good,trans(v(0,0,0),v(1,1,1),{X:0,Y:0,Z:0,W:2})]),/Unnormalized/);
});
