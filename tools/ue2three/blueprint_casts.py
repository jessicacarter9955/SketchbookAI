"""Original EX_DynamicCast for explicitly bound source actors/components.

UE5.7 ScriptCore.cpp execDynamicCast returns the original UObject when IsA
succeeds and nullptr otherwise. Interfaces and unresolved classes reject here.
"""
from blueprint_types import import_path


def object_bool_cast(value, package, owner, reads, outputs, depth=0):
    """CST_ObjectToBool compares null, rather than testing numeric truthiness."""
    from blueprint_migration import kind, expression, BlueprintTranslationError as Error
    from blueprint_effects import variable
    target=value.get('Target',{})
    token=kind(target)
    if token in ('EX_InstanceVariable','EX_LocalVariable','EX_LocalOutVariable'):
        translated,schema=variable(target,package,owner,reads,outputs,depth)
    elif token=='EX_DynamicCast':
        translated=dynamic_cast(target,package,owner,reads,outputs,depth+1)
        schema=translated['schema']
    elif token=='EX_NoObject':
        translated,schema={'op':'constant','value':None},None
    else:
        raise Error('ObjectToBool requires a typed live original object or null')
    if schema is not None and (schema.get('type')!='ObjectProperty' or schema.get('reference_kind') not in
            ('runtime_actor','runtime_component','runtime_native_component','runtime_native_widget')):
        raise Error('ObjectToBool requires an explicit source live-object binding')
    return {'op':'source_object_bool','conversion':1,'value':translated,'schema':schema}

NATIVE_PARENTS = {
    ('/Script/Engine', 'Character'): ('/Script/Engine', 'Pawn'),
    ('/Script/Engine', 'Pawn'): ('/Script/Engine', 'Actor'),
    ('/Script/Engine', 'Actor'): None,
    ('/Script/Engine', 'ActorComponent'): None,
}


def class_lineage(package, identity):
    """Resolve only reflected original classes terminating in a known base."""
    from blueprint_migration import BlueprintTranslationError as Error
    from blueprint_objects import class_metadata
    lineage, seen = [], set()
    current = tuple(identity or ())
    while current not in seen and len(lineage) < 32:
        seen.add(current)
        if current in NATIVE_PARENTS:
            lineage.append({'class': list(current), 'native': True})
            current = NATIVE_PARENTS[current]
            if current is None: return lineage
            continue
        source = getattr(package, 'source_packages', {}).get(current[0] if current else None)
        if source is None:
            raise Error('DynamicCast requires a cached original source class hierarchy')
        meta = class_metadata(source)
        if not meta or meta['object'] != current[-1] or len(current) != 2:
            raise Error('DynamicCast original class identity differs')
        cls = source.export(meta['export_index'])
        if ('CLASS_Interface' in str(cls.get('ClassFlags', ''))
                or import_path(source, cls.get('ClassIndex')) != ('/Script/Engine', 'BlueprintGeneratedClass')):
            raise Error('DynamicCast source target is not an ordinary Blueprint generated class')
        lineage.append({'class': list(current), 'export_index': meta['export_index'],
                        'super': list(meta['native_base'])})
        current = tuple(meta['native_base'])
    raise Error('DynamicCast source class hierarchy is cyclic or incomplete')


def dynamic_cast(value, package, owner, reads, outputs, depth=0):
    from blueprint_migration import BlueprintTranslationError as Error, kind, expression, memory_size
    from blueprint_effects import variable
    reference = value.get('ClassPtr')
    identity = import_path(package, reference)
    if type(reference) is int and reference > 0:
        cls = package.export(reference)
        source_name = next((name for name, source in getattr(package, 'source_packages', {}).items()
                            if source is package), None)
        if cls and source_name:
            identity = (source_name, cls.get('ObjectName'))
    elif identity:
        item = package.imports[-reference-1]
        if item.get('ClassName') not in ('Class', 'BlueprintGeneratedClass'):
            raise Error('DynamicCast target import is not an original class')
    if not identity or len(identity) != 2:
        raise Error('DynamicCast target class is unresolved')
    lineage = class_lineage(package, identity)
    if identity == ('/Script/Engine', 'ActorComponent'):
        raise Error('DynamicCast native component base requires a polymorphic runtime handle')
    base = tuple(lineage[-1]['class'])
    result_kind = 'runtime_actor' if base == ('/Script/Engine', 'Actor') else 'runtime_component'
    if base not in (('/Script/Engine', 'Actor'), ('/Script/Engine', 'ActorComponent')):
        raise Error('DynamicCast target requires an unsupported runtime object family')
    target = value.get('Target', {})
    token = kind(target)
    if token in ('EX_InstanceVariable', 'EX_LocalVariable', 'EX_LocalOutVariable'):
        translated, schema = variable(target, package, owner, reads, outputs, depth)
    elif token == 'EX_NoObject':
        translated, schema = {'op': 'constant', 'value': None}, None
    elif token == 'EX_DynamicCast':
        translated = dynamic_cast(target, package, owner, reads, outputs, depth+1)
        schema = translated['schema']
    else:
        raise Error('DynamicCast input requires a typed live original actor or component')
    if schema is not None and (schema.get('type') != 'ObjectProperty'
            or schema.get('reference_kind') not in ('runtime_actor', 'runtime_component')):
        raise Error('DynamicCast input is not a supported live runtime reference')
    if schema is not None:
        # A declared type is an upper bound. Its original hierarchy must still
        # be witnessed even if the actual live object's subclass differs.
        class_lineage(package, schema.get('class'))
    memory_size(value, package=package)
    return {'op': 'source_dynamic_cast', 'dispatch': 'EX_DynamicCast',
            'target_class': list(identity), 'class_lineage': lineage,
            'value': translated, 'input_schema': schema,
            'schema': {'type': 'ObjectProperty', 'class': list(identity),
                       'reference_kind': result_kind, 'default': None}}
