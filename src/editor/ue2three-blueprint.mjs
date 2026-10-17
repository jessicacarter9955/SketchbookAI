// Executes normalized source-derived instructions; never evaluates generated JS.
import { evaluateNativeMath } from './ue2three-native-math.mjs';
const owns = (object, key) => object != null && Object.hasOwn(object, key);
const safeField = key => typeof key === 'string' && key.length > 0 && !['__proto__', 'constructor', 'prototype'].includes(key);
const validPrimitive = (type, value) => type === 'BoolProperty' && typeof value === 'boolean'
    || type === 'ByteProperty' && Number.isInteger(value) && value >= 0 && value <= 255
    || type === 'IntProperty' && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647
    || ['FloatProperty', 'DoubleProperty'].includes(type) && typeof value === 'number' && Number.isFinite(value)
    || ['StrProperty', 'NameProperty'].includes(type) && typeof value === 'string';
function validateSchema(schema, value, depth = 0) {
    if (!schema || depth > 16) throw new Error('Invalid source value schema');
    if (schema.type === 'ArrayProperty') {
        if (!Array.isArray(value) || value.length > 100000) throw new Error('Invalid typed source array');
        for (const item of value) validateSchema(schema.element, item, depth+1);
    } else if (schema.type === 'StructProperty') {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid typed source struct');
        for (const [field, child] of Object.entries(schema.fields || {})) {
            if (!safeField(field) || !owns(value, field)) throw new Error('Missing typed source struct field: ' + field);
            validateSchema(child, value[field], depth+1);
        }
    } else if (schema.type === 'ObjectProperty') {
        if (value !== null && (!value || typeof value !== 'object' || typeof value.asset !== 'string'
            || !/^\/(Game|Engine|Script)\/[A-Za-z0-9_\/.]+$/.test(value.asset)
            || JSON.stringify(value.declared_class) !== JSON.stringify(schema.class))) throw new Error('Invalid source asset identity');
    } else if (schema.type === 'TextProperty') {
        if (!value || typeof value.text !== 'string' || !Number.isInteger(value.flags) || value.flags < 0 || value.flags > 4294967295
            || !(value.history === 'empty' && value.text === '' || value.history === 'base' && typeof value.namespace === 'string'
                && typeof value.key === 'string')) throw new Error('Unsupported original FText');
    } else if (!validPrimitive(schema.type, value)) throw new Error('Invalid typed source member: ' + schema.type);
}

export function executeBlueprint(program, self = {}, inputs = {}, { functions = {}, frames = {}, tables = {} } = {}) {
    return runBlueprint(program, self, inputs, functions, { remaining: 10000 }, 0, structuredClone(frames), tables);
}

