// A source actor binding contains identity, not an executable UObject proxy.
const owns = (object, key) => object != null && Object.hasOwn(object, key);
const bases = new Set(['Actor', 'Pawn', 'Character']);
const safeName = name => typeof name === 'string' && name && !['__proto__', 'constructor', 'prototype'].includes(name);
const nativeComponentClasses = new Set([
    ...['ActorComponent','SceneComponent','PrimitiveComponent','MeshComponent','SkeletalMeshComponent',
        'StaticMeshComponent','CapsuleComponent','CameraComponent','SpringArmComponent','AudioComponent']
        .map(name => JSON.stringify(['/Script/Engine',name])),
    JSON.stringify(['/Script/Niagara','NiagaraComponent']),
    JSON.stringify(['/Script/HairStrandsCore','GroomComponent']),
]);
export const validActorReference = value => value !== null && typeof value === 'object' && !Array.isArray(value)
    && typeof value.realm === 'string' && value.realm.length > 0
    && typeof value.actor_id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value.actor_id)
    && JSON.stringify(value.declared_class) === JSON.stringify(['/Script/Engine', 'Actor']);
export const validComponentReference = value => value !== null && typeof value === 'object' && !Array.isArray(value)
    && typeof value.realm === 'string' && value.realm.length > 0 && typeof value.actor_id === 'string'
    && /^[A-Za-z0-9_-]{1,128}$/.test(value.actor_id) && safeName(value.component_variable)
    && Array.isArray(value.declared_class) && value.declared_class.length === 2
    && /^\/Game\/[A-Za-z0-9_/.]+$/.test(value.declared_class[0]) && safeName(value.declared_class[1]);
export const validNativeComponentReference = value => value !== null && typeof value === 'object' && !Array.isArray(value)
    && value.kind === 'source_native_component' && typeof value.realm === 'string' && value.realm.length > 0
    && typeof value.actor_id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value.actor_id)
    && typeof value.source_package === 'string' && /^\/Game\/[A-Za-z0-9_/.]+$/.test(value.source_package)
    && Number.isSafeInteger(value.source_owner_index) && value.source_owner_index > 0 && safeName(value.source_field)
    && Array.isArray(value.declared_class) && value.declared_class.length === 2
    && nativeComponentClasses.has(JSON.stringify(value.declared_class));
const actorBase = identity => Array.isArray(identity) && identity.length === 2 && identity[0] === '/Script/Engine' && bases.has(identity[1]);

function standalone(context) {
    if (!context || context.mode !== 'standalone' || context.net_drivers !== 0)
        throw new Error('Native actor calls require an explicit standalone binding without game/demo net drivers');
}
function actor(context, reference) {
    if (!validActorReference(reference) || reference.realm !== context.realm || !owns(context.actors, reference.actor_id))
        throw new Error('Unbound or foreign source actor reference');
    const descriptor = context.actors[reference.actor_id];
    if (JSON.stringify(descriptor.reference) !== JSON.stringify(reference) || !actorBase(descriptor.native_base)
        || descriptor.force_net_update_override !== false) throw new Error('Unsupported source actor class or native override');
    return descriptor;
}
function sourceNativeComponent(context, reference, schema) {
    standalone(context);
    if (!validNativeComponentReference(reference) || reference.realm !== context.realm
        || JSON.stringify(reference.declared_class) !== JSON.stringify(schema?.class))
        throw new Error('Unbound or incompatible source native component reference');
    const owner = context.actors?.[reference.actor_id];
    if (context.world_context_bound !== true || !owner || owner.source_class !== reference.source_package
        || owner.source_owner_index !== reference.source_owner_index
        || owner.native_component_bindings_complete !== true)
        throw new Error('Source native component owner binding is unavailable');
    actor(context, owner.reference);
    const descriptor = context.native_components?.[reference.source_field];
    if (!descriptor || JSON.stringify(descriptor.reference) !== JSON.stringify(reference))
        throw new Error('Unbound or foreign source native component reference');
    return descriptor;
}
export function sourceComponentOwner(context, ownerIndex) {
    standalone(context);
    if (!owns(context, 'owner') || context.component_class_export_index !== ownerIndex)
        throw new Error('Original component owner binding is unavailable');
    if (context.owner !== null) actor(context, context.owner);
    return structuredClone(context.owner);
}
export function sourceNativeComponentOwner(context, reference, schema) {
    sourceNativeComponent(context,reference,schema);
    const owner=context.actors[reference.actor_id]?.reference;
    if (!owner) throw new Error('Original native component owner binding is unavailable');
    actor(context,owner);
    return structuredClone(owner);
}
export function sourceForceNetUpdate(context, reference) {
    standalone(context);
    const descriptor = actor(context, reference);
    // AActor::ForceNetUpdate has no networking effect without active drivers.
    // Keep a call receipt so this cannot be mistaken for implemented replication.
    return {op:'force_net_update', actor_id:reference.actor_id, actor_class:descriptor.source_class, scope:'standalone_no_drivers'};
}

