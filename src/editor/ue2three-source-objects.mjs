import {sourceObjectValid} from './ue2three-objects.mjs';

const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
const safeName=name=>typeof name==='string'&&name.length>0&&!['__proto__','constructor','prototype'].includes(name);

function sourceActorStorage(native,reference,operation,{instance,queries={},world}={}) {
    if (operation?.op!=='source_actor_member'||!safeName(operation.field)
        ||operation.target_schema?.reference_kind!=='runtime_actor'
        ||!same(operation.target_schema.class,[operation.package,operation.class_object]))
        throw Error('Original source Actor member contract differs');
    sourceObjectValid(native,reference,operation.target_schema);
    const descriptor=native.actors[reference.actor_id];
    const query=Object.hasOwn(queries,operation.package)?queries[operation.package]:null;
    if (!query||descriptor.source_class!==operation.package||descriptor.class_object!==operation.class_object
        ||descriptor.source_owner_index!==operation.class_export_index
        ||query.source_owner_index!==operation.class_export_index
        ||query.source_sha256!==descriptor.source_sha256
        ||!same(query.field_schemas?.[operation.field],operation.schema)
        ||operation.declaring_package!==operation.package||operation.declaring_class!==operation.class_object
        ||operation.declaring_export_index!==operation.class_export_index)
        throw Error('Original source Actor member class or declaration binding is unavailable');
    const storage=native.source_package===operation.package ? instance : world?.[operation.package]?.state||query.state;
    if (!storage||!Object.hasOwn(storage,operation.field))
        throw Error('Original source Actor member storage is unavailable');
    return storage;
}

export function readSourceActorMember(native,reference,operation,environment) {
    return structuredClone(sourceActorStorage(native,reference,operation,environment)[operation.field]);
}

export function writeSourceActorMember(native,reference,operation,value,environment) {
    if (!environment?.world?.[operation.package])
        throw Error('Original source Actor write requires staged shared instance storage');
    const storage=sourceActorStorage(native,reference,operation,environment);
    if (storage!==environment.world[operation.package].state)
        throw Error('Original source Actor write lost staged shared storage');
    storage[operation.field]=structuredClone(value);
}