function runBlueprint(program, self, inputs, functions, budget, depth, frames, tables) {
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
    for (const [field, schema] of Object.entries(program.schemas?.local || {})) {
        if (!safeField(field)) throw new Error('Invalid local schema field');
        if (!owns(locals, field)) { validateSchema(schema, schema.default); locals[field] = structuredClone(schema.default); }
    }
    for (const [frame, types] of Object.entries(program.persistent_types || {})) {
        if (!/^[1-9][0-9]*$/.test(frame)) throw new Error('Invalid persistent frame identity');
        if (!owns(frames, frame)) frames[frame] = Object.create(null);
        for (const [field, type] of Object.entries(types)) {
            if (!safeField(field)) throw new Error('Invalid persistent frame field');
            if (!owns(frames[frame], field) && owns(primitiveDefaults, type)) frames[frame][field] = primitiveDefaults[type];
        }
    }
    const instance = structuredClone(self);
    if (Object.keys(instance).some(field => !safeField(field))) throw new Error('Invalid instance property');
    const trace = [];
    let sourceIndex;
    const checkType = (scope, field, value, frame) => {
        const type = scope === 'persistent' ? program.persistent_types?.[frame]?.[field] : program.field_types?.[scope]?.[field];
        if (scope === 'persistent' && !type) throw new Error('Unresolved persistent property type');
        const valid = !type
            || type === 'BoolProperty' && typeof value === 'boolean'
            || type === 'ByteProperty' && Number.isInteger(value) && value >= 0 && value <= 255
            || type === 'IntProperty' && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647
            || ['FloatProperty', 'DoubleProperty'].includes(type) && typeof value === 'number' && Number.isFinite(value)
            || ['StrProperty', 'NameProperty'].includes(type) && typeof value === 'string'
            || type === 'ArrayProperty' && Array.isArray(value)
            || type === 'ObjectProperty' && (value === null || typeof value === 'object')
            || type === 'StructProperty' && value !== null && typeof value === 'object' && !Array.isArray(value);
        if (!valid) throw new Error(`Unsupported or invalid ${type}: ${scope}.${field}`);
        const schema = program.schemas?.[scope]?.[field];
        if (schema) validateSchema(schema, value);
    };
    const evaluate = (expression, depth = 0) => {
        if (!expression || depth > 48) throw new Error('Invalid Blueprint expression');
        if (expression.op === 'typed_literal') {
            validateSchema(expression.schema, expression.value);
            return structuredClone(expression.value);
        }
        if (expression.op === 'table_get') {
            const reference = evaluate(expression.table, depth+1), row = evaluate(expression.row, depth+1), target = expression.target;
            const table = reference && owns(tables, reference.asset) ? tables[reference.asset] : null;
            if (!table || target?.op !== 'get' || target.scope !== 'local' || !safeField(target.field)
                || table.schema?.source !== expression.row_source || program.schemas?.local?.[target.field]?.source !== expression.row_source
                || typeof row !== 'string' || !row || /[^\x01-\x7f]/.test(row)) throw new Error('Unmigrated or incompatible original data table');
            const key = Object.keys(table.rows).find(name => name.toUpperCase() === row.toUpperCase());
            if (key !== undefined) {
                const value = table.rows[key]; validateSchema(program.schemas.local[target.field], value);
                locals[target.field] = structuredClone(value);
            }
            // UE leaves OutRow unchanged when the row is absent.
            trace.push({source_index: sourceIndex, op: 'table_get', table: reference.asset, row, found: key !== undefined});
            return key !== undefined;
        }
        if (expression.op === 'array_length') {
            const array = evaluate(expression.array, depth+1);
            if (!Array.isArray(array)) throw new Error('Invalid source Array_Length');
            return array.length;
        }
        if (expression.op === 'array_add') {
            const target = expression.target;
            if (target?.op !== 'get' || target.scope !== 'self' || !safeField(target.field))
                throw new Error('Unsupported Array_Add source destination');
            const schema = program.schemas?.self?.[target.field];
            if (!schema || schema.type !== 'ArrayProperty'
                || JSON.stringify(schema.element) !== JSON.stringify(expression.element))
                throw new Error('Unresolved original Array_Add element schema');
            const array = evaluate(target, depth+1);
            const item = evaluate(expression.item, depth+1);
            if (!Array.isArray(array)) throw new Error('Invalid original Array_Add source array');
            validateSchema(schema.element, item);
            if (array.length >= 100000) throw new Error('Array_Add exceeds maximum verified array size');
            const index = array.length;
            array.push(structuredClone(item));
            checkType('self', target.field, array);
            trace.push({source_index: sourceIndex, op: 'array_add', index, value: structuredClone(item)});
            return index;
        }
        if (expression.op === 'array_set') {
            const target = expression.target;
            if (target?.op !== 'get' || target.scope !== 'self' || !safeField(target.field))
                throw new Error('Unsupported Array_Set source destination');
            const schema = program.schemas?.self?.[target.field];
            if (!schema || schema.type !== 'ArrayProperty'
                || JSON.stringify(schema.element) !== JSON.stringify(expression.element))
                throw new Error('Unresolved original Array_Set element schema');
            const array = evaluate(target, depth+1);
            const index = evaluate(expression.index, depth+1);
            const item = evaluate(expression.item, depth+1);
            const sizeToFit = evaluate(expression.size_to_fit, depth+1);
            if (!Array.isArray(array) || !validPrimitive('IntProperty', index) || typeof sizeToFit !== 'boolean')
                throw new Error('Invalid original Array_Set index or size-to-fit flag');
            validateSchema(schema.element, item);
            // UE Set Array Elem writes only a valid nonnegative index. When
            // Size to Fit is true, zero-initialize skipped elements using the
            // *declared source element constructor*, never invented values.
            if (index < 0 || (index >= array.length && !sizeToFit)) {
                trace.push({source_index: sourceIndex, op: 'array_set', index, applied: false, size_to_fit: sizeToFit});
                return null;
            }
            if (index >= 100000) throw new Error('Array_Set exceeds maximum verified array size');
            if (index >= array.length) {
                validateSchema(schema.element, schema.element.default);
                while (array.length <= index) array.push(structuredClone(schema.element.default));
            }
            array[index] = structuredClone(item);
            checkType('self', target.field, array);
            trace.push({source_index: sourceIndex, op: 'array_set', index, applied: true, size_to_fit: sizeToFit});
            return null;
        }
        if (expression.op === 'array_get') {
            const array = evaluate(expression.array, depth+1), index = evaluate(expression.index, depth+1), target = expression.target;
            if (!Array.isArray(array) || !validPrimitive('IntProperty', index) || target?.op !== 'get'
                || !safeField(target.field) || !['local', 'self', 'persistent'].includes(target.scope)) throw new Error('Invalid source Array_Get');
            const inBounds = index >= 0 && index < array.length;
            const value = inBounds ? array[index] : expression.element?.default;
            validateSchema(expression.element, value); checkType(target.scope, target.field, value, target.frame);
            ownerFor(target.scope, target.frame)[target.field] = structuredClone(value);
            if (!inBounds) trace.push({source_index: sourceIndex, op: 'warning', message: 'Array_Get index out of bounds; original source type default restored'});
            trace.push({source_index: sourceIndex, op: 'array_get', index, in_bounds: inBounds, value: structuredClone(value)});
            return null;
        }
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
                    && ['self', 'local', 'persistent'].includes(binding.target.scope)) {
                    const owner = ownerFor(binding.target.scope, binding.target.frame);
                    if (owns(owner, binding.target.field)) args[binding.parameter] = structuredClone(owner[binding.target.field]);
                    targets.push(binding);
                } else throw new Error('Unsupported call argument');
            }
            const nested = runBlueprint(callee, instance, args, functions, budget, callDepth + 1, frames, tables);
            for (const binding of targets) {
                if (!owns(nested.outputs, binding.parameter)) throw new Error(`Missing call output: ${binding.parameter}`);
                checkType(binding.target.scope, binding.target.field, nested.outputs[binding.parameter], binding.target.frame);
            }
            Object.assign(instance, nested.state);
            for (const binding of targets) {
                const owner = ownerFor(binding.target.scope, binding.target.frame);
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
        if (expression.op === 'get' && safeField(expression.field) && ['self', 'local', 'persistent'].includes(expression.scope)) {
            const owner = ownerFor(expression.scope, expression.frame);
            if (!owns(owner, expression.field)) throw new Error(`Missing ${expression.scope} property: ${expression.field}`);
            checkType(expression.scope, expression.field, owner[expression.field], expression.frame);
            return owner[expression.field];
        }
        throw new Error(`Unsupported Blueprint expression: ${expression.op}`);
    };
    const ownerFor = (scope, frame) => {
        if (scope === 'self') return instance;
        if (scope === 'local') return locals;
        if (scope !== 'persistent' || !owns(program.persistent_types || {}, frame) || !owns(frames, frame))
            throw new Error('Unresolved persistent frame');
        return frames[frame];
    };
    const callDepth = depth;
    const flow = [];
    const jumpTarget = target => {
        if (!Number.isInteger(target) || target < 0 || target >= program.steps.length) throw new Error('Invalid Blueprint jump target');
        return target;
    };
    let pc = 0;
    while (pc < program.steps.length) {
        if (--budget.remaining < 0) throw new Error('Blueprint instruction budget exceeded');
        const step = program.steps[pc++];
        sourceIndex = step.source_index;
        if (step.op === 'nop') continue;
        if (step.op === 'push_flow') {
            if (flow.length >= 32) throw new Error('Blueprint flow stack exceeded');
            flow.push(jumpTarget(step.target));
            trace.push({source_index: sourceIndex, op: step.op, target: step.target});
            continue;
        }
        if (step.op === 'pop_flow') {
            let take = true;
            if (step.value) {
                const condition = evaluate(step.value);
                if (typeof condition !== 'boolean') throw new Error('Blueprint flow condition requires Boolean');
                take = !condition;
            }
            if (take) {
                if (!flow.length) throw new Error('Blueprint empty flow stack');
                pc = jumpTarget(flow.pop());
            }
            trace.push({source_index: sourceIndex, op: step.op, taken: take, target: take ? pc : null});
            continue;
        }
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
        if (step.op === 'set_member') {
            const target = step.target;
            if (target?.op !== 'get' || !safeField(step.field)) throw new Error('Invalid source struct assignment');
            const structure = evaluate(target), schema = program.schemas?.[target.scope]?.[target.field];
            if (!schema || schema.type !== 'StructProperty' || !owns(schema.fields, step.field)
                || schema.fields[step.field].type !== step.member_type) throw new Error('Unresolved source struct assignment type');
            const value = evaluate(step.value); validateSchema(schema.fields[step.field], value);
            structure[step.field] = structuredClone(value);
            trace.push({source_index: sourceIndex, op: 'set_member', scope: target.scope, field: target.field, member: step.field, value: structuredClone(value)});
            continue;
        }
        if (step.op === 'set' && safeField(step.field)) {
            const scope = step.scope || 'local';
            if (!['self', 'local', 'persistent'].includes(scope)) throw new Error('Invalid assignment scope');
            const value = evaluate(step.value);
            if (step.boolean && typeof value !== 'boolean') throw new Error(`Expected Boolean: ${step.field}`);
            checkType(scope, step.field, value, step.frame);
            if (scope === 'self') {
                if (!owns(instance, step.field)) throw new Error(`Missing self property: ${step.field}`);
                instance[step.field] = structuredClone(value);
            } else ownerFor(scope, step.frame)[step.field] = structuredClone(value);
            trace.push({source_index: step.source_index, op: 'set', scope, field: step.field, value: structuredClone(value)});
        } else if (step.op === 'return') {
            const value = evaluate(step.value);
            const outputs = Object.create(null);
            for (const field of program.output_fields) {
                if (!owns(locals, field)) throw new Error(`Missing output property: ${field}`);
                outputs[field] = structuredClone(locals[field]);
            }
            trace.push({source_index: step.source_index, op: 'return', value: structuredClone(value)});
            return {value: structuredClone(value), outputs, state: instance, frames, trace};
        } else throw new Error(`Unsupported Blueprint instruction: ${step.op}`);
    }
    throw new Error('Blueprint returned no result');
}
