import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import atomic_json, digest, file_hash, read_json
from blueprint_cache import BlueprintCompileCache
import blueprint_migration as migration
from test_blueprint_migration import node


class BlueprintCompileCacheTests(unittest.TestCase):
    def fixture(self, root):
        source = root / 'source'; source.mkdir()
        project = source / 'Test.uproject'; project.write_text('{}', encoding='utf-8')
        asset = source / 'Test.uasset'; asset.write_bytes(b'original source, read-only')
        workspace = root / 'workspace'; published = root / 'published'
        inventory = {'files': [{'path': 'Test.uasset', 'sha256': file_hash(asset)}],
                     'assets': [{'package': '/Game/Test', 'path': 'Test.uasset', 'sha256': file_hash(asset)}]}
        atomic_json(workspace / 'artifacts/inventory.json', inventory)
        atomic_json(workspace / 'artifacts/engine_metadata.json', {'project': str(project), 'complete': True,
            'source_snapshot_hash': digest(inventory['files']), 'assets': [{'package': '/Game/Test', 'class': 'BlueprintGeneratedClass'}]})
        ast = {'Exports': [{'ObjectName': 'Test_C', 'SuperStruct': -1, 'LoadedProperties': []},
                          {'ObjectName': 'Original', 'OuterIndex': 1, 'LoadedProperties': [],
                           'ScriptBytecode': [node('EX_Return', ReturnExpression=node('EX_Nothing')), node('EX_EndOfScript')]}],
               'Imports': [{'ObjectName': 'ActorComponent', 'OuterIndex': -2}, {'ObjectName': '/Script/Engine', 'ClassName': 'Package'}]}
        parser_file = workspace / 'artifacts/uasset-json' / (file_hash(asset) + '.json'); atomic_json(parser_file, ast)
        return project, workspace, published, parser_file

    def runtime_hashes_changed(self, path):
        return 'e'*64 if str(path).replace('\\', '/').endswith('/src/editor/Ue2ThreeGameplay.js') else file_hash(path)

    def test_runtime_change_reuses_ir_but_expires_old_proof_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            project, workspace, published, parser = self.fixture(Path(directory))
            before = migration.migrate_blueprints(project, workspace, published)
            with patch.object(migration, 'translate_package', side_effect=AssertionError('Unnecessary recompilation')):
                self.assertEqual(before, migration.migrate_blueprints(project, workspace, published))
                with patch.object(migration, 'file_hash', side_effect=self.runtime_hashes_changed):
                    after = migration.migrate_blueprints(project, workspace, published)
            self.assertEqual(before['compiler_fingerprint'], after['compiler_fingerprint'])
            self.assertNotEqual(before['fingerprint'], after['fingerprint'])
            self.assertNotEqual(before['content_sha256'], after['content_sha256'])
            for key in ('packages', 'tables', 'counts', 'actor_graph', 'character_guards', 'source_types'):
                self.assertEqual(before[key], after[key])
            self.assertEqual(after['content_sha256'], digest({k: v for k, v in after.items() if k != 'content_sha256'}))
            self.assertEqual((project.parent / 'Test.uasset').read_bytes(), b'original source, read-only')

    def test_parser_change_invalidates_compiler_cache_and_changed_source_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            project, workspace, published, parser = self.fixture(Path(directory))
            before = migration.migrate_blueprints(project, workspace, published)
            ast = read_json(parser); ast['ParserVersionWitness'] = 'changed'; atomic_json(parser, ast)
            with patch.object(migration, 'translate_package', wraps=migration.translate_package) as translate:
                after = migration.migrate_blueprints(project, workspace, published)
            self.assertEqual(translate.call_count, 1)
            self.assertNotEqual(before['compiler_fingerprint'], after['compiler_fingerprint'])
            (project.parent / 'Test.uasset').write_bytes(b'changed source')
            with self.assertRaisesRegex(migration.BlueprintTranslationError, 'Source changed'):
                migration.migrate_blueprints(project, workspace, published)

    def test_compiler_changes_invalidate_cache_and_corruption_rebuilds(self):
        with tempfile.TemporaryDirectory() as directory:
            project, workspace, published, parser = self.fixture(Path(directory))
            before = migration.migrate_blueprints(project, workspace, published)
            path = workspace / 'artifacts/blueprint-compiled' / (before['compiler_fingerprint'] + '.json')
            record = read_json(path); record['payload']['counts']['translated'] = 999; atomic_json(path, record)
            with patch.object(migration, 'file_hash', side_effect=self.runtime_hashes_changed), patch.object(
                    migration, 'translate_package', wraps=migration.translate_package) as translate:
                rebuilt = migration.migrate_blueprints(project, workspace, published)
            self.assertEqual(translate.call_count, 1); self.assertEqual(rebuilt['counts']['translated'], 1)
            def new_compiler(path):
                return 'd'*64 if str(path).endswith('blueprint_migration.py') else file_hash(path)
            with patch.object(migration, 'file_hash', side_effect=new_compiler), patch.object(
                    migration, 'translate_package', wraps=migration.translate_package) as translate:
                changed = migration.migrate_blueprints(project, workspace, published)
            self.assertEqual(translate.call_count, 1)
            self.assertNotEqual(before['compiler_fingerprint'], changed['compiler_fingerprint'])
            def changed_widget_adapter(path):
                return 'e'*64 if str(path).endswith('blueprint_widgets.py') else file_hash(path)
            with patch.object(migration, 'file_hash', side_effect=changed_widget_adapter), patch.object(
                    migration, 'translate_package', wraps=migration.translate_package) as translate:
                changed_widgets = migration.migrate_blueprints(project, workspace, published)
            self.assertEqual(translate.call_count, 1)
            self.assertNotEqual(changed['compiler_fingerprint'], changed_widgets['compiler_fingerprint'])

    def test_cache_identity_project_payload_and_source_directory_guards(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); project = root / 'source/Test.uproject'
            cache = BlueprintCompileCache(root / 'cache', project); key = 'a'*64
            payload = {'schema_version': 1, 'project': str(project.resolve()), 'counts': {'translated': 1}}
            cache.save(key, payload); self.assertEqual(cache.load(key), payload)
            for bad in ('../escape', '', 'G'*64):
                with self.assertRaises(ValueError): cache.path(bad)
            with self.assertRaisesRegex(ValueError, 'outside'):
                BlueprintCompileCache(project.parent / 'cache', project)
            with self.assertRaisesRegex(ValueError, 'another project'):
                cache.save(key, {**payload, 'project': 'Other.uproject'})
            record = read_json(cache.path(key)); record['payload']['runtime_sources'] = {}; record['payload_sha256'] = digest(record['payload'])
            atomic_json(cache.path(key), record); self.assertIsNone(cache.load(key))
            cache.path(key).write_text('broken json', encoding='utf-8'); self.assertIsNone(cache.load(key))


if __name__ == '__main__': unittest.main()
