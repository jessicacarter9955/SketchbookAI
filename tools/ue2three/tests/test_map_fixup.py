import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import atomic_json, digest, file_hash
from map_fixup import _read_glb, fixup_map
from preview_server import Handler
from visual_verification import verify_scene


def fixture(path, heights=(0, 0, 0, -2.56), textured=False):
    points = [(i * 0.01, y, 0) for i, y in enumerate(heights)]
    binary = b''.join(struct.pack('<fff', *p) for p in points)
    doc = {'asset': {'version': '2.0'}, 'buffers': [{'byteLength': len(binary)}],
           'bufferViews': [{'buffer': 0, 'byteLength': len(binary)}],
           'accessors': [{'bufferView': 0, 'componentType': 5126, 'type': 'VEC3', 'count': len(points),
                          'min': [0, min(heights), 0], 'max': [0.03, max(heights), 0]}],
           'meshes': [{'name': 'LandscapeComponent_0', 'primitives': [{'attributes': {'POSITION': 0}}]},
                      {'name': 'Box', 'primitives': [{'attributes': {'POSITION': 0}, 'material': 0}]}],
           'nodes': [{'name': 'LandscapeComponent_0', 'mesh': 0}, {'name': 'Actor', 'mesh': 1}],
           'scenes': [{'nodes': [0, 1]}], 'scene': 0,
           'materials': [{'name': 'MID_Grid', 'pbrMetallicRoughness': {}}]}
    if textured:
        doc['materials'][0]['pbrMetallicRoughness']['baseColorTexture'] = {'index': 0}
    encoded = json.dumps(doc).encode(); encoded += b' ' * (-len(encoded) % 4)
    path.write_bytes(struct.pack('<4sII', b'glTF', 2, 28 + len(encoded) + len(binary)) +
                     struct.pack('<II', len(encoded), 0x4e4f534a) + encoded +
                     struct.pack('<II', len(binary), 0x004e4942) + binary)


def source():
    return {'source_sha256': 'source', 'landscapes': {'LandscapeComponent_0': {'min': -0.01, 'max': 0.01}},
            'grid_materials': {'Actor': {'name': 'MID_Grid', 'parent': '/Game/Material.Material',
                                       'parameters': {'Surface Color': [0.1, 0.2, 0.3, 1]}}}}


