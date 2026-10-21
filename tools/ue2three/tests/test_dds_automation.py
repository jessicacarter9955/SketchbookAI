"""Supervisor regression checks; real Codex authentication is a separate smoke run."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import dds_automation as automation


class AutomationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.root = base / 'repo'
        self.root.mkdir()
        project = base / 'Unreal' / 'DDS.uproject'
        project.parent.mkdir()
        project.write_text('{}')
        workspace = self.root / '.local/ue2three/jobs/DDS'
        workspace.mkdir(parents=True)
        self.config = {'project': str(project), 'workspace': str(workspace),
                       'publish_dir': str(self.root / 'build/local-scenes/ue2three/projects/DDS')}
        self.supervisor = automation.Supervisor(self.config, self.root)

    def test_fingerprint_includes_native_math_and_all_python_modules(self):
        (self.root / 'tools/ue2three').mkdir(parents=True)
        (self.root / 'src/editor').mkdir(parents=True)
        p = self.root / 'src/editor/ue2three-native-math.mjs'
        p.write_text('before')
        before = automation.fingerprint(self.root)
        p.write_text('after')
        self.assertNotEqual(before, automation.fingerprint(self.root))
        before = automation.fingerprint(self.root)
        (self.root / 'tools/ue2three/blueprint_new_helper.py').write_text('new')
        self.assertNotEqual(before, automation.fingerprint(self.root))

    def test_source_overlap_is_rejected(self):
        config = {**self.config, 'publish_dir': str(Path(self.config['project']).parent / 'output')}
        with self.assertRaisesRegex(ValueError, 'outside the source'):
            automation.validate_config(config, self.root)

    def test_error_is_durable_and_next_tick_backs_off(self):
        with patch.object(automation.agent, '_require_clean_repo', side_effect=RuntimeError('dirty')):
            with self.assertRaisesRegex(RuntimeError, 'dirty'):
                self.supervisor.tick()
        saved = json.loads(self.supervisor.state_path.read_text())
        self.assertEqual(saved['phase'], 'failed')
        self.assertEqual(saved['error'], 'dirty')
        with patch.object(automation.agent, '_require_clean_repo', side_effect=AssertionError('must back off')):
            self.assertEqual(self.supervisor.tick()['phase'], 'retry_wait')
        self.assertIn('dirty', (Path(self.config['publish_dir']) / 'automation.html').read_text())

    def test_session_budget_stops_new_agent_calls(self):
        self.supervisor.state['started_epoch'] = 0
        with patch.object(automation.agent, 'run_once', side_effect=AssertionError('budget must block')):
            self.assertEqual(self.supervisor.tick()['phase'], 'session_budget_reached')

    def test_replay_requires_same_sources_and_preserves_translated_functions(self):
        before = {'project': 'DDS', 'counts': {'translated': 1, 'blocked': 2},
                  'packages': {'A': {'source': {'sha': 'same'}, 'functions': {'existing': {}}}}}
        after = {'project': 'DDS', 'counts': {'translated': 2, 'blocked': 1},
                 'packages': {'A': {'source': {'sha': 'same'}, 'functions': {'existing': {}, 'new': {}}}}}
        self.assertTrue(automation.replay_improves(before, after))
        after['packages']['A']['functions'].pop('existing')
        self.assertFalse(automation.replay_improves(before, after))
        after['packages']['A']['functions']['existing'] = {}
        after['packages']['A']['source']['sha'] = 'different'
        self.assertFalse(automation.replay_improves(before, after))

    def test_stages_are_cached_and_require_real_outputs(self):
        source = self.root / 'input.json'
        output = self.root / 'output.json'
        source.write_text('{}')
        self.supervisor.config['deploy_command'] = {
            'argv': ['example-tool'], 'inputs': [str(source)], 'outputs': [str(output)]}
        with patch.object(self.supervisor, 'command', side_effect=lambda *a, **k: output.write_text('ok')) as run:
            self.supervisor.additional_stages()
            self.supervisor.additional_stages()
            self.assertEqual(run.call_count, 1)
        output.unlink()
        with patch.object(self.supervisor, 'command'):
            with self.assertRaisesRegex(RuntimeError, 'outputs are missing'):
                self.supervisor.additional_stages()

    def test_missing_stages_are_not_claimed_as_completed(self):
        self.supervisor.additional_stages()
        self.assertEqual(self.supervisor.state['additional_stages']['deploy_command'], 'not_configured')


if __name__ == '__main__':
    unittest.main()
