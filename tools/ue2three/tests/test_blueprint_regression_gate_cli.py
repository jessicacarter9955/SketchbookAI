import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from cli import parser


class BlueprintGateCliTests(unittest.TestCase):
    def test_migrate_accepts_explicit_prior_source_report(self):
        args = parser().parse_args([
            'migrate-blueprints', 'original.uproject', '--workspace', 'cache',
            '--publish-dir', 'output', '--baseline-report', 'baseline/blueprint-programs.json',
        ])
        self.assertEqual(args.baseline_report, Path('baseline/blueprint-programs.json'))
        self.assertEqual(args.command, 'migrate-blueprints')

    def test_existing_migration_stays_compatible_without_gate(self):
        args = parser().parse_args([
            'migrate-blueprints', 'original.uproject', '--workspace', 'cache', '--publish-dir', 'output'])
        self.assertIsNone(args.baseline_report)


if __name__ == '__main__':
    unittest.main()
