"""Typed source data: preserve asset identities and FText, never execute assets."""
import copy
import math
import re
from types import SimpleNamespace

# Data identities only. Never treat actors, components or generated classes as
# static assets merely because their serialized property is ObjectProperty.
STATIC_ASSET_CLASSES = {'AnimMontage', 'AnimSequence', 'SkeletalMesh', 'StaticMesh',
                        'Texture2D', 'SoundBase', 'SoundCue', 'SoundWave', 'SoundAttenuation',
                        'SoundConcurrency', 'DataTable',
                        'Material', 'MaterialInstance', 'MaterialInstanceConstant', 'MaterialInterface'}
STATIC_ASSET_MODULES = {'/Script/Engine': STATIC_ASSET_CLASSES,
                        '/Script/Niagara': {'NiagaraSystem', 'NiagaraDataChannelAsset'}}


def asset_constant(package, reference):
    """Retain the actual imported asset class; do not execute/load the asset."""
    if type(reference) is not int or not -len(package.imports) <= reference < 0:
        raise ValueError('Asset constant requires an original asset import')
    imported = package.imports[-reference-1]
    name = imported.get('ClassName')
    module = imported.get('ClassPackage')
    if name not in STATIC_ASSET_MODULES.get(module, set()):
        raise ValueError('Unsupported original asset constant class')
    identity = (module, name)
    return {'op': 'typed_literal', 'schema': {'type': 'ObjectProperty', 'class': list(identity), 'default': None},
            'value': asset_reference(package, reference, identity)}


def native_schema(identity):
    # FKey is a reflected InputCore struct: equality compares its FName KeyName.
    if identity == ('/Script/InputCore', 'Key'):
        key_name = {'type': 'NameProperty', 'default': 'None'}
        return {'type': 'StructProperty', 'source': identity[0], 'native': identity[1],
                'fields': {'KeyName': key_name}, 'default': {'KeyName': 'None'},
                'member_order': ['KeyName']}
    if identity == ('/Script/SlateCore', 'SlateColor'):
        linear_color=native_schema(('/Script/CoreUObject','LinearColor'))
        color_rules={'ESlateColorStylingMode::UseColor_Specified':0,
                     'ESlateColorStylingMode::UseColor_ColorTable':1,
                     'ESlateColorStylingMode::UseColor_Foreground':2,
                     'ESlateColorStylingMode::UseColor_Foreground_Subdued':3,
                     'ESlateColorStylingMode::UseColor_UseStyle':4}
        fields={'SpecifiedColor':linear_color,
                'ColorUseRule':{'type':'ByteProperty','enum':['/Script/SlateCore','ESlateColorStylingMode'],
                                'enum_values':color_rules,'default':0}}
        return {'type':'StructProperty','source':identity[0],'native':identity[1],
                'fields':fields,'default':{'SpecifiedColor':{'R':1,'G':0,'B':1,'A':1},'ColorUseRule':0},
                'member_order':['SpecifiedColor','ColorUseRule']}
    if identity == ('/Script/Engine', 'FormatArgumentData'):
        empty_text = {'history': 'empty', 'text': '', 'flags': 0}
        fields = {
            'ArgumentName': {'type': 'StrProperty', 'default': ''},
            'ArgumentValue': {'type': 'TextProperty', 'default': empty_text},
            'ArgumentValueDouble': {'type': 'DoubleProperty', 'default': 0},
            'ArgumentValueFloat': {'type': 'FloatProperty', 'default': 0},
            'ArgumentValueGender': {'type': 'ByteProperty', 'enum': ['/Script/Engine', 'ETextGender'], 'default': 0},
            'ArgumentValueInt': {'type': 'Int64Property', 'default': 0},
            'ArgumentValueType': {'type': 'ByteProperty', 'enum': ['/Script/Engine', 'EFormatArgumentType'], 'default': 0},
        }
        return {'type': 'StructProperty', 'source': identity[0], 'native': identity[1],
                'fields': fields, 'default': {name: schema['default'] for name, schema in fields.items()},
                'member_order': list(fields)}
    fields = {('/Script/CoreUObject', 'Vector2D'): ('X', 'Y'),
              ('/Script/CoreUObject', 'Vector'): ('X', 'Y', 'Z'),
              ('/Script/CoreUObject', 'Rotator'): ('Pitch', 'Yaw', 'Roll')}.get(identity)
    if fields:
        return {'type': 'StructProperty', 'source': identity[0], 'native': identity[1],
                'fields': {name: {'type': 'DoubleProperty'} for name in fields},
                'default': {name: 0 for name in fields}, 'member_order': list(fields)}
    if identity == ('/Script/CoreUObject', 'LinearColor'):
        fields = ('R', 'G', 'B', 'A')
        return {'type': 'StructProperty', 'source': identity[0], 'native': identity[1],
                'fields': {name: {'type': 'FloatProperty'} for name in fields},
                'default': {name: 0 for name in fields}, 'member_order': list(fields)}
    if identity == ('/Script/CoreUObject', 'Quat'):
        fields = ('X', 'Y', 'Z', 'W')
        return {'type': 'StructProperty', 'source': identity[0], 'native': identity[1],
                'fields': {name: {'type': 'DoubleProperty'} for name in fields},
                'default': {'X': 0, 'Y': 0, 'Z': 0, 'W': 1}, 'member_order': list(fields)}
    if identity == ('/Script/CoreUObject', 'Transform'):
        rotation, vector = native_schema(('/Script/CoreUObject', 'Quat')), native_schema(('/Script/CoreUObject', 'Vector'))
        fields = {'Rotation': rotation, 'Translation': vector, 'Scale3D': vector}
        return {'type': 'StructProperty', 'source': identity[0], 'native': identity[1], 'fields': fields,
                'default': {'Rotation': rotation['default'], 'Translation': vector['default'],
                            'Scale3D': {'X': 1, 'Y': 1, 'Z': 1}}, 'member_order': list(fields)}


