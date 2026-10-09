import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine_runner import prepare_project
from map_migration import MapMigrationError, _select_map_packages, glb_summary


class ExportMirrorTests(unittest.TestCase):
    def test_selective_map_export_keeps_verified_package_identity(self):
        packages = ["/Game/Map/B", "/Game/Map/A", "/Game/Map/A"]
        self.assertEqual(_select_map_packages(packages), ["/Game/Map/A", "/Game/Map/B"])
        self.assertEqual(_select_map_packages(packages, "/Game/Map/B"), ["/Game/Map/B"])
        with self.assertRaises(MapMigrationError):
            _select_map_packages(packages, "/Game/Map/Other")

    def test_glb_summary_reports_renderable_geometry(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "scene.glb"
            document = json.dumps({"asset": {"version": "2.0"}, "nodes": [{}], "meshes": [{}]}).encode()
            document += b" " * ((4 - len(document) % 4) % 4)
            path.write_bytes(b"glTF" + (2).to_bytes(4, "little") + (20 + len(document)).to_bytes(4, "little") +
                             len(document).to_bytes(4, "little") + (0x4E4F534A).to_bytes(4, "little") + document)
            self.assertEqual(glb_summary(path), {"mesh_count": 1, "node_count": 1})

    def test_map_export_mirror_hardlinks_content_and_omits_only_requested_package(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            project = root / "Game.uproject"
            project.write_text("{}", encoding="utf-8")
            content = root / "Content" / "Characters" / "Hero"
            content.mkdir(parents=True)
            mesh = content / "SK_Hero.uasset"
            broken = content / "BrokenIdle.uasset"
            bulk = content / "BrokenIdle.uexp"
            mesh.write_bytes(b"source mesh")
            broken.write_bytes(b"source animation")
            bulk.write_bytes(b"source animation bulk")
            workspace = root / "workspace"
            snapshot = {"project": str(project), "files": [], "engine": {
                "status": "detected", "executable": "UnrealEditor-Cmd", "requested_association": "5.7",
                "version": "5.7.4", "version_parts": [5, 7, 4],
            }}

            scratch_project, _ = prepare_project(workspace, snapshot, scratch_name="map-export-test",
                                                 mirror_assets=True,
                                                 excluded_packages=["/Game/Characters/Hero/BrokenIdle"])

            scratch = scratch_project.parent
            mirrored_mesh = scratch / "Content" / "Characters" / "Hero" / "SK_Hero.uasset"
            self.assertTrue(mirrored_mesh.samefile(mesh))
            self.assertFalse((scratch / "Content" / "Characters" / "Hero" / "BrokenIdle.uasset").exists())
            self.assertFalse((scratch / "Content" / "Characters" / "Hero" / "BrokenIdle.uexp").exists())
            self.assertTrue(broken.exists())
            self.assertTrue(bulk.exists())
            self.assertTrue((scratch / "Inspect.uproject").is_file())
            marker = json.loads((scratch / ".ue2three-content-mirror.json").read_text(encoding="utf-8"))
            self.assertEqual(marker["excluded_packages"], ["/Game/Characters/Hero/BrokenIdle"])


if __name__ == "__main__":
    unittest.main()
