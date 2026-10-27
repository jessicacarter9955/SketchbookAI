"""Typed UE5.7 CST_DoubleToFloat / CST_FloatToDouble conversion witnesses."""
import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from blueprint_migration import expression, memory_size, native_math_source_type, BlueprintTranslationError
from umg_migration import Package
from test_blueprint_migration import node


class PrimitiveCastTests(unittest.TestCase):
    def source(self, type_name):
        return Package({'Imports': [], 'Exports': [
            {'ObjectName': 'Original_C', 'LoadedProperties': [
                {'Name': 'Value', 'SerializedType': type_name}]}]})

    def value(self):
        return node('EX_InstanceVariable', Variable={'New': {'Path': ['Value'], 'ResolvedOwner': 1}})

    def test_round_trip_preserves_explicit_conversion_boundary(self):
        package = self.source('DoubleProperty')
        original = node('EX_PrimitiveCast', ConversionType=4,
                        Target=node('EX_PrimitiveCast', ConversionType=3, Target=self.value()))
        reads = set()
        result = expression(original, reads, set(), package=package, owner=1)
        self.assertEqual(result['source_type'], 'FloatProperty')
        self.assertEqual(result['return_type'], 'DoubleProperty')
        self.assertEqual(result['value']['return_type'], 'FloatProperty')
        self.assertEqual(result['value']['value'], {'op': 'get', 'scope': 'self', 'field': 'Value'})
        self.assertEqual(reads, {'Value'})
        self.assertEqual(memory_size(original, package=package), 13)
        self.assertEqual(native_math_source_type(original, package, 1), 'DoubleProperty')

    def test_original_variable_type_and_owner_are_required(self):
        for type_name, conversion in [('DoubleProperty', 4), ('FloatProperty', 3), ('IntProperty', 3)]:
            with self.subTest(type_name=type_name, conversion=conversion):
                with self.assertRaisesRegex(BlueprintTranslationError, 'source type differs'):
                    expression(node('EX_PrimitiveCast', ConversionType=conversion, Target=self.value()),
                               set(), set(), package=self.source(type_name), owner=1)
        foreign = self.value()
        foreign['Variable']['New']['ResolvedOwner'] = 2
        with self.assertRaisesRegex(BlueprintTranslationError, 'another source class'):
            expression(node('EX_PrimitiveCast', ConversionType=3, Target=foreign),
                       set(), set(), package=self.source('DoubleProperty'), owner=1)

    def test_unknown_enum_and_boolean_enum_do_not_fall_back(self):
        for conversion in [2, 5, True, '3', 'ObjectToInterface', None]:
            with self.subTest(conversion=conversion):
                with self.assertRaisesRegex(BlueprintTranslationError, 'primitive cast conversion'):
                    expression(node('EX_PrimitiveCast', ConversionType=conversion, Target=self.value()),
                               set(), set(), package=self.source('DoubleProperty'), owner=1)

    def test_object_to_bool_rejects_numeric_source_properties(self):
        with self.assertRaisesRegex(BlueprintTranslationError,'live-object binding'):
            expression(node('EX_PrimitiveCast',ConversionType=1,Target=self.value()),
                set(),set(),package=self.source('DoubleProperty'),owner=1)


if __name__ == '__main__':
    unittest.main()
