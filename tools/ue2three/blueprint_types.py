"""Original source type identities, constructors and value schemas."""

PRIMITIVES = {'BoolProperty': False, 'ByteProperty': 0, 'IntProperty': 0,
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
        if identity: return {'type': type_name, 'class': list(identity), 'default': None}
    if type_name == 'TextProperty': return {'type': type_name, 'default': {'history': 'empty', 'text': '', 'flags': 0}}
    if type_name == 'StructProperty':
        identity = import_path(package, prop.get('Struct'))
        return native_schema(identity) or getattr(package, 'source_structs', {}).get(identity)
    if type_name == 'ArrayProperty':
        element = property_schema(package, prop.get('Inner', {}))
        if element: return {'type': 'ArrayProperty', 'element': element, 'default': []}
    return None
