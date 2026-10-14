import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateNativeMath } from '../src/editor/ue2three-native-math.mjs';

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
test('clamp preserves source order including reversed bounds', () => {
    assert.equal(evaluateNativeMath('FClamp', [0.75, 0, 1]), 0.75);
    assert.equal(evaluateNativeMath('FClamp', [0.75, 2, 1]), 2);
    assert.equal(evaluateNativeMath('Clamp', [10, 0, 5]), 5);
});
test('Boolean equality is typed and unknown math is rejected', () => {
    assert.equal(evaluateNativeMath('NotEqual_BoolBool', [false, true]), true);
    assert.equal(evaluateNativeMath('EqualEqual_BoolBool', [true, true]), true);
    assert.throws(() => evaluateNativeMath('NotEqual_BoolBool', [0, 1]), /Invalid/);
    assert.throws(() => evaluateNativeMath('Add_IntInt', [0.5, 1]), /Invalid/);
    assert.throws(() => evaluateNativeMath('Divide_IntInt', [2, 1]), /Unsupported/);
});
