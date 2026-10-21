import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import SCHEMA, atomic_json, digest, file_hash, read_json
from map_migration import migrate_maps, MapMigrationError, _merge_map_catalog, _map_record
from map_processing import (classify_empty_export_source, store_raw_export, read_raw_export,
                           process_raw_export, export_implementation_hash)


def model(path):
    doc = {'asset': {'version': '2.0'}, 'scenes': [{'nodes': [0]}], 'nodes': [{'name': 'Actor', 'mesh': 0}],
           'meshes': [{'primitives': [{'attributes': {'POSITION': 0}, 'material': 0}]}],
           'materials': [{'name': 'MID_Grid', 'pbrMetallicRoughness': {'baseColorFactor': [1, 0, 1, 1]}}],
           'accessors': [{'bufferView': 0, 'componentType': 5126, 'type': 'VEC3', 'count': 3}],
           'bufferViews': [{'buffer': 0, 'byteLength': 36}], 'buffers': [{'byteLength': 36}]}
    data = json.dumps(doc).encode(); data += b' ' * (-len(data) % 4)
    blob = struct.pack('<9f', 0, 0, 0, 1, 0, 0, 0, 0, 1)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(struct.pack('<4sII', b'glTF', 2, 28 + len(data) + len(blob)) +
                     struct.pack('<II', len(data), 0x4e4f534a) + data + struct.pack('<II', len(blob), 0x004e4942) + blob)


def empty_scene(path):
    doc = {'asset': {'version': '2.0'}, 'scene': 0, 'scenes': [{'nodes': [0]}],
           'nodes': [{'name': 'OnlyPointLight', 'translation': [1, 2, 3]}]}
    data = json.dumps(doc).encode(); data += b' ' * (-len(data) % 4)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(struct.pack('<4sII', b'glTF', 2, 20 + len(data)) +
                     struct.pack('<II', len(data), 0x4e4f534a) + data)


class Logger:
    def event(self, *args, **kwargs):
        pass


class MapProcessingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(); self.root = Path(self.temporary.name)
        self.project = self.root / 'source/Game.uproject'; self.project.parent.mkdir()
        self.project.write_text('{}'); self.workspace = self.root / 'workspace'; self.workspace.mkdir()
        self.input = self.root / 'input.glb'; model(self.input)
        self.target = self.root / 'published/Map.glb'; self.key = 'a' * 64
        self.source = {'source_sha256': file_hash(self.project), 'source_hashes': {str(self.project): file_hash(self.project)},
                       'grid_materials': {'Actor': {'name': 'MID_Grid', 'parent': '/Game/Grid.Grid',
                                                  'parameters': {'Surface Color': [0.1, 0.2, 0.3, 1]}}}}
        self.reader = patch('map_fixup.source_scene', return_value=self.source); self.reader.start()

    def tearDown(self):
        self.reader.stop(); self.temporary.cleanup()

    def raw(self):
        return store_raw_export(self.input, self.workspace, self.key, self.project, '/Game/Map',
                                source_hashes=self.source['source_hashes'])

    def test_empty_source_classifier_accepts_native_actor_only_level(self):
        source = {'schema_version': 1, 'source_sha256': 'map-hash', 'source_hashes': {'map.umap': 'map-hash'},
                  'actors': [{'actor_label': 'OnlyPointLight', 'source_object': 'PointLight_0',
                              'source_export_index': 3, 'source_class': 'PointLight',
                              'transform': {'translation': [1, 2, 3]}}], 'mesh_components': []}
        result = classify_empty_export_source(source)
        self.assertEqual(result['classification'], 'source_meshless')
        self.assertEqual(result['actor_count'], 1)
        self.assertTrue(result['limitations'])

    def test_empty_source_classifier_rejects_mesh_and_blueprint_evidence(self):
        source = {'schema_version': 1, 'source_sha256': 'map-hash', 'source_hashes': {'map.umap': 'map-hash'},
                  'actors': [], 'mesh_components': [{'source_class': 'StaticMeshComponent',
                                                     'asset_reference': '/Game/SM.SM'}]}
        self.assertEqual(classify_empty_export_source(source)['classification'], 'source_geometry_present')
        source['mesh_components'] = []
        source['actors'] = [{'source_class': 'BP_Lamp_C'}]
        self.assertEqual(classify_empty_export_source(source)['classification'], 'source_geometry_indeterminate')
        source['actors'] = [{'source_class': 'Brush'}]
        self.assertEqual(classify_empty_export_source(source)['classification'], 'source_geometry_indeterminate')
        self.assertEqual(classify_empty_export_source({'schema_version': 1})['classification'], 'source_unavailable')

    def _prepare_single_map_export(self, package='/Game/ActorOnly'):
        map_file = self.project.parent / 'Content' / (package.rsplit('/', 1)[-1] + '.umap')
        map_file.parent.mkdir(parents=True, exist_ok=True); map_file.write_bytes(b'source level')
        files = [{'path': map_file.relative_to(self.project.parent).as_posix(), 'sha256': file_hash(map_file)}]
        snapshot = {'project': str(self.project), 'files': files}
        atomic_json(self.workspace / 'snapshot.json', snapshot)
        atomic_json(self.workspace / 'state.json', {'schema_version': SCHEMA,
                    'config': {'project': str(self.project)}, 'source_verification_status': 'verified',
                    'snapshot_hash': digest(snapshot), 'tasks': {}})
        artifacts = self.workspace / 'artifacts'; artifacts.mkdir(exist_ok=True)
        atomic_json(artifacts / 'inventory.json', {'maps': [package], 'files': files,
                    'assets': [{'package': package, **files[0], 'kind': 'map'}]})
        atomic_json(artifacts / 'engine_metadata.json', {'complete': True, 'project': str(self.project),
                    'source_snapshot_hash': digest(files), 'assets': [{'package': package}]})
        atomic_json(artifacts / 'engine.json', {'status': 'detected', 'version': '5.7',
                    'executable': 'must-not-run'})
        source_scene = {'schema_version': 1, 'project': str(self.project), 'map': package,
                        'source_sha256': file_hash(map_file),
                        'source_hashes': {str(map_file): file_hash(map_file)},
                        'actors': [{'actor_label': 'OnlyPointLight', 'source_object': 'PointLight_0',
                                    'source_export_index': 3, 'source_class': 'PointLight',
                                    'root_component': 'PointLightComponent0',
                                    'transform': {'translation': [1, 2, 3]}}],
                        'actor_transforms': {'OnlyPointLight': {'transform': {'translation': [1, 2, 3]}}},
                        'mesh_components': []}
        return package, snapshot, source_scene

    def test_meshless_export_writes_actor_manifest_without_claiming_rendered_success(self):
        package, snapshot, source_scene = self._prepare_single_map_export()
        publish = self.root / 'meshless-published'; launches = []

        def engine(command, **kwargs):
            launches.append(command)
            request = read_json(kwargs['env']['UE2THREE_MAP_JOB_FILE'])
            empty_scene(Path(request['output']) / request['maps'][0]['filename'])
            atomic_json(request['result'], {'source_project': str(self.project),
                        'source_snapshot_hash': digest(snapshot),
                        'results': [{'package': package, 'status': 'exported'}]})
            return type('Process', (), {'pid': 1, 'returncode': 0, 'poll': lambda self: 0})()

        with patch('map_migration.prepare_project', return_value=(self.project, [])), \
                patch('map_fixup.source_scene', return_value=source_scene):
            report = migrate_maps(self.project, self.workspace, publish, Logger(), popen=engine)
            self.assertEqual(report['counts']['source_only'], 1)
            self.assertEqual(report['counts']['exported'], 0)
            self.assertEqual(report['counts']['failed'], 0)
            row = next(item for item in report['maps'] if item['package'] == package)
            self.assertEqual(row['status'], 'source_only')
            self.assertNotIn('output', row)
            manifest = read_json(row['source_only_manifest'])
            self.assertEqual(manifest['actor_provenance']['actors'][0]['source_export_index'], 3)
            self.assertEqual(manifest['actor_provenance']['actors'][0]['transform']['translation'], [1, 2, 3])
            self.assertFalse((publish / 'maps' / 'ActorOnly.glb').exists())

            reused = migrate_maps(self.project, self.workspace, publish, Logger(), map_package=package,
                                  allow_engine=False, popen=engine)
            self.assertEqual(reused['counts']['source_only'], 1)
        self.assertEqual(len(launches), 1)

    def test_zero_geometry_with_blueprint_source_is_still_failed(self):
        package, snapshot, source_scene = self._prepare_single_map_export('/Game/BlueprintActor')
        source_scene['actors'][0]['source_class'] = 'BP_Lamp_C'
        publish = self.root / 'lost-geometry-published'

        def engine(command, **kwargs):
            request = read_json(kwargs['env']['UE2THREE_MAP_JOB_FILE'])
            empty_scene(Path(request['output']) / request['maps'][0]['filename'])
            atomic_json(request['result'], {'source_project': str(self.project),
                        'source_snapshot_hash': digest(snapshot),
                        'results': [{'package': package, 'status': 'exported'}]})
            return type('Process', (), {'pid': 1, 'returncode': 0, 'poll': lambda self: 0})()

        with patch('map_migration.prepare_project', return_value=(self.project, [])), \
                patch('map_fixup.source_scene', return_value=source_scene), \
                self.assertRaises(MapMigrationError):
            migrate_maps(self.project, self.workspace, publish, Logger(), popen=engine)
        row = read_json(publish / 'map-manifest.json')['maps'][0]
        self.assertEqual(row['status'], 'failed')
        self.assertEqual(row['source_classification']['classification'], 'source_geometry_indeterminate')
        self.assertIn('not prove the level is meshless', row['error'])
        self.assertEqual(read_json(row['source_only_manifest'])['actor_provenance']['actors'][0]['source_class'],
                         'BP_Lamp_C')

    def test_processing_changes_replay_raw_bytes_and_second_run_reuses(self):
        raw = self.raw(); original_hash = raw['output_sha256']
        first = process_raw_export(raw, self.target, self.project, self.workspace, 'v1')
        self.assertFalse(first['reused'])
        self.assertEqual(len(first['validation']['material_fallbacks']), 1)
        second = process_raw_export(raw, self.target, self.project, self.workspace, 'v1')
        self.assertTrue(second['reused'])
        changed = process_raw_export(raw, self.target, self.project, self.workspace, 'v2')
        self.assertFalse(changed['reused'])
        self.assertEqual(changed['output_sha256'], first['output_sha256'])
        self.assertEqual(file_hash(raw['path']), original_hash)

    def test_corrupt_output_and_missing_diagnostics_reprocess_without_export(self):
        raw = self.raw(); process_raw_export(raw, self.target, self.project, self.workspace, 'v1')
        self.target.write_bytes(b'corrupt')
        self.assertFalse(process_raw_export(raw, self.target, self.project, self.workspace, 'v1')['reused'])
        self.target.with_suffix('.validation.json').unlink()
        self.assertFalse(process_raw_export(raw, self.target, self.project, self.workspace, 'v1')['reused'])

    def test_raw_corruption_and_source_changes_are_not_reused(self):
        raw = self.raw(); process_raw_export(raw, self.target, self.project, self.workspace, 'v1')
        output_hash = file_hash(self.target)
        self.project.write_text('{"changed":true}')
        with self.assertRaisesRegex(ValueError, 'dependencies changed'):
            process_raw_export(raw, self.target, self.project, self.workspace, 'v1')
        self.assertEqual(file_hash(self.target), output_hash)
        Path(raw['path']).write_bytes(b'corrupt')
        self.assertIsNone(read_raw_export(self.workspace, self.key, self.project, '/Game/Map'))

    def test_raw_identity_and_path_boundaries(self):
        self.raw()
        self.assertIsNone(read_raw_export(self.workspace, self.key, self.project, '/Game/Other'))
        with self.assertRaises(ValueError):
            read_raw_export(self.workspace, '../../escape', self.project, '/Game/Map')
        with self.assertRaises(ValueError):
            process_raw_export(self.raw(), self.project.parent / 'map.glb', self.project, self.workspace)
        with self.assertRaisesRegex(ValueError, 'outside the source project'):
            store_raw_export(self.input, self.project.parent / 'cache', self.key, self.project, '/Game/Map')

    def test_malformed_cache_diagnostics_are_not_trusted(self):
        raw = self.raw(); process_raw_export(raw, self.target, self.project, self.workspace, 'v1')
        cache = self.target.with_suffix('.processing.json')
        metadata = read_json(cache); metadata['source_hashes'] = None
        atomic_json(cache, metadata)
        self.assertFalse(process_raw_export(raw, self.target, self.project, self.workspace, 'v1')['reused'])
        raw_metadata = Path(raw['path']).with_suffix('.json')
        atomic_json(raw_metadata, [])
        self.assertIsNone(read_raw_export(self.workspace, self.key, self.project, '/Game/Map'))

    def test_selected_map_merge_retains_other_entries_without_claiming_revalidation(self):
        old = {'/Game/A': {'package': '/Game/A', 'fingerprint': 'A'},
               '/Game/B': {'package': '/Game/B', 'fingerprint': 'B'}}
        merged = _merge_map_catalog(old, [{'package': '/Game/A', 'fingerprint': 'new'}])
        self.assertEqual(merged[1]['fingerprint'], 'B')
        self.assertFalse(merged[1]['verified_in_run'])
        self.assertTrue(merged[0]['verified_in_run'])
        self.assertEqual(old['/Game/A']['fingerprint'], 'A')

    def test_export_fingerprint_covers_configuration_and_package_sidecars(self):
        inventory = {'assets': [{'package': '/Game/A', 'path': 'Content/A.umap', 'kind': 'map'}]}
        files = {path: {'path': path, 'sha256': path} for path in
                 ('Content/A.umap', 'Content/A.ubulk', 'Game.uproject', 'Config/DefaultEngine.ini', 'Content/B.uasset')}
        def record():
            return _map_record('/Game/A', inventory, {}, files, {'version': '5.7'}, 'exporter', 'snapshot')
        baseline = record()
        self.assertEqual(len(baseline['source_files']), 4)
        files['Content/B.uasset']['sha256'] = 'unrelated change'
        self.assertEqual(record()['fingerprint'], baseline['fingerprint'])
        files['Content/A.ubulk']['sha256'] = 'changed bulk geometry'
        self.assertNotEqual(record()['fingerprint'], baseline['fingerprint'])
        changed = record()
        files['Config/DefaultEngine.ini']['sha256'] = 'changed render settings'
        self.assertNotEqual(record()['fingerprint'], changed['fingerprint'])

    def test_migration_reuses_exports_reprocesses_and_keeps_catalog_without_ue(self):
        artifacts = self.workspace / 'artifacts'; artifacts.mkdir()
        maps = ['/Game/A', '/Game/B']
        files = []
        for name in ('A', 'B'):
            path = self.project.parent / ('Content/' + name + '.umap'); path.parent.mkdir(exist_ok=True)
            path.write_bytes(name.encode()); files.append({'path': 'Content/' + name + '.umap', 'sha256': file_hash(path)})
        snapshot = {'project': str(self.project), 'files': files}
        atomic_json(self.workspace / 'snapshot.json', snapshot)
        atomic_json(self.workspace / 'state.json', {'schema_version': SCHEMA, 'config': {'project': str(self.project)},
                    'source_verification_status': 'verified', 'snapshot_hash': digest(snapshot), 'tasks': {}})
        atomic_json(artifacts / 'inventory.json', {'maps': maps, 'files': files,
                    'assets': [{'package': package, 'path': item['path'], 'kind': 'map'} for package, item in zip(maps, files)]})
        atomic_json(artifacts / 'engine_metadata.json', {'complete': True, 'project': str(self.project),
                    'source_snapshot_hash': digest(files), 'assets': [{'package': name} for name in maps]})
        atomic_json(artifacts / 'engine.json', {'status': 'detected', 'version': '5.7', 'executable': 'must-not-run'})
        publish = self.root / 'published'; launches = []
        def engine(command, **kwargs):
            launches.append(command)
            request = read_json(kwargs['env']['UE2THREE_MAP_JOB_FILE'])
            record = request['maps'][0]
            model(Path(request['output']) / record['filename'])
            atomic_json(request['result'], {'source_project': str(self.project), 'source_snapshot_hash': digest(snapshot),
                        'results': [{'package': record['package'], 'status': 'exported'}]})
            return type('Process', (), {'pid': 1, 'returncode': 0, 'poll': lambda self: 0})()
        with patch('map_migration.prepare_project', return_value=(self.project, [])):
            migrate_maps(self.project, self.workspace, publish, Logger(), popen=engine)
        self.assertEqual(len(launches), 2)
        with patch('map_migration.prepare_project', side_effect=AssertionError('UE preparation forbidden')):
            report = migrate_maps(self.project, self.workspace, publish, Logger(), map_package='/Game/A', allow_engine=False)
            self.assertEqual(len(report['maps']), 2)
            self.assertEqual(report['retained_map_count'], 1)
            self.assertEqual(report['counts']['reused'], 1)
            with patch('map_processing.processing_implementation_hash', return_value='changed'):
                report = migrate_maps(self.project, self.workspace, publish, Logger(), map_package='/Game/A', allow_engine=False)
            selected = next(item for item in report['maps'] if item['package'] == '/Game/A')
            self.assertEqual(selected['cache']['postprocess'], 'processed')
            self.assertFalse(selected['cache']['unreal_started'])
        self.assertEqual(len(launches), 2)
        raw_dir = self.workspace / 'maps/raw'
        for path in raw_dir.glob('*.glb'):
            path.write_bytes(b'corrupt')
        # A corrupt raw cache must not be hidden by the older published GLB.
        with self.assertRaises(MapMigrationError):
            migrate_maps(self.project, self.workspace, publish, Logger(), map_package='/Game/A', allow_engine=False)


if __name__ == '__main__':
    unittest.main()
