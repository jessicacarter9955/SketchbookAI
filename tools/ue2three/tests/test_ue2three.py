import contextlib
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from adapters import MetadataAdapter, detect_engine
from cli import main
from core import atomic_json, prepare_workspace, read_json, workspace_lock
from pipeline import (TASKS, artifact_path, build_report, load_state, new_state, plan,
                      retry_task, run, save_state, skip_task, verify_state)
from scanner import collect_snapshot, import_registry, inventory


class QuietLogger:
    def event(self, *_args, **_kwargs):
        pass


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        previous_cwd = Path.cwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, previous_cwd)
        self.source = self.root / "source"
        self.source.mkdir()
        (self.source / "Content").mkdir()
        (self.source / "Content" / "Hero.uasset").write_bytes(b"synthetic fixture only")
        (self.source / "Content" / "Level.umap").write_bytes(b"map fixture")
        self.project = self.source / "Example.uproject"
        atomic_json(self.project, {"FileVersion": 3, "EngineAssociation": "test-guid", "Plugins": []})
        self.directory = prepare_workspace(self.root / "work", self.project)
        self.logger = QuietLogger()
        self.state = new_state({"project": str(self.project), "engine": None, "registry": None})

    def snapshot(self, registry=None):
        return collect_snapshot(self.project, None, registry, self.logger)

    def complete(self):
        snap = self.snapshot()
        plan(self.state, snap)
        self.assertTrue(run(self.directory, self.state, snap, self.logger))
        return snap

    def test_unchanged_sources_reuse_verified_tasks(self):
        snap = self.complete()
        before = {name: item["input_hash"] for name, item in self.state["tasks"].items()}
        plan(self.state, self.snapshot())
        self.assertEqual(before, {name: item["input_hash"] for name, item in self.state["tasks"].items()})
        self.assertTrue(run(self.directory, self.state, snap, self.logger))
        self.assertTrue(all(task["attempts"] == 1 for task in self.state["tasks"].values()))

    def test_same_size_same_timestamp_edit_invalidates_dependents(self):
        self.complete()
        asset = self.source / "Content" / "Hero.uasset"
        before = asset.stat()
        asset.write_bytes(b"x" * before.st_size)
        self.assertEqual(asset.stat().st_size, before.st_size)
        os.utime(asset, ns=(before.st_atime_ns, before.st_mtime_ns))
        plan(self.state, self.snapshot())
        self.assertEqual(self.state["tasks"]["project"]["status"], "succeeded")
        self.assertEqual(self.state["tasks"]["engine"]["status"], "succeeded")
        for name in ("inventory", "registry", "diagnostics", "report"):
            self.assertEqual(self.state["tasks"][name]["status"], "pending")

    def test_deleted_asset_invalidates_inventory(self):
        self.complete()
        (self.source / "Content" / "Level.umap").unlink()
        plan(self.state, self.snapshot())
        self.assertEqual(self.state["tasks"]["inventory"]["status"], "pending")

    def test_interrupted_task_is_recovered_after_reload(self):
        snap = self.snapshot()
        plan(self.state, snap)
        def interrupt():
            raise KeyboardInterrupt()
        with self.assertRaises(KeyboardInterrupt):
            run(self.directory, self.state, snap, self.logger, {"project": interrupt})
        recovered = load_state(self.directory)
        self.assertEqual(recovered["tasks"]["project"]["status"], "running")
        self.assertIn("project", verify_state(self.directory, recovered, self.logger))
        self.assertTrue(run(self.directory, recovered, snap, self.logger))
        self.assertEqual(recovered["tasks"]["project"]["attempts"], 2)

    def test_corrupt_artifact_invalidates_transitive_dependents(self):
        snap = self.complete()
        artifact_path(self.directory, "inventory").write_text("{}", encoding="utf-8")
        verify_state(self.directory, self.state, self.logger)
        for name in ("inventory", "registry", "diagnostics", "report"):
            self.assertEqual(self.state["tasks"][name]["status"], "pending")
        self.assertTrue(run(self.directory, self.state, snap, self.logger))
        self.assertEqual(self.state["tasks"]["inventory"]["attempts"], 2)

    def test_failed_task_blocks_dependents_then_retry_recovers(self):
        snap = self.snapshot()
        plan(self.state, snap)
        def fail():
            raise RuntimeError("simulated disk failure")
        self.assertFalse(run(self.directory, self.state, snap, self.logger, {"project": fail, "engine": lambda: snap["engine"]}))
        self.assertEqual(self.state["tasks"]["project"]["status"], "failed")
        self.assertEqual(self.state["tasks"]["inventory"]["status"], "blocked")
        retry_task(self.state, "project")
        self.assertTrue(run(self.directory, self.state, snap, self.logger))

    def test_skip_is_not_success_and_retry_resets_it(self):
        snap = self.complete()
        skip_task(self.state, "inventory", "defer asset inspection")
        self.assertFalse(run(self.directory, self.state, snap, self.logger))
        report = build_report(self.directory, self.state)
        self.assertFalse(report["processing"]["complete"])
        self.assertEqual(report["processing"]["counts"]["skipped"], 1)
        retry_task(self.state, "inventory")
        self.assertTrue(run(self.directory, self.state, snap, self.logger))

    def test_engine_guid_and_explicit_version_mismatch(self):
        engine = self.root / "custom-engine"
        atomic_json(engine / "Engine" / "Build" / "Build.version", {"MajorVersion": 5, "MinorVersion": 7, "PatchVersion": 4})
        binary = engine / "Engine" / "Binaries" / "Win64" / "UnrealEditor-Cmd.exe"
        binary.parent.mkdir(parents=True)
        binary.write_bytes(b"never executed")
        result = detect_engine("{test-guid}", candidates=[("test-guid", engine, "test-registry")])
        self.assertEqual(result["version"], "5.7.4")
        mismatch = detect_engine("5.6", str(engine), candidates=[])
        self.assertTrue(any("differs" in warning for warning in mismatch["warnings"]))
        self.assertEqual(detect_engine("5.7", self.root / "missing", candidates=[])["status"], "invalid")

    def test_inventory_does_not_infer_asset_class_from_name(self):
        inv = inventory(self.snapshot())
        self.assertEqual(inv["maps"], ["/Game/Level"])
        hero = next(asset for asset in inv["assets"] if asset["package"] == "/Game/Hero")
        self.assertIsNone(hero["class"])
        self.assertEqual(hero["kind"], "unclassified_package")
        (self.source / "Content" / "custom.texture").write_bytes(b"unsupported data")
        retained = inventory(self.snapshot())
        self.assertIn("Content/custom.texture", retained["unclassified_files"])
        self.assertTrue(any(item["path"] == "Content/custom.texture" for item in retained["files"]))

    def test_registry_import_validates_identity_schema_and_dependencies(self):
        path = self.root / "registry.json"
        payload = {"schema_version": 1, "project": str(self.project), "assets": [
            {"package": "/Game/Hero", "class": "SkeletalMesh", "dependencies": ["/Game/Rig"]}]}
        atomic_json(path, payload)
        snap = self.snapshot(path)
        result = import_registry(snap, inventory(snap))
        self.assertEqual(result["classes"], {"SkeletalMesh": 1})
        self.assertEqual(result["freshness"], "unverified")
        self.assertEqual(result["missing_references"], [{"asset": "/Game/Hero", "dependency": "/Game/Rig"}])
        payload["project"] = str(self.root / "Other.uproject")
        atomic_json(path, payload)
        with self.assertRaisesRegex(ValueError, "different project"):
            import_registry(self.snapshot(path), inventory(snap))

    def test_future_state_schema_rejected_and_sources_never_nested(self):
        atomic_json(self.directory / "state.json", {"schema_version": 999})
        with self.assertRaisesRegex(ValueError, "Unsupported state schema"):
            load_state(self.directory)
        with self.assertRaisesRegex(ValueError, "non-nested"):
            prepare_workspace(self.source / "output", self.project)

    def test_no_conversion_claim_and_explicit_adapter_boundary(self):
        self.complete()
        report = build_report(self.directory, self.state)
        self.assertEqual(report["fidelity"]["converted_assets"], 0)
        self.assertIsNone(report["fidelity"]["percentage"])
        self.assertTrue(all(item["status"] == "unsupported" for item in report["inspection"]["capabilities"]))
        with self.assertRaises(NotImplementedError):
            MetadataAdapter().convert("fixture")

    def test_cli_scan_resume_retry_revalidate_report_and_failed_source(self):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(main(["scan", str(self.project), "--workspace", str(self.directory)]), 0)
            self.assertEqual(main(["resume"]), 0)
            for command in ("resume", "revalidate", "report"):
                self.assertEqual(main([command, "--workspace", str(self.directory)]), 0)
            self.assertEqual(main(["retry", "--task", "inventory", "--workspace", str(self.directory)]), 0)
            self.assertEqual(load_state(self.directory)["tasks"]["inventory"]["attempts"], 2)
            self.project.write_text("broken JSON", encoding="utf-8")
            self.assertEqual(main(["revalidate", "--workspace", str(self.directory)]), 2)
        report = read_json(self.directory / "report.json")
        self.assertFalse(report["processing"]["complete"])
        self.assertEqual(report["source_verification_status"], "failed")

    def test_process_lock_prevents_concurrent_mutation(self):
        with workspace_lock(self.directory):
            with self.assertRaises(RuntimeError):
                with workspace_lock(self.directory):
                    pass

    def test_dashboard_reads_state_and_runs_real_cli_action(self):
        self.complete()
        script = Path(__file__).resolve().parents[1] / "ue2three.py"
        process = subprocess.Popen([sys.executable, str(script), "dashboard", "--workspace", str(self.directory), "--port", "0"],
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.addCleanup(lambda: process.poll() is None and process.kill())
        line = process.stdout.readline()
        url = re.search(r"http://127\.0\.0\.1:\d+", line).group()
        def request(path, data=None):
            encoded = json.dumps(data).encode() if data else None
            req = urllib.request.Request(url + path, data=encoded, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=5) as response:
                return response.read().decode()
        page = request("/")
        token = re.search(r"const token='([^']+)'", page).group(1)
        initial = json.loads(request("/api/state"))
        self.assertEqual(len(initial["state"]["tasks"]), 6)
        self.assertEqual(initial["jobs"][0]["id"], self.directory.name)
        with self.assertRaises(urllib.error.HTTPError):
            request("/api/state?job=../../source")
        with self.assertRaises(urllib.error.HTTPError):
            request("/api/action", {"token": "wrong", "action": "retry", "task": "inventory"})
        request("/api/action", {"token": token, "action": "retry", "task": "inventory"})
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            status = json.loads(request("/api/state"))
            if not status["busy"]:
                break
            time.sleep(0.05)
        self.assertEqual(status["exit_code"], 0)
        self.assertEqual(status["state"]["tasks"]["inventory"]["attempts"], 2)
        process.terminate()
        process.communicate(timeout=5)


if __name__ == "__main__":
    unittest.main()
