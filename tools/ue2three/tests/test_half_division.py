"""Integer division retains the full UE 5.7 typed denominator domain."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from blueprint_migration import BlueprintTranslationError, translate_function
from umg_migration import Package
from test_blueprint_migration import BlueprintMigrationTests, node


class HalfDivisionTests(unittest.TestCase):
    def translated(self, numerator, denominator):
        imports = [
            {'ObjectName': 'Divide_IntInt', 'ClassName': 'Function', 'OuterIndex': -2},
            {'ObjectName': 'KismetMathLibrary', 'OuterIndex': -3},
            {'ObjectName': '/Script/Engine'},
        ]
        function = BlueprintMigrationTests().function()
        function['ScriptBytecode'][1]['Expression'] = node(
            'EX_CallMath', StackNode=-1, Parameters=[numerator, denominator])
        return translate_function(function, Package({'Imports': imports}))

    def test_witnessed_division(self):
        # KismetMathLibrary.inl confirms integer division for every int32
        # denominator, including the source zero-diagnostic branch. Runtime
        # explicitly rejects native-undefined INT_MIN / -1.
        for numerator in (-2147483648, -7, -1, 0, 1, 7, 2147483647):
            for denominator in (0, -2, 2, 3):
                with self.subTest(numerator=numerator, denominator=denominator):
                    program = self.translated(node('EX_IntConst', Value=numerator),
                                              node('EX_IntConst', Value=denominator))
                    self.assertEqual(program['steps'][0]['value']['name'], 'Divide_IntInt')

    def test_division_rejects_non_integer_arguments(self):
        for denominator in (node('EX_DoubleConst', Value=2.5),
                            node('EX_StringConst', Value='2')):
            with self.subTest(denominator=denominator):
                with self.assertRaises(BlueprintTranslationError):
                    self.translated(node('EX_IntConst', Value=7), denominator)
