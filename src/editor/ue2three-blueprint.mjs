// Executes normalized source-derived instructions; never evaluates generated JS.
import { evaluateNativeMath } from './ue2three-native-math.mjs';
const owns = (object, key) => object != null && Object.hasOwn(object, key);
const safeField = key => typeof key === 'string' && key.length > 0 && !['__proto__', 'constructor', 'prototype'].includes(key);

export function executeBlueprint(program, self = {}, inputs = {}, { functions = {} } = {}) {
    return runBlueprint(program, self, inputs, functions, { remaining: 10000 }, 0);
}

function runBlueprint(program, self, inputs, functions, budget, depth) {
    if (depth > 32) throw new Error('Blueprint call depth exceeded');
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
    if (Object.keys(instance).some(field => !safeField(field))) throw new Error('Invalid instance property');
    const trace = [];
    let sourceIndex;
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
        if (expression.op === 'call') {
            const callee = owns(functions, expression.function) ? functions[expression.function] : null;
            if (!callee || callee.source_export_index !== expression.export_index
                || callee.source_owner_index !== program.source_owner_index || !Array.isArray(expression.bindings))
                throw new Error(`Untranslated or mismatched function dependency: ${expression.function}`);
            const args = Object.create(null), targets = [];
            for (const binding of expression.bindings) {
                if (!safeField(binding.parameter) || owns(args, binding.parameter)) throw new Error('Invalid call parameter');
                if (binding.mode === 'input') args[binding.parameter] = structuredClone(evaluate(binding.value, depth+1));
                else if (binding.mode === 'output' && binding.target?.op === 'get' && safeField(binding.target.field)
                    && ['self', 'local'].includes(binding.target.scope)) {
                    const owner = binding.target.scope === 'self' ? instance : locals;
                    if (owns(owner, binding.target.field)) args[binding.parameter] = structuredClone(owner[binding.target.field]);
                    targets.push(binding);
                } else throw new Error('Unsupported call argument');
            }
            const nested = runBlueprint(callee, instance, args, functions, budget, callDepth + 1);
            for (const binding of targets) {
                if (!owns(nested.outputs, binding.parameter)) throw new Error(`Missing call output: ${binding.parameter}`);
                checkType(binding.target.scope, binding.target.field, nested.outputs[binding.parameter]);
            }
            Object.assign(instance, nested.state);
            for (const binding of targets) {
                const owner = binding.target.scope === 'self' ? instance : locals;
                owner[binding.target.field] = structuredClone(nested.outputs[binding.parameter]);
            }
            trace.push({source_index: sourceIndex, op: 'call', function: expression.function, outputs: nested.outputs, trace: nested.trace});
            return nested.value;
        }
        if (expression.op === 'math' && Array.isArray(expression.args)) {
            const args = expression.args.map(arg => evaluate(arg, depth+1));
            const value = evaluateNativeMath(expression.name, args, message => trace.push({source_index: sourceIndex, op: 'warning', message}));
            if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite native math result is unsupported');
            return value;
        }
        if (expression.op === 'constant') {
            const value = expression.value;
            if (value !== null && !['string', 'boolean', 'number'].includes(typeof value)
                || typeof value === 'number' && !Number.isFinite(value)) throw new Error('Invalid Blueprint constant');
            return value;
        }
        if (expression.op === 'member' && safeField(expression.field)) {
            const structure = evaluate(expression.value, depth+1);
            if (!structure || typeof structure !== 'object' || Array.isArray(structure) || !owns(structure, expression.field))
                throw new Error(`Missing source struct member: ${expression.field}`);
            return structuredClone(structure[expression.field]);
        }
        if (expression.op === 'get' && safeField(expression.field) && ['self', 'local'].includes(expression.scope)) {
            const owner = expression.scope === 'self' ? instance : locals;
            if (!owns(owner, expression.field)) throw new Error(`Missing ${expression.scope} property: ${expression.field}`);
            checkType(expression.scope, expression.field, owner[expression.field]);
            return owner[expression.field];
        }
        throw new Error(`Unsupported Blueprint expression: ${expression.op}`);
    };
    const callDepth = depth;
    let pc = 0;
    while (pc < program.steps.length) {
        if (--budget.remaining < 0) throw new Error('Blueprint instruction budget exceeded');
        const step = program.steps[pc++];
        sourceIndex = step.source_index;
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
        if (step.op === 'evaluate') { evaluate(step.value); continue; }
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
