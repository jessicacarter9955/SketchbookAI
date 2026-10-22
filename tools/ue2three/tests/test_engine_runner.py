import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import file_hash
from engine_runner import EngineError, _link_tree, prepare_project, source_engine_plugins
from map_migration import MapMigrationError, _cached_map_matches, _map_export_packages, _select_map_packages, glb_summary


class ExportMirrorTests(unittest.TestCase):
    def test_map_scratch_restores_only_source_requested_stock_engine_plugins(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            project = root / "Source" / "Game.uproject"
            project.parent.mkdir()
            project.write_text(json.dumps({"Plugins": [
                {"Name": "PoseSearch", "Enabled": True},
                {"Name": "AIAssistant", "Enabled": True},
                {"Name": "OnlineSubsystemSteam", "Enabled": True},
                {"Name": "Uninstalled", "Enabled": True},
                {"Name": "Disabled", "Enabled": False},
                {"Name": "ExternalPlugin", "Enabled": True},
                {"Name": "BadDescriptor", "Enabled": True},
            ]}), encoding="utf-8")
            engine = root / "UE_5.7" / "Engine"
            executable = engine / "Binaries" / "Win64" / "UnrealEditor-Cmd.exe"
            executable.parent.mkdir(parents=True)
            executable.touch()
            for name, category in (("EnhancedInput", "Input"), ("Niagara", "FX"),
                                   ("PoseSearch", "Animation"), ("AIAssistant", "Experimental"),
                                   ("OnlineSubsystemSteam", "Online"),
                                   ("Disabled", "Runtime"), ("ExternalPlugin", "Marketplace"),
                                   ("BadDescriptor", "Runtime")):
                location = engine / "Plugins" / category / name / (name + ".uplugin")
                location.parent.mkdir(parents=True)
                location.write_text("broken json" if name == "BadDescriptor"
                                    else json.dumps({"Modules": []}), encoding="utf-8")
            enabled, omitted = source_engine_plugins(project, executable)
            self.assertEqual(enabled, ["EnhancedInput", "Niagara", "PoseSearch"])
            self.assertTrue({"AIAssistant", "OnlineSubsystemSteam", "Uninstalled",
                             "ExternalPlugin", "BadDescriptor"}.issubset(omitted))
            self.assertNotIn("Disabled", enabled)

            snapshot = {"project": str(project), "files": [], "engine": {
                "status": "detected", "executable": str(executable),
                "requested_association": "5.7", "version_parts": [5, 7, 4]}}
            scratch, _ = prepare_project(root / "workspace", snapshot, mirror_assets=True,
                                         restore_source_engine_plugins=True)
            exported = json.loads(scratch.read_text(encoding="utf-8"))
            self.assertTrue(exported["DisableEnginePluginsByDefault"])
            self.assertEqual({p["Name"] for p in exported["Plugins"]},
                             {"PythonScriptPlugin", "GLTFExporter", "EnhancedInput", "Niagara", "PoseSearch"})
            self.assertTrue((scratch.parent / ".ue2three-engine-plugin-provenance.json").is_file())

    def test_explicit_source_plugin_disable_overrides_default(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            project = root / "Game.uproject"
            project.write_text(json.dumps({"Plugins": [{"Name": "EnhancedInput", "Enabled": False}]}))
            engine = root / "Engine"
            plugin = engine / "Plugins" / "FX" / "Niagara" / "Niagara.uplugin"
            plugin.parent.mkdir(parents=True)
            plugin.write_text(json.dumps({"Modules": []}))
            executable = engine / "Binaries" / "Win64" / "UnrealEditor-Cmd.exe"
            enabled, _ = source_engine_plugins(project, executable)
            self.assertEqual(enabled, ["Niagara"])

    def test_selective_map_export_keeps_verified_package_identity(self):
        packages = ["/Game/Map/B", "/Game/Map/A", "/Game/Map/A"]
        self.assertEqual(_select_map_packages(packages), ["/Game/Map/A", "/Game/Map/B"])
        self.assertEqual(_select_map_packages(packages, "/Game/Map/B"), ["/Game/Map/B"])
        with self.assertRaises(MapMigrationError):
            _select_map_packages(packages, "/Game/Map/Other")

    def test_glb_summary_reports_renderable_geometry(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "scene.glb"
            document = json.dumps({"asset": {"version": "2.0"}, "nodes": [{}], "meshes": [{}],
                                   "materials": [{}, {}], "textures": [{}],
                                   "images": [{"bufferView": 0}, {"uri": "external.png"}]}).encode()
            document += b" " * ((4 - len(document) % 4) % 4)
            path.write_bytes(b"glTF" + (2).to_bytes(4, "little") + (20 + len(document)).to_bytes(4, "little") +
                             len(document).to_bytes(4, "little") + (0x4E4F534A).to_bytes(4, "little") + document)
            self.assertEqual(glb_summary(path), {"mesh_count": 1, "node_count": 1, "material_count": 2,
                                                "texture_count": 1, "image_count": 2, "embedded_image_count": 1})
            record = {"fingerprint": "source-and-exporter"}
            prior = {**record, "status": "exported", "output_sha256": file_hash(path)}
            self.assertTrue(_cached_map_matches(record, prior, path))
            # Still a valid GLB header/JSON, but contents no longer match the cache.
            path.write_bytes(path.read_bytes().replace(b"external.png", b"modified.png"))
            self.assertFalse(_cached_map_matches(record, prior, path))

    def test_map_dependencies_preserve_inherited_materials_and_nested_types(self):
        def asset(name, kind, dependencies=(), **tags):
            return {"package": "/Game/" + name, "class": kind,
                    "dependencies": ["/Game/" + dep for dep in dependencies], "tags": tags}
        registry = {"assets": [
            asset("Map", "World", ["Actor"]),
            asset("Actor", "BlueprintGeneratedClass", ["Walk", "Widget"],
                  ParentClass="/Script/Engine.BlueprintGeneratedClass'/Game/Parent.Parent_C'"),
            asset("Parent", "BlueprintGeneratedClass", ["Style", "Helper"]),
            asset("Style", "UserDefinedStruct", ["Params"]),
            asset("Params", "UserDefinedStruct", ["Colors"]),
            asset("Colors", "UserDefinedEnum"),
            asset("Helper", "BlueprintGeneratedClass", ["Material", "Parent"]),
            asset("Material", "MaterialInstanceConstant", ["Animals/Texture"]),
            asset("Animals/Texture", "Texture2D"),
            asset("Walk", "AnimSequence"), asset("Widget", "WidgetBlueprintGeneratedClass"),
            asset("OtherMap", "World"), asset("Unrelated", "StaticMesh"),
        ]}
        self.assertEqual(_map_export_packages("/Game/Map", registry),
                         {"/Game/" + name for name in ["Map", "Actor", "Parent", "Style", "Params",
                                                      "Colors", "Helper", "Material", "Animals/Texture"]})

    def test_selective_mirror_filters_unselected_maps_and_keeps_bulk_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, target = root / "Content", root / "Mirror"
            source.mkdir()
            for name in ("Chosen.umap", "Other.umap", "Mesh.uasset", "Mesh.ubulk"):
                (source / name).write_bytes(b"source")
            _link_tree(source, target, included_packages={"/Game/Chosen", "/Game/Mesh"})
            self.assertEqual({p.name for p in target.iterdir()}, {"Chosen.umap", "Mesh.uasset", "Mesh.ubulk"})
            self.assertTrue((target / "Chosen.umap").samefile(source / "Chosen.umap"))

    def test_scratch_path_cannot_escape_workspace(self):
        with tempfile.TemporaryDirectory() as temporary:
            snapshot = {"project": str(Path(temporary) / "Game.uproject"), "files": [], "engine": {
                "status": "detected", "executable": "UnrealEditor-Cmd", "requested_association": "5.7",
                "version_parts": [5, 7, 4]}}
            with self.assertRaises(EngineError):
                prepare_project(Path(temporary), snapshot, scratch_name="../../outside", mirror_assets=True)

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
