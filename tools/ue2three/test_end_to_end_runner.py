"""Offline smoke tests for bounded ue2three orchestration."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from end_to_end_runner import execute


class RunnerTests(unittest.TestCase):
    def test_rejects_missing_project(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            with self.assertRaises(ValueError):
                execute(base / "missing.uproject", base / "w", base / "p", base / "s")

    def test_checkpoint_on_failed_migration(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            project = base / "source" / "demo.uproject"
            project.parent.mkdir()
            project.write_text("{}", encoding="utf-8")
            from subprocess import CompletedProcess
            with patch("end_to_end_runner.subprocess.run",
                       return_value=CompletedProcess([], 3, "", "fixture failure")):
                result = execute(project, base / "w", base / "p", base / "s")
            self.assertEqual(result["status"], "blocked")
            self.assertEqual(result["steps"][0]["exit_code"], 3)
            checkpoint = json.loads((base / "s" / "execution-checkpoint.json").read_text())
            self.assertEqual(checkpoint["status"], "blocked")
            self.assertFalse((base / "s" / "runner.lock").exists())

    def test_no_overlapping_runs(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            project = base / "source" / "demo.uproject"
            project.parent.mkdir()
            project.write_text("{}", encoding="utf-8")
            state = base / "s"
            state.mkdir()
            (state / "runner.lock").write_text("occupied")
            with self.assertRaises(RuntimeError):
                execute(project, base / "w", base / "p", state)


if __name__ == "__main__":
    unittest.main()
