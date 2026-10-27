// Mirrors the supported UE 5.7 KismetMathLibrary primitives. No game rules.
const isVector = value => value && typeof value === 'object' && !Array.isArray(value)
    && ['X','Y','Z'].every(field => typeof value[field] === 'number' && Number.isFinite(value[field]));
const isRotator = value => value && typeof value === 'object' && !Array.isArray(value)
    && ['Pitch','Yaw','Roll'].every(field => typeof value[field] === 'number' && Number.isFinite(value[field]));
const isLinearColor = value => value && typeof value === 'object' && !Array.isArray(value)
    && ['R','G','B','A'].every(field => typeof value[field] === 'number' && Number.isFinite(value[field]));
const isQuaternion = value => value && typeof value === 'object' && !Array.isArray(value)
    && ['X','Y','Z','W'].every(field => typeof value[field] === 'number' && Number.isFinite(value[field]));
const isTransform = value => value && typeof value === 'object' && !Array.isArray(value)
    && isQuaternion(value.Rotation) && isVector(value.Translation) && isVector(value.Scale3D);
const normalizeDegrees = angle => ((angle + 180) % 360 + 360) % 360 - 180;
const quatToRotator = q => {
    const singularity = q.Z*q.X - q.W*q.Y;
    const yaw = Math.atan2(2*(q.W*q.Z+q.X*q.Y), 1-2*(q.Y*q.Y+q.Z*q.Z))*180/Math.PI;
    let pitch, roll;
    if (singularity < -0.4999995) {
        pitch = -90; roll = normalizeDegrees(-yaw - 2*Math.atan2(q.X,q.W)*180/Math.PI);
    } else if (singularity > 0.4999995) {
        pitch = 90; roll = normalizeDegrees(yaw - 2*Math.atan2(q.X,q.W)*180/Math.PI);
    } else {
        pitch = Math.asin(Math.max(-1,Math.min(1,2*singularity)))*180/Math.PI;
        roll = Math.atan2(-2*(q.W*q.X+q.Y*q.Z), 1-2*(q.X*q.X+q.Y*q.Y))*180/Math.PI;
    }
    return {Pitch:normalizeDegrees(pitch),Yaw:normalizeDegrees(yaw),Roll:normalizeDegrees(roll)};
};
const makeQuaternion = rotation => {
    const pitch=rotation.Pitch*Math.PI/360, yaw=rotation.Yaw*Math.PI/360, roll=rotation.Roll*Math.PI/360;
    const sp=Math.sin(pitch), cp=Math.cos(pitch), sy=Math.sin(yaw), cy=Math.cos(yaw),
        sr=Math.sin(roll), cr=Math.cos(roll);
    const value={X:cr*sp*sy-sr*cp*cy, Y:-cr*sp*cy-sr*cp*sy,
        Z:cr*cp*sy-sr*sp*cy, W:cr*cp*cy+sr*sp*sy};
    if (!Object.values(value).every(Number.isFinite)) throw new Error('Invalid native MakeTransform parameters');
    return value;
};

