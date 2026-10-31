"""DDS scheduled-task console suppression and durable log regressions."""
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import dds_hidden_entry


class HiddenEntryTests(unittest.TestCase):
    def test_hidden_entry_redirects_both_streams_and_preserves_exit_code(self):
        with tempfile.TemporaryDirectory() as folder:
            log = Path(folder) / 'dds-task.log'
            def tick(argv):
                print('SOURCE_WITNESS_REPLAY_START', argv)
                print('DDS_STDERR_CAPTURED', file=sys.stderr)
                return 7
            with patch.dict(sys.modules, {'dds_automation': SimpleNamespace(main=tick)}):
                self.assertEqual(dds_hidden_entry.main(['--once'], log_path=log), 7)
            content = log.read_text(encoding='utf-8')
            self.assertIn('DDS_HIDDEN_TICK', content)
            self.assertIn("SOURCE_WITNESS_REPLAY_START ['--once']", content)
            self.assertIn('DDS_STDERR_CAPTURED', content)

    def test_hidden_entry_logs_failure_instead_of_losing_pythonw_traceback(self):
        with tempfile.TemporaryDirectory() as folder:
            log = Path(folder) / 'dds-task.log'
            def fail(argv):
                raise RuntimeError('source adapter failure retained')
            with patch.dict(sys.modules, {'dds_automation': SimpleNamespace(main=fail)}):
                self.assertEqual(dds_hidden_entry.main(['--once'], log_path=log), 1)
            self.assertIn('RuntimeError: source adapter failure retained',
                          log.read_text(encoding='utf-8'))

    def test_installer_refuses_console_python_and_uses_pythonw_for_scheduler(self):
        script = (Path(__file__).resolve().parents[1] / 'install_dds_automation.ps1').read_text(encoding='utf-8')
        self.assertIn("'pythonw.exe'", script)
        self.assertIn('refusing a visible-console DDS task', script)
        self.assertIn('New-ScheduledTaskAction -Execute $pythonw', script)
        self.assertNotIn('New-ScheduledTaskAction -Execute $python -Argument', script)
        self.assertIn("'dds_hidden_entry.py'", script)
        # Existing tasks are never silently replaced while DDS may be running.
        self.assertIn("if ($existing)", script)
        self.assertIn('already exists. Inspect it before replacing', script)


if __name__ == '__main__':
    unittest.main()
