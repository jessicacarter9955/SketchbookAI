import unittest
from copy import deepcopy

from blueprint_migration import BlueprintTranslationError, expression
from blueprint_values import native_schema
from test_blueprint_migration import node
from umg_migration import Package


class SourceInputKeyTests(unittest.TestCase):
    def source(self):
        imports = [
            {'ObjectName': 'EqualEqual_KeyKey', 'ClassName': 'Function', 'OuterIndex': -2},
            {'ObjectName': 'KismetInputLibrary', 'ClassName': 'Class', 'OuterIndex': -3},
            {'ObjectName': '/Script/Engine', 'ClassName': 'Package'},
            {'ObjectName': 'Key', 'ClassName': 'ScriptStruct', 'OuterIndex': -5},
            {'ObjectName': '/Script/InputCore', 'ClassName': 'Package'},
        ]
        cls = {'ObjectName': 'Widget_C', 'LoadedProperties': []}
        function = {'ObjectName': 'OnKeyUp', 'OuterIndex': 1, 'LoadedProperties': [
            {'Name': 'InputKey', 'SerializedType': 'StructProperty', 'Struct': -4}
        ]}
        package = Package({'Imports': imports, 'Exports': [cls, function]})
        package._active_function = function
        get = node('EX_LocalVariable',
                   Variable={'New': {'Path': ['InputKey'], 'ResolvedOwner': 2}})
        literal = node('EX_StructConst', Struct=-4, StructSize=32,
                       Value=[node('EX_NameConst', Value='Gamepad_FaceButton_Left')])
        call = node('EX_CallMath', StackNode=-1, Parameters=[get, literal])
        return package, call

    def test_witnessed_ue57_key_name_equality_converts_with_exact_struct_identity(self):
        package, call = self.source()
        self.assertEqual(native_schema(('/Script/InputCore', 'Key')), {
            'type': 'StructProperty', 'source': '/Script/InputCore',
            'native': 'Key',
            'fields': {'KeyName': {'type': 'NameProperty', 'default': 'None'}},
            'default': {'KeyName': 'None'}, 'member_order': ['KeyName']})
        result = expression(call, set(), set(), package=package, owner=1)
        self.assertEqual(result['op'], 'math')
        self.assertEqual(result['name'], 'EqualEqual_KeyKey')
        self.assertEqual(result['args'][0], {'op':'get','scope':'local','field':'InputKey'})
        self.assertEqual(result['args'][1]['schema'], native_schema(('/Script/InputCore', 'Key')))
        self.assertEqual(result['args'][1]['source_struct_size'], 32)

    def test_mismatched_key_layout_ownership_identity_and_unicode_reject(self):
        for failure in ('size','struct','name','ownership','parameter','function','arity'):
            package, call = self.source()
            if failure == 'size':
                call['Parameters'][1]['StructSize'] = 24
            elif failure == 'struct':
                call['Parameters'][1]['Struct'] = -2
            elif failure == 'name':
                call['Parameters'][1]['Value'][0]['Value'] = 'Tök'
            elif failure == 'ownership':
                call['Parameters'][0]['Variable']['New']['ResolvedOwner'] = 1
            elif failure == 'parameter':
                package.exports[1]['LoadedProperties'][0]['SerializedType'] = 'StrProperty'
            elif failure == 'function':
                package.imports[0]['ObjectName'] = 'OtherFunction'
            elif failure == 'arity':
                call['Parameters'].pop()
            with self.subTest(failure=failure), self.assertRaises(BlueprintTranslationError):
                expression(call, set(), set(), package=package, owner=1)


if __name__ == '__main__':
    unittest.main()
