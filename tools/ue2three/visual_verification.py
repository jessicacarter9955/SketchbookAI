"""Cacheable browser screenshot verification of already migrated local scenes."""
import os
import html
import json
import shutil
import subprocess
from pathlib import Path

from core import atomic_json, digest, file_hash, read_json


def failure_report(output, report):
    atomic_json(output / 'report.json', report)
    (output / 'index.html').write_text(
        '<!doctype html><meta charset="utf-8"><title>ue2three · Verifica visiva</title>'
        '<h1>Verifica visiva non completata</h1><p>Gli screenshot non sono disponibili per questa esecuzione.</p>'
        '<pre>' + html.escape(json.dumps(report, indent=2, ensure_ascii=False)) + '</pre>', encoding='utf-8')
    return report


def verify_scene(repo, url, model, output):
    repo, model, output = Path(repo).resolve(), Path(model).resolve(), Path(output).resolve()
    script = repo / 'tools' / 'ue2three' / 'visual-audit.mjs'
    viewer = script.with_name('ue2three-level-viewer.js')
    fingerprint = digest({'model': file_hash(model), 'audit': file_hash(script),
                          'viewer': file_hash(viewer), 'url': url, 'viewport': [1120, 700]})
    output.mkdir(parents=True, exist_ok=True)
    cache_path = output / 'cache.json'
    try:
        cache = read_json(cache_path)
        report = read_json(output / 'report.json')
        if (cache.get('fingerprint') == fingerprint and report.get('status') == 'captured' and
                set(cache['images']) == {'overview.png', 'ground.png', 'detail.png', 'index.html', 'report.json'} and
                all(file_hash(output / name) == sha for name, sha in cache['images'].items())):
            return {**report, 'reused': True}
    except (OSError, ValueError, KeyError):
        pass
    node = shutil.which('node')
    if not node:
        report = {'status': 'unavailable', 'errors': ['Node.js is unavailable'], 'views': []}
        return failure_report(output, report)
    environment = os.environ.copy()
    # Prefer a project installation or explicit path. Codex desktop can provide
    # its already installed runtime without downloading another browser/package.
    bundled = Path.home() / '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
    if (not environment.get('UE2THREE_PLAYWRIGHT_PATH') and
            not (repo / 'node_modules/playwright').is_dir() and bundled.is_dir()):
        environment['UE2THREE_PLAYWRIGHT_PATH'] = str(bundled)
    flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
    # A stale report must never mask a failed browser startup on a new input.
    (output / 'report.json').unlink(missing_ok=True)
    try:
        result = subprocess.run([node, str(script), url, str(output)], cwd=repo, env=environment,
                                capture_output=True, text=True, timeout=90, creationflags=flags)
        report = read_json(output / 'report.json')
        if result.returncode and report.get('status') == 'captured':
            report.update(status='failed', errors=[result.stderr[-1000:]])
            failure_report(output, report)
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        report = {'status': 'failed', 'errors': [str(error)], 'views': []}
        failure_report(output, report)
    if report.get('status') == 'captured':
        names = [row['image'] for row in report['views']] + ['index.html', 'report.json']
        atomic_json(cache_path, {'fingerprint': fingerprint, 'images': {name: file_hash(output / name) for name in names}})
    return report
