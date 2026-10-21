"""Guard exact Unreal VM computed-jump offsets; never synthesize dynamic destinations."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from blueprint_migration import BlueprintTranslationError, memory_size, translate_function


def expr(name, **kwargs):
    return {'$type': 'UAssetAPI.Kismet.Bytecode.Expressions.' + name + ', UAssetAPI', **kwargs}


def fixture(operand):
    instructions = [
        expr('EX_ComputedJump', CodeOffsetExpression=operand),
        expr('EX_Return', ReturnExpression=expr('EX_IntOne')),
        expr('EX_Return', ReturnExpression=expr('EX_IntZero')),
        expr('EX_EndOfScript'),
    ]
    return {
        'ObjectName': 'SourceConstantDispatch',
        'ScriptBytecode': instructions,
        'ScriptBytecodeSize': sum(memory_size(op) for op in instructions),
    }


class SourceConstantComputedJumpTests(unittest.TestCase):
    def test_original_constant_absolute_byte_offset_becomes_exact_target(self):
        code = fixture(expr('EX_IntConst', Value=8))
        result = translate_function(code)
        self.assertEqual(result['steps'][0]['op'], 'jump')
        self.assertEqual(result['steps'][0]['target'], 2)
        self.assertEqual(result['steps'][0]['target_offset'], 8)
        self.assertEqual(result['memory_size_verified'], 11)
        self.assertEqual(result['steps'][2]['value']['value'], 0)
        self.assertEqual(result['status'], 'translated_control_flow')

    def test_unaligned_or_outside_source_script_fails_closed(self):
        for offset in (7, 9, -1, 99):
            with self.subTest(offset=offset):
                with self.assertRaisesRegex(BlueprintTranslationError, 'boundary'):
                    translate_function(fixture(expr('EX_IntConst', Value=offset)))

    def test_dynamic_entrypoint_or_noninteger_is_not_guessed(self):
        for operand in (
            expr('EX_LocalVariable', Variable={'New': {'Path': ['EntryPoint'], 'ResolvedOwner': 1}}),
            expr('EX_DoubleConst', Value='8'),
        ):
            with self.subTest(token=operand['$type']):
                with self.assertRaisesRegex(BlueprintTranslationError, 'Dynamic computed jump'):
                    translate_function(fixture(operand))

    def test_missing_or_incorrect_original_memory_size_is_rejected(self):
        fn = fixture(expr('EX_IntConst', Value=8))
        fn.pop('ScriptBytecodeSize')
        with self.assertRaisesRegex(BlueprintTranslationError, 'memory size'):
            translate_function(fn)
        fn['ScriptBytecodeSize'] = 10
        with self.assertRaisesRegex(BlueprintTranslationError, 'memory size'):
            translate_function(fn)


if __name__ == '__main__':
    unittest.main()
