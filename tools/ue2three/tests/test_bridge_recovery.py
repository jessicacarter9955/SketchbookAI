import json
from http.client import IncompleteRead
from urllib.error import HTTPError
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bridge_recovery import Recovery, install_job_listing


class Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.bodies = []
        self.posts = []
        self.fail_post = False
        self.get_failures = 0
        self.routes = []
        test = self

        class BridgeError(Exception):
            pass

        class GitHub:
            def call(self, method, route, payload=None):
                test.routes.append(route)
                if test.get_failures:
                    test.get_failures -= 1
                    raise IncompleteRead(b'partial', 7)
                if '/comments?' in route:
                    return [{'body': body, 'updated_at': '2026-10-21T16:00:00Z'} for body in test.bodies]
                return {'ok': True}

            def comments(self, repo, issue):
                yield from ({'body': body} for body in test.bodies)

            def comment(self, repo, issue, body):
                test.posts.append(body)
                if test.fail_post:
                    raise IncompleteRead(b'partial', 7)
                test.bodies.append(body)
                return {'id': 1}

        self.bridge = SimpleNamespace(CONFIG_DIR=Path(self.temp.name), GitHub=GitHub, BridgeError=BridgeError)
        self.recovery = Recovery(self.bridge, sleep=lambda _: None)
        self.recovery.install()
        self.client = GitHub()

    def test_partial_get_retries_without_crashing_bridge(self):
        self.get_failures = 2
        self.assertEqual(self.client.call('GET', '/example'), {'ok': True})

    def test_exhausted_network_becomes_a_handled_bridge_error(self):
        self.get_failures = 5
        with self.assertRaises(self.bridge.BridgeError):
            self.client.call('GET', '/example')

    def test_failed_response_is_durable_and_retried_without_running_command(self):
        self.fail_post = True
        with self.assertRaises(IncompleteRead):
            self.client.comment('private/relay', 1, 'result-id-1')
        self.assertEqual(len(list(self.recovery.outbox.glob('*.json'))), 1)
        self.fail_post = False
        list(self.client.comments('private/relay', 1))
        self.assertEqual(self.bodies, ['result-id-1'])
        self.assertFalse(list(self.recovery.outbox.glob('*.json')))

    def test_ambiguous_response_is_reconciled_without_duplicate_post(self):
        self.fail_post = True
        with self.assertRaises(IncompleteRead):
            self.client.comment('private/relay', 1, 'result-id-2')
        self.bodies.append('result-id-2')
        list(self.client.comments('private/relay', 1))
        self.assertEqual(self.posts, ['result-id-2'])

    def test_polling_resumes_incrementally_with_timestamp_overlap(self):
        self.bodies.append('old command')
        list(self.client.comments('private/relay', 1))
        list(self.client.comments('private/relay', 1))
        self.assertIn('since=2026-10-21T15%3A59%3A59Z', self.routes[-1])

    def test_secondary_channel_keeps_job_registry_and_separates_health_cursor_outbox(self):
        channel = Path(self.temp.name) / 'issue2'
        recovery = Recovery(self.bridge, state_dir=channel)
        recovery.note('connected')
        self.assertEqual(self.bridge.CONFIG_DIR, Path(self.temp.name))
        self.assertEqual(recovery.outbox, channel / 'pending-results')
        self.assertEqual(recovery.cursor, channel / 'relay-cursor.json')
        self.assertTrue((channel / 'connection-health.json').is_file())

    def test_rate_limit_reset_is_durable_and_waits_before_any_request(self):
        now = [1000.0]
        slept = []
        def sleep(seconds):
            slept.append(seconds)
            now[0] += seconds
        recovery = Recovery(self.bridge, sleep=sleep, clock=lambda: now[0])
        failure = self.bridge.BridgeError('GitHub HTTP 403: API rate limit exceeded')
        failure.__cause__ = HTTPError('https://api.github.com/example', 403, 'limited',
                                      {'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '1130'}, None)
        recovery.original_call = lambda *args: (_ for _ in ()).throw(failure)
        with self.assertRaises(self.bridge.BridgeError):
            recovery.call(self.client, 'GET', '/example')
        self.assertEqual(recovery.not_before, 1132)
        self.assertFalse(slept)
        restarted = Recovery(self.bridge, sleep=sleep, clock=lambda: now[0])
        restarted.original_call = lambda *args: {'ok': True}
        self.assertEqual(restarted.call(self.client, 'GET', '/example'), {'ok': True})
        self.assertEqual(slept, [60, 60, 12])

    def test_retry_after_precedes_primary_limit_reset(self):
        recovery = Recovery(self.bridge, clock=lambda: 1000)
        failure = self.bridge.BridgeError('GitHub HTTP 429')
        failure.__cause__ = HTTPError('https://api.github.com/example', 429, 'limited',
                                      {'Retry-After': '90', 'X-RateLimit-Reset': '9999'}, None)
        recovery.original_call = lambda *args: (_ for _ in ()).throw(failure)
        with self.assertRaises(self.bridge.BridgeError):
            recovery.call(self.client, 'POST', '/example', {'body': 'result'})
        self.assertEqual(recovery.not_before, 1090)

    def test_forbidden_request_without_rate_limit_does_not_back_off(self):
        recovery = Recovery(self.bridge, clock=lambda: 1000)
        failure = self.bridge.BridgeError('GitHub HTTP 403: resource not accessible')
        failure.__cause__ = HTTPError('https://api.github.com/example', 403, 'forbidden', {}, None)
        recovery.original_call = lambda *args: (_ for _ in ()).throw(failure)
        with self.assertRaises(self.bridge.BridgeError):
            recovery.call(self.client, 'GET', '/example')
        self.assertEqual(recovery.not_before, 0)
        self.assertFalse(recovery.cooldown.exists())

    def install_listing(self):
        self.bridge.execute = lambda config, command: {'capabilities': ['ping']}
        self.engine = SimpleNamespace(JOBS={})
        install_job_listing(self.bridge, self.engine)
        self.config = {'enable_jobs': True, 'root': self.temp.name,
                       'workspaces': {'main': self.temp.name}, 'allowed_programs': ['python']}

    def write_job(self, name, **fields):
        folder = self.bridge.CONFIG_DIR / 'jobs'
        folder.mkdir(exist_ok=True)
        path = folder / (name + '.json')
        path.write_text(json.dumps({'program': 'python', 'workspace': 'main', **fields}))
        return path

    def test_job_list_respects_allowlists_and_does_not_expose_args_or_mark_orphans_running(self):
        self.install_listing()
        path = self.write_job('visible', status='running', pid=123, args=['secret-argument'])
        original = path.read_bytes()
        self.write_job('hidden-program', program='not-allowed', status='success')
        self.write_job('hidden-workspace', workspace='not-allowed', status='success')
        result = self.bridge.execute(self.config, {'action': 'job_list'})
        self.assertEqual(result['count'], 1)
        self.assertEqual(result['jobs'][0]['job_id'], 'visible')
        self.assertEqual(result['jobs'][0]['status'], 'unknown_after_restart')
        self.assertNotIn('args', result['jobs'][0])
        self.assertEqual(path.read_bytes(), original)

    def test_job_list_requires_existing_jobs_permission_and_valid_workspace(self):
        self.install_listing()
        with self.assertRaises(self.bridge.BridgeError):
            self.bridge.execute({**self.config, 'enable_jobs': False}, {'action': 'job_list'})
        with self.assertRaises(self.bridge.BridgeError):
            self.bridge.execute(self.config, {'action': 'job_list', 'workspace': 'outside'})

    def test_job_list_limits_results_and_advertises_capability(self):
        self.install_listing()
        self.write_job('older', status='success', started=10)
        self.write_job('newer', status='running', started=20)
        self.engine.JOBS['newer'] = SimpleNamespace(poll=lambda: 0)
        result = self.bridge.execute(self.config, {'action': 'job_list', 'limit': 1})
        self.assertEqual(result['jobs'][0]['job_id'], 'newer')
        self.assertEqual(result['jobs'][0]['status'], 'success')
        self.assertEqual(result['total_visible'], 2)
        self.assertTrue(result['truncated'])
        self.assertIn('job_list', self.bridge.execute(self.config, {'action': 'ping'})['capabilities'])


if __name__ == '__main__':
    unittest.main()
