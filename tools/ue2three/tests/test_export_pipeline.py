import json
import sys
import tempfile
import types
import unittest
import struct
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
from prepare_web_assets import stage, validate_glb
from ue_export_scene import export_level

def make_glb(path, textures=1):
    gltf = {"asset": {"version": "2.0"},
            "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
            "accessors": [{"componentType": 5126, "count": 3, "type": "VEC3"}],
            "materials": [{"name": "PBR", "pbrMetallicRoughness": {"baseColorFactor": [1,1,1,1]}}],
            "textures": [{"source":0}] if textures else [],
            "images": [{"uri":"data:image/png;base64,AA=="}] if textures else []}
    data=json.dumps(gltf).encode("utf-8")
    data+=b" " * ((-len(data))%4)
    path.write_bytes(struct.pack("<4sIIII",b"glTF",2,20+len(data),len(data),0x4e4f534a)+data)

class StubUE:
    class StaticMeshComponent: pass
    class SkeletalMeshComponent: pass
    class GLTFExportOptions: pass
    def __init__(self, root):
        self.project=root / "project"
        self.project.mkdir()
        self.Paths=types.SimpleNamespace(project_dir=lambda: str(self.project))
        world=types.SimpleNamespace(get_path_name=lambda: "/Game/City")
        class Mesh: static_mesh=True
        class Actor:
            def get_components_by_class(self, kind):
                return [Mesh()] if kind is StubUE.StaticMeshComponent else []
            def get_actor_label(self):
                return "ValidUEBuilding"
        self.EditorLevelLibrary=types.SimpleNamespace(get_editor_world=lambda: world,
            get_all_level_actors=lambda: [Actor()],load_level=lambda _v: None)
        self.GLTFExporter=types.SimpleNamespace(export_to_gltf=self.write_export)
    def log(self, message): pass
    def write_export(self, _world, output, _options, _selection):
        make_glb(Path(output));return True

class PipelineTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
    def test_native_export_to_web_manifest_in_separate_workspace(self):
        unreal=StubUE(self.root)
        out=self.root / "native"
        meta=export_level(unreal,{"UE2THREE_EXPORT_DIR":str(out),
           "UE2THREE_SOURCE_URL":"https://example.org/open-ue-city","UE2THREE_SOURCE_LICENSE":"MIT"})
        self.assertEqual(meta["source_type"],"UNREAL_NATIVE_LEVEL")
        self.assertEqual(meta["input_mesh_actor_count"],1)
        self.assertEqual(validate_glb(out/"scene.glb")["meshes"],1)
        item=stage(out,self.root/"site"/"assets"/"ue2three","ny")
        self.assertEqual(item["source_type"],"UNREAL_NATIVE_LEVEL")
        self.assertEqual(item["textures"],1)
        self.assertTrue((self.root/"site"/"assets"/"ue2three"/"ue-ny-scene.glb").is_file())
        stage(out,self.root/"site"/"assets"/"ue2three","sf")
        manifest=json.loads((self.root/"site"/"assets"/"ue2three"/"manifest.json").read_text())
        self.assertEqual(set(manifest["districts"]),{"ny","sf"})
    def test_unreal_project_guard(self):
        ue=StubUE(self.root)
        with self.assertRaisesRegex(RuntimeError,"outside"):
            export_level(ue,{"UE2THREE_EXPORT_DIR":str(ue.project/"Content"/"exports"),
                "UE2THREE_SOURCE_URL":"https://example.org","UE2THREE_SOURCE_LICENSE":"MIT"})
    def test_untextured_output_cannot_pass_photoreal_gate(self):
        src=self.root/"src";src.mkdir()
        make_glb(src/"scene.glb",textures=0)
        (src/"unreal-export.json").write_text(json.dumps({"stage":"unreal-native-gltf-export",
            "source_type":"UNREAL_NATIVE_LEVEL","source_url":"https://example.org","license":"CC0"}))
        with self.assertRaisesRegex(ValueError,"textures"):
            stage(src,self.root/"out","miami")
    def test_missing_unreal_provenance_rejected(self):
        src=self.root/"src";src.mkdir()
        make_glb(src/"scene.glb")
        (src/"unreal-export.json").write_text(json.dumps({"stage":"scanner","source_type":"synthetic",
            "source_url":"https://example.org","license":"MIT"}))
        with self.assertRaisesRegex(ValueError,"Unreal export"):
            stage(src,self.root/"out","rio")
    def test_corrupt_binary_is_rejected(self):
        f=self.root/"bad.glb";f.write_bytes(b"glTF"+"\0"*44)
        with self.assertRaises(ValueError):validate_glb(f)
if __name__=="__main__":
    unittest.main()
