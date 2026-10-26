"""UE5.7 KismetTextLibrary's invariant conversion contracts, never locale guesses."""
import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from blueprint_migration import expression, property_type, BlueprintTranslationError
from blueprint_values import text_value
from umg_migration import Package
from test_blueprint_migration import node


def source():
    return Package({'Imports': [
        {'ObjectName': 'Conv_StringToText', 'ClassName': 'Function', 'OuterIndex': -4},
        {'ObjectName': 'Conv_TextToString', 'ClassName': 'Function', 'OuterIndex': -4},
        {'ObjectName': 'Conv_NameToText', 'ClassName': 'Function', 'OuterIndex': -4},
        {'ObjectName': 'KismetTextLibrary', 'OuterIndex': -5},
        {'ObjectName': '/Script/Engine', 'ClassName': 'Package'}], 'Exports': [
            {'ObjectName': 'Original_C', 'LoadedProperties': [{'Name': 'Title', 'SerializedType': 'TextProperty'}]}]})


class TextConversionTests(unittest.TestCase):
    def test_nested_conversion_retains_typed_native_identities(self):
        inner = node('EX_CallMath', StackNode=-1, Parameters=[node('EX_StringConst', Value='Original')])
        result = expression(node('EX_CallMath', StackNode=-2, Parameters=[inner]), set(), set(), package=source(), owner=1)
        self.assertEqual(result['return_type'], 'StrProperty')
        self.assertEqual(result['args'][0]['return_type'], 'TextProperty')
        self.assertEqual(result['args'][0]['identity'], ['/Script/Engine', 'KismetTextLibrary', 'Conv_StringToText'])
        with self.assertRaisesRegex(BlueprintTranslationError, 'nested return type'):
            expression(node('EX_CallMath', StackNode=-1, Parameters=[inner]), set(), set(), package=source(), owner=1)

    def test_text_property_and_original_invariant_literal(self):
        original = source()
        self.assertEqual(property_type(original.exports[0]['LoadedProperties'][0], original), 'TextProperty')
        target = node('EX_InstanceVariable', Variable={'New': {'Path': ['Title'], 'ResolvedOwner': 1}})
        result = expression(node('EX_CallMath', StackNode=-2, Parameters=[target]), set(), set(), package=original, owner=1)
        self.assertEqual(result['args'][0]['field'], 'Title')
        literal = node('EX_TextConst', Value={'TextLiteralType':'InvariantText',
            'InvariantLiteralString':node('EX_UnicodeStringConst', Value='Original 😀')})
        result = expression(node('EX_CallMath', StackNode=-2, Parameters=[literal]), set(), set(), package=original, owner=1)
        self.assertEqual(result['args'][0]['value'], {'history':'invariant','text':'Original 😀','flags':2})

    def test_invariant_serialization_rejects_unverified_history_or_flags(self):
        self.assertEqual(text_value({'HistoryType':'None','Flags':2,'Value':None,'CultureInvariantString':'Title'}),
                         {'history':'invariant','text':'Title','flags':2})
        with self.assertRaises(ValueError):
            text_value({'HistoryType':'None','Flags':0,'Value':None,'CultureInvariantString':'Title'})

    def test_foreign_library_and_wrong_argument_type_remain_blocked(self):
        p = source()
        p.imports[3]['ObjectName'] = 'ForeignTextLibrary'
        with self.assertRaises(BlueprintTranslationError):
            expression(node('EX_CallMath', StackNode=-1, Parameters=[node('EX_StringConst',Value='Title')]),
                       set(),set(),package=p,owner=1)
        with self.assertRaises(BlueprintTranslationError):
            expression(node('EX_CallMath', StackNode=-1, Parameters=[node('EX_NameConst',Value='Title')]),
                       set(),set(),package=source(),owner=1)


if __name__ == '__main__':
    unittest.main()