export function sourceQueryReceiver(context, reference, packageName, classObject) {
    standalone(context);
    if (!validComponentReference(reference) || reference.realm !== context.realm
        || JSON.stringify(reference.declared_class) !== JSON.stringify([packageName,classObject]))
        throw new Error('Unbound or incompatible original component query receiver');
    const descriptor = context.components?.[reference.component_variable];
    if (!descriptor || JSON.stringify(descriptor.reference) !== JSON.stringify(reference))
        throw new Error('Unbound or foreign original component query receiver');
    const owner = context.actors?.[reference.actor_id];
    if (!owner) throw new Error('Original component query owner is unavailable');
    actor(context, owner.reference);
    return descriptor;
}

export function sourceObjectValid(context, reference, schema) {
    if (reference === null) return false;
    if (schema?.reference_kind === 'runtime_native_widget') {
        const widgetClass=schema.class;
        if (!context || !Array.isArray(widgetClass) || widgetClass.length!==2 || widgetClass[0]!=='/Script/UMG'
            || !safeName(widgetClass[1]) || reference?.kind!=='source_native_widget'
            || !/^\/Game\/[A-Za-z0-9_/.]+$/.test(reference.source_package || '')
            || !Number.isSafeInteger(reference.source_owner_index) || reference.source_owner_index<=0
            || !safeName(reference.source_field) || !/^[A-Za-z0-9_-]{1,128}$/.test(reference.widget_id || '')
            || JSON.stringify(reference.declared_class)!==JSON.stringify(widgetClass)
            || reference.source_package!==context.source_package
            || reference.source_owner_index!==context.source_owner_index)
            throw new Error('Unbound or foreign original UMG widget reference');
        const descriptor=context.widgets?.[reference.source_field];
        if (!descriptor || descriptor.binding_complete!==true || descriptor.source_owner_index!==reference.source_owner_index
            || descriptor.source_field!==reference.source_field || JSON.stringify(descriptor.declared_class)!==JSON.stringify(widgetClass)
            || JSON.stringify(descriptor.reference)!==JSON.stringify(reference))
            throw new Error('Original UMG widget source binding is unavailable');
        return true;
    }
    if (schema?.reference_kind === 'runtime_component') {
        sourceQueryReceiver(context, reference, schema.class[0], schema.class[1]);
        return true;
    }
    if (schema?.reference_kind === 'runtime_native_component') {
        sourceNativeComponent(context, reference, schema);
        return true;
    }
    standalone(context);
    const descriptor = actor(context, reference);
    const expected = schema?.class;
    const valid = actorBase(expected)
        ? expected[1] === 'Actor' || descriptor.native_base[1] === expected[1]
            || expected[1] === 'Pawn' && descriptor.native_base[1] === 'Character'
        : expected?.[0] === descriptor.source_class && expected?.[1] === descriptor.class_object;
    if (!valid) throw new Error('Original live actor class differs from IsValid receiver schema');
    // Bound descriptors have no implemented destruction/GC lifecycle. Unknown
    // objects reject instead of being assumed alive from a non-null JS object.
    return true;
}

