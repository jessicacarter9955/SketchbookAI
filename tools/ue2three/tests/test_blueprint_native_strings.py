"""Unreal source-witnessed native Kismet string conversion contracts."""
import unittest
from blueprint_migration import expression, BlueprintTranslationError
from umg_migration import Package
from test_blueprint_migration import node


def package(name, schema):
    return Package({'Imports': [
        {'ObjectName': name, 'ClassName': 'Function', 'OuterIndex': -2},
        {'ObjectName': 'KismetStringLibrary', 'OuterIndex': -3},
        {'ObjectName': '/Script/Engine', 'ClassName': 'Package'}],
        'Exports': [{'ObjectName': 'Original_C', 'LoadedProperties': [
            {'Name': 'Value', 'SerializedType': schema}]}]})


def call(value):
    return node('EX_CallMath', StackNode=-1, Parameters=[value])


class NativeStringConversionTests(unittest.TestCase):
    def test_name_to_string_preserves_original_name_and_source_identity(self):
        original = package('Conv_NameToString', 'NameProperty')
        var = node('EX_InstanceVariable', Variable={'New': {'Path': ['Value'], 'ResolvedOwner': 1}})
        result = expression(call(var), set(), set(), package=original, owner=1)
        self.assertEqual(result['identity'],
                         ['/Script/Engine', 'KismetStringLibrary', 'Conv_NameToString'])
        self.assertEqual(result['parameter_types'], ['NameProperty'])
        self.assertEqual(result['args'], [{'op': 'get', 'scope': 'self', 'field': 'Value'}])
        literal = expression(call(node('EX_NameConst', Value='Bone_Spine_02')),
                             set(), set(), package=original, owner=1)
        self.assertEqual(literal['args'][0]['value'], 'Bone_Spine_02')
        self.assertEqual(literal['args'][0]['schema']['type'], 'NameProperty')
        original.exports[0]['LoadedProperties'][0]['SerializedType'] = 'StrProperty'
        with self.assertRaisesRegex(BlueprintTranslationError, 'parameter type'):
            expression(call(var), set(), set(), package=original, owner=1)

    def test_int32_to_string_retains_sign_and_exact_source_range(self):
        original = package('Conv_IntToString', 'IntProperty')
        for value in (-2147483648, 0, 1, 2147483647):
            with self.subTest(value=value):
                literal = node('EX_IntConst', Value=value)
                result = expression(call(literal), set(), set(), package=original, owner=1)
                self.assertEqual(result['parameter_types'], ['IntProperty'])
                self.assertEqual(result['return_type'], 'StrProperty')
                self.assertEqual(result['args'][0]['value'], value)
        with self.assertRaises(BlueprintTranslationError):
            expression(call(node('EX_IntConst', Value=2147483648)), set(), set(),
                       package=original, owner=1)
        original.imports[1]['ObjectName'] = 'FakeStringLibrary'
        with self.assertRaisesRegex(BlueprintTranslationError, 'outside Engine.KismetMathLibrary'):
            expression(call(node('EX_IntZero')), set(), set(), package=original, owner=1)

    def test_no_arity_or_native_identity_fallback(self):
        p = package('Conv_NameToString', 'NameProperty')
        with self.assertRaisesRegex(BlueprintTranslationError, 'arity'):
            expression(node('EX_CallMath', StackNode=-1, Parameters=[]),
                       set(), set(), package=p, owner=1)
        p.imports[0]['ObjectName'] = 'SomeUnknownNameConverter'
        with self.assertRaises(BlueprintTranslationError):
            expression(call(node('EX_NameConst', Value='Bone')), set(), set(), package=p, owner=1)


if __name__ == '__main__':
    unittest.main()
