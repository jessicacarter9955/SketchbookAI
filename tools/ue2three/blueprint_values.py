"""Typed source data: preserve asset identities and FText, never execute assets."""
import copy
import math
import re
from types import SimpleNamespace


def native_schema(identity):
    fields = {('/Script/CoreUObject', 'Vector'): ('X', 'Y', 'Z'),
              ('/Script/CoreUObject', 'Rotator'): ('Pitch', 'Yaw', 'Roll')}.get(identity)
    if fields:
        return {'type': 'StructProperty', 'source': identity[0], 'native': identity[1],
                'fields': {name: {'type': 'DoubleProperty'} for name in fields},
                'default': {name: 0 for name in fields}}


def asset_reference(package, value, declared_class):
    from blueprint_types import import_path
    if value == 0 and type(value) is int: return None
    path = import_path(package, value)
    if not path or len(path) != 2 or not path[0].startswith(('/Game/', '/Engine/', '/Script/')):
        raise ValueError('Unresolved source asset reference')
    if not re.fullmatch(r'/(?:Game|Engine|Script)/[A-Za-z0-9_/.]+', '.'.join(path)):
        raise ValueError('Unsupported source asset identity characters')
    return {'asset': '.'.join(path), 'declared_class': list(declared_class)}


def text_value(value):
    history = value.get('HistoryType')
    flags = value.get('Flags', 0)
    if type(flags) is not int: raise ValueError('Unsupported source text flags')
    if history == 'None' and value.get('Value') is None and value.get('CultureInvariantString') is None:
        return {'history': 'empty', 'text': '', 'flags': flags}
    if history == 'Base' and all(isinstance(value.get(key), str) for key in ('Namespace', 'Value', 'CultureInvariantString')):
        return {'history': 'base', 'text': value['CultureInvariantString'], 'namespace': value['Namespace'],
                'key': value['Value'], 'flags': flags}
    raise ValueError('Unsupported original FText history')


def serialized_value(package, prop, schema, value):
    """Deserialize a complete tagged value; missing struct members retain UDS defaults."""
    from blueprint_types import PRIMITIVES, import_path
    type_name = schema['type']
    if type_name == 'ArrayProperty':
        items = value.get('Value')
        if not isinstance(items, list) or len(items) > 100000: raise ValueError('Invalid source array data')
        return [serialized_value(package, prop['Inner'], schema['element'], item) for item in items]
    if type_name in ('ObjectProperty', 'ClassProperty'):
        reference = value.get('Value')
        if schema.get('reference_kind') == 'runtime_actor':
            if type(reference) is int and reference == 0: return None
            raise ValueError('Non-null source actor defaults require world-object migration')
        if type_name == 'ClassProperty' and reference != 0:
            if (type(reference) is not int or not -len(package.imports) <= reference < 0
                    or package.imports[-reference-1].get('ClassName') not in ('Class', 'BlueprintGeneratedClass')):
                raise ValueError('Original class reference is not a class import')
        result = asset_reference(package, reference, schema['class'])
        if result is not None and type_name == 'ClassProperty': result['meta_class'] = schema['meta_class']
        return result
    if type_name == 'TextProperty': return text_value(value)
    if type_name == 'StructProperty':
        values = value.get('Value')
        if schema.get('native'):
            if not isinstance(values, list) or len(values) != 1: raise ValueError('Missing native struct data')
            raw = values[0].get('Value', {})
            if any(isinstance(raw.get(key), bool) for key in schema['fields']): raise ValueError('Invalid native struct number')
            result = {key: float(raw[key]) for key in schema['fields']}
            if not all(math.isfinite(v) for v in result.values()): raise ValueError('Non-finite native struct')
            return result
        if not isinstance(values, list): raise ValueError('Missing original struct fields')
        result = copy.deepcopy(schema['default']); seen = set()
        for child in values:
            name = child['Name']
            if name in seen or name not in schema['fields']: raise ValueError('Unknown or duplicate source struct field')
            seen.add(name)
            result[name] = serialized_value(package, schema['properties'][name], schema['fields'][name], child)
        return result
    if type_name not in PRIMITIVES: raise ValueError('Unsupported source value type')
    if type_name == 'ByteProperty' and value.get('ByteType') == 'FName':
        mapping = schema.get('enum_values')
        if mapping is None:
            mapping = getattr(package, 'source_enums', {}).get(import_path(package, prop.get('Enum')), {})
        if value.get('EnumValue') not in mapping: raise ValueError('Missing original enum mapping')
        raw = mapping[value['EnumValue']]
    else: raw = value.get('Value')
    if type_name in ('FloatProperty', 'DoubleProperty'):
        if isinstance(raw, bool): raise ValueError('Invalid source number')
        raw = float(raw)
        if not math.isfinite(raw): raise ValueError('Non-finite source value')
    elif type_name == 'BoolProperty':
        if type(raw) is not bool: raise ValueError('Invalid source Boolean')
    elif type_name in ('IntProperty', 'ByteProperty'):
        if type(raw) is not int or not (-2**31 <= raw < 2**31 if type_name == 'IntProperty' else 0 <= raw <= 255):
            raise ValueError('Invalid original integer')
    elif not isinstance(raw, str): raise ValueError('Invalid original string')
    return raw