export function sourceActorRole(context, reference, schema, method) {
    if (!['HasAuthority','GetLocalRole','GetRemoteRole'].includes(method))
        throw new Error('Unsupported original Actor role query');
    sourceObjectValid(context,reference,schema);
    const descriptor=actor(context,reference);
    const role=descriptor[method==='GetRemoteRole' ? 'remote_role' : 'local_role'];
    if (!Number.isInteger(role) || role<0 || role>3)
        throw new Error('Original live Actor network role binding is unavailable');
    return method==='HasAuthority' ? role===3 : role;
}

export function sourceFindComponent(context, reference, actorSchema, packageName, classObject, classIndex) {
    sourceObjectValid(context, reference, actorSchema);
    const descriptor = actor(context, reference);
    if (descriptor.component_lookup_complete !== true)
        throw new Error('Original component lookup includes unresolved classes or lifecycle');
    if (descriptor.unbound_component_classes?.some(identity => JSON.stringify(identity) === JSON.stringify([packageName,classObject])))
        throw new Error('Original matching component has an unavailable template binding');
    const candidates = Object.values(context.components || {}).filter(component =>
        component.reference?.actor_id === reference.actor_id
        && JSON.stringify(component.reference.declared_class) === JSON.stringify([packageName,classObject]));
    // UE uses the first matching component. Multiple matches and dynamic
    // construction are not admitted until their original order is represented.
    if (candidates.length > 1) throw new Error('Original component lookup order is unavailable');
    if (!candidates.length) return null;
    const component = candidates[0];
    sourceQueryReceiver(context, component.reference, packageName, classObject);
    if (component.class_export_index !== classIndex) throw new Error('Original component lookup class differs');
    return structuredClone(component.reference);
}

