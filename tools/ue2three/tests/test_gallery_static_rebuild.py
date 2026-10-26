import hashlib
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gallery_static_rebuild import GalleryRebuildError, rebuild, source_transform, _read_glb


def write_glb(path, *, textured=False):
    binary = struct.pack('<fff', 0, 1, 2)
    doc = {'asset': {'version': '2.0'}, 'scene': 0, 'scenes': [{'nodes': [0]}],
           'buffers': [{'byteLength': len(binary)}],
           'bufferViews': [{'buffer': 0, 'byteOffset': 0, 'byteLength': len(binary)}],
           'accessors': [{'bufferView': 0, 'componentType': 5126, 'type': 'VEC3', 'count': 1}],
           'materials': [{'name': 'Source PBR'}],
           'meshes': [{'primitives': [{'attributes': {'POSITION': 0}, 'material': 0}]}],
           'nodes': [{'name': 'Source mesh', 'mesh': 0}]}
    if textured:
        doc['images'] = [{'uri': 'outside.png'}]
    body = json.dumps(doc).encode()
    body += b' ' * (-len(body) % 4)
    path.write_bytes(struct.pack('<4sII', b'glTF', 2, 28 + len(body) + len(binary)) +
                     struct.pack('<II', len(body), 0x4E4F534A) + body +
                     struct.pack('<II', len(binary), 0x004E4942) + binary)


def t(x, y, z, *, yaw=False):
    rotation = 'x: 0.000000, y: 0.000000, z: 0.707107, w: 0.707107' if yaw else \
               'x: 0.000000, y: 0.000000, z: 0.000000, w: 1.000000'
    return (f"<Struct 'Transform' (0x01234) {{rotation: {{{rotation}}}, "
            f"translation: {{x: {x:.6f}, y: {y:.6f}, z: {z:.6f}}}, "
            "scale3d: {x: 1.000000, y: 2.000000, z: 3.000000}}>"
            )


class GalleryStaticRebuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.meshes = self.root / 'meshes'
        self.meshes.mkdir()
        self.manifest = self.root / 'actors.json'
        self.output = self.root / 'published' / 'gallery-recovered-static.glb'
        write_glb(self.meshes / 'A.glb')
        write_glb(self.meshes / 'B_exported.glb')
        self.source = {'level': '/Game/Fixers/VFX/NiagaraExamples/GalleryLevel',
                       'actors': [['Actor_1', [
                           ['Component0', '/Game/Meshes/A.A', [t(100, 200, 300), t(0, 0, 0, yaw=True)]],
                           ['Component1', '/Game/Meshes/B.B', [t(-50, 20, 0)]],
                           ['EmptyComponent', '/Game/Meshes/A.A', []]]]]}
        self.manifest.write_text(json.dumps(self.source))

    def test_static_geometry_uses_original_instances_and_shared_geometry(self):
        originals = {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                     for p in self.meshes.glob('*.glb')}
        result = rebuild(self.manifest, self.meshes, self.output, aliases={'B': 'B_exported.glb'})
        self.assertEqual((result['actors'], result['components'], result['instances'],
                          result['unique_source_meshes'], result['empty_components']), (1, 3, 3, 2, 1))
        self.assertFalse(result['complete_level'])
        self.assertFalse(result['visual_1to1_verified'])
        doc, data, digest = _read_glb(self.output)
        self.assertEqual(digest, result['output_sha256'])
        self.assertEqual(len(doc['meshes']), 2)
        self.assertEqual(len(doc['accessors']), 2)
        self.assertEqual(len(doc['materials']), 2)
        self.assertEqual(len(doc['scenes'][0]['nodes']), 3)
        self.assertEqual(len(doc['nodes']), 6)
        self.assertEqual(len(data), 24)
        wrappers = [doc['nodes'][i] for i in doc['scenes'][0]['nodes']]
        self.assertEqual(wrappers[0]['translation'], [1, 3, 2])
        self.assertEqual(wrappers[0]['scale'], [1, 3, 2])
        self.assertAlmostEqual(wrappers[1]['rotation'][1], -2**-.5, places=5)
        self.assertEqual(wrappers[2]['translation'], [-.5, 0, .2])
        self.assertEqual([doc['nodes'][i]['mesh'] for i in [0, 2, 4]], [0, 0, 1])
        self.assertEqual(json.loads(self.output.with_suffix('.source.json').read_text())['instances'], 3)
        self.assertEqual({p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                          for p in self.meshes.glob('*.glb')}, originals)

    def test_missing_source_mesh_fails_without_publishing(self):
        with self.assertRaisesRegex(GalleryRebuildError, 'Missing separate source mesh'):
            rebuild(self.manifest, self.meshes, self.output)
        self.assertFalse(self.output.exists())

    def test_external_texture_is_not_silently_dropped(self):
        write_glb(self.meshes / 'A.glb', textured=True)
        with self.assertRaisesRegex(GalleryRebuildError, 'Unsupported images'):
            rebuild(self.manifest, self.meshes, self.output, aliases={'B': 'B_exported.glb'})

    def test_source_transform_refuses_nonfinite_and_incomplete_inputs(self):
        self.assertEqual(source_transform(t(100, 200, 300))['translation'], [1, 3, 2])
        with self.assertRaises(GalleryRebuildError):
            source_transform('rotation only')
        with self.assertRaises(GalleryRebuildError):
            source_transform(t(100, 200, 300).replace('z: 300.000000', 'z: nan'))
        with self.assertRaises(GalleryRebuildError):
            source_transform(t(100, 200, 300).replace('w: 1.000000', 'w: 0.000000'))


if __name__ == '__main__':
    unittest.main()
