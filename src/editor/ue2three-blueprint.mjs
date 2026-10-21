// Executes normalized source-derived instructions; never evaluates generated JS.
import { evaluateNativeMath } from './ue2three-native-math.mjs';
import { validActorReference, validComponentReference, sourceComponentOwner, sourceForceNetUpdate,
    sourceQueryReceiver, sourceObjectValid, sourceFindComponent } from './ue2three-objects.mjs';
const owns = (object, key) => object != null && Object.hasOwn(object, key);
const safeField = key => typeof key === 'string' && key.length > 0 && !['__proto__', 'constructor', 'prototype'].includes(key);
const validPrimitive = (type, value) => type === 'BoolProperty' && typeof value === 'boolean'
    || type === 'ByteProperty' && Number.isInteger(value) && value >= 0 && value <= 255
    || type === 'IntProperty' && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647
    || type === 'Int64Property' && Number.isSafeInteger(value)
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
    } else if (schema.type === 'ObjectProperty' || schema.type === 'ClassProperty') {
        if (schema.reference_kind === 'runtime_actor') {
            if (value !== null && !validActorReference(value)) throw new Error('Invalid source runtime actor reference');
            return;
        }
        if (schema.reference_kind === 'runtime_component') {
            if (value !== null && (!validComponentReference(value)
                || JSON.stringify(value.declared_class) !== JSON.stringify(schema.class))) throw new Error('Invalid original component reference');
            return;
        }
        if (value !== null && (!value || typeof value !== 'object' || typeof value.asset !== 'string'
            || !/^\/(Game|Engine|Script|ControlRig)\/[A-Za-z0-9_\/.]+$/.test(value.asset)
            || JSON.stringify(value.declared_class) !== JSON.stringify(schema.class)
            || schema.type === 'ClassProperty' && JSON.stringify(value.meta_class) !== JSON.stringify(schema.meta_class))) throw new Error('Invalid source asset identity');
    } else if (schema.type === 'TextProperty') {
        if (!value || typeof value.text !== 'string' || !Number.isInteger(value.flags) || value.flags < 0 || value.flags > 4294967295
            || !(value.history === 'empty' && value.text === '' || value.history === 'base' && typeof value.namespace === 'string'
                && typeof value.key === 'string')) throw new Error('Unsupported original FText');
    } else if (!validPrimitive(schema.type, value)) throw new Error('Invalid typed source member: ' + schema.type);
}

export function executeBlueprint(program, self = {}, inputs = {}, { functions = {}, frames = {}, tables = {}, bindings = {}, signatures = {}, native, queries = {}, receivers } = {}) {
    // All participating components are staged once. Callbacks observe their
    // active storage; callers commit the entire transaction only after success.
    const world = receivers && Object.fromEntries(Object.entries(receivers).map(([name, receiver]) => [name, {
        ...receiver, state:structuredClone(receiver.state), frames:structuredClone(receiver.frames || {}),
        bindings:structuredClone(receiver.bindings || {}), native:structuredClone(receiver.native)}]));
    const root = world?.[native?.source_package];
    if (world && (!root || JSON.stringify(root.state) !== JSON.stringify(self)
        || root.native?.source_owner_index !== program.source_owner_index)) throw new Error('Source transaction root differs');
    const result = runBlueprint(program, root?.state || self, inputs, functions, { remaining: 10000 }, 0,
        root?.frames || structuredClone(frames), tables,
        {bindings:root?.bindings || structuredClone(bindings), signatures, native:root?.native || structuredClone(native), queries, world, readWorld:world,
            rootPackage:native?.source_package,queryStack:native?.source_package ? [native.source_package] : [], effects: []});
    if (world) result.receivers = Object.fromEntries(Object.entries(world).map(([name, receiver]) => [name,
        {state:receiver.state, frames:receiver.frames, bindings:receiver.bindings}]));
    return result;
}

