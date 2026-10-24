import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateNativeMath } from '../src/editor/ue2three-native-math.mjs';

test('source MakeVector constructs an FVector from exactly three finite numeric XYZ inputs', () => {
    const vector = evaluateNativeMath('MakeVector', [1.25, -2, 3]);
    assert.deepEqual(vector, {X: 1.25, Y: -2, Z: 3});
    assert.ok(Object.is(evaluateNativeMath('MakeVector', [-0, 0, 1]).X, -0));
    for (const args of [[], [1, 2], [1, 2, 3, 4], [true, 2, 3], [1, '2', 3], [1, null, 3],
        [NaN, 2, 3], [1, Infinity, 3]])
        assert.throws(() => evaluateNativeMath('MakeVector', args), /Invalid native MakeVector parameters/);
    assert.throws(() => evaluateNativeMath('MakeVector'), /Invalid native MakeVector parameters/);
    assert.throws(() => evaluateNativeMath('MakeVector2D', [1, 2]), /Unsupported native math/);
});

test('UE 5.7 Round uses FMath half-toward-positive-infinity rounding within int32', () => {
    for (const [input, expected] of [[1.49, 1], [1.5, 2], [-1.5, -1], [-1.51, -2], [-0.5, 0],
        [-2147483648.5, -2147483648], [2147483647.49, 2147483647]])
        assert.equal(evaluateNativeMath('Round', [input]), expected);

    for (const args of [[], [1, 2], [true], ['1'], [NaN], [Infinity], [2147483647.5], [-2147483648.51]])
        assert.throws(() => evaluateNativeMath('Round', args), /Invalid native Round|outside the verified int32 range/);
    assert.throws(() => evaluateNativeMath('Floor', [1.5]), /Unsupported native math/);
});

test('UE 5.7 FInterpTo preserves source speed, small-distance and clamping branches', () => {
    assert.equal(evaluateNativeMath('FInterpTo', [0, 10, 0.1, 2]), 2);
    assert.equal(evaluateNativeMath('FInterpTo', [0, 10, 1, 2]), 10);
    assert.equal(evaluateNativeMath('FInterpTo', [0, 10, -1, 2]), 0);
    assert.equal(evaluateNativeMath('FInterpTo', [0, 10, 0.1, 0]), 10);
    assert.equal(evaluateNativeMath('FInterpTo', [0, 10, 0.1, -2]), 10);
    assert.equal(evaluateNativeMath('FInterpTo', [1, 1 + 0.00001, 0, 5]), 1.00001);
    assert.equal(evaluateNativeMath('FInterpTo', [10, -10, 0.25, 1]), 5);
    for (const args of [[], [1,2,3], [1,2,3,4,5], [NaN,1,1,1], [1,Infinity,1,1], [1,'2',1,1]])
        assert.throws(() => evaluateNativeMath('FInterpTo', args), /Invalid native FInterpTo parameters/);
});

