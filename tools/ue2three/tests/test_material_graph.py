import base64
import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from material_graph import MaterialGraphError, extract_material_graph, tagged_properties, native_input
from umg_migration import Package


NAMES = ['None', 'BaseColor', 'StructProperty', 'ColorMaterialInput', '/Script/Engine', 'A', 'ExpressionInput']


def fname(name):
    return struct.pack('<ii', NAMES.index(name), 0)


def tag(name, kind, payload, flags=8):
    return (fname(name) + fname('StructProperty') + struct.pack('<i', 1) + fname(kind) +
            struct.pack('<i', 1) + fname('/Script/Engine') + struct.pack('<i', 0) +
            struct.pack('<iB', len(payload), flags) + payload)


def fixture():
    link = struct.pack('<ii', 2, 0) + fname('None') + struct.pack('<5i', 0, 0, 0, 0, 0)
    root = b'\0' + tag('BaseColor', 'ColorMaterialInput', link + struct.pack('<i4f', 0, 0.1, 0.2, 0.3, 1)) + fname('None')
    node = b'\0' + tag('A', 'ExpressionInput', b'\0'*8 + fname('None') + b'\0'*20) + fname('None')
    doc = {'NameMap': NAMES, 'Imports': [{'ObjectName': 'MaterialEditorOnlyData'}, {'ObjectName': 'MaterialExpressionMultiply'}],
           'Exports': [{'ObjectName': 'Editor', 'ClassIndex': -1, 'SerialOffset': 0, 'SerialSize': len(root),
                        'ScriptSerializationEndOffset': len(root), 'Data': base64.b64encode(root).decode()},
                       {'ObjectName': 'Multiply', 'ClassIndex': -2, 'SerialOffset': len(root), 'SerialSize': len(node),
                        'ScriptSerializationEndOffset': len(node), 'Data': []}]}
    return Package(doc), root + node


class MaterialGraphTests(unittest.TestCase):
    def test_recovers_native_fields_not_json_value_placeholders(self):
        package, raw = fixture(); graph = extract_material_graph(package, raw)
        self.assertEqual(graph['status'], 'direct_connections_recovered')
        self.assertEqual(graph['roots']['BaseColor']['expression'], 2)
        self.assertEqual(graph['nodes'][0]['inputs']['A']['expression'], 0)
        self.assertAlmostEqual(graph['roots']['BaseColor']['constant'][1], 0.2)
        self.assertEqual(graph['connection_count'], 1)
        self.assertEqual(graph['shader_execution'], 'not_translated')

    def test_truncation_invalid_names_and_extensions_are_rejected(self):
        for raw in (b'', b'\0\xff'*5, b'\2' + b'\0'*40):
            with self.assertRaises(MaterialGraphError): tagged_properties(raw, NAMES)
        with self.assertRaises(MaterialGraphError): native_input(b'\0'*35, NAMES, 2)

    def test_cache_source_mismatch_and_unsupported_versions_are_rejected(self):
        package, raw = fixture()
        with self.assertRaisesRegex(MaterialGraphError, 'differs from source'):
            extract_material_graph(package, b'\1' + raw[1:])
        package.document['HasUnversionedProperties'] = True
        with self.assertRaisesRegex(MaterialGraphError, 'unversioned'):
            extract_material_graph(package, raw)

    def test_native_reference_masks_and_endpoint_are_checked(self):
        link = struct.pack('<ii', 3, 0) + fname('None') + b'\0'*20
        with self.assertRaises(MaterialGraphError): native_input(link, NAMES, 2)
        link = struct.pack('<ii', 2, 0) + fname('None') + struct.pack('<5i', 2, 0, 0, 0, 0)
        with self.assertRaises(MaterialGraphError): native_input(link, NAMES, 2)
        package, raw = fixture(); package.exports[0]['ScriptSerializationEndOffset'] -= 1
        with self.assertRaisesRegex(MaterialGraphError, 'endpoint'):
            extract_material_graph(package, raw)


if __name__ == '__main__': unittest.main()
