"""Recover the existing private relay without rerunning delivered PC commands.

Keeps the bridge's author/path/program allowlists. Does not change permissions,
TLS, accounts or credentials. The UI's ChatGPT stream is a separate connection.
"""
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from http.client import HTTPException
import argparse
import hashlib
import importlib
import json
import os
from pathlib import Path
import sys
import time
from urllib.parse import quote


def atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    with temporary.open('w', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=True)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


class Recovery:
    def __init__(self, bridge, sleep=time.sleep):
        self.bridge = bridge
        self.sleep = sleep
        self.outbox = bridge.CONFIG_DIR / 'pending-results'
        self.health = bridge.CONFIG_DIR / 'connection-health.json'
        self.cursor = bridge.CONFIG_DIR / 'relay-cursor.json'
        self.original_call = bridge.GitHub.call
        self.original_comments = bridge.GitHub.comments
        self.original_comment = bridge.GitHub.comment
        self.draining = False

    def note(self, status, **fields):
        atomic(self.health, {'time': datetime.now(timezone.utc).isoformat(), 'status': status,
                             'pending_results': len(list(self.outbox.glob('*.json'))), **fields})

    def call(self, client, method, route, payload=None):
        # Only reads are retried here. An ambiguous POST is reconciled from the
        # durable result outbox before a second send, never blindly repeated.
        attempts = 3 if method == 'GET' else 1
        for attempt in range(attempts):
            try:
                return self.original_call(client, method, route, payload)
            except (OSError, HTTPException, json.JSONDecodeError) as error:
                self.note('network_retry', operation=method, error_type=type(error).__name__)
                if attempt + 1 == attempts:
                    raise self.bridge.BridgeError('Relay transport interrupted; result/checkpoint retained') from None
                self.sleep(2 ** attempt)
            except self.bridge.BridgeError:
                self.note('relay_error', operation=method)
                raise

    def queue_result(self, client, repo, issue, body):
        key = hashlib.sha256(body.encode('utf-8')).hexdigest()
        path = self.outbox / (key + '.json')
        atomic(path, {'repo': repo, 'issue': issue, 'body': body})
        self.note('result_saved')
        result = self.original_comment(client, repo, issue, body)
        path.unlink()
        self.note('connected')
        return result

    def comments(self, client, repo, issue):
        pending = list(sorted(self.outbox.glob('*.json')))
        if pending:
            # Compare exact bodies before retrying a response whose POST may
            # already have succeeded. Existing author validation is unchanged.
            existing = {item.get('body') for item in self.original_comments(client, repo, issue)}
            for path in pending[:3]:
                item = json.loads(path.read_text(encoding='utf-8'))
                if item['repo'] != repo or item['issue'] != issue:
                    raise self.bridge.BridgeError('Pending response belongs to a different configured relay')
                if item['body'] not in existing:
                    self.original_comment(client, repo, issue, item['body'])
                path.unlink()
            if len(pending) > 3:
                self.note('draining_results')
                return
        prior = json.loads(self.cursor.read_text(encoding='utf-8')) if self.cursor.exists() else {}
        since = prior.get('updated_at') if prior.get('repo') == repo and prior.get('issue') == issue else None
        route = '/repos/' + '/'.join(quote(part, safe='') for part in repo.split('/')) + f'/issues/{issue}/comments'
        page, items = 1, []
        while True:
            query = f'?per_page=100&page={page}'
            if since:
                # One-second overlap avoids losing comments with equal timestamps.
                overlap = datetime.fromisoformat(since.replace('Z', '+00:00')) - timedelta(seconds=1)
                query += '&since=' + quote(overlap.strftime('%Y-%m-%dT%H:%M:%SZ'), safe='')
            chunk = client.call('GET', route + query)
            if not isinstance(chunk, list):
                raise self.bridge.BridgeError('Relay returned invalid comment data')
            items.extend(chunk)
            if len(chunk) < 100:
                break
            page += 1
        self.note('connected', received_comments=len(items), incremental=bool(since))
        yield from items
        stamps = [item.get('updated_at') for item in items if isinstance(item.get('updated_at'), str)]
        if stamps:
            atomic(self.cursor, {'repo': repo, 'issue': issue, 'updated_at': max(stamps)})

    def install(self):
        recovery = self
        self.bridge.GitHub.call = lambda client, method, route, payload=None: recovery.call(client, method, route, payload)
        self.bridge.GitHub.comment = lambda client, repo, issue, body: recovery.queue_result(client, repo, issue, body)
        self.bridge.GitHub.comments = lambda client, repo, issue: recovery.comments(client, repo, issue)


@contextmanager
def singleton(directory):
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / 'connection-recovery.lock').open('a+b') as stream:
        if stream.tell() == 0:
            stream.write(b'0')
            stream.flush()
        stream.seek(0)
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            try:
                yield
            finally:
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            try:
                yield
            finally:
                fcntl.flock(stream, fcntl.LOCK_UN)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bridge-dir', type=Path, required=True)
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    directory = args.bridge_dir.resolve(strict=True)
    if not (directory / 'bridge_pro.py').is_file():
        parser.error('Existing bridge_pro.py is required')
    sys.path.insert(0, str(directory))
    pro = importlib.import_module('bridge_pro')
    bridge = pro.bridge
    recovery = Recovery(bridge)
    recovery.install()
    try:
        with singleton(bridge.CONFIG_DIR):
            bridge.run(once=args.once)
    except (bridge.BridgeError, OSError, ValueError) as error:
        recovery.note('disconnected', error_type=type(error).__name__)
        print('Bridge connection unavailable; inspect local connection-health.json', flush=True)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
