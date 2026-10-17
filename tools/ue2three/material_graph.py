"""Read modern UE tagged material inputs without executing Unreal or a parser.

UAssetAPI's cached JSON omits native ExpressionInput fields in some versions.
Recover them from bounded source export bytes, using its verified name/export
tables. Unsupported serialization is rejected, never interpreted as a shader.
Layout references: UAssetAPI MainSerializer, MaterialInputProperties and
FPropertyTypeName (https://github.com/atenfyr/UAssetAPI).
"""
import base64
import math
import struct


class MaterialGraphError(ValueError):
    pass


class Reader:
    def __init__(self, data, names):
        self.data, self.names, self.position = data, names, 0

    def take(self, size):
        if size < 0 or self.position + size > len(self.data):
            raise MaterialGraphError('Truncated tagged export')
        start = self.position; self.position += size
        return self.data[start:self.position]

    def integer(self):
        return struct.unpack('<i', self.take(4))[0]

    def name(self):
        index, number = struct.unpack('<ii', self.take(8))
        if not 0 <= index < len(self.names) or number < 0:
            raise MaterialGraphError('Invalid source name reference')
        value = self.names[index]
        if not isinstance(value, str):
            raise MaterialGraphError('Unsupported name table')
        return value if not number else value + '_' + str(number - 1)


def tagged_properties(data, names):
    reader = Reader(data, names)
    if reader.take(1) != b'\0':
        raise MaterialGraphError('Unsupported class serialization extension')
    properties = {}
    for _ in range(4096):
        name = reader.name()
        if name == 'None':
            return properties, reader.position
        types, pending = [], 1
        while pending:
            if len(types) >= 32:
                raise MaterialGraphError('Property type tree exceeds bound')
            kind, children = reader.name(), reader.integer()
            if not 0 <= children <= 16:
                raise MaterialGraphError('Invalid property type tree')
            types.append(kind); pending += children - 1
        size = reader.integer(); flags = reader.take(1)[0]
        if flags & ~0x3f or flags & 0x20:
            raise MaterialGraphError('Unsupported property tag flags')
        array_index = reader.integer() if flags & 1 else 0
        if flags & 2: reader.take(16)
        if flags & 4:
            raise MaterialGraphError('Unsupported property extension')
        payload = reader.take(size)
        if (name, array_index) in properties:
            raise MaterialGraphError('Duplicate property tag')
        properties[name, array_index] = {'types': types, 'payload': payload, 'flags': flags}
    raise MaterialGraphError('Property count exceeds bound')


def native_input(payload, names, exports):
    if len(payload) < 36:
        raise MaterialGraphError('Truncated native material input')
    expression, output = struct.unpack_from('<ii', payload)
    if not 0 <= expression <= exports or output < 0:
        raise MaterialGraphError('Invalid material expression reference')
    reader = Reader(payload[8:16], names)
    masks = list(struct.unpack_from('<5i', payload, 16))
    if any(value not in (0, 1) for value in masks):
        raise MaterialGraphError('Invalid material channel mask')
    return {'expression': expression, 'output': output, 'input_name': reader.name(), 'mask': masks}


def extract_material_graph(package, source_bytes):
    document = package.document
    if document.get('HasUnversionedProperties') or document.get('IsFilterEditorOnly'):
        raise MaterialGraphError('Cooked or unversioned material graph is unsupported')
    names = document.get('NameMap', [])
    result = {'schema_version': 1, 'status': 'direct_connections_recovered', 'roots': {}, 'nodes': [],
              'shader_execution': 'not_translated', 'unsupported': []}
    for index, export in enumerate(package.exports, 1):
        kind = package.class_name(export)
        if kind != 'MaterialEditorOnlyData' and not kind.startswith('MaterialExpression'):
            continue
        start, size = export.get('SerialOffset'), export.get('SerialSize')
        if not isinstance(start, int) or not isinstance(size, int) or start < 0 or not 0 < size <= 2**20:
            raise MaterialGraphError('Invalid material export range')
        raw = source_bytes[start:start+size]
        if len(raw) != size:
            raise MaterialGraphError('Source material export range is incomplete')
        if isinstance(export.get('Data'), str) and base64.b64decode(export['Data'], validate=True) != raw:
            raise MaterialGraphError('Cached raw material export differs from source')
        properties, end = tagged_properties(raw, names)
        if export.get('ScriptSerializationEndOffset') not in (None, 0, end):
            raise MaterialGraphError('Tagged property endpoint differs from source metadata')
        inputs = {}
        for (name, array_index), prop in properties.items():
            types = prop['types']
            if len(types) < 2 or types[0] != 'StructProperty' or types[1] not in (
                    'ExpressionInput', 'ColorMaterialInput', 'ScalarMaterialInput',
                    'VectorMaterialInput', 'Vector2MaterialInput', 'MaterialAttributesInput'):
                continue
            if not 0 <= array_index < 1024 or not prop['flags'] & 8:
                raise MaterialGraphError(f'Unsupported material input serialization: {export["ObjectName"]}.{name}, flags={prop["flags"]}, size={len(prop["payload"])}')
            entry = native_input(prop['payload'], names, len(package.exports))
            if entry['expression'] and not package.class_name(package.exports[entry['expression']-1]).startswith('MaterialExpression'):
                raise MaterialGraphError('Material input does not reference an expression')
            extra = prop['payload'][36:]
            expected_size = {'ExpressionInput': 36, 'MaterialAttributesInput': 36,
                             'ColorMaterialInput': 56, 'ScalarMaterialInput': 44,
                             'VectorMaterialInput': 52, 'Vector2MaterialInput': 48}[types[1]]
            if len(prop['payload']) != expected_size:
                raise MaterialGraphError('Unsupported native material input size')
            if types[1] in ('ExpressionInput', 'MaterialAttributesInput'):
                if extra: raise MaterialGraphError('Unsupported expression input suffix')
            elif extra:
                constant_flag = struct.unpack_from('<i', extra)[0]
                if constant_flag not in (0, 1) or (len(extra)-4) % 4:
                    raise MaterialGraphError('Unsupported material input constant')
                constant = list(struct.unpack('<' + 'f' * ((len(extra)-4)//4), extra[4:]))
                if not all(math.isfinite(value) for value in constant):
                    raise MaterialGraphError('Non-finite material input constant')
                entry.update(use_constant=bool(constant_flag), constant=constant)
            inputs[name if not prop['flags'] & 1 else f'{name}[{array_index}]'] = entry
        if kind == 'MaterialEditorOnlyData':
            result['roots'].update(inputs)
        else:
            values = package.props(export)
            for input_name in inputs:
                values.pop(input_name.split('[', 1)[0], None)
            result['nodes'].append({'index': index, 'name': export['ObjectName'], 'class': kind,
                                    'inputs': inputs, 'properties': values})
            if kind == 'MaterialExpressionMaterialFunctionCall':
                result['unsupported'].append({'index': index, 'reason': 'nested function input bindings and function graph not translated'})
    if not result['roots']:
        raise MaterialGraphError('No source material root inputs were recovered')
    result['connection_count'] = sum(bool(value['expression']) for value in result['roots'].values()) + sum(
        bool(value['expression']) for node in result['nodes'] for value in node['inputs'].values())
    return result
