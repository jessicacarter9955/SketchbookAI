"""Synthetic recovery contracts; never presented as DDS Play verification."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import atomic_json, digest, file_hash, read_json
from recovered_maps import publish_recovered_map
from test_dds_asset_export import fixture_glb


class RecoveredMapsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project = self.root / 'source' / 'Test.uproject'
        atomic_json(self.project, {'FileVersion': 3})
        self.original = self.project.parent / 'Content' / 'Worlds' / 'Arena.umap'
        self.original.parent.mkdir(parents=True)
        self.original.write_bytes(b'Original world')
        self.package = '/Game/Worlds/Arena'
        self.workspace = self.root / 'workspace'
        self.snapshot = {'project': str(self.project), 'files': [{
            'path': 'Content/Worlds/Arena.umap', 'sha256': file_hash(self.original)}]}
        self.snapshot_hash = digest(self.snapshot)
        atomic_json(self.workspace / 'snapshot.json', self.snapshot)
        atomic_json(self.workspace / 'state.json', {'snapshot_hash': self.snapshot_hash,
                    'source_verification_status': 'verified'})
        atomic_json(self.workspace / 'artifacts' / 'engine_metadata.json', {
            'project': str(self.project), 'complete': True,
            'source_snapshot_hash': digest(self.snapshot['files'])})
        self.audit = self.root / 'proof' / 'audit.json'
        self.diagnosis = self.root / 'proof' / 'diagnosis.json'
        atomic_json(self.audit, {'map': self.package, 'source_snapshot_hash': self.snapshot_hash})
        atomic_json(self.diagnosis, {'map': self.package, 'source_snapshot_hash': self.snapshot_hash,
                    'actors': ['Actor_0'], 'complete': True, 'pending': []})
        self.glb = self.root / 'recovered' / 'SourceAssembly.glb'
        fixture_glb(self.glb)
        self.manifest = self.glb.with_suffix('.source.json')
        self.proof = {'schema_version': 1, 'map': self.package,
                      'source_snapshot_hash': self.snapshot_hash,
                      'source_audit_sha256': file_hash(self.audit),
                      'source_diagnosis_sha256': file_hash(self.diagnosis),
                      'glb_sha256': file_hash(self.glb), 'mesh_count': 1,
                      'material_count': 0, 'texture_count': 0,
                      'original_actor_count': 1, 'represented_original_actors': 1,
                      'geometry_covered_actors': 1, 'unrepresented_original_actors': [],
                      'complete_level': False, 'play_verified': False, 'visual_1to1_verified': False}
        atomic_json(self.manifest, self.proof)
        self.publish = self.root / 'published'

    def publish_map(self):
        return publish_recovered_map(self.project, self.workspace, self.manifest,
                                     self.audit, self.diagnosis, self.publish)

    def test_generic_source_assembly_publishes_without_changing_canonical_export_count(self):
        atomic_json(self.publish / 'dds-assets' / 'maps' / 'map-manifest.json', {'maps': ['existing']})
        canonical = self.publish / 'dds-assets' / 'maps' / 'map-manifest.json'
        original_hash, canonical_hash = file_hash(self.original), file_hash(canonical)
        result = self.publish_map()
        row = result['map']
        self.assertEqual(row['package'], self.package)
        self.assertEqual(row['represented_original_actors'], 1)
        for key in ('complete_level', 'play_verified', 'visual_1to1_verified',
                    'physics_verified', 'niagara_verified', 'certified_map_export'):
            self.assertFalse(row[key])
        self.assertEqual(row['verified_workspace_snapshot_hash'], self.snapshot_hash)
        self.assertEqual(row['verified_source_files_hash'], digest(self.snapshot['files']))
        self.assertEqual(file_hash(self.publish / row['model']), file_hash(self.glb))
        self.assertEqual(file_hash(self.original), original_hash)
        self.assertEqual(file_hash(canonical), canonical_hash)
        second = self.publish_map()
        self.assertEqual(second['map']['publication_modes']['model.glb'], 'reused')
        self.assertEqual(len(read_json(Path(second['catalog']))['maps']), 1)

    def test_changed_original_map_cannot_be_published_from_stale_proof(self):
        self.original.write_bytes(b'Original map changed')
        with self.assertRaisesRegex(ValueError, 'Original map'):
            self.publish_map()
        self.assertFalse(self.publish.exists())

    def test_wrong_source_hash_scope_is_rejected_instead_of_rewritten(self):
        self.proof['source_snapshot_hash'] = digest(self.snapshot['files'])
        atomic_json(self.manifest, self.proof)
        with self.assertRaisesRegex(ValueError, 'snapshot'):
            self.publish_map()

    def test_changed_audit_or_glb_fails_before_publication(self):
        self.audit.write_text('{}')
        with self.assertRaisesRegex(ValueError, 'audit'):
            self.publish_map()
        atomic_json(self.audit, {'map': self.package, 'source_snapshot_hash': self.snapshot_hash})
        self.glb.write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'GLB'):
            self.publish_map()

    def test_partial_source_proof_cannot_claim_play_or_complete_level(self):
        self.proof['complete_level'] = True
        atomic_json(self.manifest, self.proof)
        with self.assertRaisesRegex(ValueError, 'acceptance flags'):
            self.publish_map()

    def test_publication_refuses_any_directory_inside_original_project(self):
        self.publish = self.project.parent / 'published'
        with self.assertRaisesRegex(ValueError, 'separate'):
            self.publish_map()


if __name__ == '__main__':
    unittest.main()
