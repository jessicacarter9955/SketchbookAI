import json
from http.client import IncompleteRead
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bridge_recovery import Recovery


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


if __name__ == '__main__':
    unittest.main()
