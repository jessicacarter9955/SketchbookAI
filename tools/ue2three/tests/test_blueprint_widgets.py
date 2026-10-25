"""Source-witnessed native UMG widget context translation contracts."""
import unittest

from blueprint_migration import expression, memory_size, BlueprintTranslationError
from umg_migration import Package
from test_blueprint_migration import node


def source_package(class_name='TextBlock'):
    return Package({'Imports': [
        {'ObjectName': 'SetText', 'ClassName': 'Function', 'OuterIndex': -2},
        {'ObjectName': 'TextBlock', 'ClassName': 'Class', 'OuterIndex': -3},
        {'ObjectName': '/Script/UMG', 'ClassName': 'Package'},
        {'ObjectName': class_name, 'ClassName': 'Class', 'OuterIndex': -3}],
        'Exports': [{'ObjectName': 'Source_WBP_C', 'LoadedProperties': [
            {'Name': 'Txt_Label', 'SerializedType': 'ObjectProperty', 'PropertyClass': -2},
            {'Name': 'VisibilityByte', 'SerializedType': 'ByteProperty'},
            {'Name': 'LabelText', 'SerializedType': 'TextProperty'}
        ]}]})


def receiver(field='Txt_Label'):
    return node('EX_InstanceVariable', Variable={'New': {'Path': [field], 'ResolvedOwner': 1}})


def context(method='SetText', arg=None, original=None):
    original = original or source_package()
    method = node('EX_FinalFunction', StackNode=-1, Parameters=[
        arg or node('EX_TextConst', Value={'TextLiteralType': 'Empty'})]) if method == 'SetText' else node(
        'EX_VirtualFunction', VirtualFunctionName='SetVisibility',
        Parameters=[arg if arg is not None else node('EX_ByteConst', Value=2)])
    return node('EX_Context', ObjectExpression=receiver(), ContextExpression=method,
                Offset=memory_size(method, package=original), PropertyType=0,
                RValuePointer={'New': {'Path': [], 'ResolvedOwner': 0}})


class NativeWidgetContextTests(unittest.TestCase):
    def test_original_umg_textblock_set_text_retains_source_class_and_typed_text(self):
        p = source_package()
        result = expression(context(original=p), set(), set(), package=p, owner=1)
        self.assertEqual(result['op'], 'native_widget_effect')
        self.assertEqual(result['identity'], ['/Script/UMG','TextBlock','SetText'])
        self.assertEqual(result['receiver_field'], 'Txt_Label')
        self.assertEqual(result['receiver_schema']['reference_kind'], 'runtime_native_widget')
        self.assertEqual(result['parameter']['schema']['type'], 'TextProperty')
        self.assertFalse(result['visual_1to1_certified'])

    def test_original_umg_visibility_preserves_source_enum_byte(self):
        p = source_package()
        for value in range(5):
            with self.subTest(value=value):
                result = expression(context('SetVisibility', node('EX_ByteConst',Value=value),p),
                                    set(), set(), package=p, owner=1)
                self.assertEqual(result['identity'], ['/Script/UMG','Widget','SetVisibility'])
                self.assertEqual(result['parameter']['value']['value'], value)
        with self.assertRaisesRegex(BlueprintTranslationError, 'ESlateVisibility'):
            expression(context('SetVisibility',node('EX_ByteConst',Value=5),p),
                       set(), set(), package=p, owner=1)

    def test_context_offsets_pointer_and_target_class_fail_closed(self):
        p = source_package()
        original = context(original=p)
        original['Offset'] += 1
        with self.assertRaisesRegex(BlueprintTranslationError, 'layout'):
            expression(original, set(), set(), package=p, owner=1)
        original['Offset'] -= 1
        original['RValuePointer']['New']['Path'] = ['Unknown']
        with self.assertRaisesRegex(BlueprintTranslationError, 'layout'):
            expression(original, set(), set(), package=p, owner=1)
        p = source_package()
        p.imports[1]['ObjectName'] = 'NotTextBlock'
        with self.assertRaisesRegex(BlueprintTranslationError, 'receiver class'):
            expression(context(original=p), set(), set(), package=p, owner=1)

    def test_widget_call_requires_matching_source_parameter_types(self):
        p = source_package()
        target = receiver('VisibilityByte')
        with self.assertRaisesRegex(BlueprintTranslationError, 'schema differs'):
            expression(context('SetText', target, p), set(), set(), package=p, owner=1)
        with self.assertRaisesRegex(BlueprintTranslationError, 'source-typed'):
            expression(context('SetVisibility', node('EX_IntConst',Value=1), p),
                       set(), set(), package=p, owner=1)


if __name__ == '__main__':
    unittest.main()