def witnessed_complete_default(schema, value):
    """Accept only fully serialized original CDO values, never guessed struct zeros.

    Sparse Unreal tagged properties require a witnessed constructor to fill
    absent members. When no constructor is available, a *complete* CDO struct
    can still safely initialize the instance if every field is type checked.
    """
    kind = schema.get('type') if isinstance(schema, dict) else None
    if kind == 'StructProperty':
        fields = schema.get('fields')
        if not isinstance(fields, dict) or not fields or not isinstance(value, dict) or value.keys() != fields.keys():
            raise ValueError('Complete original CDO struct members are unavailable')
        return {field: witnessed_complete_default(child, value[field]) for field, child in fields.items()}
    if kind == 'ArrayProperty':
        if not isinstance(value, list) or len(value) > 100000: raise ValueError('Invalid original CDO array')
        return [witnessed_complete_default(schema.get('element'), item) for item in value]
    if kind == 'BoolProperty' and type(value) is bool: return value
    if kind in ('IntProperty', 'ByteProperty', 'Int64Property') and type(value) is int:
        lower, upper = {'IntProperty': (-2**31, 2**31 - 1), 'ByteProperty': (0, 255),
                        'Int64Property': (-2**53 + 1, 2**53 - 1)}[kind]
        if lower <= value <= upper: return value
    if kind in ('FloatProperty', 'DoubleProperty') and type(value) in (int, float, str):
        try: number = float(value)
        except ValueError: pass
        else:
            if math.isfinite(number): return number
    if kind in ('StrProperty', 'NameProperty') and isinstance(value, str): return value
    if kind in ('ObjectProperty', 'ClassProperty') and value is None: return None
    raise ValueError('Invalid or unsupported original CDO struct field: ' + str(kind))


def asset_reference(package, value, declared_class):
    from blueprint_types import import_path
    if value == 0 and type(value) is int: return None
    path = import_path(package, value)
    if not path or len(path) != 2 or not path[0].startswith(('/Game/', '/Engine/', '/Script/', '/ControlRig/')):
        raise ValueError('Unresolved source asset reference')
    if not re.fullmatch(r'/(?:Game|Engine|Script|ControlRig)/[A-Za-z0-9_/.]+', '.'.join(path)):
        raise ValueError('Unsupported source asset identity characters')
    return {'asset': '.'.join(path), 'declared_class': list(declared_class)}


