"""Source-witnessed native UMG widget context translation contracts."""
import unittest

from blueprint_migration import expression, memory_size, property_type, BlueprintTranslationError
from blueprint_values import native_schema
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

    def test_virtual_umg_text_uses_original_text_property(self):
        p = source_package()
        call = node('EX_VirtualFunction', VirtualFunctionName='SetText',
                    Parameters=[node('EX_InstanceVariable',
                                     Variable={'New': {'Path': ['LabelText'], 'ResolvedOwner': 1}})])
        result = expression(node('EX_Context', ObjectExpression=receiver(),
            ContextExpression=call, Offset=memory_size(call, package=p), PropertyType=0,
            RValuePointer={'New': {'Path': [], 'ResolvedOwner': 0}}),
            set(), set(), package=p, owner=1)
        self.assertEqual(result['identity'], ['/Script/UMG','TextBlock','SetText'])
        self.assertEqual(result['dispatch'], 'EX_VirtualFunction')
        self.assertEqual(result['parameter']['schema']['type'], 'TextProperty')

    def test_widget_set_focus_is_an_exact_zero_argument_source_ui_effect(self):
        p=source_package();p.imports[0]['ObjectName']='SetFocus'
        p.imports[1]['ObjectName']='Widget'
        call=node('EX_FinalFunction',StackNode=-1,Parameters=[])
        context=node('EX_Context',ObjectExpression=receiver(),ContextExpression=call,
            Offset=memory_size(call,package=p),PropertyType=0,
            RValuePointer={'New':{'Path':[],'ResolvedOwner':0}})
        result=expression(context,set(),set(),package=p,owner=1)
        self.assertEqual(result['op'],'native_widget_effect')
        self.assertEqual(result['identity'],['/Script/UMG','Widget','SetFocus'])
        self.assertEqual(result['dispatch'],'EX_FinalFunction')
        self.assertNotIn('parameter',result)
        self.assertFalse(result['visual_1to1_certified'])

        p.imports[0]['ClassName']='Class'
        with self.assertRaisesRegex(BlueprintTranslationError,'function identity'):
            expression(context,set(),set(),package=p,owner=1)

    def test_umg_textblock_color_source_struct_only(self):
        p = source_package()
        p.imports[0]['ObjectName'] = 'SetColorAndOpacity'
        p.imports.extend([
            {'ObjectName': 'SlateColor', 'ClassName': 'ScriptStruct', 'OuterIndex': -6},
            {'ObjectName': '/Script/SlateCore', 'ClassName': 'Package'}
        ])
        p.exports[0]['LoadedProperties'].append({
            'Name': 'HighlightColor', 'SerializedType': 'StructProperty', 'Struct': -5})
        call = node('EX_FinalFunction', StackNode=-1, Parameters=[
            node('EX_InstanceVariable',
                 Variable={'New': {'Path': ['HighlightColor'], 'ResolvedOwner': 1}})])
        result = expression(node('EX_Context', ObjectExpression=receiver(),
            ContextExpression=call, Offset=memory_size(call, package=p), PropertyType=0,
            RValuePointer={'New': {'Path': [], 'ResolvedOwner': 0}}),
            set(), set(), package=p, owner=1)
        self.assertEqual(result['identity'], ['/Script/UMG','TextBlock','SetColorAndOpacity'])
        self.assertEqual(result['parameter']['schema'],native_schema(('/Script/SlateCore','SlateColor')))

    def test_border_material_brush_keeps_original_typed_material_identity(self):
        p = Package({'Imports': [
            {'ObjectName': 'SetBrushFromMaterial', 'ClassName': 'Function', 'OuterIndex': -2},
            {'ObjectName': 'Border', 'ClassName': 'Class', 'OuterIndex': -3},
            {'ObjectName': '/Script/UMG', 'ClassName': 'Package'},
            {'ObjectName': '/Game/Materials', 'ClassName': 'Package'},
            {'ObjectName': 'M_UI_Border', 'ClassName': 'MaterialInstanceConstant',
             'ClassPackage': '/Script/Engine', 'OuterIndex': -4}],
            'Exports': [{'ObjectName': 'Source_WBP_C', 'LoadedProperties': [
                {'Name': 'Border_Selection', 'SerializedType': 'ObjectProperty', 'PropertyClass': -2}]}]})
        call = node('EX_FinalFunction', StackNode=-1,
                    Parameters=[node('EX_ObjectConst', Value=-5)])
        value = node('EX_Context', ObjectExpression=receiver('Border_Selection'),
                     ContextExpression=call, Offset=memory_size(call, package=p), PropertyType=0,
                     RValuePointer={'New': {'Path': [], 'ResolvedOwner': 0}})
        result = expression(value, set(), set(), package=p, owner=1)
        self.assertEqual(property_type(p.exports[0]['LoadedProperties'][0], p), 'ObjectProperty')
        self.assertEqual(result['identity'], ['/Script/UMG', 'Border', 'SetBrushFromMaterial'])
        self.assertEqual(result['parameter']['schema'], {
            'type': 'ObjectProperty', 'class': ['/Script/Engine', 'MaterialInstanceConstant'], 'default': None})
        self.assertEqual(result['parameter']['value']['value'], {
            'asset': '/Game/Materials.M_UI_Border',
            'declared_class': ['/Script/Engine', 'MaterialInstanceConstant']})

        p.imports[4]['ClassName'] = 'SoundWave'
        with self.assertRaisesRegex(BlueprintTranslationError, 'source material asset'):
            expression(value, set(), set(), package=p, owner=1)
        p.imports.extend([
            {'ObjectName': 'Object', 'ClassName': 'Class', 'OuterIndex': -7},
            {'ObjectName': '/Script/CoreUObject', 'ClassName': 'Package'}])
        with self.assertRaisesRegex(BlueprintTranslationError, 'Unsupported source property type: ObjectProperty'):
            property_type({'SerializedType': 'ObjectProperty', 'PropertyClass': -6}, p)

    def test_progress_bar_set_percent_preserves_float_pin_and_original_widget_class(self):
        p = source_package('ProgressBar')
        p.imports[0]['ObjectName'] = 'SetPercent'
        p.imports[1]['ObjectName'] = 'ProgressBar'
        p.exports[0]['LoadedProperties'][0]['Name'] = 'Progress'
        call = node('EX_FinalFunction', StackNode=-1, Parameters=[node('EX_FloatConst', Value='+0.5')])
        value = node('EX_Context', ObjectExpression=receiver('Progress'), ContextExpression=call,
                     Offset=memory_size(call, package=p), PropertyType=0,
                     RValuePointer={'New': {'Path': [], 'ResolvedOwner': 0}})
        result = expression(value, set(), set(), package=p, owner=1)
        self.assertEqual(result['identity'], ['/Script/UMG', 'ProgressBar', 'SetPercent'])
        self.assertEqual(result['receiver_schema']['class'], ['/Script/UMG', 'ProgressBar'])
        self.assertEqual(result['parameter']['schema']['type'], 'FloatProperty')
        self.assertEqual(result['parameter']['value']['value'], 0.5)
        p.imports[1]['ObjectName'] = 'TextBlock'
        with self.assertRaisesRegex(BlueprintTranslationError, 'receiver class differs'):
            expression(value, set(), set(), package=p, owner=1)

    def test_image_brush_texture_preserves_original_asset_and_match_size(self):
        p = source_package('Image')
        p.imports[1]['ObjectName'] = 'Image'
        p.imports.extend([
            {'ObjectName': 'Texture2D', 'ClassName': 'Class', 'OuterIndex': -6},
            {'ObjectName': '/Script/Engine', 'ClassName': 'Package'}])
        p.exports[0]['LoadedProperties'].extend([
            {'Name': 'IconImage', 'SerializedType': 'ObjectProperty', 'PropertyClass': -2},
            {'Name': 'OriginalTexture', 'SerializedType': 'ObjectProperty', 'PropertyClass': -5},
            {'Name': 'MatchSize', 'SerializedType': 'BoolProperty'}])
        call = node('EX_VirtualFunction', VirtualFunctionName='SetBrushFromTexture',
                    Parameters=[receiver('OriginalTexture'), node('EX_False')])
        original = node('EX_Context', ObjectExpression=receiver('IconImage'), ContextExpression=call,
                        Offset=memory_size(call, package=p), PropertyType=0,
                        RValuePointer={'New': {'Path': [], 'ResolvedOwner': 0}})
        result = expression(original, set(), set(), package=p, owner=1)
        self.assertEqual(result['identity'], ['/Script/UMG', 'Image', 'SetBrushFromTexture'])
        self.assertEqual(result['parameter']['schema']['class'], ['/Script/Engine', 'Texture2D'])
        self.assertEqual(result['options']['bMatchSize']['value']['value'], False)
        self.assertFalse(result['visual_1to1_certified'])
        call['Parameters'][1] = receiver('MatchSize')
        original['Offset'] = memory_size(call, package=p)
        result = expression(original, set(), set(), package=p, owner=1)
        self.assertEqual(result['options']['bMatchSize']['value']['field'], 'MatchSize')
        call['Parameters'][1] = node('EX_IntConst', Value=1)
        original['Offset'] = memory_size(call, package=p)
        with self.assertRaisesRegex(BlueprintTranslationError, 'bMatchSize'):
            expression(original, set(), set(), package=p, owner=1)
        call['Parameters'][1] = node('EX_False')
        original['Offset'] = memory_size(call, package=p)
        p.exports[0]['LoadedProperties'][-2]['PropertyClass'] = -2
        with self.assertRaisesRegex(BlueprintTranslationError, 'Texture2D'):
            expression(original, set(), set(), package=p, owner=1)

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
        with self.assertRaisesRegex(BlueprintTranslationError, 'receiver class differs'):
            expression(context(original=p), set(), set(), package=p, owner=1)

    def test_widget_call_requires_matching_source_parameter_types(self):
        p = source_package()
        target = receiver('VisibilityByte')
        with self.assertRaisesRegex(BlueprintTranslationError, 'schema differs'):
            expression(context('SetText', target, p), set(), set(), package=p, owner=1)
        with self.assertRaisesRegex(BlueprintTranslationError, 'source-typed'):
            expression(context('SetVisibility', node('EX_IntConst',Value=1), p),
                       set(), set(), package=p, owner=1)

    def test_image_brush_from_texture_preserves_texture_and_match_size_arguments(self):
        p = Package({'Imports': [
            {'ObjectName': 'SetBrushFromTexture', 'ClassName': 'Function', 'OuterIndex': -2},
            {'ObjectName': 'Image', 'ClassName': 'Class', 'OuterIndex': -3},
            {'ObjectName': '/Script/UMG', 'ClassName': 'Package'},
            {'ObjectName': '/Script/Engine', 'ClassName': 'Package'},
            {'ObjectName': 'Texture2D', 'ClassName': 'Class', 'OuterIndex': -4}],
            'Exports': [{'ObjectName': 'Source_WBP_C', 'LoadedProperties': [
                {'Name': 'Img_ItemIcon', 'SerializedType': 'ObjectProperty', 'PropertyClass': -2},
                {'Name': 'Tex_Empty', 'SerializedType': 'ObjectProperty', 'PropertyClass': -5},
                {'Name': 'bMatchSize', 'SerializedType': 'BoolProperty'}]}]})
        call = node('EX_VirtualFunction', VirtualFunctionName='SetBrushFromTexture', Parameters=[
            receiver('Tex_Empty'), node('EX_False')])
        value = node('EX_Context', ObjectExpression=receiver('Img_ItemIcon'), ContextExpression=call,
                     Offset=memory_size(call, package=p), PropertyType=0,
                     RValuePointer={'New': {'Path': [], 'ResolvedOwner': 0}})
        result = expression(value, set(), set(), package=p, owner=1)
        self.assertEqual(result['identity'], ['/Script/UMG', 'Image', 'SetBrushFromTexture'])
        self.assertEqual(result['dispatch'], 'EX_VirtualFunction')
        self.assertEqual(result['receiver_schema']['class'], ['/Script/UMG', 'Image'])
        self.assertEqual(result['parameter']['schema']['type'], 'ObjectProperty')
        self.assertEqual(result['options']['bMatchSize']['schema']['type'], 'BoolProperty')
        self.assertEqual(result['parameter']['schema']['class'], ['/Script/Engine', 'Texture2D'])
        self.assertEqual(result['parameter']['value']['field'], 'Tex_Empty')
        self.assertFalse(result['options']['bMatchSize']['value']['value'])

        p.exports[0]['LoadedProperties'][1]['PropertyClass'] = -2
        with self.assertRaisesRegex(BlueprintTranslationError, 'typed source Texture2D'):
            expression(value, set(), set(), package=p, owner=1)


if __name__ == '__main__':
    unittest.main()