export class SourceActorBindings {
    constructor(report) {
        this.report = report;
        this.realm = crypto.randomUUID();
        this.root = null;
        this.target = null;
        this.components = new Map();
        this.nativeComponents = new Map();
    }
    bind(sourceClass, target) {
        if (this.root) {
            if (this.root.source_class === sourceClass && this.target === target) return this.describe();
            throw new Error('A runtime instance already owns a different source actor');
        }
        const graph = owns(this.report.actor_graph?.roots, sourceClass) ? this.report.actor_graph.roots[sourceClass] : null;
        const data = owns(this.report.packages, sourceClass) ? this.report.packages[sourceClass] : null;
        const meta = data?.class_metadata;
        if (!target || typeof target !== 'object' || !graph || !actorBase(graph.native_base)
            || graph.force_net_update_override !== false || !meta || meta.force_net_update_override !== false
            || graph.export_index !== meta.export_index || graph.object !== meta.object
            || JSON.stringify(graph.native_base) !== JSON.stringify(meta.native_base)
            || graph.source?.source_sha256 !== data.source?.source_sha256
            || !Number.isInteger(graph.scs_export_index) || graph.scs_export_index < 1 || !Array.isArray(graph.components))
            throw new Error('Original source actor construction graph is unavailable or incompatible');
        const components = new Map();
        for (const component of graph.components) {
            const child = owns(this.report.packages, component.package) ? this.report.packages[component.package] : null;
            const childMeta = child?.class_metadata;
            if (!safeName(component.variable) || components.has(component.package) || !childMeta
                || childMeta.object !== component.class_object || childMeta.export_index !== component.class_export_index
                || JSON.stringify(childMeta.native_base) !== JSON.stringify(['/Script/Engine', 'ActorComponent'])
                || child.source?.source_sha256 !== component.source?.source_sha256
                || !Number.isInteger(component.scs_node_export_index) || component.scs_node_export_index < 1
                || !Number.isInteger(component.template_export_index) || component.template_export_index < 1
                || typeof component.template_sha256 !== 'string'
                || !component.source_overrides || Object.keys(component.source_overrides).some(field => !safeName(field) || !owns(child.default_state, field)))
                throw new Error('Original component ownership, multiplicity or template differs');
            components.set(component.package, structuredClone(component));
        }
        const nativeComponents = new Map();
        const componentVariables = new Set([...components.values()].map(component => component.variable));
        for (const component of graph.native_components || []) {
            const identity=[component.package,component.class_object], schema=data.field_schemas?.[component.variable];
            if (!safeName(component.variable) || componentVariables.has(component.variable) || nativeComponents.has(component.variable)
                || !nativeComponentClasses.has(JSON.stringify(identity)) || schema?.type !== 'ObjectProperty'
                || schema.reference_kind !== 'runtime_native_component' || JSON.stringify(schema.class) !== JSON.stringify(identity)
                || !owns(data.default_state,component.variable)
                || !Number.isSafeInteger(component.scs_node_export_index) || component.scs_node_export_index < 1
                || !Number.isSafeInteger(component.template_export_index) || component.template_export_index < 1
                || !/^[a-f0-9]{64}$/.test(component.template_sha256 || ''))
                throw new Error('Original native component field, class or template differs');
            nativeComponents.set(component.variable,structuredClone(component));
        }
        this.root = {reference:{realm:this.realm,actor_id:'actor-1',declared_class:['/Script/Engine','Actor']},
            // SourceActorBindings creates a standalone actor with no drivers.
            // AActor initializes Role=ROLE_Authority; remote roles require
            // additional source replication settings and stay unbound here.
            local_role:3,
            source_sha256:graph.source.source_sha256,
            component_lookup_complete:graph.component_lookup_complete === true,
            unbound_component_classes:(graph.component_blocked || []).map(row=>[row.package,row.class_object]),
            source_class:sourceClass, source_owner_index:graph.export_index,
            native_component_bindings_complete:graph.native_component_bindings_complete === true,
            class_object:graph.object, native_base:structuredClone(graph.native_base), force_net_update_override:false};
        this.graph = graph; this.target = target; this.components = components; this.nativeComponents=nativeComponents;
        return this.describe();
    }
    describe() {
        return this.root ? {source_class:this.root.source_class, components:this.components.size,
            native_components:this.nativeComponents.size,
            source_sha256:this.graph.source.source_sha256, scs_sha256:this.graph.scs_sha256} : null;
    }
    context(packageName) {
        if (!this.root) return undefined;
        const component = this.components.get(packageName);
        return {mode:'standalone',net_drivers:0,realm:this.realm,source_package:packageName,
            world_context_bound:this.root.source_class === packageName || !!component,
            actors:{[this.root.reference.actor_id]:structuredClone(this.root)},
            components:Object.fromEntries([...this.components.values()].map(component => [component.variable,{
                reference:this.componentReference(component.package), source_sha256:component.source.source_sha256,
                class_export_index:component.class_export_index, template_sha256:component.template_sha256}])),
            native_components:Object.fromEntries([...this.nativeComponents.values()].map(component => [component.variable,{
                reference:this.nativeComponentReference(component.variable), scs_node_export_index:component.scs_node_export_index,
                template_export_index:component.template_export_index, template_sha256:component.template_sha256}])),
            ...(component ? {owner:structuredClone(this.root.reference),component_class_export_index:component.class_export_index} : {})};
    }
    componentReference(packageName) {
        const component=this.components.get(packageName);
        if (!this.root || !component) throw new Error('Original component is not bound to the source actor');
        return {realm:this.realm,actor_id:this.root.reference.actor_id,component_variable:component.variable,
            declared_class:[component.package,component.class_object]};
    }
    nativeComponentReference(variable) {
        const component=this.nativeComponents.get(variable);
        if (!this.root || !component) throw new Error('Original native component is not bound to the source actor');
        return {kind:'source_native_component',realm:this.realm,actor_id:this.root.reference.actor_id,
            source_package:this.root.source_class,source_owner_index:this.root.source_owner_index,source_field:variable,
            declared_class:[component.package,component.class_object]};
    }
    ownerTarget(packageName) { return this.components.has(packageName) ? this.target : undefined; }
    witness(packageName) {
        const component = this.components.get(packageName);
        return component ? {source_class:this.root.source_class, component:component.variable,
            class_export_index:component.class_export_index, scs_node_export_index:component.scs_node_export_index,
            template_sha256:component.template_sha256, source_sha256:component.source.source_sha256,
            actor_source_sha256:this.graph.source.source_sha256, scs_sha256:this.graph.scs_sha256} : null;
    }
}