def text_value(value):
    history = value.get('HistoryType')
    flags = value.get('Flags', 0)
    if type(flags) is not int: raise ValueError('Unsupported source text flags')
    if history == 'None' and value.get('Value') is None and value.get('CultureInvariantString') is None:
        return {'history': 'empty', 'text': '', 'flags': flags}
    if (history == 'None' and flags == 2 and value.get('Value') is None
            and isinstance(value.get('CultureInvariantString'), str)):
        text = value['CultureInvariantString']
        return {'history': 'invariant' if text else 'empty', 'text': text, 'flags': flags}
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
        if schema.get('reference_kind') in ('runtime_actor', 'runtime_component'):
            if type(reference) is int and reference == 0: return None
            raise ValueError('Non-null source actor defaults require world-object migration')
        if schema.get('reference_kind') in ('runtime_native_component', 'runtime_native_object'):
            if type(reference) is int and reference == 0: return None
            raise ValueError('Non-null source native-object defaults require a native-object adapter')
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
            if schema.get('native') == 'SlateColor':
                if not isinstance(values,list) or len(values)!=2:
                    raise ValueError('Missing complete original FSlateColor fields')
                result=copy.deepcopy(schema['default']);seen=set()
                for child in values:
                    name=child.get('Name')
                    if name in seen or name not in schema['fields']:
                        raise ValueError('Unknown or duplicate original FSlateColor field')
                    seen.add(name)
                    result[name]=serialized_value(package,{},schema['fields'][name],child)
                if seen != set(schema['fields']): raise ValueError('Incomplete original FSlateColor fields')
                return result
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
    if type_name == 'ByteProperty' and isinstance(value.get('Value'),str) and schema.get('enum_values'):
        enum_name=value['Value']
        mapping=schema['enum_values']
        if enum_name not in mapping: raise ValueError('Missing original native enum mapping')
        raw=mapping[enum_name]
    elif type_name == 'ByteProperty' and value.get('ByteType') == 'FName':
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
    elif type_name == 'Int64Property':
        if type(raw) is not int or not -(2**53) < raw < 2**53:
            raise ValueError('Original Int64 value is outside the exact JavaScript integer range')
    elif not isinstance(raw, str): raise ValueError('Invalid original string')
    return raw


def source_enums(documents):
    return {(name, export['ObjectName']): {v['Item1']: v['Item2'] for v in export['Enum'].get('Names', [])}
             for name, doc in documents.items() for export in doc.get('Exports', []) if 'Enum' in export}


def witnessed_enum_tag_default(value, enums):
    """Resolve a CDO enum inherited from a parent class using its own tag.

    UAssetAPI preserves the full enum package path on the original ByteProperty
    tag even when the generated child's LoadedProperties omits an inherited
    declaration. Require the exact source enum table; never parse an ordinal
    out of a display name or silently assume zero.
    """
    nodes = value.get('PropertyTypeName')
    if (value.get('ByteType') != 'FName' or not isinstance(nodes, list) or len(nodes) != 3
            or [n.get('InnerCount') for n in nodes if isinstance(n, dict)] != [1, 1, 0]
            or not all(isinstance(n, dict) and isinstance(n.get('Name'), str) for n in nodes)
            or nodes[0]['Name'] != 'ByteProperty' or nodes[1]['Name'] != value.get('EnumType')
            or not nodes[1]['Name'] or not nodes[2]['Name'].startswith('/Game/')
            or not isinstance(value.get('EnumValue'), str)
            or not value['EnumValue'].startswith(nodes[1]['Name'] + '::')):
        raise ValueError('Original inherited enum identity is incomplete')
    enum_key = (nodes[2]['Name'], nodes[1]['Name'])
    mapping = enums.get(enum_key)
    if not isinstance(mapping, dict) or value['EnumValue'] not in mapping:
        raise ValueError('Original enum value mapping not cached: ' + '/'.join(enum_key))
    ordinal = mapping[value['EnumValue']]
    if type(ordinal) is not int or not 0 <= ordinal <= 255:
        raise ValueError('Original enum value outside byte range')
    return ordinal


def construct_source_structs(documents):
    from blueprint_types import property_schema
    enums = source_enums(documents)
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
