import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from blueprint_batch_plan import build_plan, census_package, read_package, resolve_reference, reverse_closure, html_page


def expression(name, **fields):
    return {'$type': 'UAssetAPI.Kismet.Bytecode.Expressions.' + name + ', UAssetAPI', **fields}


class BatchPlanTests(unittest.TestCase):
    def document(self):
        return {'Imports': [
            {'ObjectName': 'Format', 'OuterIndex': -2},
            {'ObjectName': 'KismetTextLibrary', 'OuterIndex': -3},
            {'ObjectName': '/Script/Engine', 'ClassName': 'Package'}],
            'Exports': [
                {'ObjectName': 'First', 'OuterIndex': 0, 'ScriptBytecode': [
                    expression('EX_DynamicCast'),
                    expression('EX_Let', Expression=expression('EX_CallMath', StackNode=-1))]},
                {'ObjectName': 'Caller', 'ScriptBytecode': [expression('EX_FinalFunction', StackNode=1)]},
                {'ObjectName': 'VirtualCaller', 'ScriptBytecode': [
                    expression('EX_VirtualFunction', VirtualFunctionName='First')]}]}

    def report(self):
        return {'counts': {'translated': 0, 'blocked': 3}, 'packages': {'/Game/Test': {
            'functions': {}, 'blocked': [
                {'function': 'First', 'reason': 'Unsupported opcode: EX_DynamicCast'},
                {'function': 'Caller', 'reason': 'Source callee blocked'},
                {'function': 'VirtualCaller', 'reason': 'Unsupported dispatch'}]}}}

    def test_nested_later_call_and_static_callers_count_without_claiming_unlocks(self):
        rows = census_package('/Game/Test', self.document())
        plan = build_plan(self.report(), rows)
        native = next(row for row in plan['families'] if row['category'] == 'native_call')
        self.assertEqual(native['blocked_source_functions_count'], 1)
        self.assertEqual(native['transitive_blocked_callers'], ['/Game/Test::Caller'])
        self.assertEqual(native['estimated_affected_union_count'], 2)
        self.assertEqual(native['first_failure_functions_count'], 0)
        self.assertIsNone(native['proven_unlocked_count'])
        self.assertIn('/Expression', native['witnesses'][0]['path'])
        cast = next(row for row in plan['families'] if row['family'] == 'opcode:EX_DynamicCast')
        self.assertEqual(cast['first_failure_functions_count'], 1)

    def test_resolver_rejects_cycles_and_invalid_index(self):
        self.assertIsNone(resolve_reference({'Imports': [{'OuterIndex': -1}]}, -1))
        self.assertIsNone(resolve_reference(self.document(), -90))
        self.assertEqual(resolve_reference(self.document(), -1),
                         ['/Script/Engine', 'KismetTextLibrary', 'Format'])

    def test_content_hash_cache_reuses_parse_and_rejects_changed_source(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            source, census = root / 'source', root / 'census'
            source.mkdir()
            census.mkdir()
            raw = json.dumps(self.document()).encode()
            sha = 'a' * 64
            path = source / (sha + '.json')
            path.write_bytes(raw)
            evidence = {'source_sha256': sha, 'parsed_sha256': hashlib.sha256(raw).hexdigest()}
            rows, reused = read_package('/Game/Test', evidence, source, census, 'impl1')
            self.assertFalse(reused)
            again, reused = read_package('/Game/Test', evidence, source, census, 'impl1')
            self.assertTrue(reused)
            self.assertEqual(rows, again)
            path.write_text('{}', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'hash differs'):
                read_package('/Game/Test', evidence, source, census, 'impl1')

    def test_translated_occurrence_prevents_unfounded_global_unsupported_claim(self):
        document = self.document()
        document['Exports'][1]['ScriptBytecode'] = [expression('EX_CallMath', StackNode=-1)]
        report = self.report()
        report['packages']['/Game/Test']['blocked'] = report['packages']['/Game/Test']['blocked'][:1]
        report['packages']['/Game/Test']['functions'] = {'Caller': {}}
        plan = build_plan(report, census_package('/Game/Test', document))
        native = next(row for row in plan['families'] if row['category'] == 'native_call')
        self.assertEqual(native['translated_source_functions_count'], 1)
        self.assertFalse(native['rank_eligible'])

    def test_dependency_cycles_terminate_and_include_distinct_callers(self):
        self.assertEqual(reverse_closure({'a'}, {'a': {'b'}, 'b': {'a', 'c'}}), {'a', 'b', 'c'})

    def test_dashboard_displays_compiler_progress_and_escapes_source_family_labels(self):
        plan=build_plan(self.report(),census_package('/Game/Test',self.document()))
        plan['families'][0]['family']='<script>alert(1)</script>'
        plan['families'][0]['rank_eligible']=True
        page=html_page(plan)
        self.assertIn('0 / 3 funzioni tradotte',page)
        self.assertIn('non sono conversioni promesse',page)
        self.assertNotIn('<script>',page)
        self.assertIn('&lt;script&gt;',page)

    def test_similar_opcode_names_do_not_create_false_first_failure_evidence(self):
        report = self.report()
        report['packages']['/Game/Test']['blocked'][0]['reason'] = 'Unsupported opcode: EX_Context_FailSilent'
        document = self.document()
        document['Exports'][0]['ScriptBytecode'] = [expression('EX_Context')]
        plan = build_plan(report, census_package('/Game/Test', document))
        context = next(row for row in plan['families'] if row['family'] == 'opcode:EX_Context')
        self.assertEqual(context['first_failure_functions_count'], 0)
        self.assertFalse(context['reported_unsupported_somewhere'])


if __name__ == '__main__':
    unittest.main()
