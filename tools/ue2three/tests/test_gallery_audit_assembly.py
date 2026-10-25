"""Independent original Gallery audit assembly regression gates."""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

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


if __name__ == '__main__':
    unittest.main()
