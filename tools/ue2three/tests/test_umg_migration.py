import sys
import json
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from umg_migration import _value, _widgets_for_map, _asset_document
from web_runner import reusable_workspace


class WidgetMigrationTests(unittest.TestCase):
    def test_parser_uses_copy_and_caches_without_exposing_source_to_writer(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "Source.uasset"
            source.write_bytes(b"original")
            source.with_suffix(".uexp").write_bytes(b"payload")
            def parse(command, **kwargs):
                copied = Path(command[2])
                self.assertNotEqual(copied, source)
                self.assertEqual(copied.read_bytes(), b"original")
                self.assertEqual(copied.with_suffix(".uexp").read_bytes(), b"payload")
                copied.write_bytes(b"parser changed its own input")
                Path(command[3]).write_text(json.dumps({"Exports": [{"ObjectName": "Source"}]}))
                return SimpleNamespace(returncode=0, stdout="", stderr="")
            with patch("umg_migration.subprocess.run", side_effect=parse) as runner:
                _asset_document("/Game/Source", source, root / "parser.exe", root / "cache", "VER_UE5_7")
                _asset_document("/Game/Source", source, root / "parser.exe", root / "cache", "VER_UE5_7")
                self.assertEqual(runner.call_count, 1)
            self.assertEqual(source.read_bytes(), b"original")

    def test_discovers_widget_blueprints_through_map_dependency_closure(self):
        registry = {"assets": [
            {"package": "/Game/Maps/Main", "class": "World", "dependencies": ["/Game/UI/Menu", "/Engine/Transient"]},
            {"package": "/Game/UI/Menu", "class": "WidgetBlueprintGeneratedClass", "dependencies": ["/Game/UI/Button"]},
            {"package": "/Game/UI/Button", "class": "WidgetBlueprintGeneratedClass", "dependencies": []},
            {"package": "/Game/Other", "class": "WidgetBlueprintGeneratedClass", "dependencies": []},
        ]}
        self.assertEqual(_widgets_for_map(registry, "/Game/Maps/Main"), ["/Game/UI/Button", "/Game/UI/Menu"])

    def test_reads_source_widget_text_and_nested_struct_values(self):
        text = {"$type": "UAssetAPI.PropertyTypes.Objects.TextPropertyData, UAssetAPI",
                "CultureInvariantString": "ENTER LOBBY"}
        self.assertEqual(_value(text), "ENTER LOBBY")
        nested = {"$type": "UAssetAPI.PropertyTypes.Objects.StructPropertyData, UAssetAPI", "Value": [
            {"Name": "Maximum", "$type": "UAssetAPI.PropertyTypes.Objects.StructPropertyData, UAssetAPI",
             "Value": [{"Name": "X", "Value": 1.0}, {"Name": "Y", "Value": 0.5}]}
        ]}
        self.assertEqual(_value(nested), {"Maximum": {"X": 1.0, "Y": 0.5}})

    def test_one_click_runner_reuses_verified_scan_and_map_cache_for_same_project(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            project = root / "DDS.uproject"
            project.touch()
            cached = root / "previous" / "jobs" / "DDS-123"
            (cached / "maps" / "runs").mkdir(parents=True)
            (cached / "state.json").write_text(json.dumps({
                "config": {"project": str(project)}, "source_verification_status": "verified"
            }), encoding="utf-8")
            preferred = root / "jobs" / "DDS-123"
            self.assertEqual(reusable_workspace(root, preferred, project), cached)

    def test_one_click_runner_ignores_scan_from_another_project(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            project = root / "DDS.uproject"
            other = root / "Other.uproject"
            project.touch(); other.touch()
            cached = root / "jobs" / "old"; cached.mkdir(parents=True)
            (cached / "state.json").write_text(json.dumps({
                "config": {"project": str(other)}, "source_verification_status": "verified"
            }), encoding="utf-8")
            preferred = root / "jobs" / "DDS-123"
            self.assertEqual(reusable_workspace(root, preferred, project), preferred)


if __name__ == "__main__":
    unittest.main()
