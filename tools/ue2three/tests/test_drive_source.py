"""Google Drive DDS source staging tests (offline; no Drive token/network)."""
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from drive_source import DriveSourceError, inventory, stage, valid_name


class Response(io.BytesIO):
    def __enter__(self):
        return self
    def __exit__(self, *args):
        self.close()


class FakeDrive:
    def __init__(self, nodes, contents=None):
        self.nodes = nodes
        self.contents = contents or {}
        self.calls = []
    def __call__(self, request, timeout=60):
        self.calls.append(request.full_url)
        parsed = urlparse(request.full_url)
        if not request.get_header("Authorization") == "Bearer example-token":
            raise AssertionError("No authorization header")
        if parsed.path.endswith("/files"):
            q = parse_qs(parsed.query)["q"][0]
            folder_id = q.split("'")[1]
            data = self.nodes.get(folder_id, [])
            return Response(json.dumps({"files": data}).encode())
        fid = parsed.path.rsplit("/", 1)[-1]
        return Response(self.contents[fid])


class DriveStageTests(unittest.TestCase):
    def test_empty_folder_tree_is_not_a_complete_unreal_project(self):
        api = FakeDrive({"rootname": [{"id": "a", "name": "Content", "mimeType": "application/vnd.google-apps.folder"}], "a": []})
        manifest = inventory("rootname", "example-token", api)
        self.assertEqual(manifest["status"], "incomplete")
        self.assertEqual(manifest["package_count"], 0)
        self.assertEqual(len(manifest["missing"]), 2)
        with tempfile.TemporaryDirectory() as target:
            with self.assertRaisesRegex(DriveSourceError, "Incomplete Unreal source"):
                stage(manifest, "example-token", target, api)

    def test_stage_byte_identical_sources_and_never_replace_different_file(self):
        project = b'{"FileVersion":3}'
        asset = b"original asset bytes"
        def file(fid, name, data):
            return {"id": fid, "name": name, "mimeType": "application/octet-stream",
                    "md5Checksum": hashlib.md5(data).hexdigest(), "size": str(len(data))}
        api = FakeDrive({
            "rootname": [file("p", "VIPExtractionKitDDS.uproject", project),
                         {"id": "c", "name": "Content", "mimeType": "application/vnd.google-apps.folder"}],
            "c": [file("m", "Original.uasset", asset)],
        }, {"p": project, "m": asset})
        manifest = inventory("rootname", "example-token", api)
        self.assertEqual(manifest["status"], "ready_to_stage")
        with tempfile.TemporaryDirectory() as target:
            self.assertEqual(len(stage(manifest, "example-token", target, api)), 2)
            self.assertEqual((Path(target) / "Content/Original.uasset").read_bytes(), asset)
            self.assertEqual(len(stage(manifest, "example-token", target, api)), 2)
            (Path(target) / "Content/Original.uasset").write_bytes(b"modified")
            with self.assertRaisesRegex(DriveSourceError, "will not be overwritten"):
                stage(manifest, "example-token", target, api)

    def test_rejects_traversal_and_case_collisions(self):
        for name in ("../escape", "bad/segment", "NUL", "trailing.", "."):
            with self.assertRaises(DriveSourceError):
                valid_name(name)
        api = FakeDrive({"rootname": [{"id": "a", "name": "One.uasset", "mimeType": "application/octet-stream"},
                                      {"id": "b", "name": "one.uasset", "mimeType": "application/octet-stream"}]})
        with self.assertRaisesRegex(DriveSourceError, "case-colliding"):
            inventory("rootname", "example-token", api)

    def test_only_one_root_project_and_content_packages_satisfy_preflight(self):
        p = {"id": "proj", "name": "project.uproject", "mimeType": "application/octet-stream", "size": "3"}
        api = FakeDrive({"rootname": [p]})
        report = inventory("rootname", "example-token", api)
        self.assertEqual(report["status"], "incomplete")
        self.assertIn("No source .uasset", report["missing"][0])


if __name__ == "__main__":
    unittest.main()
