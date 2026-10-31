"""Supervisor regression checks; real Codex authentication is a separate smoke run."""
import json
from pathlib import Path
import subprocess
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

    def test_blueprint_patch_scope_preserves_assets_and_accepts_root_regression_tests(self):
        allowed = (
            'tools/ue2three/blueprint_migration.py',
            'tools/ue2three/test_blueprint_audio_vfx.py',
            'tools/ue2three/test_blueprint_physics.py',
            'tools/ue2three/tests/test_blueprint_cache.py',
            'src/editor/ue2three-blueprint-runtime.mjs',
            'tests/ue2three-native-physics.test.mjs',
            'docs/ue2three-blueprint-checkpoint-20261030.md',
        )
        rejected = (
            '', '../tools/ue2three/blueprint_migration.py',
            'tools/ue2three/test_blueprint_x.py/../../reference.png',
            'tools/ue2three/dds_agent.py',
            'docs/original-reference.png',
            'docs/original-reference.svg',
            'assets/Unreal/Source.uasset',
            'img2three/AGENTS.md',
        )
        for item in allowed:
            with self.subTest(allowed=item):
                self.assertTrue(automation.blueprint_patch_in_scope(item))
        for item in rejected:
            with self.subTest(rejected=item):
                self.assertFalse(automation.blueprint_patch_in_scope(item))

    def test_recover_retained_scope_rejection_requires_real_patch_verification(self):
        worktree = self.root / '.local/ue2three/dds-agent/worktrees/native-audio-vfx'
        worktree.mkdir(parents=True)
        checkpoint = {'families': {'native-audio-vfx': {
            'status': 'needs_review', 'result': 'empty_or_out_of_scope_patch',
            'worktree_path': str(worktree)}}}

        def git_result(_root, *args):
            if args[0] == 'rev-parse':
                return 'verified-head'
            if args[0] == 'diff':
                return 'tools/ue2three/blueprint_migration.py'
            if args[0] == 'ls-files':
                return 'tools/ue2three/test_blueprint_audio_vfx.py'
            raise AssertionError(args)

        with patch.object(automation.agent, '_git', side_effect=git_result), \\
                patch.object(automation.agent, 'verify_worker') as verify, \\
                patch.object(automation.agent, '_checkpoint_event'):
            self.assertEqual(
                self.supervisor.recover_retained_verification_patches(checkpoint),
                ['native-audio-vfx'])
            verify.assert_called_once_with(worktree, 'native-audio-vfx')
        row = checkpoint['families']['native-audio-vfx']
        self.assertEqual(row['status'], 'patch_ready_for_review')
        self.assertEqual(row['result'], 'historical_patch_revalidated')
        self.assertEqual(row['recovery_probe_head'], 'verified-head')

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
        self.supervisor.config['session_seconds'] = 7200
        self.supervisor.state['started_epoch'] = 0
        with patch.object(automation.agent, 'run_many', side_effect=AssertionError('budget must block')):
            self.assertEqual(self.supervisor.tick()['phase'], 'session_budget_reached')

    def test_zero_session_budget_does_not_expire_even_after_days(self):
        self.supervisor.config['session_seconds'] = 0
        self.supervisor.state['started_epoch'] = 0
        with patch.object(automation.agent, '_require_clean_repo', side_effect=RuntimeError('reached actual work')):
            with self.assertRaisesRegex(RuntimeError, 'reached actual work'):
                self.supervisor.tick()

    def test_usage_limit_pauses_the_whole_agent_queue(self):
        self.supervisor.state['compiled_fingerprint'] = automation.fingerprint(self.root)
        self.supervisor.config['codex_executable'] = 'codex-test-double'
        with patch.object(automation.agent, '_require_clean_repo', return_value='a' * 40), \
                patch.object(automation.agent, '_disk_guard'), \
                patch.object(self.supervisor, 'ensure_dependencies'), \
                patch.object(self.supervisor, 'command'), \
                patch.object(automation.agent, 'run_many', return_value={
                    'status': 'parallel_batch_finished', 'results': [
                        {'family': 'native-timers', 'status': 'retry_wait', 'result': 'usage_limit'}]}):
            result = self.supervisor.tick()
        self.assertEqual(result['phase'], 'waiting_account')
        self.assertEqual(result['waiting_reason'], 'usage_limit')
        self.assertGreater(result['retry_after'], 0)

    def test_parallel_configuration_defaults_to_four_and_rejects_overcommit(self):
        self.assertEqual(self.supervisor.config['parallel_workers'], 4)
        with self.assertRaisesRegex(ValueError, 'parallel_workers'):
            automation.Supervisor({**self.config, 'parallel_workers': 5}, self.root)

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

    def git(self, *args, cwd=None):
        return subprocess.check_output(['git', *args], cwd=cwd or self.root,
                                       text=True, stderr=subprocess.PIPE).strip()

    def git_fixture(self):
        branch = 'chatgpt/ue2three-dds'
        remote = Path(self.temp.name) / 'remote.git'
        self.git('init', '--bare', '--initial-branch', branch, str(remote))
        self.git('init', '--initial-branch', branch, str(self.root))
        self.git('config', 'user.name', 'Automation Test')
        self.git('config', 'user.email', 'automation@example.test')
        (self.root / '.gitignore').write_text('.local/\nbuild/\n')
        (self.root / 'shared.txt').write_text('base\n')
        self.git('add', '.gitignore', 'shared.txt')
        self.git('commit', '-m', 'base')
        self.git('remote', 'add', 'origin', str(remote))
        self.git('push', '-u', 'origin', branch)
        concurrent = Path(self.temp.name) / 'concurrent'
        self.git('clone', '--branch', branch, str(remote), str(concurrent))
        self.git('config', 'user.name', 'Other Author', cwd=concurrent)
        self.git('config', 'user.email', 'other@example.test', cwd=concurrent)
        self.supervisor.config.update(push=True, branch=branch)
        return remote, concurrent, branch

    def commit_file(self, repo: Path, name: str, content: str):
        path = repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        self.git('add', '--', name, cwd=repo)
        self.git('commit', '-m', 'modify ' + name, cwd=repo)

    def test_opt_in_remote_sync_fast_forwards_and_invalidates_compiled_checkpoint(self):
        remote, concurrent, branch = self.git_fixture()
        self.supervisor.config['sync_remote_branch'] = branch
        self.commit_file(concurrent, 'docs/remote-update.txt', 'new source implementation\n')
        self.git('push', 'origin', branch, cwd=concurrent)
        expected = self.git('rev-parse', 'HEAD', cwd=concurrent)
        self.supervisor.state['compiled_fingerprint'] = 'outdated'
        self.assertTrue(self.supervisor.sync_remote())
        self.assertEqual(self.git('rev-parse', 'HEAD'), expected)
        self.assertIsNone(self.supervisor.state['compiled_fingerprint'])
        self.assertEqual(self.supervisor.state['synced_remote_commit'], expected)
        self.assertFalse(self.supervisor.sync_remote())

    def test_remote_sync_never_discards_divergent_local_history(self):
        remote, concurrent, branch = self.git_fixture()
        self.supervisor.config['sync_remote_branch'] = branch
        self.commit_file(self.root, 'docs/local.txt', 'unpublished local\n')
        local = self.git('rev-parse', 'HEAD')
        self.commit_file(concurrent, 'docs/remote.txt', 'remote work\n')
        self.git('push', 'origin', branch, cwd=concurrent)
        self.assertFalse(self.supervisor.sync_remote())
        self.assertEqual(self.git('rev-parse', 'HEAD'), local)
        self.assertEqual(self.supervisor.state['phase'], 'source_sync_needs_review')
        self.assertEqual(self.git('status', '--porcelain'), '')

    def test_remote_sync_does_not_fetch_dirty_checkout_or_pending_push(self):
        _, concurrent, branch = self.git_fixture()
        self.supervisor.config['sync_remote_branch'] = branch
        self.supervisor.state['pending_push'] = True
        with patch.object(self.supervisor, 'command', side_effect=AssertionError('pending push must not fetch')):
            self.assertFalse(self.supervisor.sync_remote())
        self.supervisor.state['pending_push'] = False
        (self.root / 'user-work.txt').write_text('keep user changes\n')
        with patch.object(self.supervisor, 'command', side_effect=AssertionError('dirty checkout must not fetch')):
            with self.assertRaises(automation.agent.RunnerError):
                self.supervisor.sync_remote()
        self.assertTrue((self.root / 'user-work.txt').exists())

    def test_remote_sync_requires_explicit_branch_and_matching_push(self):
        with self.assertRaisesRegex(ValueError, 'same branch'):
            automation.validate_config({**self.config, 'push': True, 'branch': 'main',
                                       'sync_remote_branch': 'chatgpt/ue2three-dds'}, self.root)
        with self.assertRaisesRegex(ValueError, 'sync_remote_branch'):
            automation.validate_config({**self.config, 'sync_remote_branch': 'main..bad'}, self.root)

    def test_disjoint_remote_commit_is_merged_verified_and_pushed(self):
        remote, concurrent, branch = self.git_fixture()
        self.commit_file(self.root, 'docs/local.txt', 'local\n')
        self.commit_file(concurrent, 'src/remote.txt', 'remote\n')
        self.git('push', 'origin', branch, cwd=concurrent)
        self.supervisor.save('integrated', pending_push=True)
        with patch.object(self.supervisor, '_validate_reconciled_push') as validate:
            self.supervisor.pending_push()
        validate.assert_called_once_with()
        merged = self.git('rev-parse', 'HEAD')
        self.assertEqual(merged, self.git('rev-parse', 'refs/heads/' + branch, cwd=remote))
        self.assertEqual(len(self.git('rev-list', '--parents', '-n', '1', 'HEAD').split()), 3)
        self.assertFalse(self.supervisor.state['pending_push'])
        self.assertIsNone(self.supervisor.state['push_blocker'])

    def test_same_path_remote_divergence_needs_review_without_git_mutation(self):
        remote, concurrent, branch = self.git_fixture()
        self.commit_file(self.root, 'shared.txt', 'local\n')
        self.commit_file(concurrent, 'shared.txt', 'remote\n')
        self.git('push', 'origin', branch, cwd=concurrent)
        local_head = self.git('rev-parse', 'HEAD')
        remote_head = self.git('rev-parse', 'refs/heads/' + branch, cwd=remote)
        self.supervisor.save('integrated', pending_push=True)
        with patch.object(automation.agent, 'run_many', side_effect=AssertionError('must not run')):
            self.assertEqual(self.supervisor.tick()['phase'], 'push_needs_review')
        self.assertIn('shared.txt', self.supervisor.state['push_blocker'])
        self.assertEqual(self.git('rev-parse', 'HEAD'), local_head)
        self.assertEqual(self.git('rev-parse', 'refs/heads/' + branch, cwd=remote), remote_head)
        self.assertEqual(self.git('status', '--porcelain'), '')
        # A blocked tick may now fetch read-only to detect a separately
        # published resolution, but it must still preserve divergent work.
        self.assertEqual(self.supervisor.tick()['phase'], 'push_needs_review')
        self.assertEqual(self.git('rev-parse', 'HEAD'), local_head)

    def test_stale_push_blocker_recovers_when_exact_local_commit_was_published(self):
        remote, _, branch = self.git_fixture()
        self.commit_file(self.root, 'docs/local.txt', 'locally verified change\n')
        published = self.git('rev-parse', 'HEAD')
        # A previous push could have reached GitHub despite a lost response.
        self.git('push', 'origin', branch)
        self.supervisor.save('push_needs_review', pending_push=True,
                             push_blocker='Previous transport outcome was ambiguous',
                             compiled_fingerprint='old')
        self.supervisor.pending_push()
        self.assertFalse(self.supervisor.state['pending_push'])
        self.assertIsNone(self.supervisor.state['push_blocker'])
        self.assertIsNone(self.supervisor.state['compiled_fingerprint'])
        self.assertEqual(self.git('rev-parse', 'HEAD'), published)
        self.assertEqual(self.supervisor.state['pushed_commit'], published)

    def test_stale_push_blocker_fast_forwards_only_if_remote_contains_local(self):
        remote, concurrent, branch = self.git_fixture()
        self.commit_file(self.root, 'docs/local.txt', 'locally verified change\n')
        local = self.git('rev-parse', 'HEAD')
        self.git('push', 'origin', branch)
        self.git('pull', '--ff-only', 'origin', branch, cwd=concurrent)
        self.commit_file(concurrent, 'docs/remote.txt', 'later remote change\n')
        self.git('push', 'origin', branch, cwd=concurrent)
        published = self.git('rev-parse', 'HEAD', cwd=concurrent)
        self.supervisor.save('push_needs_review', pending_push=True,
                             push_blocker='Old conflict already resolved elsewhere')
        self.supervisor.pending_push()
        self.assertNotEqual(local, published)
        self.assertEqual(self.git('rev-parse', 'HEAD'), published)
        self.assertFalse(self.supervisor.state['pending_push'])
        self.assertIsNone(self.supervisor.state['push_blocker'])
        self.assertIsNone(self.supervisor.state['compiled_fingerprint'])
        self.assertEqual(self.git('status', '--porcelain'), '')

    def test_remote_already_contains_local_without_blocker_does_not_merge_again(self):
        remote, concurrent, branch = self.git_fixture()
        self.commit_file(self.root, 'docs/local.txt', 'locally verified change\n')
        self.git('push', 'origin', branch)
        self.git('pull', '--ff-only', 'origin', branch, cwd=concurrent)
        self.commit_file(concurrent, 'docs/remote.txt', 'new remote change\n')
        self.git('push', 'origin', branch, cwd=concurrent)
        expected = self.git('rev-parse', 'HEAD', cwd=concurrent)
        self.supervisor.save('integrated', pending_push=True)
        self.supervisor.pending_push()
        self.assertEqual(self.git('rev-parse', 'HEAD'), expected)
        self.assertEqual(len(self.git('rev-list', '--parents', '-n', '1', 'HEAD').split()), 2)
        self.assertFalse(self.supervisor.state['pending_push'])

    def test_dirty_checkout_never_fetches_or_pushes(self):
        _, _, _ = self.git_fixture()
        (self.root / 'untracked.txt').write_text('user work')
        self.supervisor.save('integrated', pending_push=True)
        with patch.object(self.supervisor, 'command', side_effect=AssertionError('Git fetch must not run')):
            with self.assertRaisesRegex(automation.agent.RunnerError, 'clean'):
                self.supervisor.pending_push()
        self.assertTrue((self.root / 'untracked.txt').exists())

    def test_remote_race_fails_once_then_recovers_on_next_tick(self):
        remote, concurrent, branch = self.git_fixture()
        self.commit_file(self.root, 'local.txt', 'original local commit\n')
        self.supervisor.save('integrated', pending_push=True)
        real_command = self.supervisor.command
        raced = []

        def remote_advances_before_push(name, args, **kwargs):
            if name == 'git-push' and not raced:
                raced.append(True)
                self.commit_file(concurrent, 'remote.txt', 'racing remote commit\n')
                self.git('push', 'origin', branch, cwd=concurrent)
            return real_command(name, args, **kwargs)

        with patch.object(self.supervisor, 'command', side_effect=remote_advances_before_push):
            with self.assertRaisesRegex(RuntimeError, 'git-push'):
                self.supervisor.pending_push()
        self.assertTrue(self.supervisor.state['pending_push'])
        self.assertEqual(self.git('rev-parse', 'HEAD^'), self.git('rev-parse', branch + '~1', cwd=remote))
        with patch.object(self.supervisor, '_validate_reconciled_push') as validate:
            self.supervisor.pending_push()
        validate.assert_called_once_with()
        self.assertFalse(self.supervisor.state['pending_push'])
        self.assertEqual(self.git('rev-parse', 'HEAD'),
                         self.git('rev-parse', 'refs/heads/' + branch, cwd=remote))

    def test_validation_checks_python_and_node_and_records_commit(self):
        self.git_fixture()
        path = self.root / 'tests/ue2three-test.test.mjs'
        path.parent.mkdir(parents=True)
        path.write_text('test()')
        self.git('add', 'tests/ue2three-test.test.mjs')
        self.git('commit', '-m', 'add test')
        self.supervisor.state['push_validation_required'] = True
        with patch.object(self.supervisor, 'command') as command, \
                patch.object(automation.shutil, 'which', return_value='node'):
            self.supervisor._validate_reconciled_push()
        self.assertEqual([call.args[0] for call in command.call_args_list],
                         ['git-reconcile-python-tests', 'git-reconcile-node-tests'])
        self.assertIn('tests/ue2three-test.test.mjs', command.call_args_list[1].args[1])
        self.assertFalse(self.supervisor.state['push_validation_required'])
        self.assertEqual(self.supervisor.state['validated_push_head'], self.git('rev-parse', 'HEAD'))


if __name__ == '__main__':
    unittest.main()
