"""Independent source-witnessed exports must survive a Codex account backoff."""

import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import dds_automation as automation


class IndependentStageRetryTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name) / "repo"
        self.root.mkdir()
        project = Path(directory.name) / "Unreal" / "DDS.uproject"
        project.parent.mkdir()
        project.write_text("{}", encoding="utf-8")
        workspace = self.root / ".local/ue2three/jobs/DDS"
        workspace.mkdir(parents=True)
        self.supervisor = automation.Supervisor({
            "project": str(project), "workspace": str(workspace),
            "publish_dir": str(self.root / "build/local-scenes/ue2three/projects/DDS")},
            self.root)

    def test_waiting_account_keeps_independent_stages_running(self):
        self.supervisor.save("waiting_account", retry_after=time.time() + 600,
                             waiting_reason="usage_limit")
        with patch.object(self.supervisor, "additional_stages") as stages:
            result = self.supervisor.tick()
        stages.assert_called_once()
        self.assertEqual(result["phase"], "retry_wait")
        self.assertIsNone(result["independent_stage_error"])
        self.assertEqual(self.supervisor.state["phase"], "waiting_account")

    def test_independent_stage_failure_preserves_account_backoff(self):
        self.supervisor.save("waiting_connection", retry_after=time.time() + 600,
                             waiting_reason="connection_interrupted")
        with patch.object(self.supervisor, "additional_stages",
                          side_effect=RuntimeError("asset export failed")):
            result = self.supervisor.tick()
        self.assertEqual(result["phase"], "retry_wait")
        self.assertIn("asset export failed", result["independent_stage_error"])
        self.assertEqual(self.supervisor.state["phase"], "waiting_connection")

    def test_generic_failure_backoff_does_not_start_independent_stages(self):
        self.supervisor.save("failed", retry_after=time.time() + 600)
        with patch.object(self.supervisor, "additional_stages") as stages:
            result = self.supervisor.tick()
        stages.assert_not_called()
        self.assertEqual(result["phase"], "retry_wait")

    def test_usage_limit_runs_stages_before_waiting(self):
        self.supervisor.state["compiled_fingerprint"] = automation.fingerprint(self.root)
        self.supervisor.config["codex_executable"] = "codex-test-double"
        with patch.object(automation.agent, "_require_clean_repo", return_value="a" * 40), \
             patch.object(automation.agent, "_disk_guard"), \
             patch.object(self.supervisor, "ensure_dependencies"), \
             patch.object(self.supervisor, "command"), \
             patch.object(self.supervisor, "additional_stages") as stages, \
             patch.object(automation.agent, "run_many", return_value={
                 "status": "parallel_batch_finished", "results": [
                     {"family": "native-timers", "status": "retry_wait",
                      "result": "usage_limit"}]}):
            result = self.supervisor.tick()
        stages.assert_called_once()
        self.assertEqual(result["phase"], "waiting_account")


if __name__ == "__main__":
    unittest.main()