test('source double arithmetic and divide-by-zero behavior match Kismet', () => {
    assert.equal(evaluateNativeMath('Add_DoubleDouble', [1.25, 2.5]), 3.75);
    assert.equal(evaluateNativeMath('Subtract_DoubleDouble', [10, 3]), 7);
    assert.equal(evaluateNativeMath('Multiply_DoubleDouble', [2, -3]), -6);
    assert.equal(evaluateNativeMath('Divide_DoubleDouble', [25, 100]), 0.25);
    const warnings = [];
    assert.equal(evaluateNativeMath('Divide_DoubleDouble', [10, -0], message => warnings.push(message)), 0);
    assert.deepEqual(warnings, ['Divide by zero: Divide_DoubleDouble']);
    assert.equal(evaluateNativeMath('Divide_DoubleDouble', [1e-10, 1e-10]), 1);
});
test('int32 arithmetic preserves Windows integer width', () => {
    assert.equal(evaluateNativeMath('Add_IntInt', [2147483647, 1]), -2147483648);
    assert.equal(evaluateNativeMath('Subtract_IntInt', [-2147483648, 1]), 2147483647);
    assert.equal(evaluateNativeMath('Multiply_IntInt', [65536, 65536]), 0);
});
test('original int min/max, selection and exact double conversion remain typed', () => {
    assert.equal(evaluateNativeMath('Min', [-2147483648, 2147483647]), -2147483648);
    assert.equal(evaluateNativeMath('Max', [-2147483648, 2147483647]), 2147483647);
    assert.equal(evaluateNativeMath('Min', [3, 3]), 3);
    for (const value of [-2147483648, 0, 2147483647]) assert.equal(evaluateNativeMath('Conv_IntToDouble', [value]), value);
    assert.equal(evaluateNativeMath('SelectInt', [2, 7, true]), 2);
    assert.equal(evaluateNativeMath('SelectInt', [2, 7, false]), 7);
    for (const [name, args] of [['Min', [1.5, 2]], ['Max', [0, 2147483648]],
        ['Conv_IntToDouble', [true]], ['Conv_IntToDouble', [1, 2]], ['SelectInt', [2, 7, 1]]])
        assert.throws(() => evaluateNativeMath(name, args), /Invalid/);
});
test('clamp preserves source order including reversed bounds', () => {
    assert.equal(evaluateNativeMath('FClamp', [0.75, 0, 1]), 0.75);
    assert.equal(evaluateNativeMath('FClamp', [0.75, 2, 1]), 2);
    assert.equal(evaluateNativeMath('Clamp', [10, 0, 5]), 5);
});
test('source double interpolation and ranges preserve bounds, flags and extrapolation', () => {
    assert.equal(evaluateNativeMath('Lerp', [1, 0.25, 0.5]), 0.625);
    assert.equal(evaluateNativeMath('Lerp', [1, 0.25, 2]), -0.5);
    assert.equal(evaluateNativeMath('FMin', [0.25, -1]), -1);
    assert.equal(evaluateNativeMath('FMax', [0.25, -1]), 0.25);
    assert.ok(Object.is(evaluateNativeMath('FMin', [0, -0]), -0));
    assert.ok(Object.is(evaluateNativeMath('FMax', [-0, 0]), 0));
    for (const inclusiveMin of [true, false]) for (const inclusiveMax of [true, false]) {
        assert.equal(evaluateNativeMath('InRange_FloatFloat', [0, 0, 1, inclusiveMin, inclusiveMax]), inclusiveMin);
        assert.equal(evaluateNativeMath('InRange_FloatFloat', [1, 0, 1, inclusiveMin, inclusiveMax]), inclusiveMax);
        assert.equal(evaluateNativeMath('InRange_FloatFloat', [0.5, 0, 1, inclusiveMin, inclusiveMax]), true);
        assert.equal(evaluateNativeMath('InRange_FloatFloat', [0, 1, -1, inclusiveMin, inclusiveMax]), false);
    }
    for (const [name, args] of [['Lerp', [1, 2, true]], ['FMax', [1, Infinity]],
        ['InRange_FloatFloat', [0, 0, 1, 1, true]], ['InRange_FloatFloat', [0, 0, 1, true]]])
        assert.throws(() => evaluateNativeMath(name, args), /Invalid/);
});
test('Boolean equality is typed and unknown math is rejected', () => {
    assert.equal(evaluateNativeMath('NotEqual_BoolBool', [false, true]), true);
    assert.equal(evaluateNativeMath('EqualEqual_BoolBool', [true, true]), true);
    assert.throws(() => evaluateNativeMath('NotEqual_BoolBool', [0, 1]), /Invalid/);
    assert.throws(() => evaluateNativeMath('Add_IntInt', [0.5, 1]), /Invalid/);
    assert.throws(() => evaluateNativeMath('Divide_IntInt', [2, 1]), /Unsupported/);
});
test('source FName comparisons preserve case-insensitivity and instance suffixes', () => {
    assert.equal(evaluateNativeMath('EqualEqual_NameName', ['Head', 'HEAD']), true);
    assert.equal(evaluateNativeMath('NotEqual_NameName', ['head_0', 'head']), true);
    assert.equal(evaluateNativeMath('EqualEqual_NameName', ['head_01', 'head_1']), false);
    assert.throws(() => evaluateNativeMath('EqualEqual_NameName', ['café', 'CAFÉ']), /Unsupported/);
    assert.throws(() => evaluateNativeMath('EqualEqual_NameName', [0, 'None']), /invalid/);
});

