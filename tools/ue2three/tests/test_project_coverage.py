import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import digest
from project_coverage import coverage, write_report


class CoverageTests(unittest.TestCase):
    def fixture(self):
        inventory = {'files': [{'path': 'Original.uasset', 'sha256': 'a'*64}],
                     'assets': [{'package': '/Game/Widget'}, {'package': '/Game/Missing'}],
                     'unclassified_files': ['Movies/Original.mp4']}
        registry = {'complete': True, 'project': 'C:/Original/DDS.uproject',
                    'source_snapshot_hash': digest(inventory['files']), 'assets': [
                        {'package': '/Game/Widget', 'class': 'WidgetBlueprintGeneratedClass'},
                        {'package': '/Game/Unknown', 'class': 'CustomGameplayFeature'},
                        {'package': '/Game/Data', 'class': 'DataTable'},
                        {'package': '/Game/Movie', 'class': 'MediaPlayer'}]}
        return inventory, registry

    def test_unknown_classes_and_inventory_gaps_are_never_discarded(self):
        report = coverage(*self.fixture())
        self.assertEqual(report['registry_assets'], 4)
        self.assertEqual(len(report['asset_register']), 4)
        self.assertEqual(report['unresolved_classes'], {'CustomGameplayFeature': 1})
        self.assertEqual(report['inventory_only_assets'], [{'package': '/Game/Missing'}])
        self.assertEqual(report['unclassified_files'], ['Movies/Original.mp4'])
        self.assertEqual(report['additional_systems']['media']['count'], 1)
        self.assertEqual(report['additional_systems']['data']['count'], 1)

    def test_13_areas_and_runtime_acceptance_never_turn_green_from_census(self):
        report = coverage(*self.fixture())
        self.assertEqual(len(report['areas']), 13)
        self.assertFalse(report['whole_game_verified'])
        self.assertFalse(report['browser_verification_performed'])
        self.assertTrue(all(a['play_1to1'] == 'manual_pending' and a['status'] != 'green' for a in report['areas']))
        self.assertTrue(all(a['runtime_integrated'] is None for a in report['asset_register']))
        self.assertIn('multiplayer', [r['id'] for r in report['cross_cutting_requirements']])

    def test_incomplete_or_mixed_source_registry_rejects(self):
        inventory, registry = self.fixture()
        registry['complete'] = False
        with self.assertRaises(ValueError): coverage(inventory, registry)
        registry['complete'] = True; registry['source_snapshot_hash'] = 'wrong'
        with self.assertRaises(ValueError): coverage(inventory, registry)

    def test_html_escapes_source_names_and_json_preserves_asset_register(self):
        report = coverage(*self.fixture())
        report['unresolved_classes']['<script>bad</script>'] = 1
        with tempfile.TemporaryDirectory() as folder:
            write_report(report, folder)
            text = (Path(folder)/'project-coverage.html').read_text(encoding='utf-8')
            self.assertNotIn('<script>bad</script>', text)
            self.assertIn('&lt;script&gt;', text)
            saved = json.loads((Path(folder)/'project-coverage.json').read_text(encoding='utf-8'))
            self.assertEqual(len(saved['asset_register']), 4)

if __name__ == '__main__': unittest.main()