function runBlueprint(program, self, inputs, functions, budget, depth, frames, tables, notifications) {
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
    const primitiveDefaults = {BoolProperty: false, ByteProperty: 0, IntProperty: 0, Int64Property: 0,
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
            const schema = program.persistent_schemas?.[frame]?.[field];
            if (!owns(frames[frame], field) && schema) {
                validateSchema(schema, schema.default); frames[frame][field] = structuredClone(schema.default);
            }
        }
    }
    const receiver = notifications.world?.[notifications.native?.source_package];
    const instance = receiver ? receiver.state : structuredClone(self);
    if (receiver && receiver.state !== self) throw new Error('Source transaction lost active instance storage');
    if (Object.keys(instance).some(field => !safeField(field))) throw new Error('Invalid instance property');
    const trace = [];
    let sourceIndex;
    const emit = effect => notifications.effects.push(notifications.world && notifications.native.source_package !== notifications.rootPackage
        ? {...effect, package:notifications.native.source_package} : effect);
    const checkType = (scope, field, value, frame) => {
        const type = scope === 'persistent' ? program.persistent_types?.[frame]?.[field] : program.field_types?.[scope]?.[field];
        if (scope === 'persistent' && !type) throw new Error('Unresolved persistent property type');
        const valid = !type
            || type === 'BoolProperty' && typeof value === 'boolean'
            || type === 'ByteProperty' && Number.isInteger(value) && value >= 0 && value <= 255
            || type === 'IntProperty' && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647
            || type === 'Int64Property' && Number.isSafeInteger(value)
            || ['FloatProperty', 'DoubleProperty'].includes(type) && typeof value === 'number' && Number.isFinite(value)
            || ['StrProperty', 'NameProperty'].includes(type) && typeof value === 'string'
            || type === 'ArrayProperty' && Array.isArray(value)
            || type === 'ObjectProperty' && (value === null || typeof value === 'object')
            || type === 'StructProperty' && value !== null && typeof value === 'object' && !Array.isArray(value);
        if (!valid) throw new Error(`Unsupported or invalid ${type}: ${scope}.${field}`);
        const schema = scope === 'persistent' ? program.persistent_schemas?.[frame]?.[field] : program.schemas?.[scope]?.[field];
        if (schema) validateSchema(schema, value);
    };
    const schemaFor = target => target?.scope === 'persistent' ? program.persistent_schemas?.[target.frame]?.[target.field]
        : program.schemas?.[target?.scope]?.[target?.field];
    const evaluate = (expression, depth = 0) => {
        if (!expression || depth > 48) throw new Error('Invalid Blueprint expression');
        if (expression.op === 'native_game_time') {
            const context = notifications.native;
            if (!context || context.mode !== 'standalone' || context.net_drivers !== 0
                || context.world_context_bound !== true
                || expression.source_owner_index !== program.source_owner_index
                || context.source_owner_index !== program.source_owner_index
                || typeof context.game_time_seconds !== 'number' || !Number.isFinite(context.game_time_seconds)
                || context.game_time_seconds < 0)
                throw new Error('Original world game time is unavailable');
            return context.game_time_seconds;
        }
        if (expression.op === 'native_find_component') {
            const reference = evaluate(expression.target,depth+1);
            validateSchema(expression.actor_schema,reference);
            if (reference === null) {
                trace.push({source_index:sourceIndex,op:'warning',message:'Accessed None: GetComponentByClass context skipped'});
                return null;
            }
            return sourceFindComponent(notifications.native,reference,expression.actor_schema,
                expression.package,expression.class_object,expression.class_export_index);
        }
        if (expression.op === 'component_member') {
            const reference = evaluate(expression.target,depth+1);
            if (reference === null) {
                if (expression.schema?.type === 'StructProperty')
                    throw new Error('Unverified original struct ClearValue for a null component context');
                validateSchema(expression.schema,expression.schema?.default);
                trace.push({source_index:sourceIndex,op:'warning',message:'Accessed None: original component property default'});
                return structuredClone(expression.schema.default);
            }
            const descriptor = sourceQueryReceiver(notifications.native,reference,expression.package,expression.class_object);
            const query = owns(notifications.queries,expression.package) ? notifications.queries[expression.package] : null;
            if (!safeField(expression.field) || !query || query.source_sha256 !== descriptor.source_sha256
                || expression.class_export_index !== descriptor.class_export_index
                || JSON.stringify(query.field_schemas?.[expression.field]) !== JSON.stringify(expression.schema))
                throw new Error('Original component property schema or source differs');
            const ownReceiver = expression.package === notifications.native?.source_package;
            if (!notifications.readWorld && !ownReceiver && notifications.queryStack.includes(expression.package))
                throw new Error('Reentrant component property access requires shared active storage');
            const storage = ownReceiver ? instance : (notifications.readWorld?.[expression.package]?.state || query.state);
            if (!owns(storage,expression.field)) throw new Error('Original component property storage is unavailable');
            validateSchema(expression.schema,storage[expression.field]);
            return structuredClone(storage[expression.field]);
        }
        if (expression.op === 'native_object_valid') {
            const reference=evaluate(expression.target,depth+1);
            validateSchema(expression.schema,reference);
            return sourceObjectValid(notifications.native,reference,expression.schema);
        }
        if (expression.op === 'component_call') {
            const reference = evaluate(expression.target,depth+1);
            if (reference === null) {
                trace.push({source_index:sourceIndex,op:'warning',message:'Accessed None: original component call skipped'});
                return null;
            }
            const descriptor = sourceQueryReceiver(notifications.native,reference,expression.package,expression.class_object);
            const target = notifications.world?.[expression.package], callee = target?.functions?.[expression.function];
            if (!target || target.source_sha256 !== descriptor.source_sha256 || !callee
                || target.native?.source_package !== expression.package || target.native.world_context_bound !== true
                || target.native.source_owner_index !== descriptor.class_export_index
                || callee.source_owner_index !== descriptor.class_export_index || callee.source_export_index !== expression.export_index
                || expression.value_parameters_only !== true || callee.value_parameters_only !== true
                || !Array.isArray(expression.bindings) || !Array.isArray(callee.parameters)
                || expression.bindings.length !== callee.parameters.length)
                throw new Error('Original component mutation requires a bound transactional receiver and by-value signature');
            sourceQueryReceiver(target.native,reference,expression.package,expression.class_object);
            const args = Object.create(null);
            for (const [index,binding] of expression.bindings.entries()) {
                const parameter = callee.parameters[index];
                if (binding.mode !== 'input' || !safeField(binding.parameter) || owns(args,binding.parameter)
                    || parameter.name !== binding.parameter || JSON.stringify(parameter.schema) !== JSON.stringify(binding.schema))
                    throw new Error('Original component mutation parameter schema differs');
                const value = evaluate(binding.value,depth+1); validateSchema(binding.schema,value);
                args[binding.parameter] = structuredClone(value);
            }
            const nested = runBlueprint(callee,target.state,args,target.functions,budget,callDepth+1,target.frames,tables,
                {...notifications,bindings:target.bindings,signatures:target.signatures || {},native:target.native,
                    queryStack:[...notifications.queryStack,expression.package]});
            trace.push({source_index:sourceIndex,op:'component_call',package:expression.package,function:expression.function,
                outputs:structuredClone(nested.outputs),trace:nested.trace});
            return nested.value;
        }
        if (expression.op === 'component_query') {
            const reference=evaluate(expression.target,depth+1);
            if (reference === null) {
                // These admitted calls have out parameters and no return value:
                // UE skips the call and leaves caller-owned out storage intact.
                trace.push({source_index:sourceIndex,op:'warning',message:'Accessed None: original component query skipped'});
                return null;
            }
            const descriptor=sourceQueryReceiver(notifications.native,reference,expression.package,expression.class_object);
            if (notifications.queryStack.includes(expression.package)) throw new Error('Reentrant original component queries require shared active storage');
            const query=owns(notifications.queries,expression.package) ? notifications.queries[expression.package] : null;
            const callee=query?.functions?.[expression.function];
            if (!query || query.source_sha256 !== descriptor.source_sha256 || !callee
                || callee.source_owner_index !== descriptor.class_export_index || callee.source_export_index !== expression.export_index
                || !Array.isArray(callee.self_writes) || callee.self_writes.length || Object.keys(callee.persistent_types || {}).length
                || !Array.isArray(expression.bindings)) throw new Error('Untranslated or effectful original component query');
            const args=Object.create(null),targets=[];
            for (const binding of expression.bindings) {
                if (!safeField(binding.parameter) || owns(args,binding.parameter)) throw new Error('Invalid component query parameter');
                if (binding.mode === 'input') {
                    const value=evaluate(binding.value,depth+1);validateSchema(binding.schema,value);
                    args[binding.parameter]=structuredClone(value);
                } else if (binding.mode === 'output' && binding.target?.op === 'get' && safeField(binding.target.field)
                    && ['local','self','persistent'].includes(binding.target.scope)) {
                    const owner=ownerFor(binding.target.scope,binding.target.frame);
                    if (owns(owner,binding.target.field)) args[binding.parameter]=structuredClone(owner[binding.target.field]);
                    targets.push(binding);
                } else throw new Error('Unsupported original component query binding');
            }
            const queryState = notifications.readWorld?.[expression.package]?.state || query.state;
            const nested=runBlueprint(callee,queryState,args,query.functions,budget,callDepth+1,{},tables,
                {bindings:{},signatures:query.signatures || {},native:structuredClone(query.native),queries:notifications.queries,readWorld:notifications.readWorld,
                    queryStack:[...notifications.queryStack,expression.package],effects:[]});
            if (nested.effects.length || Object.keys(nested.frames).length || JSON.stringify(nested.state) !== JSON.stringify(queryState))
                throw new Error('Original component query attempted a state change or effect');
            for (const binding of targets) {
                if (!owns(nested.outputs,binding.parameter)) throw new Error('Missing original component query output');
                checkType(binding.target.scope,binding.target.field,nested.outputs[binding.parameter],binding.target.frame);
            }
            for (const binding of targets) ownerFor(binding.target.scope,binding.target.frame)[binding.target.field]=structuredClone(nested.outputs[binding.parameter]);
            trace.push({source_index:sourceIndex,op:'component_query',package:expression.package,function:expression.function,
                outputs:structuredClone(nested.outputs),trace:nested.trace});
            return nested.value;
        }
        if (expression.op === 'native_get_owner') {
            if (expression.source_owner_index !== program.source_owner_index) throw new Error('Original component class differs');
            return sourceComponentOwner(notifications.native, expression.source_owner_index);
        }
        if (expression.op === 'native_force_net_update') {
            const reference = evaluate(expression.target, depth+1);
            if (reference === null) {
                trace.push({source_index:sourceIndex,op:'warning',message:'Accessed None: Actor.ForceNetUpdate context skipped'});
                return null;
            }
            emit(sourceForceNetUpdate(notifications.native, reference));
            return null;
        }
        if (expression.op === 'typed_literal') {
            validateSchema(expression.schema, expression.value);
            return structuredClone(expression.value);
        }
        if (expression.op === 'struct_literal') {
            if (expression.schema?.type !== 'StructProperty' || !expression.fields
                || Object.keys(expression.fields).length !== Object.keys(expression.schema.fields).length)
                throw new Error('Invalid original struct literal');
            const value = Object.create(null);
            for (const field of expression.schema.member_order || []) {
                if (!safeField(field) || !owns(expression.fields, field)) throw new Error('Invalid original struct member order');
                value[field] = evaluate(expression.fields[field], depth+1);
            }
            validateSchema(expression.schema, value);
            return structuredClone(value);
        }
        if (expression.op === 'mark_dirty') {
            if (!safeField(expression.field)
                || !validPrimitive('IntProperty', expression.source_rep_index) || expression.source_rep_index < 0)
                throw new Error('Invalid original dirty-property witness');
            emit({op: 'mark_dirty', field: expression.field, source_rep_index: expression.source_rep_index});
            return null;
        }
        if (expression.op === 'broadcast') {
            const signature = notifications.signatures[expression.delegate];
            if (!safeField(expression.delegate) || !signature || signature.export_index !== expression.export_index
                || JSON.stringify(signature.parameters) !== JSON.stringify(expression.parameters)
                || !Array.isArray(expression.args) || expression.args.length !== signature.parameters.length)
                throw new Error('Unresolved original multicast declaration');
            const values = expression.args.map((arg, index) => {
                const value = evaluate(arg, depth+1); validateSchema(signature.parameters[index].schema, value);
                return structuredClone(value);
            });
            const listeners = notifications.bindings[expression.delegate] || [];
            if (!Array.isArray(listeners)) throw new Error('Invalid original delegate listener list');
            emit({op: 'broadcast', delegate: expression.delegate,
                parameters: Object.fromEntries(signature.parameters.map((param, index) => [param.name, values[index]])), listeners: listeners.length});
            // UE copies the multicast invocation list and visits it in insertion order.
            for (const listener of [...listeners]) {
                const callee = owns(functions, listener.function) ? functions[listener.function] : null;
                if (!callee || callee.source_export_index !== listener.export_index || callee.source_owner_index !== program.source_owner_index
                    || !Array.isArray(callee.parameters) || callee.parameters.length !== signature.parameters.length
                    || callee.parameters.some((param, index) => !safeField(param.name) || !param.schema
                        || JSON.stringify(param.schema) !== JSON.stringify(signature.parameters[index].schema)))
                    throw new Error('Untranslated or incompatible original delegate handler');
                const args = Object.fromEntries(callee.parameters.map((param, index) => [param.name, values[index]]));
                const nested = runBlueprint(callee, instance, args, functions, budget, callDepth+1, frames, tables, notifications);
                Object.assign(instance, nested.state);
                trace.push({source_index: sourceIndex, op: 'delegate_handler', delegate: expression.delegate, function: listener.function, trace: nested.trace});
            }
            return null;
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
        if (expression.op === 'array_valid') {
            const array = evaluate(expression.array, depth+1), index = evaluate(expression.index, depth+1);
            if (!Array.isArray(array) || !validPrimitive('IntProperty', index)) throw new Error('Invalid source Array_IsValidIndex');
            return index >= 0 && index < array.length;
        }
        if (expression.op === 'array_mutate') {
            const target = expression.target;
            if (target?.op !== 'get' || !safeField(target.field) || !['local', 'self', 'persistent'].includes(target.scope)
                || schemaFor(target)?.type !== 'ArrayProperty'
                || JSON.stringify(schemaFor(target)?.element) !== JSON.stringify(expression.element))
                throw new Error('Unresolved typed source array mutation');
            const array = evaluate(target, depth+1), operation = expression.operation;
            if (!Array.isArray(array)) throw new Error('Invalid source array mutation');
            const index = expression.index ? evaluate(expression.index, depth+1) : null;
            if (['Array_Set', 'Array_Remove'].includes(operation) && !validPrimitive('IntProperty', index)) throw new Error('Invalid source array index');
            const value = expression.value ? structuredClone(evaluate(expression.value, depth+1)) : null;
            let result = null, inBounds = index >= 0 && index < array.length;
            if (operation === 'Array_Set') {
                const resize = evaluate(expression.resize, depth+1);
                if (typeof resize !== 'boolean') throw new Error('Invalid source Array_Set resize flag');
                validateSchema(expression.element, value);
                if (resize && index >= 0) {
                    if (index >= 100000) throw new Error('Source array resource limit exceeded');
                    while (array.length <= index) { validateSchema(expression.element, expression.element.default); array.push(structuredClone(expression.element.default)); }
                    inBounds = true;
                }
                if (inBounds) array[index] = value;
            } else if (operation === 'Array_Remove') { if (inBounds) array.splice(index, 1); }
            else if (operation === 'Array_Clear') array.length = 0;
            else if (operation === 'Array_Add') {
                validateSchema(expression.element, value);
                if (array.length >= 100000) throw new Error('Source array resource limit exceeded');
                result = array.length; array.push(value);
            } else if (operation === 'Array_Append') {
                if (!Array.isArray(value) || array.length+value.length > 100000) throw new Error('Invalid or oversized source array append');
                for (const item of value) validateSchema(expression.element, item);
                // Copying the source first also preserves UE's self-append behavior.
                for (const item of value) array.push(item);
            } else throw new Error('Unsupported source array mutation');
            if (['Array_Set', 'Array_Remove'].includes(operation) && !inBounds)
                trace.push({source_index: sourceIndex, op: 'warning', message: operation+' index out of bounds; source array unchanged'});
            trace.push({source_index: sourceIndex, op: 'array_mutate', operation, scope: target.scope, field: target.field,
                index, in_bounds: inBounds, length: array.length});
            return result;
        }
        if (expression.op === 'array_literal') {
            const target = expression.target, schema = schemaFor(target);
            if (target?.op !== 'get' || !safeField(target.field) || !['local', 'self', 'persistent'].includes(target.scope)
                || schema?.type !== 'ArrayProperty' || JSON.stringify(schema.element) !== JSON.stringify(expression.element)
                || !Array.isArray(expression.elements) || expression.elements.length > 100000)
                throw new Error('Unresolved typed source array literal');
            let array = evaluate(target, depth+1);
            if (!Array.isArray(array)) throw new Error('Invalid source SetArray destination');
            array.length = 0;
            const canMutate = value => value && typeof value === 'object' &&
                (['call','array_literal','array_mutate','array_add','array_set'].includes(value.op) || Object.values(value).some(canMutate));
            for (const item of expression.elements) {
                // execSetArray constructs each slot BEFORE evaluating its source.
                validateSchema(schema.element, schema.element.default);
                const index = array.length; array.push(structuredClone(schema.element.default));
                const before = canMutate(item) ? JSON.stringify(array) : null;
                const value = structuredClone(evaluate(item, depth+1));
                // A transactional nested call may replace the state with a copy.
                // Reacquire that copy; actual reentrant destination writes fail.
                array = evaluate(target, depth+1);
                if (array.length !== index+1 || before !== null && JSON.stringify(array) !== before)
                    throw new Error('Reentrant SetArray destination mutation is unsupported');
                validateSchema(schema.element, value); array[index] = value;
            }
            trace.push({source_index:sourceIndex,op:'array_literal',scope:target.scope,field:target.field,length:array.length});
            return null;
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
            const nested = runBlueprint(callee, instance, args, functions, budget, callDepth + 1, frames, tables, notifications);
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
        if (expression.op === 'native_call') {
            const identity = ['/Script/Engine', 'KismetStringLibrary', 'Concat_StrStr'];
            const parameterTypes = ['StrProperty', 'StrProperty'];
            if (JSON.stringify(expression.identity) !== JSON.stringify(identity)
                || JSON.stringify(expression.parameter_types) !== JSON.stringify(parameterTypes)
                || expression.return_type !== 'StrProperty' || !Array.isArray(expression.args)
                || expression.args.length !== parameterTypes.length)
                throw new Error('Unsupported original native object call');
            const values = expression.args.map((argument, index) => {
                let sourceType = null;
                if (argument?.op === 'typed_literal') sourceType = argument.schema?.type;
                else if (argument?.op === 'get') {
                    const schemaType = schemaFor(argument)?.type;
                    const declaredType = argument.scope === 'persistent' ? program.persistent_types?.[argument.frame]?.[argument.field]
                        : program.field_types?.[argument.scope]?.[argument.field];
                    if (schemaType && declaredType && schemaType !== declaredType)
                        throw new Error('Original native object parameter schema differs');
                    sourceType = schemaType || declaredType || null;
                }
                if (sourceType !== parameterTypes[index]) throw new Error('Original native object parameter type differs');
                const value = evaluate(argument, depth+1);
                if (typeof value !== 'string') throw new Error('Invalid original native object string parameter');
                return value;
            });
            return values[0] + values[1];
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
            const schema = schemaFor(target);
            if (!schema || schema.type !== 'StructProperty' || !owns(schema.fields, step.field)
                || schema.fields[step.field].type !== step.member_type) throw new Error('Unresolved source struct assignment type');
            const value = evaluate(step.value); validateSchema(schema.fields[step.field], value);
            // An original nested call can assign this same source property.
            // Reacquire its storage after evaluating the RHS, as its VM address
            // still denotes that property rather than an obsolete JS object.
            const structure = evaluate(target); validateSchema(schema,structure);
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
            // Nested calls share a staged effect journal. Copying its entire
            // growing prefix at every return is quadratic for source loops.
            return {value: structuredClone(value), outputs, state: instance, frames, trace,
                effects:callDepth === 0 ? structuredClone(notifications.effects) : notifications.effects};
        } else throw new Error(`Unsupported Blueprint instruction: ${step.op}`);
    }
    throw new Error('Blueprint returned no result');
}