test('witnessed FVector operators and scalar conversion preserve all three source components', () => {
    const a={X:1.5,Y:-2,Z:0},b={X:2,Y:3,Z:-4};
    assert.deepEqual(evaluateNativeMath('Add_VectorVector',[a,b]),{X:3.5,Y:1,Z:-4});
    assert.deepEqual(evaluateNativeMath('Subtract_VectorVector',[a,b]),{X:-0.5,Y:-5,Z:4});
    assert.deepEqual(evaluateNativeMath('Multiply_VectorVector',[a,b]),{X:3,Y:-6,Z:-0});
    assert.deepEqual(evaluateNativeMath('Conv_DoubleToVector',[-3]),{X:-3,Y:-3,Z:-3});
    assert.ok(Object.is(evaluateNativeMath('Conv_DoubleToVector',[-0]).X,-0));
    for (const [name,args] of [['Add_VectorVector',[a,{X:1,Y:2}]],
        ['Subtract_VectorVector',[a,{Pitch:1,Yaw:2,Roll:3}]],
        ['Multiply_VectorVector',[a,b,b]],['Conv_DoubleToVector',[true]]])
        assert.throws(()=>evaluateNativeMath(name,args),/Invalid native/);
});

test('witnessed rotator construction and breaks retain native argument and output order', () => {
    const rotation=evaluateNativeMath('MakeRotator',[10,20,30]);
    assert.deepEqual(rotation,{Pitch:20,Yaw:30,Roll:10});
    assert.deepEqual(evaluateNativeMath('BreakVector',[{X:1/3,Y:-2,Z:3}]),
        {X:Math.fround(1/3),Y:-2,Z:3});
    assert.deepEqual(evaluateNativeMath('BreakRotator',[rotation]),{Roll:10,Pitch:20,Yaw:30});
    for (const [name,args] of [['MakeRotator',[1,2]],['BreakVector',[{X:1,Y:2,Z:NaN}]],
        ['BreakRotator',[{X:1,Y:2,Z:3}]]])
        assert.throws(()=>evaluateNativeMath(name,args),/Invalid native/);
});

test('witnessed MakeTransform constructs source FTransform quaternion, translation and scale fields', () => {
    const location={X:1,Y:2,Z:3},rotation={Pitch:0,Yaw:90,Roll:0},scale={X:2,Y:3,Z:4};
    const transform=evaluateNativeMath('MakeTransform',[location,rotation,scale]);
    assert.deepEqual(transform.Translation,location);
    assert.deepEqual(transform.Scale3D,scale);
    assert.ok(Math.abs(transform.Rotation.Z-Math.SQRT1_2)<1e-15);
    assert.ok(Math.abs(transform.Rotation.W-Math.SQRT1_2)<1e-15);
    assert.deepEqual(evaluateNativeMath('MakeTransform',[{X:0,Y:0,Z:0},{Pitch:0,Yaw:0,Roll:0},{X:1,Y:1,Z:1}]),
        {Rotation:{X:0,Y:-0,Z:0,W:1},Translation:{X:0,Y:0,Z:0},Scale3D:{X:1,Y:1,Z:1}});
    assert.throws(()=>evaluateNativeMath('MakeTransform',[location,{X:0,Y:0,Z:0},scale]),/Invalid native/);
});


