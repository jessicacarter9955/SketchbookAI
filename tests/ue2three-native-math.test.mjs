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
