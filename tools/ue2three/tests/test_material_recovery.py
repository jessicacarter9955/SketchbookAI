"""Original-material graph recovery uses verified sources and resumable checkpoints."""

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import atomic_json, digest, file_hash, read_json
from material_recovery import MaterialRecoveryError, recover_materials, verified_materials


class MaterialRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.project = self.root / "source" / "Game.uproject"
        self.project.parent.mkdir()
        self.project.write_text("{}", encoding="utf-8")
        self.material = self.project.parent / "Content" / "M_Test.uasset"
        self.material.parent.mkdir()
        self.material.write_bytes(b"original material")
        file = {"path": "Content/M_Test.uasset", "sha256": file_hash(self.material)}
        self.workspace = self.root / "workspace"
        (self.workspace / "artifacts").mkdir(parents=True)
        snapshot = {"project": str(self.project), "files": [file]}
        atomic_json(self.workspace / "snapshot.json", snapshot)
        atomic_json(self.workspace / "state.json", {"source_verification_status": "verified",
                    "snapshot_hash": digest(snapshot)})
        atomic_json(self.workspace / "artifacts" / "inventory.json", {
            "files": [file], "assets": [{**file, "package": "/Game/M_Test"}]})
        atomic_json(self.workspace / "artifacts" / "engine_metadata.json", {
            "complete": True, "project": str(self.project),
            "source_snapshot_hash": digest([file]),
            "engine_version": "5.6",
            "assets": [{"package": "/Game/M_Test", "class": "Material"},
                       {"package": "/Game/M_Instance", "class": "MaterialInstanceConstant"}]})
        self.publish = self.root / "published"

    def test_only_original_verified_material_is_selected(self):
        rows, _ = verified_materials(self.project, self.workspace)
        self.assertEqual([row["package"] for row in rows], ["/Game/M_Test"])
        self.assertEqual(rows[0]["source_sha256"], file_hash(self.material))

    def test_refuses_unverified_snapshot(self):
        state = read_json(self.workspace / "state.json")
        state["snapshot_hash"] = "stale"
        atomic_json(self.workspace / "state.json", state)
        with self.assertRaises(MaterialRecoveryError):
            verified_materials(self.project, self.workspace)

    def test_checkpoint_resumes_without_touching_original_material(self):
        graph = {"nodes": [{"id": 1}], "connection_count": 2}
        parser_calls = []

        def parser(*args):
            parser_calls.append(args[0])
            return object(), file_hash(self.material)

        with patch("material_recovery._tool", return_value="mock-tool"), \
             patch("material_recovery._asset_document", side_effect=parser), \
             patch("material_recovery.extract_material_graph", return_value=graph):
            first = recover_materials(self.project, self.workspace, self.publish, workers=1)
            again = recover_materials(self.project, self.workspace, self.publish, workers=1)
        self.assertEqual(first["counts"], {"source": 1, "recovered": 1,
                                           "blocked": 0, "pending": 0})
        self.assertEqual(again["counts"], first["counts"])
        self.assertEqual(parser_calls, ["/Game/M_Test"])
        self.assertEqual(self.material.read_bytes(), b"original material")
        self.assertEqual(first["materials"]["/Game/M_Test"]["connections"], 2)

    def test_failed_graph_does_not_count_as_recovered(self):
        with patch("material_recovery._tool", return_value="mock-tool"), \
             patch("material_recovery._asset_document", side_effect=ValueError("bad package")):
            result = recover_materials(self.project, self.workspace, self.publish, workers=1)
        self.assertEqual(result["counts"], {"source": 1, "recovered": 0,
                                            "blocked": 1, "pending": 0})
        self.assertIn("bad package", result["materials"]["/Game/M_Test"]["error"])

    def test_refuses_original_project_as_publish_directory(self):
        with self.assertRaises(MaterialRecoveryError):
            recover_materials(self.project, self.workspace, self.project.parent)


if __name__ == "__main__":
    unittest.main()
