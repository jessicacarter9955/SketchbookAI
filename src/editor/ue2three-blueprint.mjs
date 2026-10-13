// Executes normalized source-derived instructions; never evaluates generated JS.
const owns = (object, key) => object != null && Object.hasOwn(object, key);
const safeField = key => typeof key === 'string' && key.length > 0 && !['__proto__', 'constructor', 'prototype'].includes(key);

export function executeBlueprint(program, self = {}, inputs = {}) {
    if (program?.schema_version !== 1 || !['translated_straight_line', 'translated_control_flow'].includes(program.status)
        || !Array.isArray(program.steps) || program.steps.length > 10000
        || !Array.isArray(program.output_fields) || program.output_fields.some(name => !safeField(name)))
        throw new Error('Unsupported Blueprint program');
    const locals = Object.assign(Object.create(null), structuredClone(inputs));
    for (const field of program.input_fields || []) {
        if (!safeField(field) || !owns(locals, field)) throw new Error(`Missing Blueprint input: ${field}`);
    }
    // Unreal initializes primitive local/out property storage before executing
    // a UFunction. Struct constructors need their source type/defaults and are
    // deliberately not invented here.
    const primitiveDefaults = {BoolProperty: false, ByteProperty: 0, IntProperty: 0,
        FloatProperty: 0, DoubleProperty: 0, StrProperty: '', NameProperty: 'None'};
    for (const [field, type] of Object.entries(program.field_types?.local || {})) {
        if (!safeField(field)) throw new Error('Invalid local field');
        if (!owns(locals, field) && owns(primitiveDefaults, type)) locals[field] = primitiveDefaults[type];
    }
    const instance = structuredClone(self);
    const trace = [];
    const checkType = (scope, field, value) => {
        const type = program.field_types?.[scope]?.[field];
        const valid = !type
            || type === 'BoolProperty' && typeof value === 'boolean'
            || type === 'ByteProperty' && Number.isInteger(value) && value >= 0 && value <= 255
            || type === 'IntProperty' && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647
            || ['FloatProperty', 'DoubleProperty'].includes(type) && typeof value === 'number' && Number.isFinite(value)
            || ['StrProperty', 'NameProperty'].includes(type) && typeof value === 'string'
            || type === 'StructProperty' && value !== null && typeof value === 'object' && !Array.isArray(value);
        if (!valid) throw new Error(`Unsupported or invalid ${type}: ${scope}.${field}`);
    };
    const evaluate = (expression, depth = 0) => {
        if (!expression || depth > 48) throw new Error('Invalid Blueprint expression');
        if (expression.op === 'math' && Array.isArray(expression.args)) {
            const boolean = ['BooleanAND', 'BooleanOR', 'BooleanXOR', 'Not_PreBool'].includes(expression.name);
            const match = /^(EqualEqual|NotEqual|Greater|GreaterEqual|Less|LessEqual)_(ByteByte|IntInt|DoubleDouble)$/.exec(expression.name);
            if (!boolean && !match) throw new Error(`Unsupported native math: ${expression.name}`);
            const args = expression.args.map(arg => evaluate(arg, depth+1));
            const expected = expression.name === 'Not_PreBool' ? 1 : 2;
            if (args.length !== expected || args.some(value => boolean ? typeof value !== 'boolean' : typeof value !== 'number' || !Number.isFinite(value)))
                throw new Error('Invalid native math parameters');
            if (match?.[2] === 'ByteByte' && args.some(v => !Number.isInteger(v) || v < 0 || v > 255)) throw new Error('Invalid byte math parameters');
            if (match?.[2] === 'IntInt' && args.some(v => !Number.isInteger(v) || v < -2147483648 || v > 2147483647)) throw new Error('Invalid int math parameters');
            const [a, b] = args;
            const op = match?.[1] || expression.name;
            switch (op) {
                case 'BooleanAND': return a && b;
                case 'BooleanOR': return a || b;
                case 'BooleanXOR': return a !== b;
                case 'Not_PreBool': return !a;
                case 'EqualEqual': return a === b;
                case 'NotEqual': return a !== b;
                case 'Greater': return a > b;
                case 'GreaterEqual': return a >= b;
                case 'Less': return a < b;
                case 'LessEqual': return a <= b;
            }
        }
        if (expression.op === 'constant') {
            const value = expression.value;
            if (value !== null && !['string', 'boolean', 'number'].includes(typeof value)
                || typeof value === 'number' && !Number.isFinite(value)) throw new Error('Invalid Blueprint constant');
            return value;
        }
        if (expression.op === 'get' && safeField(expression.field) && ['self', 'local'].includes(expression.scope)) {
            const owner = expression.scope === 'self' ? instance : locals;
            if (!owns(owner, expression.field)) throw new Error(`Missing ${expression.scope} property: ${expression.field}`);
            checkType(expression.scope, expression.field, owner[expression.field]);
            return owner[expression.field];
        }
        throw new Error(`Unsupported Blueprint expression: ${expression.op}`);
    };
    let pc = 0, budget = 10000;
    while (pc < program.steps.length) {
        if (--budget < 0) throw new Error('Blueprint instruction budget exceeded');
        const step = program.steps[pc++];
        if (step.op === 'nop') continue;
        if (step.op === 'jump' || step.op === 'branch') {
            if (!Number.isInteger(step.target) || step.target < 0 || step.target >= program.steps.length)
                throw new Error('Invalid Blueprint jump target');
            let take = true;
            if (step.op === 'branch') {
                const condition = evaluate(step.value);
                if (typeof condition !== 'boolean') throw new Error('Blueprint branch requires Boolean');
                take = !condition;
            }
            trace.push({source_index: step.source_index, op: step.op, taken: take, target: step.target});
            if (take) pc = step.target;
            continue;
        }
        if (step.op === 'end') throw new Error('Blueprint reached EndOfScript without return');
        if (step.op === 'set' && safeField(step.field)) {
            const scope = step.scope || 'local';
            if (!['self', 'local'].includes(scope)) throw new Error('Invalid assignment scope');
            const value = evaluate(step.value);
            if (step.boolean && typeof value !== 'boolean') throw new Error(`Expected Boolean: ${step.field}`);
            checkType(scope, step.field, value);
            if (scope === 'self') {
                if (!owns(instance, step.field)) throw new Error(`Missing self property: ${step.field}`);
                instance[step.field] = structuredClone(value);
            } else locals[step.field] = structuredClone(value);
            trace.push({source_index: step.source_index, op: 'set', scope, field: step.field, value: structuredClone(value)});
        } else if (step.op === 'return') {
            const value = evaluate(step.value);
            const outputs = Object.create(null);
            for (const field of program.output_fields) {
                if (!owns(locals, field)) throw new Error(`Missing output property: ${field}`);
                outputs[field] = structuredClone(locals[field]);
            }
            trace.push({source_index: step.source_index, op: 'return', value: structuredClone(value)});
            return {value: structuredClone(value), outputs, state: instance, trace};
        } else throw new Error(`Unsupported Blueprint instruction: ${step.op}`);
    }
    throw new Error('Blueprint returned no result');
}