export function evaluateNativeMath(name, args, warning = () => {}) {
    if (name === 'MakeVector') {
        if (!Array.isArray(args) || args.length !== 3 || args.some(value => typeof value !== 'number' || !Number.isFinite(value)))
            throw new Error('Invalid native MakeVector parameters');
        // UE 5.7 KismetMathLibrary.h declares double X/Y/Z; its .inl returns FVector(X, Y, Z).
        return {X: args[0], Y: args[1], Z: args[2]};
    }
    if (name === 'Conv_DoubleToVector') {
        if (!Array.isArray(args) || args.length !== 1 || typeof args[0] !== 'number' || !Number.isFinite(args[0]))
            throw new Error('Invalid native Conv_DoubleToVector parameters');
        return {X:args[0],Y:args[0],Z:args[0]};
    }
    if (name === 'Conv_LinearColorToVector') {
        if (!Array.isArray(args) || args.length !== 1 || !isLinearColor(args[0]))
            throw new Error('Invalid native Conv_LinearColorToVector parameters');
        // Original Kismet conversion copies linear R/G/B as X/Y/Z; alpha is not converted.
        return {X:args[0].R,Y:args[0].G,Z:args[0].B};
    }
    if (name === 'Multiply_LinearColorLinearColor') {
        if (!Array.isArray(args) || args.length !== 2 || !args.every(isLinearColor))
            throw new Error('Invalid native Multiply_LinearColorLinearColor parameters');
        const result={R:args[0].R*args[1].R,G:args[0].G*args[1].G,
            B:args[0].B*args[1].B,A:args[0].A*args[1].A};
        if (!isLinearColor(result)) throw new Error('Non-finite native Multiply_LinearColorLinearColor result');
        return result;
    }
    if (['Add_VectorVector','Subtract_VectorVector','Multiply_VectorVector'].includes(name)) {
        if (!Array.isArray(args) || args.length !== 2 || !args.every(isVector))
            throw new Error(`Invalid native ${name} parameters`);
        const op=name === 'Add_VectorVector' ? (a,b)=>a+b
            : name === 'Subtract_VectorVector' ? (a,b)=>a-b : (a,b)=>a*b;
        const result={X:op(args[0].X,args[1].X),Y:op(args[0].Y,args[1].Y),Z:op(args[0].Z,args[1].Z)};
        if (!isVector(result)) throw new Error(`Invalid native ${name} result`);
        return result;
    }
    if (name === 'MakeRotator') {
        if (!Array.isArray(args) || args.length !== 3 || args.some(value => typeof value !== 'number' || !Number.isFinite(value)))
            throw new Error('Invalid native MakeRotator parameters');
        // The native API argument order is Roll, Pitch, Yaw; FRotator stores Pitch, Yaw, Roll.
        const [roll,pitch,yaw]=args.map(Math.fround);
        if (![roll,pitch,yaw].every(Number.isFinite)) throw new Error('Invalid native MakeRotator parameters');
        return {Pitch:pitch,Yaw:yaw,Roll:roll};
    }
    if (name === 'BreakVector2D') {
        if (!Array.isArray(args) || args.length !== 1 || !args[0] || typeof args[0] !== 'object'
            || Object.keys(args[0]).sort().join(',') !== 'X,Y'
            || !['X','Y'].every(key => typeof args[0][key] === 'number' && Number.isFinite(args[0][key])))
            throw new Error('Invalid original BreakVector2D parameters');
        return {X: args[0].X, Y: args[0].Y};
    }
    if (name === 'BreakVector') {
        if (!Array.isArray(args) || args.length !== 1 || !isVector(args[0]))
            throw new Error('Invalid native BreakVector parameters');
        return {X:Math.fround(args[0].X),Y:Math.fround(args[0].Y),Z:Math.fround(args[0].Z)};
    }
    if (name === 'BreakRotator') {
        if (!Array.isArray(args) || args.length !== 1 || !isRotator(args[0]))
            throw new Error('Invalid native BreakRotator parameters');
        return {Roll:Math.fround(args[0].Roll),Pitch:Math.fround(args[0].Pitch),Yaw:Math.fround(args[0].Yaw)};
    }
    if (name === 'BreakTransform') {
        if (!Array.isArray(args) || args.length !== 1 || !isTransform(args[0]))
            throw new Error('Invalid native BreakTransform parameters');
        const value = args[0];
        return {Location:{...value.Translation}, Rotation:quatToRotator(value.Rotation), Scale:{...value.Scale3D}};
    }
    if (name === 'MakeTransform') {
        if (!Array.isArray(args) || args.length !== 3 || !isVector(args[0]) || !isRotator(args[1]) || !isVector(args[2]))
            throw new Error('Invalid native MakeTransform parameters');
        return {Rotation:makeQuaternion(args[1]),Translation:{X:args[0].X,Y:args[0].Y,Z:args[0].Z},
            Scale3D:{X:args[2].X,Y:args[2].Y,Z:args[2].Z}};
    }
    if (name === 'Abs') {
        if (!Array.isArray(args) || args.length !== 1 || typeof args[0] !== 'number' || !Number.isFinite(args[0]))
            throw new Error('Invalid native Abs parameters');
        return Math.abs(args[0]);
    }
    if (name === 'Square' || name === 'FFloor') {
        if (!Array.isArray(args) || args.length !== 1 || typeof args[0] !== 'number' || !Number.isFinite(args[0]))
            throw new Error(`Invalid native ${name} parameters`);
        const result = name === 'Square' ? args[0] * args[0] : Math.floor(args[0]);
        if (!Number.isFinite(result) || name === 'FFloor' && (result < -2147483648 || result > 2147483647))
            throw new Error(`Out-of-range native ${name} result`);
        return result;
    }
    if (name === 'Conv_BoolToDouble') {
        if (!Array.isArray(args) || args.length !== 1 || typeof args[0] !== 'boolean')
            throw new Error('Invalid native Conv_BoolToDouble parameters');
        return args[0] ? 1 : 0;
    }
    if (name === 'Conv_IntToInt64') {
        if (!Array.isArray(args) || args.length !== 1 || !Number.isInteger(args[0]) ||
            args[0] < -2147483648 || args[0] > 2147483647)
            throw new Error('Invalid native Conv_IntToInt64 parameters');
        // Signed int32 always converts exactly to the supported JS int64 range.
        return args[0];
    }
    if (name === 'FInterpTo') {
        if (!Array.isArray(args) || args.length !== 4 || args.some(x => typeof x !== 'number' || !Number.isFinite(x)))
            throw new Error('Invalid native FInterpTo parameters');
        const [current, target, deltaTime, speed] = args;
        // UE 5.7 UnrealMathUtility.h FMath::FInterpTo: stop at the source
        // small-number threshold and clamp DeltaTime * InterpSpeed to [0,1].
        if (speed <= 0) return target;
        const distance = target - current;
        if (!Number.isFinite(distance)) throw new Error('Invalid native FInterpTo distance');
        if (distance * distance < Math.fround(1e-8)) return target;
        const alpha = Math.max(0, Math.min(1, deltaTime * speed));
        const result = current + distance * alpha;
        if (!Number.isFinite(result)) throw new Error('Non-finite native FInterpTo result');
        return result;
    }
    if (name === 'VSize' || name === 'VSizeXY' || name === 'Vector_Distance' || name === 'Vector_DistanceSquared') {
        const count = name === 'Vector_Distance' || name === 'Vector_DistanceSquared' ? 2 : 1;
        if (!Array.isArray(args) || args.length !== count || !args.every(isVector))
            throw new Error('Invalid native ' + name + ' parameters');
        const a = args[0], sourceB = count === 2 ? args[1] : {X:0,Y:0,Z:0};
        const x = a.X - sourceB.X, y = a.Y - sourceB.Y, z = a.Z - sourceB.Z;
        // UE FVector::Size / FVector::Dist: sqrt of the three squared double components.
        const squared = x*x + y*y + (name === 'VSizeXY' ? 0 : z*z);
        const distance = name === 'Vector_DistanceSquared' ? squared : Math.sqrt(squared);
        if (!Number.isFinite(distance)) throw new Error('Non-finite native ' + name + ' result');
        return distance;
    }
    if (name === 'Round') {
        if (args.length !== 1 || typeof args[0] !== 'number' || !Number.isFinite(args[0]))
            throw new Error('Invalid native Round parameters');
        // UE 5.7 KismetMathLibrary::Round calls FMath::RoundToInt(double),
        // which rounds half values toward +infinity before returning int32.
        const result = Math.floor(args[0] + 0.5);
        if (result < -2147483648 || result > 2147483647)
            throw new Error('Native Round result is outside the verified int32 range');
        return result;
    }
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
        && (match[2] === 'ByteByte' || match[1] === 'Divide' && match[2] !== 'DoubleDouble' && match[2] !== 'IntInt'))
        throw new Error(`Unsupported native math: ${name}`);
    const arity = name === 'Not_PreBool' ? 1 : clamp ? 3 : 2;
    if (args.length !== arity || args.some(value => boolean ? typeof value !== 'boolean' : typeof value !== 'number' || !Number.isFinite(value)))
        throw new Error('Invalid native math parameters');
    const type = match?.[2] || (name === 'Clamp' ? 'IntInt' : 'DoubleDouble');
    if (type === 'ByteByte' && args.some(v => !Number.isInteger(v) || v < 0 || v > 255)) throw new Error('Invalid byte math parameters');
    if (type === 'IntInt' && args.some(v => !Number.isInteger(v) || v < -2147483648 || v > 2147483647)) throw new Error('Invalid int math parameters');
    const [a, b, c] = args;
    if (name === 'Divide_IntInt') {
        if (b !== 2) throw new Error('Unwitnessed original int division denominator');
        return Math.trunc(a / b) || 0;
    }
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
