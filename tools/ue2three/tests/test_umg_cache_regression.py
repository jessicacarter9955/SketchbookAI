"""UMG cache regression: parser identity and source sidecars."""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from umg_migration import _asset_document


class UMGCacheRegressionTests(unittest.TestCase):
    def test_sidecar_changes_and_engine_version_invalidate_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            asset = root / "Widget.uasset"
            asset.write_bytes(b"asset")
            def parser(argv, **kwargs):
                Path(argv[3]).write_text(json.dumps({"Exports": [{"ObjectName": "Widget"}]}))
                return SimpleNamespace(returncode=0, stdout="", stderr="")
            def load(version="VER_UE5_7"):
                return _asset_document("/Game/UI/Widget", asset, root / "parser.exe", root / "cache", version)[1]
            with patch("umg_migration.subprocess.run", side_effect=parser) as runner:
                previous = load()
                self.assertEqual(load(), previous)
                for suffix in (".uexp", ".ubulk", ".uptnl"):
                    asset.with_suffix(suffix).write_bytes(suffix.encode())
                    current = load()
                    self.assertNotEqual(current, previous)
                    previous = current
                asset.with_suffix(".uexp").write_bytes(b"modified")
                current = load()
                self.assertNotEqual(current, previous)
                previous = current
                asset.with_suffix(".ubulk").unlink()
                current = load()
                self.assertNotEqual(current, previous)
                previous = current
                self.assertNotEqual(load("VER_UE5_6"), previous)
                self.assertEqual(runner.call_count, 7)

    def test_empty_cache_exports_reparsed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            asset = root / "Widget.uasset"
            asset.write_bytes(b"asset")
            def parser(argv, **kwargs):
                Path(argv[3]).write_text(json.dumps({"Exports": [{"ObjectName": "Valid"}]}))
                return SimpleNamespace(returncode=0, stdout="", stderr="")
            with patch("umg_migration.subprocess.run", side_effect=parser) as runner:
                package, key = _asset_document("/Game/UI/Widget", asset, root / "parser.exe", root / "cache", "VER_UE5_7")
                self.assertEqual(package.exports[0]["ObjectName"], "Valid")
                (root / "cache" / f"{key}.json").write_text('{"Exports": []}')
                package, same_key = _asset_document("/Game/UI/Widget", asset, root / "parser.exe", root / "cache", "VER_UE5_7")
                self.assertEqual(same_key, key)
                self.assertEqual(package.exports[0]["ObjectName"], "Valid")
                self.assertEqual(runner.call_count, 2)


if __name__ == "__main__":
    unittest.main()
