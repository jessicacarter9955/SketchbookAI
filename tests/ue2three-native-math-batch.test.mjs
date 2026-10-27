import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateNativeMath as run } from '../src/editor/ue2three-native-math.mjs';

const close=(a,b,tolerance=1e-12)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} differs from ${b}`);
const vectorClose=(a,b)=>['X','Y','Z'].forEach(field=>close(a[field],b[field]));

test('original int32 divide and remainder truncate toward zero with source zero warnings',()=>{
    for (const [a,b,q,r] of [[7,3,2,1],[-7,3,-2,-1],[7,-3,-2,1],[-7,-3,2,-1],[-2,3,0,-2],[-2147483648,2,-1073741824,0]]) {
        assert.equal(run('Divide_IntInt',[a,b]),q);
        assert.equal(run('Percent_IntInt',[a,b]),r);
    }
    const warnings=[];
    assert.equal(run('Divide_IntInt',[8,0],w=>warnings.push(w)),0);
    assert.equal(run('Percent_IntInt',[8,0],w=>warnings.push(w)),0);
    assert.deepEqual(warnings,['Divide by zero: Divide_IntInt','Modulo by zero: Percent_IntInt']);
    for (const name of ['Divide_IntInt','Percent_IntInt']) {
        assert.throws(()=>run(name,[-2147483648,-1]),/Undefined native/);
        for (const args of [[1.5,2],[2147483648,1],[1,'2'],[1]]) assert.throws(()=>run(name,args),/Invalid native/);
    }
});

test('source scalar tolerance and range mapping preserve zero spans and reversed ranges',()=>{
    assert.equal(run('NearlyEqual_FloatFloat',[1,1.25,0.25]),true);
    assert.equal(run('NearlyEqual_FloatFloat',[1,1,-1]),false);
    assert.equal(run('MapRangeClamped',[15,10,20,100,200]),150);
    assert.equal(run('MapRangeClamped',[25,10,20,100,200]),200);
    assert.equal(run('MapRangeClamped',[15,20,10,100,0]),50);
    assert.equal(run('MapRangeClamped',[4,5,5,10,20]),10);
    assert.equal(run('MapRangeClamped',[5,5,5,10,20]),20);
    assert.equal(run('MapRangeClamped',[5,5,5+1e-9,10,20]),10);
    assert.equal(run('MapRangeClamped',[6,5,5+1e-9,10,20]),20);
    for (const [name,args] of [['MapRangeClamped',[1,2,3,4]],['MapRangeClamped',[1,2,3,4,Infinity]],
        ['NearlyEqual_FloatFloat',[1,1,true]]]) assert.throws(()=>run(name,args),/Invalid native/);
});

test('source FVector2D make and break retain double precision and two components',()=>{
    const a=run('MakeVector2D',[1/3,-2]);
    assert.deepEqual(a,{X:1/3,Y:-2});
    assert.deepEqual(run('BreakVector2D',[a]),a);
    assert.ok(Object.is(run('MakeVector2D',[-0,1]).X,-0));
    for (const [name,args] of [['MakeVector2D',[1]],['MakeVector2D',[true,2]],['BreakVector2D',[{X:1}]],
        ['BreakVector2D',[{X:1,Y:NaN}]]]) assert.throws(()=>run(name,args),/Invalid native/);
});

test('Unreal forward/up axes and vector rotation retain UE coordinate handedness',()=>{
    const rot={Pitch:0,Yaw:90,Roll:0};
    vectorClose(run('Conv_RotatorToVector',[rot]),{X:0,Y:1,Z:0});
    vectorClose(run('Conv_RotatorToVector',[{Pitch:90,Yaw:0,Roll:137}]),{X:0,Y:0,Z:1});
    vectorClose(run('Conv_RotatorToVector',[{Pitch:360,Yaw:450,Roll:0}]),{X:0,Y:1,Z:0});
    vectorClose(run('GetUpVector',[rot]),{X:0,Y:0,Z:1});
    vectorClose(run('GetUpVector',[{Pitch:0,Yaw:0,Roll:90}]),{X:0,Y:1,Z:0});
    vectorClose(run('GreaterGreater_VectorRotator',[{X:1,Y:0,Z:0},rot]),{X:0,Y:1,Z:0});
    vectorClose(run('GreaterGreater_VectorRotator',[{X:0,Y:1,Z:0},{Pitch:0,Yaw:0,Roll:90}]),{X:0,Y:0,Z:-1});
    const r=run('Conv_VectorToRotator',[{X:1,Y:1,Z:Math.sqrt(2)}]);
    close(r.Yaw,45);close(r.Pitch,45);assert.equal(r.Roll,0);
    assert.deepEqual(run('Conv_VectorToRotator',[{X:0,Y:0,Z:0}]),{Pitch:0,Yaw:0,Roll:0});
    for (const [name,args] of [['GetUpVector',[{X:1,Y:2,Z:3}]],['Conv_VectorToRotator',[{X:1,Y:2}]],
        ['GreaterGreater_VectorRotator',[{X:1,Y:2,Z:3},rot,rot]]]) assert.throws(()=>run(name,args),/Invalid native/);
});

test('source FVector tolerance comparison is componentwise and projection does not normalize its input',()=>{
    const a={X:1,Y:2,Z:3};
    assert.equal(run('NotEqual_VectorVector',[a,{X:1.00001,Y:2,Z:3},1e-4]),false);
    assert.equal(run('NotEqual_VectorVector',[a,{X:1.01,Y:2,Z:3},1e-4]),true);
    assert.equal(run('NotEqual_VectorVector',[a,a,-1]),true);
    assert.deepEqual(run('ProjectPointOnToPlane',[a,{X:0,Y:0,Z:1},{X:0,Y:0,Z:1}]),{X:1,Y:2,Z:1});
    assert.deepEqual(run('ProjectPointOnToPlane',[a,{X:0,Y:0,Z:1},{X:0,Y:0,Z:2}]),{X:1,Y:2,Z:-5});
    assert.deepEqual(run('ProjectPointOnToPlane',[a,a,{X:0,Y:0,Z:0}]),a);
    assert.throws(()=>run('NotEqual_VectorVector',[a,a,'0']),/Invalid native/);
});

test('source SelectTransform copies the selected native value and enforces boolean selection',()=>{
    const a={Rotation:{X:0,Y:0,Z:0,W:1},Translation:{X:1,Y:2,Z:3},Scale3D:{X:1,Y:1,Z:1}};
    const b={...a,Translation:{X:4,Y:5,Z:6}};
    const selected=run('SelectTransform',[a,b,true]);
    assert.deepEqual(selected,a);selected.Translation.X=99;assert.equal(a.Translation.X,1);
    assert.deepEqual(run('SelectTransform',[a,b,false]),b);
    assert.throws(()=>run('SelectTransform',[a,b,1]),/Invalid native/);
});

test('source RInterpTo preserves float timing, shortest rotation and source branch ordering',()=>{
    const r=yaw=>({Pitch:0,Yaw:yaw,Roll:0});
    assert.deepEqual(run('RInterpTo',[r(170),r(-170),0.5,1]),r(180));
    assert.deepEqual(run('RInterpTo',[r(-170),r(170),0.5,1]),r(180));
    assert.deepEqual(run('RInterpTo',[r(370),r(10),0,0]),r(370));
    assert.deepEqual(run('RInterpTo',[r(370),r(10),1,0]),r(10));
    assert.deepEqual(run('RInterpTo',[r(0),r(90),1,2]),r(90));
    assert.deepEqual(run('RInterpTo',[r(0),r(90),-1,2]),r(0));
    assert.deepEqual(run('RInterpTo',[r(0),r(1e-5),0.1,1]),r(1e-5));
    assert.throws(()=>run('RInterpTo',[r(0),r(90),Infinity,1]),/Invalid native/);
});
