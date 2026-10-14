// Mirrors the supported UE 5.7 KismetMathLibrary primitives. No game rules.
export function evaluateNativeMath(name, args, warning = () => {}) {
    if (name === 'EqualEqual_NameName' || name === 'NotEqual_NameName') {
        if (args.length !== 2 || args.some(value => typeof value !== 'string' || !value || /[^\x01-\x7f]/.test(value)))
            throw new Error('Unsupported or invalid source FName comparison');
        const equal = args[0].toUpperCase() === args[1].toUpperCase();
        return name === 'EqualEqual_NameName' ? equal : !equal;
    }
    const boolean = /^(BooleanAND|BooleanOR|BooleanXOR|Not_PreBool|EqualEqual_BoolBool|NotEqual_BoolBool)$/.test(name);
    const match = /^(EqualEqual|NotEqual|Greater|GreaterEqual|Less|LessEqual|Add|Subtract|Multiply|Divide)_(ByteByte|IntInt|DoubleDouble)$/.exec(name);
    const clamp = name === 'FClamp' || name === 'Clamp';
    if (!boolean && !match && !clamp) throw new Error(`Unsupported native math: ${name}`);
    if (match && ['Add', 'Subtract', 'Multiply', 'Divide'].includes(match[1])
        && (match[2] === 'ByteByte' || match[1] === 'Divide' && match[2] !== 'DoubleDouble'))
        throw new Error(`Unsupported native math: ${name}`);
    const arity = name === 'Not_PreBool' ? 1 : clamp ? 3 : 2;
    if (args.length !== arity || args.some(value => boolean ? typeof value !== 'boolean' : typeof value !== 'number' || !Number.isFinite(value)))
        throw new Error('Invalid native math parameters');
    const type = match?.[2] || (name === 'Clamp' ? 'IntInt' : 'DoubleDouble');
    if (type === 'ByteByte' && args.some(v => !Number.isInteger(v) || v < 0 || v > 255)) throw new Error('Invalid byte math parameters');
    if (type === 'IntInt' && args.some(v => !Number.isInteger(v) || v < -2147483648 || v > 2147483647)) throw new Error('Invalid int math parameters');
    const [a, b, c] = args;
    if (clamp) return a < b ? b : a < c ? a : c;
    const op = match?.[1] || name;
    switch (op) {
        case 'BooleanAND': return a && b;
        case 'BooleanOR': return a || b;
        case 'BooleanXOR': case 'NotEqual_BoolBool': return a !== b;
        case 'EqualEqual_BoolBool': return a === b;
        case 'Not_PreBool': return !a;
        case 'EqualEqual': return a === b;
        case 'NotEqual': return a !== b;
        case 'Greater': return a > b;
        case 'GreaterEqual': return a >= b;
        case 'Less': return a < b;
        case 'LessEqual': return a <= b;
        case 'Add': return type === 'IntInt' ? (a + b) | 0 : a + b;
        case 'Subtract': return type === 'IntInt' ? (a - b) | 0 : a - b;
        case 'Multiply': return type === 'IntInt' ? Math.imul(a, b) : a * b;
        case 'Divide':
            if (b === 0) { warning('Divide by zero: Divide_DoubleDouble'); return 0; }
            return a / b;
    }
}
