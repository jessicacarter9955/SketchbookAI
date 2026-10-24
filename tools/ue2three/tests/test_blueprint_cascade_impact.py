"""Dependency prioritization must not invent an executable Blueprint."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from blueprint_cascade_impact import dependency_cascade_impact


def blocked(name, index, reason):
    return {'function': name, 'source_export_index': index, 'reason': reason}


class CascadeImpactTests(unittest.TestCase):
    def test_shared_first_blocker_has_transitive_observed_impact(self):
        report = {'packages': {
            '/Game/A': {'blocked': [
                blocked('Root', 1, 'Unsupported opcode: EX_Context'),
                blocked('Caller', 2, 'Untranslated function dependency: Root'),
                blocked('Caller2', 3, 'Untranslated function dependency: Caller'),
                blocked('Another', 4, 'Unsupported native math call: FMod'),
                blocked('CycleA', 5, 'Untranslated function dependency: CycleB'),
                blocked('CycleB', 6, 'Untranslated function dependency: CycleA'),
                blocked('Missing', 7, 'Untranslated function dependency: Absent'),
            ]},
            '/Game/B': {'blocked': [blocked('Root', 8, 'Unsupported opcode: EX_DynamicCast')]},
        }}
        actual = dependency_cascade_impact(report)
        self.assertEqual(actual['blocked_functions'], 8)
        self.assertEqual(actual['first_dependency_blockers'], 5)
        self.assertEqual(actual['attributed_functions'], 5)
        self.assertEqual(actual['unresolved_functions'], 3)
        largest = actual['roots'][0]
        self.assertEqual((largest['package'], largest['function']), ('/Game/A', 'Root'))
        self.assertEqual(largest['observed_blocked_functions'], 3)
        self.assertEqual(largest['observed_dependency_callers'], 2)
        self.assertEqual({row['function'] for row in largest['affected']}, {'Root', 'Caller', 'Caller2'})
        self.assertEqual([row['error'] for row in actual['unresolved']],
                         ['dependency_cycle', 'dependency_cycle', 'missing_dependency_target'])
        self.assertEqual(len(actual['roots']), 3)
        self.assertEqual(actual, dependency_cascade_impact(report))

    def test_ambiguous_duplicates_remain_unattributed(self):
        report = {'packages': {'/Game/X': {'blocked': [
            blocked('Same', 10, 'Unsupported opcode: EX_Context'),
            blocked('Same', 11, 'Unsupported opcode: EX_VirtualFunction'),
            blocked('Dependent', 12, 'Untranslated function dependency: Same'),
        ]}}}
        impact = dependency_cascade_impact(report)
        self.assertEqual(impact['attributed_functions'], 0)
        self.assertEqual(impact['unresolved_functions'], 3)
        self.assertTrue(all(row['error'] == 'ambiguous_dependency_target' for row in impact['unresolved']))

    def test_invalid_program_schema_is_not_silently_accepted(self):
        for report in ({}, {'packages': []}, {'packages': {'X': {'blocked': {}}}},
                       {'packages': {'X': {'blocked': [{'function': 'X'}]}}}):
            with self.subTest(report=report), self.assertRaises(ValueError):
                dependency_cascade_impact(report)


if __name__ == '__main__':
    unittest.main()
