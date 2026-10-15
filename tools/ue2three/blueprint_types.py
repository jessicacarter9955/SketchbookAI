"""Original primitive UserDefinedStruct defaults and typed array schemas."""
import math

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
    enums, structs = {}, {}
    for name, document in documents.items():
        for export in document.get('Exports', []):
            if 'Enum' in export:
                enums[(name, export['ObjectName'])] = {v['Item1']: v['Item2'] for v in export['Enum'].get('Names', [])}
    for name, document in documents.items():
        for export in document.get('Exports', []):
            if 'StructData' not in export: continue
            try:
                defaults, fields = {}, {}
                values = {v['Name']: v for v in export['StructData']}
                for prop in export.get('LoadedProperties', []):
                    field, type_name = prop['Name'], prop['SerializedType']
                    if field in ('__proto__', 'constructor', 'prototype') or type_name not in PRIMITIVES:
                        raise error('Unsupported source struct member')
                    value = values.get(field)
                    if value is None: raise error('Missing serialized source struct default')
                    if type_name == 'ByteProperty' and value.get('ByteType') == 'FName':
                        ref = prop.get('Enum')
                        names = []
                        for _ in range(16):
                            if type(ref) is not int or not -len(document.get('Imports', [])) <= ref < 0: break
                            item = document['Imports'][-ref-1]; names.append(item['ObjectName'])
                            if item.get('ClassName') == 'Package': break
                            ref = item.get('OuterIndex')
                        mapping = enums.get(tuple(reversed(names)), {})
                        if value.get('EnumValue') not in mapping: raise error('Missing original enum mapping')
                        raw = mapping[value['EnumValue']]
                    else: raw = value.get('Value')
                    if type_name in ('FloatProperty', 'DoubleProperty'):
                        raw = float(raw)
                        if not math.isfinite(raw): raise error('Non-finite source struct default')
                    elif type_name == 'BoolProperty':
                        if type(raw) is not bool: raise error('Invalid source Boolean default')
                    elif type_name in ('IntProperty', 'ByteProperty'):
                        if type(raw) is not int or not (-2**31 <= raw < 2**31 if type_name == 'IntProperty' else 0 <= raw <= 255):
                            raise error('Invalid source integer default')
                    elif not isinstance(raw, str): raise error('Invalid source string default')
                    fields[field] = {'type': type_name}; defaults[field] = raw
                structs[(name, export['ObjectName'])] = {'type': 'StructProperty', 'source': name,
                                                       'fields': fields, 'default': defaults}
            except (ValueError, TypeError, KeyError):
                # The whole constructor stays unavailable if any member/default
                # cannot be established. Never fill missing source data by guess.
                continue
    return structs


def property_schema(package, prop):
    type_name = prop.get('SerializedType')
    if type_name in PRIMITIVES: return {'type': type_name, 'default': PRIMITIVES[type_name]}
    if type_name == 'StructProperty': return getattr(package, 'source_structs', {}).get(import_path(package, prop.get('Struct')))
    if type_name == 'ArrayProperty':
        element = property_schema(package, prop.get('Inner', {}))
        if element: return {'type': 'ArrayProperty', 'element': element, 'default': []}
    return None
