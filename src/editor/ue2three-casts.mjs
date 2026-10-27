import { sourceObjectValid } from './ue2three-objects.mjs';

const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const nativeParents = new Map([
    [JSON.stringify(['/Script/Engine','Character']), ['/Script/Engine','Pawn']],
    [JSON.stringify(['/Script/Engine','Pawn']), ['/Script/Engine','Actor']],
    [JSON.stringify(['/Script/Engine','Actor']), null],
    [JSON.stringify(['/Script/Engine','ActorComponent']), null],
]);
const validClass = identity => Array.isArray(identity) && identity.length === 2
    && typeof identity[0] === 'string' && /^\/(Game|Script)\/[A-Za-z0-9_/.]+$/.test(identity[0])
    && typeof identity[1] === 'string' && /^[A-Za-z0-9_]+$/.test(identity[1]);

function validateLineage(lineage, target) {
    if (!Array.isArray(lineage) || !lineage.length || lineage.length > 32 || !same(lineage[0]?.class,target))
        throw new Error('Original DynamicCast class hierarchy is unavailable');
    const seen = new Set();
    for (const [index,row] of lineage.entries()) {
        if (!validClass(row?.class) || seen.has(JSON.stringify(row.class)))
            throw new Error('Original DynamicCast class hierarchy is invalid');
        seen.add(JSON.stringify(row.class));
        const next = lineage[index+1]?.class || null;
        if (row.native === true) {
            const parent = nativeParents.get(JSON.stringify(row.class));
            if (parent === undefined || !same(parent,next)) throw new Error('Original DynamicCast native inheritance differs');
        } else if (!Number.isSafeInteger(row.export_index) || row.export_index < 1
            || !same(row.super,next) || !row.class[0].startsWith('/Game/'))
            throw new Error('Original DynamicCast source inheritance differs');
    }
}

export function sourceDynamicCast(context, reference, operation) {
    if (operation?.dispatch !== 'EX_DynamicCast') throw new Error('Original DynamicCast dispatch differs');
    validateLineage(operation.class_lineage,operation.target_class);
    const schema=operation.schema;
    const base=operation.class_lineage.at(-1).class;
    const expectedKind=same(base,['/Script/Engine','Actor']) ? 'runtime_actor' : 'runtime_component';
    if (schema?.type !== 'ObjectProperty' || schema.reference_kind !== expectedKind
        || !same(schema.class,operation.target_class) || schema.default !== null)
        throw new Error('Original DynamicCast result schema differs');
    if (reference === null) return null;
    const input=operation.input_schema;
    if (!input || input.type !== 'ObjectProperty' || !['runtime_actor','runtime_component'].includes(input.reference_kind))
        throw new Error('Original DynamicCast input is not a bound live object');
    sourceObjectValid(context,reference,input);
    if (input.reference_kind === 'runtime_component') {
        // Current source component bindings contain direct ActorComponent
        // subclasses. Preserve the exact handle rather than invent a proxy.
        if (expectedKind !== 'runtime_component') return null;
        if (same(reference.declared_class,operation.target_class)) {
            const bound=context.components?.[reference.component_variable];
            const witness=operation.class_lineage[0];
            if (witness.export_index !== bound?.class_export_index
                || !same(witness.super,['/Script/Engine','ActorComponent']))
                throw new Error('Original DynamicCast live component class witness differs');
            return structuredClone(reference);
        }
        if (same(operation.target_class,['/Script/Engine','ActorComponent']))
            throw new Error('Native base component cast requires a polymorphic component handle');
        return null;
    }
    if (expectedKind !== 'runtime_actor') return null;
    const descriptor=context.actors[reference.actor_id];
    const actual=[descriptor.source_class,descriptor.class_object];
    const sourceRow=operation.class_lineage.find(row=>same(row.class,actual));
    const target=operation.target_class;
    if (target[0].startsWith('/Game/')) {
        if (!same(actual,target)) return null;
        if (!sourceRow || sourceRow.export_index !== descriptor.source_owner_index
            || !same(sourceRow.super,descriptor.native_base))
            throw new Error('Original DynamicCast live class witness differs');
        return structuredClone(reference);
    }
    let current=descriptor.native_base;
    const seen=new Set();
    while (current && !seen.has(JSON.stringify(current))) {
        seen.add(JSON.stringify(current));
        if (same(current,target)) return structuredClone(reference);
        current=nativeParents.get(JSON.stringify(current));
        if (current === undefined) throw new Error('Original DynamicCast live native ancestry is unresolved');
    }
    return null;
}
