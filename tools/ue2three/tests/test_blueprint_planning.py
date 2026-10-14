import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import atomic_json, digest, file_hash
from blueprint_planning import analyze_package, build_blueprint_plan
from test_blueprint_migration import node


class BlueprintPlanningTests(unittest.TestCase):
    def fixture(self):
        document = {'Exports': [
            {'ObjectName': 'SourceEvent', 'OuterIndex': 3, 'ScriptBytecode': [
                node('EX_LetValueOnPersistentFrame'), node('EX_LocalFinalFunction', StackNode=2),
                node('EX_Return', ReturnExpression=node('EX_Nothing')), node('EX_EndOfScript')]},
            {'ObjectName': 'ExecuteUbergraph_Test', 'OuterIndex': 3, 'ScriptBytecode': [node('EX_Context')]},
            {'ObjectName': 'Test_C', 'LoadedProperties': []}], 'Imports': []}
        blocked = [{'function': 'SourceEvent', 'source_export_index': 1, 'reason': 'Unsupported opcode: EX_LetValueOnPersistentFrame'},
                   {'function': 'ExecuteUbergraph_Test', 'source_export_index': 2, 'reason': 'Unsupported opcode: EX_Context'}]
        return document, {'blocked': blocked}

    def test_event_dependencies_and_overlapping_families_are_identified_without_success_claims(self):
        document, report = self.fixture()
        records = analyze_package('/Game/Test', document, report)
        self.assertEqual(records[0]['event_target'], 'ExecuteUbergraph_Test')
        self.assertEqual(records[1]['modules'], ['events', 'objects'])
        self.assertNotIn('translated', records[0])

    def test_plan_reuses_artifacts_and_rejects_a_changed_source_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); workspace = root / 'workspace'; published = root / 'published'
            document, package = self.fixture()
            cache = workspace / 'artifacts/uasset-json' / ('a'*64 + '.json'); atomic_json(cache, document)
            package['source'] = {'source_sha256': 'a'*64, 'parsed_sha256': file_hash(cache)}
            report = {'project': str(root / 'source/Game.uproject'), 'packages': {'/Game/Test': package},
                      'missing_cached_packages': []}
            report['content_sha256'] = digest(report); atomic_json(published / 'blueprint-programs.json', report)
            result = build_blueprint_plan(workspace, published)
            self.assertEqual(result['blocked_functions'], 2)
            self.assertEqual(result['event_entry_wrappers'], 1)
            self.assertEqual(result, build_blueprint_plan(workspace, published))
            packet = published / 'work-packets/events.md'; packet.write_text('damaged', encoding='utf-8')
            build_blueprint_plan(workspace, published)
            self.assertIn('SourceEvent', packet.read_text(encoding='utf-8'))
            cache.write_text('{}', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'cache differs'): build_blueprint_plan(workspace, published)
