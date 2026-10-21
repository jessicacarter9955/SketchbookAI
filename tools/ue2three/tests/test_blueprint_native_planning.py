import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import digest
from blueprint_native_planning import native_surface, rank_native_families, adapter_present
import test_blueprint_events as event_fixtures
from test_blueprint_migration import node
from umg_migration import Package


class NativePlanningTests(unittest.TestCase):
    def imports(self):
        return [{'ObjectName': 'LineTraceSingle', 'ClassName': 'Function', 'OuterIndex': -2},
                {'ObjectName': 'KismetSystemLibrary', 'OuterIndex': -3},
                {'ObjectName': '/Script/Engine', 'ClassName': 'Package'},
                {'ObjectName': 'IsValid', 'ClassName': 'Function', 'OuterIndex': -2}]

    def test_exact_api_identity_arity_and_presence_are_diagnostic_only(self):
        self.assertTrue(adapter_present(('/Script/Engine','KismetStringLibrary','Concat_StrStr')))
        self.assertFalse(adapter_present(('/Script/Engine','KismetStringLibrary','Join_StrStr')))
        code = [node('EX_CallMath', StackNode=-1, Parameters=[node('EX_Self')]),
                node('EX_FinalFunction', StackNode=-4, Parameters=[]),
                node('EX_FinalFunction', StackNode=99, Parameters=[]),
                node('EX_FinalFunction', StackNode=-2, Parameters=[]),
                node('EX_VirtualFunction', VirtualFunctionName='UnresolvedSourceCall')]
        package = Package({'Exports': [{'ObjectName': 'Test', 'ScriptBytecode': code}], 'Imports': self.imports()})
        result = native_surface(package, package.exports[0])
        self.assertEqual(len(result['calls']), 2)
        trace, valid = result['calls']
        self.assertEqual(trace['identity'], ['/Script/Engine', 'KismetSystemLibrary', 'IsValid'])
        self.assertTrue(trace['adapter_family_present'])
        self.assertEqual(valid['family'], 'native-physics')
        self.assertFalse(valid['adapter_family_present'])
        self.assertEqual(valid['observed_arities'], [1])
        self.assertEqual(result['virtual_calls_requiring_receiver_resolution'], ['UnresolvedSourceCall'])
        package.imports[2]['ObjectName'] = '/Game/Foreign'
        self.assertEqual(native_surface(package, package.exports[0])['calls'], [])

    def test_source_event_reachability_excludes_unrelated_native_calls(self):
        package = event_fixtures.BlueprintEventsTests().package()
        package.imports = self.imports()
        package._event_layouts = {}
        # Source entry 15 excludes the native trace at original offset 35.
        result = native_surface(package, package.exports[0])
        self.assertEqual(result['calls'], [])
        self.assertEqual(result['event_entries'][0]['memory_size_verified'], 62)
        package.exports[0]['ScriptBytecode'][1]['Parameters'][0]['Value'] = 35
        result = native_surface(package, package.exports[0])
        self.assertEqual(result['calls'][0]['api'], '/Script/Engine.KismetSystemLibrary.LineTraceSingle')

    def test_unverified_layout_is_recorded_without_guessing_event_dependencies(self):
        package = event_fixtures.BlueprintEventsTests().package(); package.imports = self.imports()
        package.exports[1]['ScriptBytecodeSize'] += 1
        result = native_surface(package, package.exports[0])
        self.assertEqual(result['event_entries'], [])
        self.assertEqual(result['calls'], [])
        self.assertIn('memory size differs', result['event_slice_errors'][0])

    def test_shared_api_ranking_preserves_source_witnesses_and_overlapping_counts(self):
        package = Package({'Exports': [], 'Imports': self.imports()})
        export = {'ScriptBytecode': [node('EX_FinalFunction', StackNode=-1, Parameters=[]),
                                     node('EX_CallMath', StackNode=-4, Parameters=[])]}
        records = [{'package': '/Game/Test', 'function': f'Fn{index}', 'export_index': index,
                    'source_bytecode_sha256': digest(export['ScriptBytecode']),
                    'native_surface': native_surface(package, export)} for index in (1, 2)]
        result = rank_native_families(records)
        self.assertEqual([row['blocked_source_functions_involved'] for row in result['families']], [2, 2])
        self.assertFalse(result['operations'][0]['adapter_family_present'])
        self.assertEqual(len(result['operations'][0]['observed_in_blocked_functions']), 2)
        self.assertNotIn('translated', result)
        self.assertIn('Counts overlap', result['scope'])


if __name__ == '__main__': unittest.main()
