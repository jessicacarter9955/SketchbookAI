// A source actor binding contains identity, not an executable UObject proxy.
const owns = (object, key) => object != null && Object.hasOwn(object, key);
const bases = new Set(['Actor', 'Pawn', 'Character']);
const safeName = name => typeof name === 'string' && name && !['__proto__', 'constructor', 'prototype'].includes(name);
export const validActorReference = value => value !== null && typeof value === 'object' && !Array.isArray(value)
    && typeof value.realm === 'string' && value.realm.length > 0
    && typeof value.actor_id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value.actor_id)
    && JSON.stringify(value.declared_class) === JSON.stringify(['/Script/Engine', 'Actor']);
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
export function sourceComponentOwner(context, ownerIndex) {
    standalone(context);
    if (!owns(context, 'owner') || context.component_class_export_index !== ownerIndex)
        throw new Error('Original component owner binding is unavailable');
    if (context.owner !== null) actor(context, context.owner);
    return structuredClone(context.owner);
}
export function sourceActorIsValid(context, reference) {
    // Original Kismet IsValid returns false for None. A non-null reference is
    // accepted only for the live actor bound to this source-derived SCS graph.
    // PendingKill/destruction cannot be inferred without the original actor
    // lifecycle; unknown/foreign objects therefore fail closed.
    if (reference === null) return false;
    standalone(context);
    actor(context, reference);
    return true;
}
export function sourceForceNetUpdate(context, reference) {
    standalone(context);
    const descriptor = actor(context, reference);
    // AActor::ForceNetUpdate has no networking effect without active drivers.
    // Keep a call receipt so this cannot be mistaken for implemented replication.
    return {op:'force_net_update', actor_id:reference.actor_id, actor_class:descriptor.source_class, scope:'standalone_no_drivers'};
}

export class SourceActorBindings {
    constructor(report) {
        this.report = report;
        this.realm = crypto.randomUUID();
        this.root = null;
        this.target = null;
        this.components = new Map();
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
        this.root = {reference:{realm:this.realm,actor_id:'actor-1',declared_class:['/Script/Engine','Actor']},
            source_class:sourceClass, native_base:structuredClone(graph.native_base), force_net_update_override:false};
        this.graph = graph; this.target = target; this.components = components;
        return this.describe();
    }
    describe() {
        return this.root ? {source_class:this.root.source_class, components:this.components.size,
            source_sha256:this.graph.source.source_sha256, scs_sha256:this.graph.scs_sha256} : null;
    }
    context(packageName) {
        if (!this.root) return undefined;
        const component = this.components.get(packageName);
        return {mode:'standalone',net_drivers:0,realm:this.realm,
            actors:{[this.root.reference.actor_id]:structuredClone(this.root)},
            ...(component ? {owner:structuredClone(this.root.reference),component_class_export_index:component.class_export_index} : {})};
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
