import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import atomic_json, digest, file_hash
from progress_report import project_progress
from test_map_processing import model


class ProgressReportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        self.workspace = self.root / 'work'; self.published = self.root / 'published'; self.character = self.root / 'character'
        self.project = str(self.root / 'source' / 'Game.uproject')
        files = [{'path': 'Content/Map.umap', 'sha256': 'source'}]
        atomic_json(self.workspace / 'artifacts/inventory.json', {'files': files, 'maps': ['/Game/A', '/Game/B']})
        atomic_json(self.workspace / 'artifacts/engine_metadata.json', {'project': self.project, 'complete': True,
                    'source_snapshot_hash': digest(files), 'assets': [{'class': 'AnimSequence'}]*10 + [{'class': 'World'}]*2})
        self.map = self.published / 'maps/A.glb'; model(self.map)
        validation = {'transforms': {'matched': 2, 'mismatched': 0, 'skipped': 1}, 'material_fallbacks': [{}],
                      'material_graphs': {'Grid': {'root_connections': 'direct_connections_recovered', 'connection_count': 5}}}
        atomic_json(self.map.with_suffix('.validation.json'), validation)
        atomic_json(self.published / 'map-manifest.json', {'project': self.project, 'maps': [
                    {'package': '/Game/A', 'filename': 'A.glb', 'status': 'exported',
                     'output_sha256': file_hash(self.map), 'validation': validation}]})
        model(self.character / 'clip.glb')
        atomic_json(self.character / 'manifest.json', {'source': {'project': self.project}, 'clips': {'idle': 'clip.glb'}})

    def tearDown(self): self.temp.cleanup()

    def test_checklist_distinguishes_file_exports_from_fidelity_and_lighting_is_last(self):
        report = project_progress(self.workspace, self.published, self.character)
        self.assertEqual(report['rows'][-1]['id'], 'lighting')
        self.assertTrue(all(not row['fidelity_1_to_1'] for row in report['rows']))
        self.assertEqual(report['direct_shader_connections'], 5)
        self.assertTrue(any(m['title'] == 'Trasformazioni confrontabili' for m in report['milestones']))
        self.assertEqual(report['source_classes']['AnimSequence'], 10)
        self.assertEqual(report, project_progress(self.workspace, self.published, self.character))

    def test_missing_outputs_and_modified_html_invalidate_report(self):
        original = project_progress(self.workspace, self.published, self.character)
        self.map.unlink()
        changed = project_progress(self.workspace, self.published, self.character)
        self.assertNotEqual(original['fingerprint'], changed['fingerprint'])
        self.assertEqual(changed['rows'][0]['status'], 'red')
        (self.published / 'progress.html').write_text('corrupt')
        project_progress(self.workspace, self.published, self.character)
        self.assertIn('Sistemi da completare', (self.published / 'progress.html').read_text(encoding='utf-8'))

    def test_other_project_character_is_not_counted(self):
        atomic_json(self.character / 'manifest.json', {'source': {'project': 'Other.uproject'}, 'clips': {'idle': 'clip.glb'}})
        report = project_progress(self.workspace, self.published, self.character)
        clips = next(row for row in report['rows'] if row['id'] == 'clips')
        self.assertEqual(clips['status'], 'red')


if __name__ == '__main__': unittest.main()
