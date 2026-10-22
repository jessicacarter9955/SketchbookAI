import http.client
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import automation_web as web


class WebTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.config = self.root / '.local/config.json'
        self.config.parent.mkdir()
        self.config.write_text(json.dumps({'project': 'DDS.uproject', 'session_seconds': 0,
            'publish_dir': str(self.root / 'build/project'), 'paused': True}))
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), web.handler(self.root, self.config, 0))
        self.port = self.server.server_port
        self.server.RequestHandlerClass = web.handler(self.root, self.config, self.port)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.cleanup_server)

    def cleanup_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)

    def request(self, method, path, body=None, origin=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=2)
        headers = {'Content-Type': 'application/json'}
        if origin: headers['Origin'] = origin
        connection.request(method, path, json.dumps(body) if body else None, headers)
        response = connection.getresponse()
        result = response.status, response.read()
        connection.close()
        return result

    def test_status_has_explicit_criteria_and_no_invented_completeness(self):
        code, raw = self.request('GET', '/__ue2three/status')
        data = json.loads(raw)
        self.assertEqual(code, 200)
        self.assertEqual(len(data['areas']), 8)
        self.assertTrue(data['continuous'])
        self.assertEqual(next(a for a in data['areas'] if a['id'] == 'character')['percent'], 0)
        self.assertEqual(data['configured_workers'], 4)
        self.assertEqual(data['active_workers'], 0)
        self.assertEqual([item['status'] for item in data['lanes']], ['not_started'] * 4)

    def test_four_worker_heartbeats_drive_live_count_not_cached_checkpoints(self):
        import time
        state_root = self.root / '.local/ue2three/dds-agent'
        state_root.mkdir(parents=True)
        families = {}
        for lane, family in enumerate(('native-objects', 'native-data', 'native-physics', 'native-math'), 1):
            families[family] = {'status': 'running', 'lane': lane, 'started_at': '2026-10-22T10:00:00Z'}
            beat = state_root / 'heartbeats' / family
            beat.mkdir(parents=True)
            (beat / 'heartbeat.json').write_text(json.dumps({'status': 'running',
                'updated_at': ('2020-01-01T00:00:00Z' if lane == 4 else web.datetime.now(web.timezone.utc).isoformat()),
                'updated_epoch': time.time() if lane != 4 else 1}))
        (state_root / 'checkpoint.json').write_text(json.dumps({'families': families}))
        data = json.loads(self.request('GET', '/__ue2three/status')[1])
        self.assertEqual(data['active_workers'], 3)
        self.assertEqual(sum(item['live'] for item in data['jobs']), 3)
        self.assertTrue(data['lanes'][3]['stale'])

    def test_start_is_accepted_without_waiting_for_a_job(self):
        with patch.object(web.subprocess, 'Popen') as start:
            code, raw = self.request('POST', '/__ue2three/control', {'action': 'start'}, f'http://127.0.0.1:{self.port}')
            self.assertEqual(code, 202)
            start.assert_called_once()
        self.assertFalse(json.loads(self.config.read_text())['paused'])

    def test_cross_origin_control_and_private_files_are_blocked(self):
        code, _ = self.request('POST', '/__ue2three/control', {'action': 'start'}, 'https://unrelated.example')
        self.assertEqual(code, 403)
        code, _ = self.request('GET', '/.local/config.json')
        self.assertEqual(code, 403)


if __name__ == '__main__':
    unittest.main()
