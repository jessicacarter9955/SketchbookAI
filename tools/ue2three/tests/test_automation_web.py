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

    def test_separate_state_root_preserves_live_agent_telemetry(self):
        state_root = self.root / 'other-checkout'
        state_path = state_root / '.local/ue2three/asset-export/progress.json'
        state_path.parent.mkdir(parents=True)
        state_path.write_text(json.dumps({'schema_version': 1, 'status': 'completed',
            'phase': 'completed', 'running': False, 'heartbeat_at': None,
            'assets': {'discovered': 3, 'eligible': 3, 'converted': 3,
                       'verified': 3, 'failed': 0, 'skipped': 0},
            'jobs': [], 'progress': {'percent': 100}}))
        self.server.RequestHandlerClass = web.handler(self.root, self.config, self.port, state_root)
        status, body = self.request('GET', '/__ue2three/status')
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['asset_pipeline']['assets']['verified'], 3)

    def asset_checkpoint(self, **overrides):
        path = self.root / '.local/ue2three/asset-export/progress.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        stamp = web.datetime.now(web.timezone.utc).isoformat()
        payload = {'schema_version': 1, 'updated_at': stamp, 'heartbeat_at': stamp,
                   'phase': 'converting', 'status': 'converting', 'running': True,
                   'assets': {'discovered': 10, 'eligible': 10, 'converted': 6,
                              'verified': 4, 'failed': 1, 'skipped': 0},
                   'progress': {'percent': 40, 'basis': 'verified_outputs_over_eligible',
                                'description': 'Four checked GLBs out of ten known outputs'},
                   'jobs': [{'id': 'character', 'status': 'validating', 'running': True,
                             'completed': 3, 'total': 5, 'percent': 60,
                             'heartbeat_at': stamp, 'started_at': stamp, 'log': 'character.log',
                             'manifest': 'character-manifest.json', 'error': None},
                            {'id': 'maps', 'status': 'converting', 'running': True,
                             'completed': 1, 'total': 5, 'percent': 20,
                             'heartbeat_at': stamp, 'started_at': stamp, 'log': 'maps.log',
                             'manifest': None, 'error': None}],
                   'outputs': {'source_root': 'C:/Unreal/', 'published_dir': 'build/dds',
                               'manifest_path': 'build/dds/manifest.json'},
                   'error': None, 'notes': ['First monitored batch']}
        payload.update(overrides)
        path.write_text(json.dumps(payload))
        return path

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
        self.assertEqual([item['progress']['percent'] for item in data['lanes']], [0] * 4)
        self.assertFalse(data['asset_pipeline']['available'])
        self.assertFalse(data['asset_pipeline']['live'])
        self.assertIsNone(data['asset_pipeline']['percent'])

    def test_worker_percent_tracks_verified_gates_not_elapsed_time(self):
        self.assertEqual(web.worker_progress({}, {})['percent'], 0)
        # A prior review outcome must not imply the new running attempt already passed its checks.
        running = {'status': 'running', 'attempts': 2, 'started_at': '2026-10-22T09:00:00Z',
                   'original_commit': 'prior_patch', 'result': 'no_proven_conversion_gain'}
        self.assertEqual(web.worker_progress(running, {})['percent'], 25)
        ready = {**running, 'status': 'patch_ready_for_review', 'result': 'codex_exit_0'}
        self.assertEqual(web.worker_progress(ready, {})['percent'], 50)
        self.assertEqual(web.worker_progress({**ready, 'status': 'needs_review',
                         'result': 'no_proven_conversion_gain'}, {})['percent'], 50)
        promoting = {'phase': 'promoting', 'candidate_family': 'native-data', 'candidate_commit': 'abc'}
        self.assertEqual(web.worker_progress({**ready, 'name': 'native-data'}, promoting)['percent'], 75)
        verified = {**ready, 'status': 'integrated', 'commit': 'abc',
                    'verified_counts': {'translated': 401}, 'verified_gain': {'translated': 1, 'blocked': 1}}
        self.assertEqual(web.worker_progress(verified, {})['percent'], 100)
        self.assertEqual(web.worker_progress(verified, {})['verified_gain']['translated'], 1)
        self.assertLess(web.worker_progress({**verified, 'verified_counts': {}}, {})['percent'], 100)

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
        self.assertEqual(data['lanes'][0]['progress']['percent'], 25)
        self.assertIn('blueprints', data['lanes'][0]['affected_areas'])

    def test_asset_pipeline_reports_measured_output_bars_and_independent_parallel_jobs(self):
        self.asset_checkpoint()
        data = json.loads(self.request('GET', '/__ue2three/status')[1])
        assets = data['asset_pipeline']
        self.assertTrue(assets['available'])
        self.assertTrue(assets['live'])
        self.assertEqual(assets['status'], 'converting')
        self.assertEqual(assets['percent'], 40)
        self.assertEqual(assets['converted_percent'], 60)
        self.assertEqual(assets['assets']['verified'], 4)
        self.assertEqual([item['percent'] for item in assets['jobs']], [60, 20])
        self.assertEqual([item['live'] for item in assets['jobs']], [True, True])
        self.assertEqual(assets['outputs']['manifest_path'], 'build/dds/manifest.json')
        self.assertFalse(assets['verified_complete'])
        # The independent export run cannot certify Play or 1:1 maps.
        self.assertNotEqual(next(a for a in data['areas'] if a['id'] == 'maps')['status'], 'green')

    def test_map_failures_and_shader_quality_are_visible_but_never_green(self):
        stamp = web.datetime.now(web.timezone.utc).isoformat()
        self.asset_checkpoint(jobs=[{'id': 'maps', 'status': 'partial', 'running': False,
            'completed': 2, 'total': 10, 'percent': 20, 'heartbeat_at': stamp,
            'material_degraded': 1, 'issues': [
                {'package': '/Game/Fixers/Maps/Crash', 'status': 'failed',
                 'detail': 'MaterialBaking crash'},
                {'package': '/Game/Fixers/Maps/Approx', 'status': 'material_degraded',
                 'detail': 'Used simple material baking'}]}])
        response = web.snapshot(self.root, self.config)
        maps = response['asset_pipeline']['jobs'][0]
        self.assertEqual(maps['material_degraded'], 1)
        self.assertEqual([i['status'] for i in maps['issues']], ['failed', 'material_degraded'])
        self.assertNotEqual(next(a for a in response['areas'] if a['id'] == 'maps')['status'], 'green')

    def test_asset_missing_inventory_has_no_percent_or_false_completion(self):
        self.asset_checkpoint(progress={'percent': None, 'basis': 'unknown',
                                        'description': 'Inventory incomplete'},
                              jobs=[{'id': 'maps', 'status': 'inventory', 'running': True,
                                     'completed': 0, 'total': 3, 'percent': None,
                                     'heartbeat_at': web.datetime.now(web.timezone.utc).isoformat()}])
        assets = web.asset_snapshot(self.root)
        self.assertIsNone(assets['percent'])
        self.assertIsNone(assets['converted_percent'])
        self.assertIsNone(assets['jobs'][0]['percent'])
        self.assertFalse(assets['verified_complete'])

    def test_asset_stale_heartbeat_not_reported_running(self):
        self.asset_checkpoint(heartbeat_at='2020-01-01T00:00:00Z',
                              jobs=[{'id': 'maps', 'status': 'converting', 'running': True,
                                     'completed': 1, 'total': 5, 'percent': 20,
                                     'heartbeat_at': '2020-01-01T00:00:00Z'}])
        assets = web.asset_snapshot(self.root)
        self.assertTrue(assets['stale'])
        self.assertFalse(assets['live'])
        self.assertTrue(assets['jobs'][0]['stale'])
        self.assertFalse(assets['jobs'][0]['live'])
        # Previously measured GLBs remain visible, not presented as actively converting.
        self.assertEqual(assets['percent'], 40)

    def test_asset_invalid_counts_do_not_invent_green(self):
        self.asset_checkpoint(status='completed', running=False,
                              assets={'discovered': 1, 'eligible': 1, 'converted': 1,
                                      'verified': 2, 'failed': 0, 'skipped': 0})
        assets = web.asset_snapshot(self.root)
        self.assertFalse(assets['counts_valid'])
        self.assertIsNone(assets['percent'])
        self.assertFalse(assets['verified_complete'])
        self.asset_checkpoint(status='completed', running=False,
                              assets={'discovered': 10, 'eligible': 10, 'converted': 10,
                                      'verified': 10, 'failed': 0, 'skipped': 0})
        assets = web.asset_snapshot(self.root)
        self.assertTrue(assets['verified_complete'])
        self.assertEqual(assets['percent'], 100)

    def test_maps_criterion_only_advances_after_verified_complete_original_export(self):
        manifest = self.root / 'build/maps/map-manifest.json'
        manifest.parent.mkdir(parents=True)
        manifest.write_text('{"maps": []}')
        stamp = web.datetime.now(web.timezone.utc).isoformat()
        jobs = [{'id': 'maps', 'status': 'completed', 'running': False,
                 'completed': 10, 'total': 10, 'percent': 100,
                 'heartbeat_at': stamp, 'manifest': str(manifest), 'error': None}]
        self.asset_checkpoint(project='DDS.uproject', status='partial', phase='partial',
                              running=False, jobs=jobs,
                              assets={'discovered': 12, 'eligible': 12, 'converted': 10,
                                      'verified': 10, 'failed': 0, 'skipped': 0})
        data = json.loads(self.request('GET', '/__ue2three/status')[1])
        maps = next(a for a in data['areas'] if a['id'] == 'maps')
        self.assertEqual(maps['percent'], 20)
        self.assertEqual(maps['done'], 1)
        self.assertEqual(maps['status'], 'yellow')
        # No completion claim from a single file, missing manifest, or wrong project.
        jobs[0]['total'] = jobs[0]['completed'] = 9
        self.asset_checkpoint(project='DDS.uproject', status='partial', phase='partial',
                              running=False, jobs=jobs,
                              assets={'discovered': 12, 'eligible': 12, 'converted': 9,
                                      'verified': 9, 'failed': 0, 'skipped': 0})
        self.assertEqual(next(a for a in web.snapshot(self.root, self.config)['areas']
                         if a['id'] == 'maps')['percent'], 0)

    def test_character_export_advances_only_source_witnessed_gates_not_play(self):
        manifest = self.root / 'build/character/manifest.json'
        manifest.parent.mkdir(parents=True)
        manifest.write_text('{"artifacts": []}')
        stamp = web.datetime.now(web.timezone.utc).isoformat()
        job = {'id': 'character', 'status': 'completed', 'running': False,
               'completed': 48, 'total': 48, 'percent': 100,
               'heartbeat_at': stamp, 'manifest': str(manifest), 'error': None}
        self.asset_checkpoint(project='DDS.uproject', status='partial', phase='partial',
                              running=False, jobs=[job],
                              assets={'discovered': 58, 'eligible': 58, 'converted': 48,
                                      'verified': 48, 'failed': 0, 'skipped': 0})
        rows = {r['id']: r for r in web.snapshot(self.root, self.config)['areas']}
        self.assertEqual(rows['character']['done'], 1)
        self.assertEqual(rows['animations']['done'], 1)
        self.assertEqual(rows['character']['status'], 'yellow')
        self.assertEqual(rows['animations']['status'], 'yellow')

        # A wrong source project, partial batch or missing proof keeps both gates unset.
        for change in ({'project': 'Different.uproject'},
                       {'jobs': [{**job, 'completed': 47, 'percent': 98}]},
                       {'jobs': [{**job, 'manifest': 'missing-manifest.json'}]}):
            partial = {'project': 'DDS.uproject', 'status': 'partial', 'phase': 'partial',
                       'running': False, 'jobs': [job],
                       'assets': {'discovered': 58, 'eligible': 58, 'converted': 48,
                                  'verified': 48, 'failed': 0, 'skipped': 0}}
            self.asset_checkpoint(**{**partial, **change})
            rows = {r['id']: r for r in web.snapshot(self.root, self.config)['areas']}
            self.assertEqual(rows['character']['done'], 0)
            self.assertEqual(rows['animations']['done'], 0)

    def test_asset_malformed_checkpoint_is_safe(self):
        path = self.asset_checkpoint()
        path.write_text('{not JSON')
        assets = web.asset_snapshot(self.root)
        self.assertFalse(assets['available'])
        self.assertIsNone(assets['percent'])
        self.asset_checkpoint(phase=[], status={}, heartbeat_at={'invalid': True},
                              jobs=[{'id': [], 'status': []}],
                              assets={'discovered': True, 'eligible': 1, 'converted': 1,
                                      'verified': 1, 'failed': 0, 'skipped': 0})
        assets = web.asset_snapshot(self.root)
        self.assertTrue(assets['available'])
        self.assertFalse(assets['live'])
        self.assertFalse(assets['counts_valid'])
        self.assertEqual(assets['jobs'], [])
        self.assertIsNone(assets['percent'])

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
