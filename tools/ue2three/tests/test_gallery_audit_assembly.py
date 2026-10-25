"""Independent original Gallery audit assembly regression gates."""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from gallery_fragment_assembly import AssemblyError, read_glb
from gallery_audit_assembly import assemble_audit, LEVEL
from test_gallery_fragment_assembly import make_glb


class VerifiedGalleryAssemblyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        files = [self.root / 'first.glb', self.root / 'second.glb']
        for f in files: make_glb(f, light=True, animated=True)
        self.diagnosis = self.root / 'diagnosis.json'
        self.audit = self.root / 'audit.json'
        self.output = self.root / 'assembled.glb'
        self.diagnosis_doc = {
            'map': LEVEL, 'source_snapshot_hash': 'source-sha',
            'actors': ['ActorA', 'ActorB', 'Unexportable'], 'complete': True,
            'pending': []
        }
        self.groups = [
            {'actor_names': [a], 'glb': str(p), 'glb_sha256': hashlib.sha256(p.read_bytes()).hexdigest(),
             'success': True, 'verification_mode': 'complete_export_unclean_exit',
             'unreal_exit_code': 1} for a, p in zip(['ActorA', 'ActorB'], files)
        ]
        self.audit_doc = {
            'schema_version': 1, 'map': LEVEL,
            'source_snapshot_hash': 'source-sha',
            'source_actor_count': 3, 'recovered_actor_count': 2,
            'unrecovered_actor_names': ['Unexportable'],
            'verified_nonoverlapping_groups': self.groups
        }
        self.save()

    def save(self):
        self.diagnosis.write_text(json.dumps(self.diagnosis_doc), encoding='utf8')
        self.audit.write_text(json.dumps(self.audit_doc), encoding='utf8')

    def test_preserves_native_glb_materials_textures_and_unclean_exit_provenance(self):
        original = {Path(g['glb']): g['glb_sha256'] for g in self.groups}
        result = assemble_audit(self.audit, self.diagnosis, self.output)
        assert result['selected_original_actors'] == 2
        assert result['unrecovered_original_actors'] == ['Unexportable']
        assert result['mesh_count'] == 2
        assert result['play_verified'] is False
        assert result['visual_1to1_verified'] is False
        gltf, _, hash_value = read_glb(self.output)
        assert result['glb_sha256'] == hash_value
        assert len(gltf['materials']) == 2
        assert len(gltf['textures']) == 2
        assert len(gltf['extensions']['KHR_lights_punctual']['lights']) == 2
        assert all(hashlib.sha256(p.read_bytes()).hexdigest() == h for p, h in original.items())
        with self.assertRaisesRegex(AssemblyError, 'overwrite'):
            assemble_audit(self.audit, self.diagnosis, self.output)

    def test_source_hash_group_overlap_tampering_and_incomplete_actor_census_fail(self):
        self.audit_doc['source_snapshot_hash'] = 'forged'
        self.save()
        with self.assertRaisesRegex(AssemblyError, 'hash'):
            assemble_audit(self.audit, self.diagnosis, self.output)
        self.audit_doc['source_snapshot_hash'] = 'source-sha'
        self.groups[1]['actor_names'] = ['ActorA']
        self.save()
        with self.assertRaisesRegex(AssemblyError, 'overlaps'):
            assemble_audit(self.audit, self.diagnosis, self.output)
        self.groups[1]['actor_names'] = ['ActorB']
        self.groups[1]['glb_sha256'] = 'forged'
        self.save()
        with self.assertRaisesRegex(AssemblyError, 'changed'):
            assemble_audit(self.audit, self.diagnosis, self.output)
        self.groups[1]['glb_sha256'] = hashlib.sha256(Path(self.groups[1]['glb']).read_bytes()).hexdigest()
        self.audit_doc['recovered_actor_count'] = 3
        self.save()
        with self.assertRaisesRegex(AssemblyError, 'accounting'):
            assemble_audit(self.audit, self.diagnosis, self.output)


    def test_reconciles_original_static_supplement_without_actor_overlap(self):
        static = self.root / 'static.glb'
        make_glb(static)
        source_manifest = self.root / 'source-instances.json'
        source_manifest.write_text(json.dumps({
            'level': LEVEL, 'actors': [['Unexportable', []]]}), encoding='utf8')
        supplement = {
            'level': LEVEL, 'status': 'static_geometry_subset_only',
            'complete_level': False, 'source_manifest': str(source_manifest),
            'source_manifest_sha256': hashlib.sha256(source_manifest.read_bytes()).hexdigest(),
            'output_sha256': hashlib.sha256(static.read_bytes()).hexdigest()
        }
        sidecar = static.with_suffix('.source.json')
        sidecar.write_text(json.dumps(supplement), encoding='utf8')
        result = assemble_audit(self.audit, self.diagnosis, self.output, static_file=static)
        self.assertEqual(result['audited_native_actors'], 2)
        self.assertEqual(result['original_static_supplement_actors'], 1)
        self.assertEqual(result['selected_original_actors'], 3)
        self.assertEqual(result['unrecovered_original_actors'], [])
        self.assertEqual(result['mesh_count'], 3)
        self.assertFalse(result['complete_level'])
        self.assertFalse(result['play_verified'])

    def test_static_source_checks_checksum_actor_overlap_and_missing_manifest(self):
        static = self.root / 'static.glb'
        make_glb(static)
        source_manifest = self.root / 'source-instances.json'
        source_manifest.write_text(json.dumps({
            'level': LEVEL, 'actors': [['ActorA', []]]}), encoding='utf8')
        supplement = {
            'level': LEVEL, 'status': 'static_geometry_subset_only',
            'complete_level': False, 'source_manifest': str(source_manifest),
            'source_manifest_sha256': hashlib.sha256(source_manifest.read_bytes()).hexdigest(),
            'output_sha256': hashlib.sha256(static.read_bytes()).hexdigest()
        }
        static.with_suffix('.source.json').write_text(json.dumps(supplement), encoding='utf8')
        with self.assertRaisesRegex(AssemblyError, 'overlap'):
            assemble_audit(self.audit, self.diagnosis, self.output, static_file=static)
        source_manifest.write_text(json.dumps({
            'level': LEVEL, 'actors': [['Unexportable', []]]}), encoding='utf8')
        with self.assertRaisesRegex(AssemblyError, 'SHA-256'):
            assemble_audit(self.audit, self.diagnosis, self.output, static_file=static)


    def test_two_disjoint_static_source_groups_combine_without_faking_completion(self):
        self.diagnosis_doc['actors'].extend(['AdditionalStatic', 'MissingTarget'])
        self.audit_doc['source_actor_count'] = 5
        self.audit_doc['unrecovered_actor_names'] = ['Unexportable', 'AdditionalStatic', 'MissingTarget']
        self.save()
        supplements = []
        for idx, actor in enumerate(('Unexportable', 'AdditionalStatic')):
            glb = self.root / f'supplement-{idx}.glb'
            manifest = self.root / f'supplement-{idx}.json'
            make_glb(glb)
            manifest.write_text(json.dumps({'level': LEVEL, 'actors': [[actor, []]]}), encoding='utf8')
            glb.with_suffix('.source.json').write_text(json.dumps({
                'level': LEVEL, 'status': 'static_geometry_subset_only',
                'complete_level': False,
                'source_manifest': str(manifest),
                'source_manifest_sha256': hashlib.sha256(manifest.read_bytes()).hexdigest(),
                'output_sha256': hashlib.sha256(glb.read_bytes()).hexdigest()
            }), encoding='utf8')
            supplements.append(glb)
        result = assemble_audit(self.audit, self.diagnosis, self.output, static_file=supplements)
        self.assertEqual(result['selected_original_actors'], 4)
        self.assertEqual(result['original_static_supplement_actors'], 2)
        self.assertEqual(result['unrecovered_original_actors'], ['MissingTarget'])
        self.assertEqual(result['mesh_count'], 4)
        self.assertFalse(result['complete_level'])
        self.assertFalse(result['visual_1to1_verified'])
        other = self.root / 'duplicate.glb'
        with self.assertRaisesRegex(AssemblyError, 'Repeated static'):
            assemble_audit(self.audit, self.diagnosis, other, static_file=[supplements[0], supplements[0]])


    def test_original_non_rendering_actor_node_does_not_falsify_glb_geometry_coverage(self):
        self.diagnosis_doc['actors'].append('TargetPoint_0')
        self.audit_doc['source_actor_count'] = 4
        self.audit_doc['unrecovered_actor_names'] = ['Unexportable', 'TargetPoint_0']
        self.save()
        node = {'name': 'TargetPoint_0', 'translation': [0.1, 0.2, 0.3],
                'extras': {'unreal_actor': 'TargetPoint_0',
                           'non_rendering_source_marker': True}}
        with patch('gallery_audit_assembly.original_target_point', return_value=node):
            result = assemble_audit(self.audit, self.diagnosis, self.output,
                                    target_point_project=self.root,
                                    target_point_workspace=self.root)
        self.assertEqual(result['geometry_covered_actors'], 2)
        self.assertEqual(result['represented_original_actors'], 3)
        self.assertEqual(result['non_rendering_original_actors'], ['TargetPoint_0'])
        self.assertEqual(result['unrepresented_original_actors'], ['Unexportable'])
        self.assertFalse(result['complete_level'])
        self.assertFalse(result['play_verified'])
        gltf, _, _ = read_glb(self.output)
        self.assertEqual(gltf['nodes'][-1]['extras']['unreal_actor'], 'TargetPoint_0')

    def test_marker_requires_complete_original_provenance_arguments(self):
        with self.assertRaisesRegex(AssemblyError, 'both'):
            assemble_audit(self.audit, self.diagnosis, self.output,
                           target_point_project=self.root)
        self.assertFalse(self.output.exists())


if __name__ == '__main__':
    unittest.main()
