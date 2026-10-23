import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from map_crash_diagnostics import (DiagnosisError, audit_existing_exports,
                                   diagnose, first_groups, initialize, load_source_attempt)


class CrashDiagnosticsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.source = root / "original" / "DDS.uproject"
        self.scratch = root / "scratch" / "DDS.uproject"
        for name in (self.source, self.scratch):
            name.parent.mkdir(parents=True, exist_ok=True)
            name.write_text("{}")
        self.run_dir = root / "run"
        self.run_dir.mkdir()
        self.output = root / "diagnostics"
        self.request = {"source_project": str(self.source), "scratch_project": str(self.scratch),
                        "source_snapshot_hash": "exact-source-hash",
                        "maps": [{"package": "/Game/Gallery", "filename": "Gallery.glb", "fingerprint": "a"}]}
        (self.run_dir / "request.json").write_text(json.dumps(self.request))
        (self.run_dir / "process.json").write_text(json.dumps({
            "command": ["unreal.exe", str(self.scratch), "-script=export.py", "-abslog=old.log"]}))
        self.names = [f"Actor_{i}" for i in range(4)]
        self._write_census(self.names)

    def _write_census(self, names):
        (self.run_dir / "actor-census.json").write_text(json.dumps({
            "package": "/Game/Gallery", "source_snapshot_hash": "exact-source-hash",
            "selection": {"mode": "all"}, "actors": [{"name": n} for n in names]}))

    @staticmethod
    def fake_glb(path, geometry=True):
        data = json.dumps({"meshes": [{}], "nodes": [{}]} if geometry else {}).encode('utf-8')
        data += b' ' * (-len(data) % 4)
        payload = struct.pack("<II", len(data), 0x4E4F534A) + data
        path.write_bytes(b"glTF" + struct.pack("<II", 2, 12 + len(payload)) + payload)

    def test_source_must_match_census_and_preserve_original_project(self):
        request, command, names = load_source_attempt(self.run_dir)
        self.assertEqual(names, self.names)
        self.assertEqual(request["source_project"], str(self.source))
        self.assertEqual(command[1], str(self.scratch))
        self._write_census(["Duplicate", "Duplicate"])
        with self.assertRaises(DiagnosisError):
            initialize(self.run_dir, self.output)

    def test_initial_groups_cover_all_actors_without_full_retry(self):
        self.assertEqual(first_groups(self.names), [self.names[:2], self.names[2:]])
        self.assertEqual(first_groups(["Only"]), [["Only"]])

    def test_failed_groups_split_then_resume_without_losing_actors(self):
        observed = []

        def fake_runner(command, **kwargs):
            request = json.loads(Path(kwargs["env"]["UE2THREE_MAP_JOB_FILE"]).read_text())
            item = request["maps"][0]
            names = item["selected_actor_names"]
            observed.extend(names)
            self.assertEqual(command[-1].split("-abslog=")[-1].endswith("unreal.log"), True)
            if len(names) > 1:
                return SimpleNamespace(returncode=3)
            target = Path(request["output"]) / item["filename"]
            self.fake_glb(target)
            Path(request["result"]).write_text(json.dumps({"complete": True,
                "source_project": request["source_project"],
                "source_snapshot_hash": request["source_snapshot_hash"], "results": [{
                "status": "exported", "package": item["package"], "filename": item["filename"],
                "fingerprint": item["fingerprint"],
                "actor_selection": {"mode": "subset", "actor_names": names, "selected": len(names)}}]}))
            return SimpleNamespace(returncode=0)

        first = diagnose(self.run_dir, self.output, max_attempts=2, runner=fake_runner)
        self.assertFalse(first["complete"])
        self.assertEqual(len(first["pending"]), 2)
        second = diagnose(self.run_dir, self.output, max_attempts=4, runner=fake_runner)
        self.assertTrue(second["complete"])
        self.assertEqual({n for record in second["verified_groups"] for n in record["actor_names"]},
                         set(self.names))
        self.assertEqual(len(second["attempts"]), 6)
        self.assertEqual(len(second["unexportable_actors"]), 0)
        self.assertEqual(self.source.read_text(), "{}")
        self.assertTrue((self.output / "diagnosis.json").is_file())
        audit = audit_existing_exports(self.run_dir, self.output)
        self.assertEqual(audit["recovered_actor_count"], 4)
        self.assertEqual(len(audit["verified_nonoverlapping_groups"]), 4)

    def test_crashing_single_actor_is_reported_not_silently_omitted(self):
        self._write_census(["Problem"])
        state = diagnose(self.run_dir, self.output, max_attempts=1,
                         runner=lambda *args, **kwargs: SimpleNamespace(returncode=17))
        self.assertTrue(state["complete"])
        self.assertEqual(state["verified_groups"], [])
        self.assertEqual(state["unexportable_actors"][0]["actor_names"], ["Problem"])

    def test_completed_nonzero_exit_recovers_source_matched_geometry_only(self):
        self._write_census(["StaticMeshA"])

        def exported_after_nonzero_exit(command, **kwargs):
            job = json.loads(Path(kwargs["env"]["UE2THREE_MAP_JOB_FILE"]).read_text())
            record = job["maps"][0]
            glb = Path(job["output"]) / record["filename"]
            self.fake_glb(glb, geometry=True)
            Path(job["result"]).write_text(json.dumps({
                "complete": True, "source_project": job["source_project"],
                "source_snapshot_hash": job["source_snapshot_hash"],
                "results": [{"status": "exported", "package": record["package"],
                             "filename": record["filename"], "fingerprint": record["fingerprint"],
                             "bytes": glb.stat().st_size,
                             "actor_selection": {"mode": "subset", "selected": 1,
                                                 "actor_names": ["StaticMeshA"]}}]}))
            return SimpleNamespace(returncode=1)

        state = diagnose(self.run_dir, self.output, max_attempts=1,
                         runner=exported_after_nonzero_exit)
        self.assertTrue(state["complete"])
        self.assertEqual(len(state["verified_groups"]), 1)
        record = state["verified_groups"][0]
        self.assertEqual(record["verification_mode"], "complete_export_unclean_exit")
        self.assertEqual(record["geometry"]["mesh_count"], 1)
        self.assertEqual(record["exit_code"], 1)
        self.assertEqual(len(record["glb_sha256"]), 64)
        # Old reports marked even the completed GLB group as a failure.
        # Recovery uses the original files, not the earlier success label.
        previous = json.loads((self.output / "diagnosis.json").read_text())
        previous["attempts"][0]["success"] = False
        (self.output / "diagnosis.json").write_text(json.dumps(previous))
        audit = audit_existing_exports(self.run_dir, self.output)
        self.assertEqual(audit["recovered_actor_count"], 1)
        self.assertEqual(audit["verified_nonoverlapping_groups"][0]["unreal_exit_code"], 1)

    def test_incomplete_nonzero_export_never_counts_as_success(self):
        self._write_census(["StaticMeshA"])

        def incomplete(command, **kwargs):
            job = json.loads(Path(kwargs["env"]["UE2THREE_MAP_JOB_FILE"]).read_text())
            record = job["maps"][0]
            glb = Path(job["output"]) / record["filename"]
            self.fake_glb(glb, geometry=True)
            Path(job["result"]).write_text(json.dumps({"complete": False, "results": [{
                "status": "exported", "bytes": glb.stat().st_size,
                "actor_selection": {"mode": "subset", "selected": 1,
                                    "actor_names": ["StaticMeshA"]}}]}))
            return SimpleNamespace(returncode=1)

        state = diagnose(self.run_dir, self.output, max_attempts=1, runner=incomplete)
        self.assertEqual(state["verified_groups"], [])
        self.assertEqual(len(state["unexportable_actors"]), 1)


if __name__ == "__main__":
    unittest.main()
