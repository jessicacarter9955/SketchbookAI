"""Synthetic fixtures exercise the supervisor; no fixture pretends to be DDS production proof."""
import contextlib
import io
import json
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import atomic_json, digest, file_hash, read_json
from character import character_fingerprint, load_character_recipe
from dds_asset_export import (ExportSupervisor, _verified_character_files,
                              _verified_map_rows, _map_issues, main, new_progress,
                              outside_source, stalled_retry_delay)


def fixture_glb(path: Path, mesh=True, animation=False):
    # A valid minimal glTF JSON chunk; Unreal never runs in unit tests.
    document = {"asset": {"version": "2.0"}, "nodes": [{"mesh": 0}] if mesh else [],
                "meshes": [{"primitives": [{}]}] if mesh else []}
    if animation:
        document["animations"] = [{"samplers": [{"input": 0, "output": 1}],
                                   "channels": [{"sampler": 0, "target": {"node": 0, "path": "translation"}}]}]
    raw = json.dumps(document, separators=(",", ":")).encode("utf-8")
    raw += b" " * (-len(raw) % 4)
    result = struct.pack("<4sII", b"glTF", 2, 20 + len(raw))
    result += struct.pack("<I4s", len(raw), b"JSON") + raw
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(result)


class AssetSupervisorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "original"
        self.source.mkdir()
        self.project = self.source / "VIPDDS.uproject"
        atomic_json(self.project, {"FileVersion": 3, "EngineAssociation": "5.7"})
        self.map_workspace = self.root / "cache"
        self.publish = self.root / "published"
        self.checkpoint = self.root / "checkpoint"
        self.recipe = self.root / "recipe.json"
        atomic_json(self.recipe, {"schema_version": 1, "id": "test-character",
                                  "mesh": "/Game/Hero/Mesh", "clips": {"idle": "/Game/Hero/Idle"},
                                  "attachment_assets": {"pistol": {"asset": "/Game/Hero/Pistol", "bone": "right_hand"}}})

    def _assets(self):
        for name in ("Mesh", "Idle", "Pistol"):
            path = self.source / "Content" / "Hero" / (name + ".uasset")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(name.encode("ascii"))
        map_path = self.source / "Content" / "Worlds" / "Start.umap"
        map_path.parent.mkdir(parents=True, exist_ok=True)
        map_path.write_bytes(b"Original authored map")

    def _inventory(self):
        self.map_workspace.mkdir(parents=True, exist_ok=True)
        snapshot = {"schema_version": 1, "project": str(self.project.resolve()),
                    "files": [{"path": "Content/Worlds/Start.umap", "sha256": file_hash(
                        self.source / "Content" / "Worlds" / "Start.umap")}],
                    "omitted_links": []}
        atomic_json(self.map_workspace / "snapshot.json", snapshot)
        atomic_json(self.map_workspace / "state.json", {"source_verification_status": "verified",
            "config": {"project": str(self.project.resolve())}, "snapshot_hash": digest(snapshot)})
        atomic_json(self.map_workspace / "artifacts" / "inventory.json", {"maps": ["/Game/Worlds/Start"]})
        atomic_json(self.map_workspace / "artifacts" / "engine_metadata.json", {
            "complete": True, "project": str(self.project.resolve()),
            "source_snapshot_hash": digest(snapshot["files"])})
        return digest(snapshot)

    def _runner(self, **changes):
        return ExportSupervisor(self.project, self.map_workspace, self.publish,
                                self.checkpoint, recipe_path=self.recipe,
                                scan_if_needed=changes.get("scan_if_needed", False),
                                max_parallel=changes.get("max_parallel", 2))

    def test_source_must_be_separate_from_all_outputs(self):
        with self.assertRaisesRegex(ValueError, "separate"):
            outside_source(self.source / "Content" / "out", self.project, "publish")
        with self.assertRaisesRegex(ValueError, "separate"):
            ExportSupervisor(
                self.project, self.root / "cache", self.source / "publish", self.checkpoint,
                recipe_path=self.recipe)

    def test_schema_is_explicit_about_unmeasured_denominator(self):
        data = new_progress(self.project, self.publish)
        self.assertEqual(data["schema_version"], 1)
        self.assertIsNone(data["progress"]["percent"])
        self.assertEqual(data["assets"]["verified"], 0)
        self.assertFalse(data["running"])

    def test_maps_ignore_stale_identity_empty_geometry_and_corruption(self):
        output = self.root / "map.glb"
        fixture_glb(output)
        row = {"package": "/Game/Worlds/Start", "verified_in_run": True, "status": "exported",
               "output": str(output), "output_sha256": file_hash(output)}
        manifest = {"project": str(self.project), "source_snapshot_hash": "valid", "maps": [row]}
        matched, failed, skipped = _verified_map_rows(manifest, self.project, ["/Game/Worlds/Start"], "valid")
        self.assertEqual((len(matched), failed, skipped), (1, 0, 0))
        self.assertEqual(_verified_map_rows(manifest, self.project, ["/Game/Worlds/Start"], "different"), ([], 0, 0))
        fixture_glb(output, mesh=False)
        self.assertEqual(_verified_map_rows(manifest, self.project, ["/Game/Worlds/Start"], "valid")[1], 1)
        fixture_glb(output)
        row["status"] = "source_only"
        self.assertEqual(_verified_map_rows(manifest, self.project, ["/Game/Worlds/Start"], "valid")[2], 1)

    def test_material_fidelity_and_individual_failures_surface_as_issues(self):
        output = self.root / "map.glb"
        fixture_glb(output)
        rows = [{"package": "/Game/Worlds/Start", "verified_in_run": True,
                 "status": "exported", "output": str(output), "output_sha256": file_hash(output),
                 "material_fidelity": {"bake_mode": "simple", "degraded": True,
                                       "warning": "Simplified shaders: check in Play"}},
                {"package": "/Game/Worlds/Broken", "verified_in_run": True,
                 "status": "failed", "error": "Material baking crashed"}]
        manifest = {"project": str(self.project), "source_snapshot_hash": "valid", "maps": rows}
        selected = ["/Game/Worlds/Start", "/Game/Worlds/Broken"]
        good, failed, skipped = _verified_map_rows(manifest, self.project, selected, "valid")
        self.assertEqual((len(good), failed, skipped), (1, 1, 0))
        self.assertTrue(good[0]["material_fidelity"]["degraded"])
        issues, downgraded = _map_issues(manifest, self.project, selected, "valid")
        self.assertEqual(downgraded, 1)
        self.assertEqual({i["status"] for i in issues}, {"material_degraded", "failed"})
        self.assertEqual(_map_issues(manifest, self.project, selected, "stale"), ([], 0))

    def test_character_files_require_visual_meshes_but_clips_may_be_track_only(self):
        folder = self.root / "character"
        fixture_glb(folder / "character.glb", mesh=True)
        fixture_glb(folder / "clip-idle.glb", mesh=False, animation=True)
        fixture_glb(folder / "attachment-pistol.glb", mesh=True)
        atomic_json(folder / "manifest.json", {"schema_version": 1, "kind": "character",
                    "fingerprint": "f" * 64, "recipe_id": "test-character",
                    "mesh": "character.glb", "clips": {"idle": "clip-idle.glb"},
                    "attachment_assets": {"pistol": {"file": "attachment-pistol.glb", "bone": "right_hand"}}})
        checked = _verified_character_files(folder, self.project, "f" * 64, 3)
        self.assertEqual(len(checked), 3)
        self.assertEqual(checked[0]["mesh_count"], 1)
        fixture_glb(folder / "character.glb", mesh=False)
        with self.assertRaisesRegex(ValueError, "Non-renderable"):
            _verified_character_files(folder, self.project, "f" * 64, 3)
        fixture_glb(folder / "character.glb")
        fixture_glb(folder / "clip-idle.glb", mesh=False)
        with self.assertRaisesRegex(ValueError, "no glTF animation channels"):
            _verified_character_files(folder, self.project, "f" * 64, 3)
        fixture_glb(folder / "clip-idle.glb", mesh=False, animation=True)
        with self.assertRaisesRegex(ValueError, "omitted or renamed"):
            _verified_character_files(folder, self.project, "f" * 64, 3, {"different"}, {"pistol"})

    def test_verified_character_outputs_are_reused_until_original_source_changes(self):
        self._assets()
        recipe = load_character_recipe(self.recipe)
        fingerprint, _ = character_fingerprint(self.project, recipe)
        folder = self.publish / "dds-assets" / "character"
        fixture_glb(folder / "character.glb")
        fixture_glb(folder / "clip-idle.glb", mesh=False, animation=True)
        fixture_glb(folder / "attachment-pistol.glb")
        atomic_json(folder / "manifest.json", {"schema_version": 1, "kind": "character",
                    "fingerprint": fingerprint, "recipe_id": "test-character",
                    "mesh": "character.glb", "clips": {"idle": "clip-idle.glb"},
                    "attachment_assets": {"pistol": {"file": "attachment-pistol.glb",
                                                     "bone": "right_hand"}}})
        runner = self._runner()
        self.assertFalse(runner._prepare_character(), "Verified outputs must skip redundant Unreal export")
        job = next(item for item in runner.progress["jobs"] if item["id"] == "character")
        self.assertEqual(job["status"], "completed")
        self.assertEqual(job["completed"], 3)
        self.assertTrue(job["reused_verified_outputs"])
        (self.source / "Content/Hero/Pistol.uasset").write_bytes(b"modified source")
        changed = self._runner()
        self.assertTrue(changed._prepare_character(), "A changed source must require a new export")
        self.assertFalse(changed.progress["jobs"][0].get("reused_verified_outputs", False))

    def test_no_sources_prevents_fabricated_completion_without_launch(self):
        runner = self._runner(scan_if_needed=False)
        result = runner.run()
        self.assertEqual(result, 3)
        progress = json.loads(runner.progress_path.read_text())
        self.assertEqual(progress["status"], "blocked")
        self.assertEqual(progress["assets"]["verified"], 0)
        self.assertIsNone(progress["progress"]["percent"])
        self.assertTrue(all(job["status"] == "blocked" for job in progress["jobs"]))
        self.assertFalse((self.publish / "dds-assets").exists())

    def test_checked_fixture_conversion_progress_and_checkpoint(self):
        self._assets()
        self._inventory()
        runner = self._runner(scan_if_needed=False)
        originals = {path: file_hash(path) for path in self.source.rglob("*.uasset")}
        originals[self.project] = file_hash(self.project)

        def synthetic_unreal_fixture(job_id, argv, *, manifest=None, read_progress=None):
            # Test seam: fills the same filesystem contracts that the real CLI
            # would fill. Production has no synthetic export fallback.
            if job_id == "character":
                folder = runner.character_output
                fixture_glb(folder / "character.glb")
                fixture_glb(folder / "clip-idle.glb", mesh=False, animation=True)
                fixture_glb(folder / "attachment-pistol.glb")
                atomic_json(folder / "manifest.json", {"schema_version": 1, "kind": "character",
                    "fingerprint": runner._fingerprint, "recipe_id": "test-character",
                    "mesh": "character.glb", "clips": {"idle": "clip-idle.glb"},
                    "attachment_assets": {"pistol": {"file": "attachment-pistol.glb", "bone": "right_hand"}}})
            else:
                folder = runner.map_output
                fixture_glb(folder / "maps" / "Start.glb")
                output = folder / "maps" / "Start.glb"
                atomic_json(folder / "map-manifest.json", {"project": str(self.project),
                    "source_snapshot_hash": runner._source_snapshot_hash,
                    "maps": [{"package": "/Game/Worlds/Start", "status": "exported",
                              "verified_in_run": True, "output": str(output),
                              "output_sha256": file_hash(output)}]})
            return 0

        runner._launch = synthetic_unreal_fixture
        self.assertEqual(runner.run(), 0)
        progress = read_json(runner.progress_path)
        self.assertEqual(progress["status"], "completed")
        self.assertEqual(progress["assets"]["eligible"], 4)
        self.assertEqual(progress["assets"]["verified"], 4)
        self.assertEqual(progress["progress"]["percent"], 100)
        self.assertFalse(progress["running"])
        self.assertEqual(len(read_json(runner.manifest_path)["files"]), 4)
        for path, sha in originals.items():
            self.assertEqual(file_hash(path), sha, "Original content changed")

    def test_busy_map_workspace_defers_instead_of_starting_another_export(self):
        self._assets()
        self._inventory()
        runner = self._runner(scan_if_needed=False)
        self.assertTrue(runner._prepare_maps())
        # Simulate the other CLI owning the native lock.
        import unittest.mock
        with unittest.mock.patch("dds_asset_export.workspace_lock", side_effect=RuntimeError("busy")):
            runner._convert_maps()
        job = next(x for x in runner.progress["jobs"] if x["id"] == "maps")
        self.assertEqual(job["status"], "blocked")
        self.assertIn("owns the workspace lock", job["error"])

    def test_status_never_starts_unreal_or_generates_green(self):
        target = self.root / "empty-checkpoint"
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream):
            self.assertEqual(main(["--status", "--state-dir", str(target)]), 0)
        self.assertEqual(json.loads(stream.getvalue())["status"], "not_started")
        self.assertFalse(target.exists())

    def test_partial_export_loop_backs_off_but_resets_after_real_progress(self):
        self.assertEqual(stalled_retry_delay(300, 0, 900), 300)
        self.assertEqual(stalled_retry_delay(300, 1, 900), 600)
        self.assertEqual(stalled_retry_delay(300, 2, 900), 900)
        counts = iter([8, 8, 8, 9])
        delays = []

        class FakeSupervisor:
            def __init__(self, *args, **kwargs):
                self._source_snapshot_hash = "source-snapshot"
                self._fingerprint = "source-characters"
                self.progress = {"jobs": []}

            def run(self):
                self.progress["jobs"] = [
                    {"id": "character", "completed": 48, "failed": 0, "skipped": 0},
                    {"id": "maps", "completed": next(counts), "failed": 2, "skipped": 0}]
                return 3

        def pause(seconds):
            delays.append(seconds)
            if len(delays) == 4:
                raise KeyboardInterrupt()

        with patch("dds_asset_export.ExportSupervisor", FakeSupervisor), \
             patch("dds_asset_export.time.sleep", side_effect=pause):
            self.assertEqual(main(["--loop", "--project", str(self.project),
                                   "--map-workspace", str(self.map_workspace),
                                   "--publish-dir", str(self.publish),
                                   "--interval-seconds", "300",
                                   "--max-stalled-delay-seconds", "900"]), 130)
        self.assertEqual(delays, [300, 600, 900, 300])


if __name__ == "__main__":
    unittest.main()