def construct_source_structs(documents):
    from blueprint_types import property_schema
    enums = {(name, export['ObjectName']): {v['Item1']: v['Item2'] for v in export['Enum'].get('Names', [])}
             for name, doc in documents.items() for export in doc.get('Exports', []) if 'Enum' in export}
    structs = {}
    pending = [(name, doc, export) for name, doc in documents.items() for export in doc.get('Exports', []) if 'StructData' in export]
    for _ in range(len(pending)+1):
        remaining = []
        for name, doc, export in pending:
            package = SimpleNamespace(imports=doc.get('Imports', []), source_structs=structs, source_enums=enums)
            try:
                defaults, fields, properties = {}, {}, {}
                values = {value['Name']: value for value in export['StructData']}
                for prop in export.get('LoadedProperties', []):
                    field = prop['Name']
                    if field in ('__proto__', 'constructor', 'prototype') or field in fields or field not in values:
                        raise ValueError('Missing, duplicate or unsafe source field')
                    schema = property_schema(package, prop)
                    if not schema: raise ValueError('Unresolved source member type')
                    # Keep only descriptors needed to decode later sparse rows.
                    properties[field] = {k: v for k, v in prop.items() if k in ('Name', 'SerializedType', 'Inner', 'Enum', 'Struct', 'PropertyClass', 'MetaClass')}
                    fields[field] = schema; defaults[field] = serialized_value(package, prop, schema, values[field])
                structs[(name, export['ObjectName'])] = {'type': 'StructProperty', 'source': name, 'fields': fields,
                    'default': defaults, 'properties': properties, 'member_order': list(fields)}
            except (ValueError, TypeError, KeyError, OverflowError): remaining.append((name, doc, export))
        if len(remaining) == len(pending): break
        pending = remaining
    return structs


def source_tables(documents, structs):
    from blueprint_types import import_path
    tables, blocked = {}, {}
    for name, doc in documents.items():
        package = SimpleNamespace(imports=doc.get('Imports', []))
        for export in doc.get('Exports', []):
            if 'Table' not in export: continue
            try:
                pointer = next(value['Value'] for value in export.get('Data', []) if value.get('Name') == 'RowStruct')
                schema = structs.get(import_path(package, pointer))
                if not schema: raise ValueError('Original row schema is unavailable')
                rows, seen = {}, set()
                for row in export['Table']['Data']:
                    key = row['Name']
                    if not isinstance(key, str) or not key or not key.isascii() or key.upper() in seen:
                        raise ValueError('Unsupported or duplicate original FName row')
                    seen.add(key.upper())
                    rows[key] = serialized_value(package, {}, schema, row)
                tables[name+'.'+export['ObjectName']] = {'schema': schema, 'rows': rows}
            except (ValueError, KeyError, TypeError, StopIteration) as error: blocked[name] = str(error)
    return tables, blocked
