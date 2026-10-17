// Mirrors the supported UE 5.7 KismetMathLibrary primitives. No game rules.
export function evaluateNativeMath(name, args, warning = () => {}) {
    if (name === 'SelectFloat') {
        if (args.length !== 3 || args.slice(0, 2).some(value => typeof value !== 'number' || !Number.isFinite(value)) || typeof args[2] !== 'boolean')
            throw new Error('Invalid native double selection parameters');
        return args[2] ? args[0] : args[1];
    }
    if (['Min', 'Max', 'Conv_IntToDouble', 'SelectInt'].includes(name)) {
        const arity = name === 'SelectInt' ? 3 : name === 'Conv_IntToDouble' ? 1 : 2;
        if (args.length !== arity || args.some((value, index) => name === 'SelectInt' && index === 2
            ? typeof value !== 'boolean' : !Number.isInteger(value) || value < -2147483648 || value > 2147483647))
            throw new Error('Invalid native int selection/conversion parameters');
        const [a, b, pickA] = args;
        if (name === 'Conv_IntToDouble') return a;
        if (name === 'SelectInt') return pickA ? a : b;
        return name === 'Min' ? (a < b ? a : b) : (b < a ? a : b);
    }
    if (['Lerp', 'FMin', 'FMax', 'InRange_FloatFloat'].includes(name)) {
        const arity = name === 'InRange_FloatFloat' ? 5 : name === 'Lerp' ? 3 : 2;
        if (args.length !== arity || args.some((value, index) => name === 'InRange_FloatFloat' && index >= 3
            ? typeof value !== 'boolean' : typeof value !== 'number' || !Number.isFinite(value)))
            throw new Error('Invalid native double interpolation/range parameters');
        const [a, b, c, inclusiveMin, inclusiveMax] = args;
        if (name === 'Lerp') return a + c * (b - a);
        if (name === 'InRange_FloatFloat') return (inclusiveMin ? a >= b : a > b) && (inclusiveMax ? a <= c : a < c);
        return name === 'FMin' ? (a < b ? a : b) : (b < a ? a : b);
    }
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
