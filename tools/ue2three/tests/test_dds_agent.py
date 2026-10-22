"""Regression tests for the bounded DDS source-aware agent runner."""
import json
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import dds_agent
from core import digest, file_hash, workspace_lock


class DdsAgentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        self._git('init', '-q')
        self._git('config', 'user.email', 'test@example.invalid')
        self._git('config', 'user.name', 'DDS Agent Tests')
        (self.repo / '.gitignore').write_text('.local/\nbuild/local-scenes/\n', encoding='utf-8')
        (self.repo / 'tracked.txt').write_text('base\n', encoding='utf-8')
        self._git('add', '.gitignore', 'tracked.txt')
        self._git('commit', '-qm', 'test base')

        self.project = self.root / 'licensed-source' / 'VIPExtractionKitDDS.uproject'
        self.project.parent.mkdir(parents=True)
        self.project.write_text('{}', encoding='utf-8')
        self.published = self.repo / 'build' / 'local-scenes' / 'ue2three' / 'projects' / 'DDS-123'
        self.published.mkdir(parents=True)
        self.package = '/Game/DDS/BP_Test'
        self.source_hash = 'a' * 64
        self.bytecode_hash = 'b' * 64
        self.cache_workspace = self.repo / '.local' / 'ue2three' / 'test-lane' / 'jobs' / 'DDS-123'
        cache = self.cache_workspace / 'artifacts' / 'uasset-json' / f'{self.source_hash}.json'
        cache.parent.mkdir(parents=True)
        cache.write_text('{"parsed":true}\n', encoding='utf-8')
        self.parsed_hash = file_hash(cache)
        state = {'config': {'project': str(self.project)}, 'source_verification_status': 'verified'}
        (self.cache_workspace / 'state.json').write_text(json.dumps(state), encoding='utf-8')
        self.witness = {'package': self.package, 'function': 'CanStart', 'export_index': 7,
                        'source_bytecode_sha256': self.bytecode_hash}
        programs = {'schema_version': 1, 'project': str(self.project),
                    'packages': {self.package: {'source': {'source_sha256': self.source_hash,
                                                           'parsed_sha256': self.parsed_hash}}},
                    'missing_cached_packages': []}
        programs['content_sha256'] = digest(programs)
        (self.published / 'blueprint-programs.json').write_text(
            json.dumps(programs, sort_keys=True), encoding='utf-8')
        operation = {'api': '/Script/Engine.KismetSystemLibrary.Delay',
                     'family': 'native-timers', 'adapter_family_present': False,
                     'observed_arities': [1], 'dispatch': ['EX_CallMath'],
                     'observed_in_blocked_functions': [self.witness]}
        packet = (f'# ue2three native adapter task: Timers\n\nProgram version: {programs["content_sha256"]}.\n\n'
                  '## Exact observed native calls and source witnesses\n```json\n'
                  + json.dumps([operation], indent=2) + '\n```\n\n'
                  '## Bounded original function examples\n```json\n[]\n```\n')
        packet_path = self.published / 'work-packets' / 'native-timers.md'
        packet_path.parent.mkdir()
        packet_path.write_text(packet, encoding='utf-8')
        plan = {
            'schema_version': 1,
            'project': str(self.project),
            'programs_content_sha256': programs['content_sha256'],
            'fingerprint': 'c' * 64,
            'functions': [{**self.witness, 'first_blocker': 'Unsupported call'}],
            'native_dependencies': {
                'families': [{'id': 'native-timers', 'blocked_source_functions_involved': 1,
                              'apis_without_known_adapter_family': ['/Script/Engine.KismetSystemLibrary.Delay'],
                              'packet': 'work-packets/native-timers.md'}],
                'operations': [operation],
            },
            'output_sha256': {'work-packets/native-timers.md': file_hash(packet_path)},
        }
        plan['content_sha256'] = digest(plan)
        (self.published / 'blueprint-plan.json').write_text(json.dumps(plan, sort_keys=True), encoding='utf-8')
        self.state_root = self.repo / '.local' / 'ue2three' / 'dds-agent'

    def _git(self, *args, cwd=None):
        result = subprocess.run(['git', '-C', str(cwd or self.repo), *args], check=True,
                                capture_output=True, text=True, encoding='utf-8')
        return result.stdout.strip()

    def _load_state(self):
        return json.loads((self.state_root / 'checkpoint.json').read_text(encoding='utf-8'))

    def _write_state(self, value):
        self.state_root.mkdir(parents=True, exist_ok=True)
        (self.state_root / 'checkpoint.json').write_text(json.dumps(value), encoding='utf-8')

    def _make_four_verified_families(self):
        plan_path = self.published / 'blueprint-plan.json'
        plan = json.loads(plan_path.read_text(encoding='utf-8'))
        original = plan['native_dependencies']['operations'][0]
        for family in ('native-objects', 'native-physics', 'native-animation'):
            operation = {**original, 'family': family, 'api': '/Script/Test.' + family}
            packet = ('# ue2three native adapter task: ' + family + '\n\nProgram version: '
                      + plan['programs_content_sha256'] + '.\n\n'
                      '## Exact observed native calls and source witnesses\n```json\n'
                      + json.dumps([operation]) + '\n```\n\n'
                      '## Bounded original function examples\n```json\n[]\n```\n')
            path = self.published / 'work-packets' / (family + '.md')
            path.write_text(packet, encoding='utf-8')
            plan['output_sha256'][f'work-packets/{family}.md'] = file_hash(path)
            plan['native_dependencies']['families'].append({
                'id': family, 'blocked_source_functions_involved': 1,
                'apis_without_known_adapter_family': [operation['api']],
                'packet': f'work-packets/{family}.md'})
            plan['native_dependencies']['operations'].append(operation)
        plan['content_sha256'] = digest({key: value for key, value in plan.items() if key != 'content_sha256'})
        plan_path.write_text(json.dumps(plan, sort_keys=True), encoding='utf-8')

    def test_dry_run_selects_only_a_verified_source_witness_and_does_not_write(self):
        result = dds_agent.dry_run(self.repo, self.state_root)
        self.assertEqual(result['status'], 'ready')
        self.assertEqual(result['family'], 'native-timers')
        self.assertEqual(result['source_witnesses'], 1)
        self.assertFalse(self.state_root.exists())

    def test_continuous_mode_has_no_session_or_codex_wall_clock_expiry(self):
        self.assertEqual(dds_agent.MAX_RUN_SECONDS, 0)
        self.assertEqual(dds_agent.MAX_CODEX_SECONDS, 0)
        self.assertIsNone(dds_agent._bounded_timeout(0))
        self.assertEqual(dds_agent._bounded_timeout(20), 20)

    def test_usage_limit_is_distinguished_from_adapter_failure(self):
        logs = self.repo / '.local/dds-agent'
        logs.mkdir(parents=True)
        (logs / 'codex-events.jsonl').write_text(json.dumps({
            'type': 'turn.failed', 'error': {'message': 'You have hit your usage limit'}}) + '\n')
        self.assertEqual(dds_agent.codex_failure_kind(self.repo), 'usage_limit')

    def test_account_limit_does_not_exhaust_an_adapter_attempt(self):
        with patch.object(dds_agent, 'run_codex', return_value=1), \
                patch.object(dds_agent, 'codex_failure_kind', return_value='usage_limit'):
            result = dds_agent.run_once(self.repo, self.state_root, 'codex-test-double')
        self.assertEqual(result['error'], 'usage_limit')
        self.assertEqual(self._load_state()['families']['native-timers']['attempts'], 0)
        self.assertEqual(self._load_state()['families']['native-timers']['status'], 'retry_wait')

    def test_prompt_compaction_preserves_complete_structured_records(self):
        operations = [{'api': f'API_{i}', 'observed_in_blocked_functions':
                       [{'package': 'p', 'function': str(n)} for n in range(100)]} for i in range(100)]
        example = {'bytecode': [{'opcode': 'EX_StringConst', 'value': 'source'}]}
        text = '```json\n' + json.dumps(operations) + '\n```\n```json\n' + json.dumps([example]) + '\n```'
        compact = dds_agent.compact_packet(text, 12000)
        self.assertLessEqual(len(compact), 12000)
        value = json.loads(compact)
        self.assertEqual(value['complete_function_examples'], [example])
        self.assertLessEqual(len(value['operations']), 24)

    def test_tampered_plan_packet_or_cache_fails_closed(self):
        plan_path = self.published / 'blueprint-plan.json'
        original = plan_path.read_text(encoding='utf-8')
        altered_plan = json.loads(original)
        altered_plan['fingerprint'] = 'd' * 64
        plan_path.write_text(json.dumps(altered_plan, sort_keys=True), encoding='utf-8')
        with self.assertRaisesRegex(dds_agent.RunnerError, 'checksum'):
            dds_agent.dry_run(self.repo, self.state_root)
        plan_path.write_text(original, encoding='utf-8')

        packet = self.published / 'work-packets' / 'native-timers.md'
        packet.write_text(packet.read_text(encoding='utf-8') + 'tampered\n', encoding='utf-8')
        with self.assertRaisesRegex(dds_agent.RunnerError, 'packet checksum'):
            dds_agent.dry_run(self.repo, self.state_root)
        packet.write_text(packet.read_text(encoding='utf-8').removesuffix('tampered\n'), encoding='utf-8')

        cache = self.cache_workspace / 'artifacts' / 'uasset-json' / f'{self.source_hash}.json'
        cache.write_text('{"changed":true}\n', encoding='utf-8')
        with self.assertRaisesRegex(dds_agent.RunnerError, 'No verified read-only cache'):
            dds_agent.dry_run(self.repo, self.state_root)

    def test_unwitnessed_or_known_adapter_family_is_not_selected(self):
        plan_path = self.published / 'blueprint-plan.json'
        plan = json.loads(plan_path.read_text(encoding='utf-8'))
        plan['native_dependencies']['operations'][0]['observed_in_blocked_functions'][0]['function'] = 'Other'
        plan['content_sha256'] = digest({key: value for key, value in plan.items() if key != 'content_sha256'})
        plan_path.write_text(json.dumps(plan, sort_keys=True), encoding='utf-8')
        self.assertEqual(dds_agent.dry_run(self.repo, self.state_root)['status'], 'no_eligible_family')

    def test_success_runs_only_in_a_detached_worktree_and_waits_for_manual_acceptance(self):
        seen = {}

        def fake_codex(executable, worker, prompt):
            seen['executable'] = executable
            seen['worker'] = worker
            seen['prompt'] = prompt
            self.assertNotEqual(worker.resolve(), self.repo.resolve())
            self.assertEqual(Path(self._git('rev-parse', '--show-toplevel', cwd=worker)).resolve(), worker.resolve())
            self.assertIn('detached, isolated Git worktree', prompt)
            self.assertIn(self.bytecode_hash, prompt)
            return 0

        with patch.object(dds_agent, 'run_codex', side_effect=fake_codex) as run, \
                patch.object(dds_agent, 'verify_worker') as verify:
            result = dds_agent.run_once(self.repo, self.state_root, 'codex-test-double')
        run.assert_called_once()
        verify.assert_called_once_with(seen['worker'], 'native-timers')
        self.assertEqual(result['status'], 'patch_ready_for_review')
        self.assertEqual(result['manual_browser_acceptance'], 'pending')
        self.assertEqual(seen['executable'], 'codex-test-double')
        self.assertNotEqual(seen['worker'].resolve(), self.project.parent.resolve())
        self.assertEqual(self._load_state()['families']['native-timers']['status'], 'patch_ready_for_review')
        self.assertEqual(dds_agent.status(self.repo, self.state_root)['pending_manual_review'], ['native-timers'])
        events = (self.state_root / 'events.jsonl').read_text(encoding='utf-8').splitlines()
        self.assertEqual([json.loads(line)['event'] for line in events], ['attempt_started', 'patch_ready_for_review'])

        with patch.object(dds_agent, 'run_codex', side_effect=AssertionError('cooldown must not run Codex')) as run:
            self.assertEqual(dds_agent.run_once(self.repo, self.state_root)['status'], 'cooldown')
        run.assert_not_called()

    def test_four_real_conversion_slots_overlap_and_keep_independent_checkpoints(self):
        self._make_four_verified_families()
        barrier = threading.Barrier(4, timeout=15)
        seen = []
        lock = threading.Lock()

        def concurrent_codex(executable, worker, prompt):
            with lock:
                seen.append((worker, time.monotonic()))
            barrier.wait()
            self.assertTrue((worker / '.local/dds-agent/source-witness.json').is_file())
            return 0

        with patch.object(dds_agent, 'run_codex', side_effect=concurrent_codex), \
                patch.object(dds_agent, 'verify_worker') as verify:
            result = dds_agent.run_many(self.repo, self.state_root, 'codex-test-double', max_workers=4)
        self.assertEqual(result['status'], 'parallel_batch_finished')
        self.assertEqual(result['workers_started'], 4)
        self.assertEqual(len({path for path, _ in seen}), 4)
        self.assertLess(max(start for _, start in seen) - min(start for _, start in seen), 15)
        self.assertEqual(verify.call_count, 4)
        checkpoint = self._load_state()
        self.assertEqual(len(checkpoint['families']), 4)
        self.assertEqual({row['lane'] for row in checkpoint['families'].values()}, {1, 2, 3, 4})
        for family, row in checkpoint['families'].items():
            self.assertEqual(row['status'], 'patch_ready_for_review')
            heartbeat = dds_agent._read_heartbeat(self.state_root / 'heartbeats' / family / 'heartbeat.json')
            self.assertEqual(heartbeat['status'], 'idle')
        with patch.object(dds_agent, 'run_codex', side_effect=AssertionError('no duplicate run')):
            self.assertEqual(dds_agent.run_many(self.repo, self.state_root, 'codex-test-double')['status'], 'cooldown')

    def test_new_head_reopens_only_no_gain_reviews_once_and_retains_attempt_history(self):
        current_head = self._git('rev-parse', 'HEAD')
        old_head = 'a' * 40
        checkpoint = dds_agent._default_checkpoint()
        checkpoint['families'] = {
            'native-timers': {'status': 'needs_review', 'result': 'no_proven_conversion_gain',
                              'attempts': 3, 'base_head': old_head},
            'native-physics': {'status': 'needs_review', 'result': 'reconciliation_conflict',
                               'attempts': 1, 'base_head': old_head},
            'native-math': {'status': 'integrated', 'result': 'no_proven_conversion_gain',
                            'attempts': 1, 'base_head': old_head}}
        self.assertEqual(dds_agent._reopen_reviews_for_new_head(checkpoint, current_head), ['native-timers'])
        item = checkpoint['families']['native-timers']
        self.assertEqual((item['status'], item['attempts'], item['lifetime_attempts']),
                         ('pending_new_revision', 0, 3))
        item['status'] = 'needs_review'
        self.assertEqual(dds_agent._reopen_reviews_for_new_head(checkpoint, current_head), [])
        self.assertEqual(checkpoint['families']['native-physics']['status'], 'needs_review')
        self.assertEqual(checkpoint['families']['native-math']['status'], 'integrated')

    def test_retry_count_is_bounded_and_failed_worktree_is_reused(self):
        workers = []

        def failed_codex(executable, worker, prompt):
            workers.append(worker.resolve())
            return 1

        with patch.object(dds_agent, 'run_codex', side_effect=failed_codex) as run:
            for expected in ('retry_wait', 'retry_wait', 'exhausted'):
                checkpoint = self._load_state() if (self.state_root / 'checkpoint.json').exists() else dds_agent._default_checkpoint()
                checkpoint['last_attempt_epoch'] = 0
                record = checkpoint.get('families', {}).get('native-timers')
                if record:
                    record['retry_after'] = 0
                self._write_state(checkpoint)
                result = dds_agent.run_once(self.repo, self.state_root, 'codex-test-double')
                self.assertEqual(result['status'], expected)
            self.assertEqual(run.call_count, dds_agent.MAX_ATTEMPTS)
        self.assertEqual(len(set(workers)), 1)
        self.assertEqual(self._load_state()['families']['native-timers']['attempts'], dds_agent.MAX_ATTEMPTS)

    def test_validation_failure_never_marks_a_patch_ready(self):
        with patch.object(dds_agent, 'run_codex', return_value=0), \
                patch.object(dds_agent, 'verify_worker',
                             side_effect=dds_agent.RunnerError('validation failed', 'verification_failed')):
            result = dds_agent.run_once(self.repo, self.state_root, 'codex-test-double')
        self.assertEqual(result['status'], 'retry_wait')
        self.assertEqual(result['error'], 'verification_failed')
        self.assertEqual(dds_agent.status(self.repo, self.state_root)['pending_manual_review'], [])

    def test_fresh_heartbeat_and_disk_guard_block_codex(self):
        self.state_root.mkdir(parents=True, exist_ok=True)
        dds_agent._atomic_json(self.state_root / 'heartbeat.json', {
            'status': 'running', 'updated_epoch': time_now(), 'run_id': 'other-run', 'schema_version': 1,
        })
        with patch.object(dds_agent, 'run_codex', side_effect=AssertionError('heartbeat must block')) as run:
            with self.assertRaisesRegex(dds_agent.RunnerError, 'heartbeat is already active'):
                dds_agent.run_once(self.repo, self.state_root, 'codex-test-double')
        run.assert_not_called()
        (self.state_root / 'heartbeat.json').unlink()
        with patch.object(dds_agent.shutil, 'disk_usage', return_value=SimpleNamespace(free=1)), \
                patch.object(dds_agent, 'run_codex', side_effect=AssertionError('disk guard must block')) as run:
            with self.assertRaisesRegex(dds_agent.RunnerError, 'below the runner reserve'):
                dds_agent.run_once(self.repo, self.state_root, 'codex-test-double')
        run.assert_not_called()
        self.assertFalse((self.state_root / 'worktrees' / 'native-timers').exists())

    def test_repository_must_be_clean_and_state_must_stay_under_checkout(self):
        changed = self.repo / 'tracked.txt'
        changed.write_text('dirty\n', encoding='utf-8')
        with patch.object(dds_agent, 'run_codex', side_effect=AssertionError('dirty repo must block')) as run:
            with self.assertRaisesRegex(dds_agent.RunnerError, 'must be clean'):
                dds_agent.run_once(self.repo, self.state_root, 'codex-test-double')
        run.assert_not_called()
        changed.write_text('base\n', encoding='utf-8')
        with self.assertRaisesRegex(dds_agent.RunnerError, 'must stay under'):
            dds_agent.run_once(self.repo, self.root / 'outside-state', 'codex-test-double')

    def test_process_lock_prevents_a_second_tick_from_overlapping(self):
        self.state_root.mkdir(parents=True, exist_ok=True)
        with workspace_lock(self.state_root):
            with patch.object(dds_agent, 'run_codex', side_effect=AssertionError('lock must prevent Codex')) as run:
                with self.assertRaisesRegex(dds_agent.RunnerError, 'already owns the process lock'):
                    dds_agent.run_once(self.repo, self.state_root, 'codex-test-double')
        run.assert_not_called()

    def test_validation_uses_family_scoped_python_javascript_and_diff_checks(self):
        with patch.object(dds_agent.shutil, 'which', return_value='node-test-double'), \
                patch.object(dds_agent.subprocess, 'run',
                             return_value=SimpleNamespace(returncode=0)) as run:
            dds_agent.verify_worker(self.repo, 'native-timers')
        self.assertEqual(run.call_count, 3)
        python_command = run.call_args_list[0].args[0]
        javascript_command = run.call_args_list[1].args[0]
        diff_command = run.call_args_list[2].args[0]
        self.assertEqual(python_command[0], sys.executable)
        self.assertIn('test_blueprint*.py', python_command)
        self.assertEqual(javascript_command[0:3], ['node-test-double', '--test',
                                                   'tests/ue2three-blueprint.test.mjs'])
        self.assertNotIn('tests/ue2three-attachment.test.mjs', javascript_command)
        self.assertEqual(diff_command[-2:], ['diff', '--check'])


def time_now():
    import time
    return time.time()


if __name__ == '__main__':
    unittest.main()
