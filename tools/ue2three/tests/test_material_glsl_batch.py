"""Original-source census/manifest regression tests for the GLSL conversion batch."""
import copy
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from material_glsl_batch import GLSLBatchError, lower_verified


def sample():
    graph = {'schema_version': 1, 'status': 'direct_connections_recovered',
             'nodes': [{'index': 1, 'class': 'MaterialExpressionConstant3Vector',
                        'inputs': {}, 'properties': {'Constant': {'R': 0.25, 'G': 0.5, 'B': 1, 'A': 1}}}],
             'roots': {'BaseColor': {'expression': 1, 'output': 0,
                                    'mask': [0, 0, 0, 0, 0]}},
             'connection_count': 1}
    name = '/Game/Source/M_Test'
    return ({'schema_version': 1, 'project': '/source/Original.uproject',
             'source_snapshot_hash': 'original-inventory',
             'counts': {'source': 1, 'recovered': 1, 'blocked': 0, 'pending': 0},
             'materials': {name: {'status': 'recovered', 'source_sha256': 'original-hash',
                                  'nodes': 1, 'connections': 1, 'graph': graph}}},
            [{'package': name, 'source_sha256': 'original-hash'}])


class WitnessedMaterialBatchTests(unittest.TestCase):
    def test_complete_original_sources_lower_to_explicitly_unintegrated_glsl(self):
        report, witnesses = sample()
        result = lower_verified(report, witnesses)
        self.assertEqual(result['counts']['materials'], 1)
        self.assertEqual(result['counts']['translated_roots'], 1)
        self.assertEqual(result['counts']['pbr_adapter_candidates'], 1)
        self.assertIn('/Game/Source/M_Test', result['pbr_adapter_candidate_packages'])
        self.assertEqual(result['materials']['/Game/Source/M_Test']['translated_roots']
                         ['BaseColor']['glsl'], 'vec3(0.25, 0.5, 1.0)')
        self.assertEqual(result['shader_execution'], 'not_integrated')

    def test_missing_material_cannot_masquerade_as_100_percent(self):
        report, witnesses = sample()
        witnesses.append({'package': '/Game/Source/M_Missing', 'source_sha256': 'x'})
        with self.assertRaisesRegex(GLSLBatchError, 'census'):
            lower_verified(report, witnesses)

    def test_source_hash_and_graph_node_census_are_checked(self):
        report, witnesses = sample()
        witnesses[0]['source_sha256'] = 'different'
        with self.assertRaisesRegex(GLSLBatchError, 'source'):
            lower_verified(report, witnesses)
        report, witnesses = sample()
        report['materials']['/Game/Source/M_Test']['nodes'] = 123
        with self.assertRaisesRegex(GLSLBatchError, 'node census'):
            lower_verified(report, witnesses)

    def test_connected_unsupported_graph_is_reported_not_approximated(self):
        report, witnesses = sample()
        graph = report['materials']['/Game/Source/M_Test']['graph']
        graph['nodes'][0]['class'] = 'MaterialExpressionMaterialFunctionCall'
        result = lower_verified(report, witnesses)
        self.assertEqual(result['counts']['translated_roots'], 0)
        self.assertEqual(result['counts']['blocked_roots'], 1)
        self.assertEqual(result['counts']['pbr_adapter_candidates'], 0)
        self.assertIn('MaterialExpressionMaterialFunctionCall', str(
            result['materials']['/Game/Source/M_Test']['blocked_roots']))

    def test_changed_source_recovery_counts_are_rejected(self):
        report, witnesses = sample()
        report['counts']['pending'] = 1
        with self.assertRaisesRegex(GLSLBatchError, 'census'):
            lower_verified(report, witnesses)
        report, witnesses = sample()
        report['materials']['/Game/Source/M_Test']['connections'] = 10
        with self.assertRaisesRegex(GLSLBatchError, 'connection census'):
            lower_verified(report, witnesses)


if __name__ == '__main__':
    unittest.main()
