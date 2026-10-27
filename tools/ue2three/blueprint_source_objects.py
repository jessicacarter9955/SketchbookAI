"""Source class inheritance and read-only, explicitly bound source Actor access.

Resolving a UClass is type evidence, never actor construction or asset loading.
Native ancestry outside the reflected source chain is not guessed.
"""
from blueprint_types import import_path

ACTOR_BASES = {('/Script/Engine', name) for name in ('Actor', 'Pawn', 'Character')}
COMPONENT_BASE = ('/Script/Engine', 'ActorComponent')


def _generated_class(package, object_name=None):
    candidates = [(index, export) for index, export in enumerate(package.exports, 1)
                  if str(export.get('$type', '')).split(',', 1)[0].rsplit('.', 1)[-1] == 'ClassExport'
                  and str(export.get('ObjectName', '')).endswith('_C')
                  and not str(export.get('ObjectName', '')).startswith('Default__')
                  and (object_name is None or export.get('ObjectName') == object_name)]
    return candidates[0] if len(candidates) == 1 else None


def source_class_hierarchy(package, identity):
    """Return exact child-to-parent source class witnesses ending in native base.

    Returns None for missing/cyclic/ambiguous source ancestry. The native base is
    the final serialized SuperStruct; unreflected native ancestry is not inferred.
    """
    identity = tuple(identity or ())
    if len(identity) != 2 or not identity[0].startswith('/Game/'):
        return None
    sources = getattr(package, 'source_packages', {})
    hierarchy, seen = [], set()
    current = identity
    for _ in range(64):
        if current in seen:
            return None
        seen.add(current)
        source = sources.get(current[0])
        if source is None:
            return None
        found = _generated_class(source, current[1])
        if found is None:
            return None
        index, cls = found
        parent = import_path(source, cls.get('SuperStruct'))
        if parent is None or len(parent) != 2:
            return None
        hierarchy.append({'package': current[0], 'object': current[1], 'export_index': index,
                          'parent': list(parent),
                          'force_net_update_override': any(
                              e.get('OuterIndex') == index and e.get('ObjectName') == 'ForceNetUpdate'
                              for e in source.exports)})
        if parent[0].startswith('/Script/'):
            return {'identity': list(identity), 'native_base': list(parent), 'source_hierarchy': hierarchy,
                    'force_net_update_override': any(row['force_net_update_override'] for row in hierarchy)}
        if not parent[0].startswith('/Game/'):
            return None
        current = parent
    return None


def hierarchical_class_metadata(package):
    """Drop-in metadata for source classes whose cached ancestry is complete."""
    found = _generated_class(package)
    if found is None:
        return None
    index, cls = found
    names = [name for name, source in getattr(package, 'source_packages', {}).items() if source is package]
    if len(names) != 1:
        # A direct native subclass needs no cross-package source map.
        parent = import_path(package, cls.get('SuperStruct'))
        if parent and len(parent) == 2 and parent[0].startswith('/Script/'):
            return {'export_index': index, 'object': cls['ObjectName'], 'native_base': list(parent),
                    'force_net_update_override': any(e.get('OuterIndex') == index
                        and e.get('ObjectName') == 'ForceNetUpdate' for e in package.exports)}
        return None
    hierarchy = source_class_hierarchy(package, (names[0], cls['ObjectName']))
    if hierarchy is None:
        return None
    return {'export_index': index, 'object': cls['ObjectName'],
            'native_base': hierarchy['native_base'], 'source_hierarchy': hierarchy['source_hierarchy'],
            'force_net_update_override': hierarchy['force_net_update_override']}


def source_object_property_schema(package, identity):
    hierarchy = source_class_hierarchy(package, identity)
    if hierarchy is None:
        return None
    native = tuple(hierarchy['native_base'])
    kind = 'runtime_actor' if native in ACTOR_BASES else 'runtime_component' if native == COMPONENT_BASE else None
    if kind is None:
        return None
    return {'type': 'ObjectProperty', 'class': list(identity), 'reference_kind': kind, 'default': None}


def source_actor_member(value, package, owner, reads, outputs, depth):
    """Resolve an actor field only from its exact reflected source declaration."""
    from blueprint_migration import kind, memory_size, field, BlueprintTranslationError as Error
    from blueprint_effects import variable
    from blueprint_types import property_schema
    call = value.get('ContextExpression', {})
    if kind(call) != 'EX_InstanceVariable':
        return None
    target, target_schema = variable(value.get('ObjectExpression', {}), package, owner, reads, outputs, depth)
    identity = tuple(target_schema.get('class', ()))
    if target_schema.get('reference_kind') != 'runtime_actor' or len(identity) != 2 or not identity[0].startswith('/Game/'):
        return None
    hierarchy = source_class_hierarchy(package, identity)
    if hierarchy is None or tuple(hierarchy['native_base']) not in ACTOR_BASES:
        raise Error('Original source Actor ancestry is unavailable')
    pointer = call.get('Variable', {}).get('New', {})
    declaring = import_path(package, pointer.get('ResolvedOwner'))
    declarations = [row for row in hierarchy['source_hierarchy']
                    if (row['package'], row['object']) == declaring]
    if (len(declarations) != 1 or value.get('RValuePointer') != call.get('Variable')
            or value.get('Offset') != memory_size(call, package=package)):
        raise Error('Original source Actor property owner or context layout differs')
    declaration = declarations[0]
    source = package.source_packages[declaration['package']]
    name = field(call.get('Variable'))
    props = [prop for prop in source.export(declaration['export_index']).get('LoadedProperties', [])
             if prop.get('Name') == name]
    schema = property_schema(source, props[0]) if len(props) == 1 else None
    if schema is None:
        raise Error('Original source Actor property schema is unavailable')
    return {'op': 'source_actor_member', 'target': target, 'target_schema': target_schema,
            'package': identity[0], 'class_object': identity[1],
            'class_export_index': hierarchy['source_hierarchy'][0]['export_index'],
            'declaring_package': declaration['package'], 'declaring_class': declaration['object'],
            'declaring_export_index': declaration['export_index'], 'field': name, 'schema': schema}
