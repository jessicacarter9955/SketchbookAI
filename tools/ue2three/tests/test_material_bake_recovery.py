"""Native Unreal MaterialBaking crash recovery: simulated editor processes only."""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import SCHEMA, atomic_json, digest, file_hash, read_json
from map_migration import (_material_baking_crash, _native_gltf_exporter_crash,
                           _material_fidelity, migrate_maps,
                           MapMigrationError)
from test_map_processing import model


CRASH = ("Fatal error: Unhandled Exception: EXCEPTION_ACCESS_VIOLATION reading address 0x0000000000000588\n"
         "[Callstack] UnrealEditor-MaterialBaking.dll!BakeMaterial()\n"
         "[Callstack] UnrealEditor-GLTFExporter.dll!ExportWorld()\n")


class Logger:
    def __init__(self):
        self.events = []

    def event(self, name, message, **kw):
        self.events.append((name, message, kw))


class MaterialBakeRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.project = self.root / 'source' / 'Game.uproject'
        self.project.parent.mkdir(parents=True)
        self.project.write_text('{}', encoding='utf-8')
        self.map_file = self.project.parent / 'Content' / 'A.umap'
        self.map_file.parent.mkdir()
        self.map_file.write_bytes(b'original unreal map')
        self.source_hash = file_hash(self.map_file)
        self.workspace = self.root / 'workspace'
        self.workspace.mkdir()
        self.publish = self.root / 'published'
        self.package = '/Game/A'
        files = [{'path': 'Content/A.umap', 'sha256': self.source_hash}]
        self.snapshot = {'project': str(self.project), 'files': files}
        atomic_json(self.workspace / 'snapshot.json', self.snapshot)
        atomic_json(self.workspace / 'state.json', {'schema_version': SCHEMA,
                    'config': {'project': str(self.project)}, 'source_verification_status': 'verified',
                    'snapshot_hash': digest(self.snapshot), 'tasks': {}})
        artifacts = self.workspace / 'artifacts'
        artifacts.mkdir()
        atomic_json(artifacts / 'inventory.json', {'maps': [self.package], 'files': files,
                    'assets': [{'package': self.package, **files[0], 'kind': 'map'}]})
        atomic_json(artifacts / 'engine_metadata.json', {'complete': True, 'project': str(self.project),
                    'source_snapshot_hash': digest(files), 'assets': [{'package': self.package}]})
        atomic_json(artifacts / 'engine.json', {'status': 'detected', 'version': '5.7',
                    'executable': 'mocked-unreal-editor'})

    def tearDown(self):
        self.temporary.cleanup()

    def engine(self, outcomes, modes):
        def launch(command, **kwargs):
            job = read_json(kwargs['env']['UE2THREE_MAP_JOB_FILE'])
            mode = job['material_bake_mode']
            modes.append(mode)
            log = next(Path(arg.partition('=')[2]) for arg in command if arg.startswith('-abslog='))
            log.parent.mkdir(parents=True, exist_ok=True)
            outcome = outcomes[mode]
            if outcome == 'native-crash':
                log.write_text(CRASH, encoding='utf-8')
                exit_code = 3
            elif outcome == 'gallery-gltf-crash':
                log.write_text('LogGLTFExporter: Warning: Non-uniform parent scale (X=2 Y=0 Z=2)\\n'
                               'Fatal error: Unhandled Exception: EXCEPTION_ACCESS_VIOLATION\\n'
                               '[Callstack] UnrealEditor-GLTFExporter.dll!ExportWorld()\\n', encoding='utf-8')
                exit_code = 3
            elif outcome == 'other-crash':
                log.write_text('Fatal error: Unhandled Exception: EXCEPTION_ACCESS_VIOLATION\n'
                               '[Callstack] UnrealEditor-GLTFExporter.dll!ExportWorld()\n', encoding='utf-8')
                exit_code = 3
            else:
                log.write_text('UE2THREE_MAP_DONE', encoding='utf-8')
                record = job['maps'][0]
                model(Path(job['output']) / record['filename'])
                atomic_json(job['result'], {'source_project': str(self.project),
                            'source_snapshot_hash': digest(self.snapshot),
                            'results': [{'package': record['package'], 'status': 'exported',
                                         'material_bake_mode': mode}]})
                exit_code = 0
            return type('Process', (), {'pid': 125, 'returncode': exit_code,
                                         'poll': lambda self: exit_code})()
        return launch

    def test_exact_native_crash_signature_is_required(self):
        log = self.root / 'crash.log'
        log.write_text(CRASH, encoding='utf-8')
        self.assertTrue(_material_baking_crash(log))
        log.write_text(CRASH.replace('UnrealEditor-MaterialBaking.dll',
                                    'UnrealEditor-RenderingCore.dll'), encoding='utf-8')
        self.assertFalse(_material_baking_crash(log))
        self.assertFalse(_material_baking_crash(log.parent / 'missing.log'))

    def test_gallery_gltf_only_crash_is_not_misclassified_as_material_baking(self):
        log = self.root / 'gallery.log'
        log.write_text('LogGLTFExporter: Warning: Non-uniform parent scale (X=2 Y=0 Z=2)\\n'
                       'Fatal error: Unhandled Exception: EXCEPTION_ACCESS_VIOLATION\\n'
                       '[Callstack] UnrealEditor-GLTFExporter.dll!ExportWorld()\\n',
                       encoding='utf-8')
        self.assertTrue(_native_gltf_exporter_crash(log))
        self.assertFalse(_material_baking_crash(log))
        log.write_text('LogGLTFExporter: Warning: Non-uniform scale only\\n',
                       encoding='utf-8')
        self.assertFalse(_native_gltf_exporter_crash(log))

    def test_gallery_gltf_crash_bounded_retry_preserves_fidelity_warning(self):
        modes = []
        with patch('map_migration.prepare_project', return_value=(self.project, [])):
            report = migrate_maps(self.project, self.workspace, self.publish, Logger(),
                                  popen=self.engine({'use_mesh_data': 'gallery-gltf-crash',
                                                     'simple': 'success'}, modes))
        self.assertEqual(modes, ['use_mesh_data', 'simple'])
        self.assertEqual(report['counts']['exported'], 1)
        row = report['maps'][0]
        self.assertFalse(row['bake_attempts'][0]['crashed_in_material_baking'])
        self.assertTrue(row['bake_attempts'][0]['crashed_in_gltf_exporter'])
        self.assertEqual(row['material_fidelity']['bake_mode'], 'simple')
        self.assertTrue(row['material_fidelity']['degraded'])
        self.assertFalse(row['material_fidelity']['verified_1to1'])
        self.assertEqual(file_hash(self.map_file), self.source_hash)

    def test_crash_retries_in_isolated_modes_and_marks_materials_unverified(self):
        modes = []
        logger = Logger()
        original_project = file_hash(self.project)
        with patch('map_migration.prepare_project', return_value=(self.project, [])):
            report = migrate_maps(self.project, self.workspace, self.publish, logger,
                                  popen=self.engine({'use_mesh_data': 'native-crash',
                                                     'simple': 'native-crash',
                                                     'disabled': 'success'}, modes))
        self.assertEqual(modes, ['use_mesh_data', 'simple', 'disabled'])
        self.assertEqual(report['counts']['exported'], 1)
        row = report['maps'][0]
        self.assertEqual(row['material_fidelity']['bake_mode'], 'disabled')
        self.assertTrue(row['material_fidelity']['degraded'])
        self.assertFalse(row['material_fidelity']['verified_1to1'])
        self.assertTrue(any('UE2THREE_MATERIAL_FIDELITY_DEGRADED bake_mode=disabled' in warning
                            for warning in row['warnings']))
        self.assertEqual(len(row['bake_attempts']), 3)
        self.assertTrue(row['bake_attempts'][0]['crashed_in_material_baking'])
        self.assertTrue(row['bake_attempts'][1]['crashed_in_material_baking'])
        self.assertNotEqual(row['bake_attempts'][0]['log'], row['bake_attempts'][1]['log'])
        self.assertTrue(Path(row['output']).is_file())
        self.assertEqual(file_hash(self.map_file), self.source_hash)
        self.assertEqual(file_hash(self.project), original_project)
        self.assertEqual(len([event for event in logger.events if event[0] == 'map-material-bake-fallback']), 2)
        with patch('map_migration.prepare_project', side_effect=AssertionError('Unreal must not rerun')):
            cached = migrate_maps(self.project, self.workspace, self.publish, Logger(),
                                  allow_engine=False)
        self.assertEqual(cached['maps'][0]['material_fidelity']['bake_mode'], 'disabled')
        self.assertFalse(cached['maps'][0]['material_fidelity']['verified_1to1'])
        self.assertEqual(cached['counts']['reused'], 1)

    def test_unrelated_native_crash_does_not_reduce_material_quality(self):
        modes = []
        with patch('map_migration.prepare_project', return_value=(self.project, [])), \
                self.assertRaises(MapMigrationError):
            migrate_maps(self.project, self.workspace, self.publish, Logger(),
                         popen=self.engine({'use_mesh_data': 'other-crash'}, modes))
        self.assertEqual(modes, ['use_mesh_data'])
        rows = read_json(self.publish / 'map-manifest.json')['maps']
        self.assertEqual(rows[0]['status'], 'failed')
        self.assertEqual(rows[0]['bake_attempts'][0]['bake_mode'], 'use_mesh_data')

    def test_successful_simple_bake_stops_before_geometry_only_mode(self):
        modes = []
        with patch('map_migration.prepare_project', return_value=(self.project, [])):
            report = migrate_maps(self.project, self.workspace, self.publish, Logger(),
                                  popen=self.engine({'use_mesh_data': 'native-crash',
                                                     'simple': 'success'}, modes))
        self.assertEqual(modes, ['use_mesh_data', 'simple'])
        self.assertEqual(report['counts']['exported'], 1)
        fidelity = report['maps'][0]['material_fidelity']
        self.assertEqual(fidelity['bake_mode'], 'simple')
        self.assertTrue(fidelity['degraded'])
        self.assertFalse(fidelity['verified_1to1'])
        self.assertIn('world-position', fidelity['warning'])

    def test_fidelity_metadata_defaults_to_unverified_even_with_full_bake(self):
        self.assertEqual(_material_fidelity([]), {'bake_mode': 'use_mesh_data',
                            'degraded': False, 'verified_1to1': False, 'warning': None})


if __name__ == '__main__':
    unittest.main()
