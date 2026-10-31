"""Original source type identities, constructors and value schemas."""

PRIMITIVES = {'BoolProperty': False, 'ByteProperty': 0, 'IntProperty': 0, 'Int64Property': 0,
              'FloatProperty': 0, 'DoubleProperty': 0, 'StrProperty': '', 'NameProperty': 'None'}


def import_path(package, reference):
    names = []
    for _ in range(16):
        if type(reference) is not int or not -len(package.imports) <= reference < 0: return None
        item = package.imports[-reference-1]; names.append(item.get('ObjectName'))
        if item.get('ClassName') == 'Package': return tuple(reversed(names))
        reference = item.get('OuterIndex')
    return None


def source_structs(documents, error):
    from blueprint_values import construct_source_structs
    return construct_source_structs(documents)


NATIVE_COMPONENT_REFERENCES = {
    ('/Script/Engine', name) for name in ('ActorComponent', 'SceneComponent', 'PrimitiveComponent',
        'MeshComponent', 'SkeletalMeshComponent', 'StaticMeshComponent', 'CapsuleComponent',
        'CameraComponent', 'SpringArmComponent', 'AudioComponent', 'SceneCaptureComponent',
        'SceneCaptureComponent2D', 'SpotLightComponent')
} | {
    ('/Script/Niagara', 'NiagaraComponent'),
    ('/Script/HairStrandsCore', 'GroomComponent'),
}
NATIVE_OBJECT_REFERENCES = {('/Script/Niagara', 'NiagaraDataChannelWriter')}


def property_schema(package, prop):
    from blueprint_values import native_schema
    type_name = prop.get('SerializedType')
    if type_name in PRIMITIVES:
        schema = {'type': type_name, 'default': PRIMITIVES[type_name]}
        if type_name == 'ByteProperty' and prop.get('Enum'):
            mapping = getattr(package, 'source_enums', {}).get(import_path(package, prop.get('Enum')))
            if mapping: schema['enum_values'] = mapping
        return schema
    if type_name == 'ObjectProperty':
        identity = import_path(package, prop.get('PropertyClass'))
        from blueprint_widgets import NATIVE_WIDGET_CLASSES
        if identity and identity[0] == '/Script/UMG' and identity[1] in NATIVE_WIDGET_CLASSES:
            return {'type': type_name, 'class': list(identity),
                    'reference_kind': 'runtime_native_widget', 'default': None}
        if identity in {('/Script/Engine', name) for name in ('Actor', 'Pawn', 'Character')}:
            return {'type': type_name, 'class': list(identity), 'reference_kind': 'runtime_actor', 'default': None}
        if identity in NATIVE_COMPONENT_REFERENCES:
            return {'type': type_name, 'class': list(identity), 'reference_kind': 'runtime_native_component', 'default': None}
        if identity in NATIVE_OBJECT_REFERENCES:
            return {'type': type_name, 'class': list(identity), 'reference_kind': 'runtime_native_object', 'default': None}
        if identity and identity[0].startswith('/Game/'):
            from blueprint_source_objects import source_object_property_schema
            inherited_schema=source_object_property_schema(package,identity)
            if inherited_schema: return inherited_schema
        source = getattr(package, 'source_packages', {}).get((identity or (None,))[0])
        if source and identity:
            from blueprint_objects import class_metadata
            meta = class_metadata(source)
            if meta and meta['object'] == identity[-1]:
                base = meta['native_base']
                reference_kind = 'runtime_component' if base == ['/Script/Engine', 'ActorComponent'] else (
                    'runtime_actor' if tuple(base) in {('/Script/Engine', name) for name in ('Actor', 'Pawn', 'Character')} else None)
                if reference_kind:
                    return {'type': type_name, 'class': list(identity), 'reference_kind': reference_kind, 'default': None}
        if identity: return {'type': type_name, 'class': list(identity), 'default': None}
    if type_name == 'ClassProperty':
        identity, meta = import_path(package, prop.get('PropertyClass')), import_path(package, prop.get('MetaClass'))
        if identity == ('/Script/CoreUObject', 'Class') and meta:
            return {'type': type_name, 'class': list(identity), 'meta_class': list(meta), 'default': None}
    if type_name == 'TextProperty': return {'type': type_name, 'default': {'history': 'empty', 'text': '', 'flags': 0}}
    if type_name == 'StructProperty':
        identity = import_path(package, prop.get('Struct'))
        return native_schema(identity) or getattr(package, 'source_structs', {}).get(identity)
    if type_name == 'ArrayProperty':
        element = property_schema(package, prop.get('Inner', {}))
        if element: return {'type': 'ArrayProperty', 'element': element, 'default': []}
    return None
