import hashlib
import json
from pathlib import Path
import struct
import tempfile
import unittest
from tools.citybld.verify_batch import verify, VerificationError

def glb_bytes(textured=True):
    scene = {"asset": {"version": "2.0"}, "scenes":[{"nodes":[0]}],
             "scene":0, "nodes":[{"mesh":0}], "meshes":[{"primitives":[{"attributes":{"POSITION":0}}]}],
             "materials":[{"pbrMetallicRoughness":{"baseColorTexture":{"index":0}} if textured else {}}],
             "textures":[{"source":0}], "images":[{"uri":"data:image/png;base64,AA=="}]}
    data = json.dumps(scene, separators=(",", ":")).encode()
    data += b" " * ((-len(data)) % 4)
    binary = b"abcd"
    length = 12 + 8 + len(data) + 8 + len(binary)
    return (struct.pack("<4sII", b"glTF", 2, length) +
            struct.pack("<I4s", len(data), b"JSON") + data +
            struct.pack("<I4s", len(binary), b"BIN" + bytes([0])) + binary)

class CityBldPortTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        raw = glb_bytes()
        (self.root / "ny-001.glb").write_bytes(raw)
        self.manifest = {
            "schema":"citybld-selected-export-v1", "batch":"ny-001",
            "source_engine":"5.8.3-2026", "source_level":"/Game/NY_City.NY_City",
            "source_workflow":"CityBLD + Modern City Kit in Unreal Editor",
            "enabled_worldbld_plugins":["WorldBLD", "CityBLD", "ModernCityEssentials"],
            "selected_actor_count":1, "actors":[{"name":"First building"}],
            "glb":"ny-001.glb", "bytes":len(raw),
            "sha256":hashlib.sha256(raw).hexdigest(),
        }
        self.write()
    def write(self):
        (self.root / "manifest.json").write_text(json.dumps(self.manifest))
    def test_valid_native_batch_accepts_candidate_not_fake_visual_qa(self):
        result = verify(self.root)
        self.assertEqual(result["meshes"], 1)
        self.assertTrue(result["ready_for_visual_qa"])
        self.assertFalse(result["verified_in_threejs"])
    def test_missing_kit_is_not_marked_ready(self):
        self.manifest["enabled_worldbld_plugins"] = ["WorldBLD", "CityBLD"]
        self.write()
        with self.assertRaises(VerificationError): verify(self.root)
    def test_tampered_glb_rejected(self):
        (self.root / "ny-001.glb").write_bytes(b"not a model")
        with self.assertRaises(VerificationError): verify(self.root)
    def test_untextured_mesh_rejected(self):
        raw = glb_bytes(False)
        (self.root / "ny-001.glb").write_bytes(raw)
        self.manifest["sha256"] = hashlib.sha256(raw).hexdigest()
        self.manifest["bytes"] = len(raw)
        self.write()
        with self.assertRaises(VerificationError): verify(self.root)
    def test_procedural_or_missing_sources_rejected(self):
        self.manifest["source_workflow"] = "procedural city generated in JS"
        self.write()
        with self.assertRaises(VerificationError): verify(self.root)

if __name__ == "__main__":
    unittest.main()
