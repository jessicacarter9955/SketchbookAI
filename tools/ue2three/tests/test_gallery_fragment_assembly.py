import hashlib
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gallery_fragment_assembly import AssemblyError, assemble, read_glb


def make_glb(path, *, light=False, external_image=False, animated=False):
    binary = struct.pack('<fff', 1, 2, 3) + b'PNG!'
    doc = {'asset': {'version': '2.0'}, 'scene': 0, 'scenes': [{'nodes': [0]}],
           'buffers': [{'byteLength': len(binary)}],
           'bufferViews': [{'buffer': 0, 'byteOffset': 0, 'byteLength': 12},
                           {'buffer': 0, 'byteOffset': 12, 'byteLength': 4}],
           'accessors': [{'bufferView': 0, 'componentType': 5126, 'type': 'VEC3', 'count': 1}],
           'images': [{'mimeType': 'image/png', 'bufferView': 1}],
           'samplers': [{'wrapS': 10497}], 'textures': [{'sampler': 0, 'source': 0}],
           'materials': [{'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}},
                          'extensions': {'KHR_materials_specular': {'specularColorTexture': {'index': 0}}}}],
           'meshes': [{'primitives': [{'attributes': {'POSITION': 0}, 'material': 0}]}],
           'nodes': [{'name': 'Authoring node', 'mesh': 0}],
           'extensionsUsed': ['KHR_materials_specular']}
    if external_image:
        doc['images'] = [{'uri': 'unavailable.png'}]
    if light:
        doc['extensionsUsed'].append('KHR_lights_punctual')
        doc['extensions'] = {'KHR_lights_punctual': {'lights': [{'type': 'directional', 'color': [1, 1, 1]}]}}
        doc['nodes'][0]['extensions'] = {'KHR_lights_punctual': {'light': 0}}
    if animated:
        doc['skins'] = [{'joints': [0], 'skeleton': 0, 'inverseBindMatrices': 0}]
        doc['nodes'][0]['skin'] = 0
        doc['meshes'][0]['primitives'][0]['targets'] = [{'POSITION': 0}]
        doc['animations'] = [{'samplers': [{'input': 0, 'output': 0}],
                              'channels': [{'sampler': 0, 'target': {'node': 0, 'path': 'translation'}}]}]
    encoded = json.dumps(doc).encode()
    encoded += b' ' * (-len(encoded) % 4)
    path.write_bytes(struct.pack('<4sII', b'glTF', 2, 28 + len(encoded) + len(binary)) +
                     struct.pack('<II', len(encoded), 0x4E4F534A) + encoded +
                     struct.pack('<II', len(binary), 0x004E4942) + binary)


class GalleryFragmentAssemblyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.first = self.root / 'first.glb'
        self.second = self.root / 'second.glb'
        self.static = self.root / 'GalleryStaticSubset.glb'
        make_glb(self.first, light=True, animated=True)
        make_glb(self.second, light=True, animated=True)
        make_glb(self.static)
        self.source_manifest = self.root / 'source-actors.json'
        self.source_manifest.write_text(json.dumps({'actors': [['C', []]]}))
        self.static.with_suffix('.source.json').write_text(json.dumps({
            'level': '/Game/Fixers/VFX/NiagaraExamples/GalleryLevel',
            'status': 'static_geometry_subset_only', 'complete_level': False,
            'source_manifest': str(self.source_manifest),
            'source_manifest_sha256': hashlib.sha256(self.source_manifest.read_bytes()).hexdigest(),
            'output_sha256': hashlib.sha256(self.static.read_bytes()).hexdigest()}))
        self.diagnosis = self.root / 'diagnosis.json'
        self.state = {'map': '/Game/Fixers/VFX/NiagaraExamples/GalleryLevel',
                      'source_snapshot_hash': 'verified-source', 'actors': ['A', 'B', 'C', 'D'],
                      'complete': True, 'pending': [], 'verified_groups': [
                          {'actor_names': ['A'], 'glb': str(self.first),
                           'glb_sha256': hashlib.sha256(self.first.read_bytes()).hexdigest()},
                          {'actor_names': ['B'], 'glb': str(self.second),
                           'glb_sha256': hashlib.sha256(self.second.read_bytes()).hexdigest()}]}
        self.diagnosis.write_text(json.dumps(self.state))
        self.output = self.root / 'final' / 'GalleryPartial.glb'

    def test_original_textures_extensions_and_lights_are_remapped(self):
        original_hashes = [hashlib.sha256(p.read_bytes()).hexdigest()
                           for p in (self.first, self.second, self.static)]
        result = assemble(self.diagnosis, self.static, self.output)
        self.assertEqual(result['geometry_covered_actors'], 3)
        self.assertEqual(result['uncovered_actors'], ['D'])
        self.assertFalse(result['complete_level'])
        self.assertFalse(result['play_verified'])
        self.assertEqual((result['mesh_count'], result['texture_count']), (3, 3))
        doc, _, digest = read_glb(self.output)
        self.assertEqual(digest, result['output_sha256'])
        self.assertEqual(len(doc['materials']), 3)
        self.assertEqual(len(doc['nodes']), 3)
        self.assertEqual([x['mesh'] for x in doc['nodes']], [0, 1, 2])
        self.assertEqual([m['pbrMetallicRoughness']['baseColorTexture']['index']
                          for m in doc['materials']], [0, 1, 2])
        self.assertEqual([m['extensions']['KHR_materials_specular']['specularColorTexture']['index']
                          for m in doc['materials']], [0, 1, 2])
        self.assertEqual([image['bufferView'] for image in doc['images']], [1, 3, 5])
        self.assertEqual([node['extensions']['KHR_lights_punctual']['light']
                          for node in doc['nodes'][:2]], [0, 1])
        self.assertEqual(len(doc['extensions']['KHR_lights_punctual']['lights']), 2)
        self.assertEqual([node['skin'] for node in doc['nodes'][:2]], [0, 1])
        self.assertEqual([skin['joints'] for skin in doc['skins']], [[0], [1]])
        self.assertEqual([skin['inverseBindMatrices'] for skin in doc['skins']], [0, 1])
        self.assertEqual([animation['channels'][0]['target']['node']
                          for animation in doc['animations']], [0, 1])
        self.assertEqual([animation['samplers'][0]['input']
                          for animation in doc['animations']], [0, 1])
        self.assertEqual([doc['meshes'][i]['primitives'][0]['targets'][0]['POSITION']
                          for i in range(2)], [0, 1])
        self.assertEqual([hashlib.sha256(p.read_bytes()).hexdigest()
                          for p in (self.first, self.second, self.static)], original_hashes)

    def test_stale_checksum_or_overlap_refused_without_output(self):
        self.state['verified_groups'][0]['glb_sha256'] = 'wrong'
        self.diagnosis.write_text(json.dumps(self.state))
        with self.assertRaisesRegex(AssemblyError, 'checksum changed'):
            assemble(self.diagnosis, self.static, self.output)
        self.assertFalse(self.output.exists())
        self.state['verified_groups'][0]['glb_sha256'] = hashlib.sha256(self.first.read_bytes()).hexdigest()
        self.state['verified_groups'][1]['actor_names'] = ['A']
        self.diagnosis.write_text(json.dumps(self.state))
        with self.assertRaisesRegex(AssemblyError, 'overlapping'):
            assemble(self.diagnosis, self.static, self.output)

    def test_external_source_image_refused(self):
        make_glb(self.second, external_image=True)
        self.state['verified_groups'][1]['glb_sha256'] = hashlib.sha256(self.second.read_bytes()).hexdigest()
        self.diagnosis.write_text(json.dumps(self.state))
        with self.assertRaisesRegex(AssemblyError, 'External texture'):
            assemble(self.diagnosis, self.static, self.output)


if __name__ == '__main__':
    unittest.main()