test('UE 5.7 Abs, VSize and Vector_Distance retain source numeric/vector contracts', () => {
    assert.equal(evaluateNativeMath('Abs', [-3.25]), 3.25);
    assert.equal(evaluateNativeMath('Abs', [2]), 2);
    assert.equal(evaluateNativeMath('VSize', [{X:3,Y:4,Z:12}]), 13);
    assert.equal(evaluateNativeMath('VSizeXY', [{X:3,Y:4,Z:12}]), 5);
    assert.equal(evaluateNativeMath('VSizeXY', [{X:0,Y:0,Z:9000}]), 0);
    assert.equal(evaluateNativeMath('Conv_IntToInt64', [-2147483648]), -2147483648);
    assert.equal(evaluateNativeMath('Conv_IntToInt64', [2147483647]), 2147483647);
    assert.deepEqual(evaluateNativeMath('Conv_LinearColorToVector', [{R:0.25,G:0.5,B:0.75,A:0.125}]),
        {X:0.25,Y:0.5,Z:0.75});
    assert.equal(evaluateNativeMath('Vector_Distance', [{X:3,Y:4,Z:12},{X:0,Y:0,Z:0}]), 13);
    assert.equal(evaluateNativeMath('Vector_Distance', [{X:-2,Y:3,Z:1},{X:1,Y:-1,Z:13}]), 13);
    assert.equal(evaluateNativeMath('VSize', [{X:0,Y:0,Z:0}]), 0);
    for (const [name, args] of [
        ['Abs', []], ['Abs', [NaN]], ['Abs', ['3']], ['Abs', [3,4]],
        ['VSize', []], ['VSize', [{X:1,Y:2}]], ['VSize', [{X:1,Y:2,Z:Infinity}]],
        ['VSizeXY', []], ['VSizeXY', [{X:1,Y:2}]],
        ['Conv_IntToInt64', [2147483648]], ['Conv_IntToInt64', [-2147483649]],
        ['Conv_IntToInt64', [1.5]],
        ['Conv_LinearColorToVector', []],
        ['Conv_LinearColorToVector', [{R:1,G:0,B:0}]],
        ['Conv_LinearColorToVector', [{R:1,G:0,B:0,A:NaN}]],
        ['Vector_Distance', [{X:1,Y:2,Z:3}]],
        ['Vector_Distance', [{X:1,Y:2,Z:3},{X:1,Y:2,Z:NaN}]],
        ['Vector_Distance', [{X:1e308,Y:0,Z:0},{X:-1e308,Y:0,Z:0}]],
    ]) assert.throws(() => evaluateNativeMath(name, args), /Invalid native|Non-finite native/);
});

test('witnessed DDS scalar conversions, comparisons and componentwise color products remain source-typed', () => {
    assert.equal(evaluateNativeMath('Square', [-3]), 9);
    assert.equal(evaluateNativeMath('FFloor', [-2.01]), -3);
    assert.equal(evaluateNativeMath('FFloor', [2147483647.5]), 2147483647);
    assert.equal(evaluateNativeMath('Conv_BoolToDouble', [true]), 1);
    assert.equal(evaluateNativeMath('Conv_BoolToDouble', [false]), 0);
    assert.deepEqual(evaluateNativeMath('Multiply_LinearColorLinearColor', [
        {R:0.5,G:0.25,B:0.75,A:1},{R:0.2,G:4,B:0,A:0.5},
    ]),{R:0.1,G:1,B:0,A:0.5});
    for (const [name,args] of [
        ['Square', [NaN]], ['Square', [1e308]], ['Square', [2,3]],
        ['FFloor', [2147483648]], ['FFloor', [-2147483649]],
        ['Conv_BoolToDouble', [1]],
        ['Multiply_LinearColorLinearColor', [{R:1,G:1,B:1,A:1},{R:1,G:1,B:1}]],
    ]) assert.throws(()=>evaluateNativeMath(name,args), /Invalid native|Out-of-range|Non-finite/);
});