class MapFixupTests(unittest.TestCase):
    def test_atomic_json_retries_windows_sharing_error(self):
        import os
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'state.json'
            atomic_json(path, {'old': True})
            original = os.replace
            calls = []
            def replace(source_path, target_path):
                calls.append(1)
                if len(calls) == 1:
                    self.assertEqual(json.loads(path.read_text()), {'old': True})
                    error = PermissionError('reader holds destination'); error.winerror = 5
                    raise error
                return original(source_path, target_path)
            with patch('core.os.replace', side_effect=replace), patch('core.time.sleep'):
                atomic_json(path, {'new': True})
            self.assertEqual(len(calls), 2)
            self.assertEqual(json.loads(path.read_text()), {'new': True})

    def test_atomic_json_does_not_hide_persistent_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'state.json'; atomic_json(path, {'old': True})
            error = PermissionError('locked'); error.winerror = 5
            with patch('core.os.replace', side_effect=error) as replace, patch('core.time.sleep'):
                with self.assertRaises(PermissionError):
                    atomic_json(path, {'new': True})
            self.assertEqual(replace.call_count, 8)
            self.assertEqual(json.loads(path.read_text()), {'old': True})

    def test_repairs_only_source_bounded_flat_landscape(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'map.glb'; fixture(path)
            report = fixup_map(path, source())
            doc, blob = _read_glb(path)
            self.assertEqual(report['landscapes'][0]['repaired_vertices'], 1)
            self.assertEqual(struct.unpack_from('<f', blob, 40)[0], 0)
            self.assertEqual(doc['accessors'][0]['min'][1], 0)
            material = doc['materials'][doc['meshes'][doc['nodes'][1]['mesh']]['primitives'][0]['material']]
            self.assertEqual(material['pbrMetallicRoughness']['baseColorFactor'], [0.1, 0.2, 0.3, 1])
            self.assertEqual(material['extras']['ue2three']['shader_fidelity'], 'not_verified')

    def test_refuses_to_flatten_nonflat_or_mostly_invalid_terrain(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'map.glb'; fixture(path, (0, 0.005, 0, -2.56))
            report = fixup_map(path, source(), restore_tints=False)
            _, blob = _read_glb(path)
            self.assertFalse(report['landscapes'])
            self.assertTrue(report['warnings'])
            self.assertAlmostEqual(struct.unpack_from('<f', blob, 40)[0], -2.56, places=5)

    def test_successfully_baked_textures_are_not_tinted_twice(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'map.glb'; fixture(path, textured=True)
            report = fixup_map(path, source())
            doc, _ = _read_glb(path)
            self.assertFalse(report['material_fallbacks'])
            self.assertEqual(len(doc['materials']), 1)
            self.assertEqual(len(doc['meshes']), 2)

    def test_no_source_bounds_means_no_geometry_repair(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'map.glb'; fixture(path)
            metadata = source(); metadata['landscapes'] = {}
            report = fixup_map(path, metadata, restore_tints=False)
            self.assertFalse(report['landscapes'])

    def test_windows_preview_module_mime_types(self):
        self.assertEqual(Handler.extensions_map['.js'], 'text/javascript')
        self.assertEqual(Handler.extensions_map['.mjs'], 'text/javascript')

    def test_visual_cache_reuses_only_complete_unchanged_evidence(self):
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary); scripts = repo / 'tools/ue2three'; scripts.mkdir(parents=True)
            for name in ('visual-audit.mjs', 'ue2three-level-viewer.js'):
                (scripts / name).write_text(name)
            model = repo / 'map.glb'; model.write_bytes(b'model')
            output = repo / 'audit'; output.mkdir()
            url = 'http://127.0.0.1:8401/map'
            fingerprint = digest({'model': file_hash(model), 'audit': file_hash(scripts / 'visual-audit.mjs'),
                                  'viewer': file_hash(scripts / 'ue2three-level-viewer.js'), 'url': url, 'viewport': [1120, 700]})
            for name in ('overview.png', 'ground.png', 'detail.png', 'index.html'):
                (output / name).write_bytes(b'evidence')
            atomic_json(output / 'report.json', {'status': 'captured', 'views': []})
            atomic_json(output / 'cache.json', {'fingerprint': fingerprint, 'images': {
                p.name: file_hash(p) for p in output.iterdir() if p.name != 'cache.json'}})
            with patch('visual_verification.subprocess.run') as launch:
                self.assertTrue(verify_scene(repo, url, model, output)['reused'])
                launch.assert_not_called()
            (output / 'overview.png').unlink()
            with patch('visual_verification.shutil.which', return_value=None):
                self.assertEqual(verify_scene(repo, url, model, output)['status'], 'unavailable')
            self.assertIn('Verifica visiva non completata', (output / 'index.html').read_text(encoding='utf-8'))

    def test_failed_browser_startup_replaces_stale_gallery(self):
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary); scripts = repo / 'tools/ue2three'; scripts.mkdir(parents=True)
            for name in ('visual-audit.mjs', 'ue2three-level-viewer.js'):
                (scripts / name).write_text(name)
            model = repo / 'map.glb'; model.write_bytes(b'model')
            output = repo / 'audit'; output.mkdir()
            (output / 'index.html').write_text('OLD SUCCESS')
            atomic_json(output / 'report.json', {'status': 'captured', 'views': []})
            with patch('visual_verification.shutil.which', return_value='node'), \
                    patch('visual_verification.subprocess.run', side_effect=OSError('browser startup failed')):
                report = verify_scene(repo, 'http://127.0.0.1:8401/map', model, output)
            self.assertEqual(report['status'], 'failed')
            self.assertNotIn('OLD SUCCESS', (output / 'index.html').read_text(encoding='utf-8'))
            self.assertIn('browser startup failed', (output / 'index.html').read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main()
