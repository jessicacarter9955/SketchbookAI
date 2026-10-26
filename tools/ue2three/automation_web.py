"""Loopback-only live ue2three dashboard. Job lifetime is independent of HTTP."""
from __future__ import annotations

import argparse
from collections import deque
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import subprocess
import time
from urllib.parse import unquote, urlsplit

from core import read_json
from dds_agent import _atomic_json

ROOT = Path(__file__).resolve().parents[2]
PHASES = ['conversion_checkpoint', 'codex-auth-check', 'agent_running', 'agent_checkpoint',
          'cached-blueprints', 'promoting', 'integrated', 'pushed']
LABELS = {'paused': 'In attesa di avvio', 'agent_running': 'Sviluppo del convertitore',
          'cached-blueprints': 'Conversione dalla cache', 'codex-auth-check': 'Collegamento al modello',
          'agent_checkpoint': 'Verifica del batch', 'promoting': 'Integrazione del batch',
          'integrated': 'Batch integrato', 'conversion_checkpoint': 'Conversione salvata',
          'git-push': 'Invio su GitHub', 'pushed': 'Batch pubblicato su GitHub',
          'waiting_next_tick': 'In attesa del prossimo ciclo', 'waiting_account': 'Pausa per limite account',
          'waiting_connection': 'Riconnessione programmata', 'failed': 'Intervento o nuovo tentativo necessario'}

WORKER_IMPACT = {
    'native-objects': ('blueprints', 'character'),
    'native-timers': ('blueprints', 'systems'),
    'native-data': ('blueprints', 'systems'),
    'native-animation': ('blueprints', 'animations'),
    'native-audio-vfx': ('physics',),
    'native-physics': ('physics', 'character'),
    'native-math': ('blueprints',),
}

ASSET_COUNTS = ('discovered', 'eligible', 'converted', 'verified', 'failed', 'skipped')
ASSET_PHASES = {'not_started', 'inventory', 'converting', 'validating',
                'completed', 'partial', 'blocked', 'failed'}
ASSET_JOB_IDS = {'character', 'maps'}


def worker_progress(record, state):
    """Evidence-based batch gates, NOT an estimate of translated code or ETA.

    No elapsed-time guess is used. A worker can remain at 25/50 percent
    indefinitely when it has not crossed the next verified gate.
    """
    status = record.get('status', 'new')
    if status == 'running':
        gates = 1
    elif status == 'integrated' and record.get('commit') and record.get('verified_counts'):
        gates = 4
    elif (state.get('phase') == 'promoting' and state.get('candidate_family') == record.get('name')
          and state.get('candidate_commit')):
        gates = 3
    elif status == 'patch_ready_for_review' or record.get('original_commit'):
        gates = 2
    elif record.get('attempts', 0) or record.get('started_at'):
        gates = 1
    else:
        gates = 0
    stages = ('Non avviato', 'Agente avviato', 'Patch e test del worker verificati',
              'Replay con incremento verificato', 'Integrazione verificata')
    return {'percent': gates * 25, 'completed_gates': gates, 'total_gates': 4,
            'stage': stages[gates], 'verified_gain': record.get('verified_gain') if gates == 4 else None}


def optional(path):
    try:
        return read_json(path)
    except (OSError, ValueError):
        return {}


def age(stamp):
    try:
        return max(0, time.time() - datetime.fromisoformat(stamp.replace('Z', '+00:00')).timestamp())
    except (AttributeError, ValueError, TypeError):
        return None


def measured_percent(completed, total):
    """Return a percentage only for a valid, nonempty measured denominator."""
    if (type(completed) is not int or type(total) is not int or
            total <= 0 or completed < 0 or completed > total):
        return None
    return round(100 * completed / total, 1)


def asset_snapshot(root):
    """Read the independent Unreal->GLB worker's durable schema-v1 checkpoint.

    A recorded 'running' flag is historical unless accompanied by a recent
    heartbeat. Output coverage means GLBs verified among identified targets,
    never the percentage of the DDS game port or a proof of playable maps.
    """
    path = root / '.local/ue2three/asset-export/progress.json'
    payload = optional(path)
    available = isinstance(payload, dict) and type(payload.get('schema_version')) is int \
        and payload['schema_version'] == 1
    if not available:
        payload = {}
    counts = payload.get('assets')
    counts_valid = (isinstance(counts, dict) and all(
        type(counts.get(key)) is int and counts[key] >= 0 for key in ASSET_COUNTS))
    assets = {key: counts[key] if counts_valid else 0 for key in ASSET_COUNTS}
    # Do not display a false 100% from a truncated, inconsistent or
    # partly-inventoried checkpoint.
    basis = payload.get('progress')
    basis = basis.get('basis') if isinstance(basis, dict) else None
    consistent = (counts_valid and assets['verified'] <= assets['converted']
                  and assets['converted'] <= assets['eligible']
                  and assets['eligible'] <= assets['discovered'])
    percent = (measured_percent(assets['verified'], assets['eligible'])
               if consistent and basis == 'verified_outputs_over_eligible' else None)
    converted_percent = (measured_percent(assets['converted'], assets['eligible'])
                         if consistent and basis == 'verified_outputs_over_eligible' else None)
    raw_phase = payload.get('phase')
    phase = raw_phase if isinstance(raw_phase, str) and raw_phase in ASSET_PHASES else 'not_started'
    raw_status = payload.get('status')
    status = raw_status if isinstance(raw_status, str) and raw_status in ASSET_PHASES else phase
    stamp = payload.get('heartbeat_at') if isinstance(payload.get('heartbeat_at'), str) else None
    heartbeat_age = age(stamp)
    working = payload.get('running') is True
    live = (available and working and phase in ('inventory', 'converting', 'validating')
            and heartbeat_age is not None and heartbeat_age < 120)
    stale = working and not live
    complete = (status == 'completed' and percent == 100 and assets['failed'] == 0)

    raw_jobs = payload.get('jobs') if isinstance(payload.get('jobs'), list) else []
    jobs = []
    for raw in raw_jobs[:20]:
        if not isinstance(raw, dict) or not isinstance(raw.get('id'), str) \
                or raw['id'] not in ASSET_JOB_IDS:
            continue
        raw_job_phase = raw.get('status')
        current_phase = raw_job_phase if isinstance(raw_job_phase, str) \
            and raw_job_phase in ASSET_PHASES else 'not_started'
        job_stamp = raw.get('heartbeat_at') if isinstance(raw.get('heartbeat_at'), str) else None
        job_age = age(job_stamp)
        job_working = raw.get('running') is True
        job_live = job_working and current_phase in ('inventory', 'converting', 'validating') \
            and job_age is not None and job_age < 120
        # The producer explicitly uses null when source inventory is incomplete;
        # a numeric completed/total pair is not permission to claim coverage.
        reported = raw.get('percent')
        job_percent = (measured_percent(raw.get('completed'), raw.get('total'))
                       if type(reported) in (int, float) and 0 <= reported <= 100 else None)
        issues = raw.get('issues') if isinstance(raw.get('issues'), list) else []
        issues = [{'package': entry['package'][:250], 'status': entry['status'],
                   'detail': entry['detail'][:400]}
                  for entry in issues[:30] if isinstance(entry, dict)
                  and isinstance(entry.get('package'), str)
                  and isinstance(entry.get('detail'), str)
                  and entry.get('status') in ('failed', 'source_only', 'material_degraded')]
        jobs.append({'id': raw['id'], 'status': current_phase, 'live': job_live,
                     'stale': job_working and not job_live,
                     'heartbeat_at': job_stamp,
                     'completed': raw.get('completed') if type(raw.get('completed')) is int else None,
                     'total': raw.get('total') if type(raw.get('total')) is int else None,
                     'percent': job_percent,
                     'manifest': raw.get('manifest') if isinstance(raw.get('manifest'), str) else None,
                     'log': raw.get('log') if isinstance(raw.get('log'), str) else None,
                     'error': raw.get('error') if isinstance(raw.get('error'), str) else None,
                     'issues': issues,
                     'material_degraded': raw.get('material_degraded')
                     if type(raw.get('material_degraded')) is int and raw['material_degraded'] >= 0 else 0})
    outputs = payload.get('outputs') if isinstance(payload.get('outputs'), dict) else {}
    notes = payload.get('notes') if isinstance(payload.get('notes'), list) else []
    return {'available': available, 'phase': phase, 'status': status, 'live': live,
            'stale': stale, 'heartbeat_at': stamp,
            'updated_at': payload.get('updated_at') if isinstance(payload.get('updated_at'), str) else None,
            'assets': assets,
            'source_project': payload.get('project') if isinstance(payload.get('project'), str) else None,
            'counts_valid': bool(consistent), 'percent': percent,
            'converted_percent': converted_percent, 'verified_complete': complete,
            'progress_basis': basis or 'unknown',
            'jobs': jobs,
            'outputs': {key: outputs.get(key) if isinstance(outputs.get(key), str) else None
                        for key in ('manifest_path', 'published_dir', 'source_root')},
            'error': payload.get('error') if isinstance(payload.get('error'), str) else None,
            'notes': [note[:500] for note in notes[:10] if isinstance(note, str)]}


def recent_worker(worker):
    path = worker / '.local/dds-agent/codex-events.jsonl'
    if not path.is_file():
        return {'last_activity': None, 'message': '', 'event_types': []}
    # Read only a bounded tail; large historical tool output stays on disk.
    with path.open('rb') as stream:
        stream.seek(max(0, path.stat().st_size - 32768))
        lines = stream.read().decode('utf-8', 'replace').splitlines()
    messages, types = deque(maxlen=2), deque(maxlen=8)
    for line in lines:
        try:
            event = json.loads(line)
        except ValueError:
            continue
        types.append(event.get('type', ''))
        item = event.get('item', {})
        if item.get('type') == 'agent_message':
            messages.append(item.get('text', '')[:500])
    return {'last_activity': datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(),
            'message': messages[-1] if messages else '', 'event_types': list(types)}


def area(identity, title, criteria, benefit, note='', partial=False):
    done = sum(bool(value) for _, value in criteria)
    return {'id': identity, 'title': title, 'percent': round(100 * done / len(criteria)),
            'done': done, 'total': len(criteria),
            'status': 'green' if done == len(criteria) else 'yellow' if done or partial else 'red',
            'criteria': [{'label': label, 'done': bool(value)} for label, value in criteria],
            'benefit': benefit, 'note': note}


def glb(path):
    try:
        import struct
        with path.open('rb') as stream:
            magic, version, size = struct.unpack('<4sII', stream.read(12))
        return magic == b'glTF' and version == 2 and size == path.stat().st_size
    except (OSError, ValueError, struct.error):
        return False


def areas(root, config, state, checkpoint, asset_pipeline=None):
    published = Path(config['publish_dir'])
    character = root / 'build/local-scenes/ue2three/current'
    manifest = optional(character / 'manifest.json')
    clips = list(manifest.get('clips', {}).values())
    character_ok = glb(character / 'character.glb')
    weapons_ok = glb(character / 'attachment-pistol.glb') and glb(character / 'attachment-rifle.glb')
    programs = optional(published / 'progress.json')
    rows = {row['id']: row for row in programs.get('rows', [])}
    integrated = any(row.get('commit') and row.get('verified_counts') for row in checkpoint.get('families', {}).values())
    pipeline = asset_pipeline if asset_pipeline is not None else asset_snapshot(root)
    project = str(config.get('project', '')).replace('\\', '/').casefold()
    source_project = str(pipeline.get('source_project') or '').replace('\\', '/').casefold()
    character_jobs = [job for job in pipeline.get('jobs', []) if job['id'] == 'character']
    character_job = character_jobs[0] if character_jobs else {}
    character_export_verified = (pipeline['counts_valid'] and project and project == source_project
                                 and character_job.get('status') == 'completed'
                                 and character_job.get('percent') == 100
                                 and character_job.get('total', 0) >= 48
                                 and not character_job.get('error')
                                 and bool(character_job.get('manifest'))
                                 and Path(character_job['manifest']).is_file())
    map_jobs = [job for job in pipeline.get('jobs', []) if job['id'] == 'maps']
    map_job = map_jobs[0] if map_jobs else {}
    # Only this specific export criterion can turn green from a GLB checkpoint.
    # Play, collision, materials, traversal, and visual comparison remain manual.
    maps_verified = (pipeline['counts_valid'] and project and project == source_project
                     and map_job.get('status') == 'completed' and map_job.get('percent') == 100
                     and map_job.get('total', 0) >= 10 and not map_job.get('error')
                     and bool(map_job.get('manifest'))
                     and Path(map_job['manifest']).is_file())
    demo = optional(root / '.local/ue2three/demo-acceptance.json')
    legacy = root / 'build/local-scenes/dds'
    legacy_manifest = optional(legacy / 'manifest.json')
    legacy_assets = (glb(legacy / legacy_manifest.get('mesh', 'missing.glb'))
                     and all(glb(legacy / legacy_manifest.get('weapons', {}).get(name, 'missing.glb'))
                             for name in ('pistol', 'rifle')))
    return [
        area('demo', 'Demo DDS giocabile (non certificazione 1:1)', [
            ('Mannequin e due armi della demo originali disponibili', legacy_assets),
            ('Canvas 3D e HUD osservati in una sessione Play', demo.get('legacy_play_visible') is True),
            ('Sparo, ricarica e munizioni provati nel browser', demo.get('legacy_combat_passed') is True),
            ('Mannequin ue2three integrato e avviato in Play', demo.get('ue2three_play_visible') is True)],
            'Giocare alla demo DDS con armi e statistiche.',
            'Verde solo per la demo testata. NON certifica fedeltà Unreal 1:1.', True),
        area('automation', 'Automazione delle conversioni', [
            ('Autenticazione reale verificata', bool(state.get('agent_result'))),
            ('Ciclo agente, test e integrazione concluso', integrated),
            ('Checkpoint e push confermati', bool(state.get('pushed_commit'))),
            ('Sessione senza scadenza automatica', config.get('session_seconds') == 0),
            ('Supervisore senza errore bloccante corrente', state.get('phase') != 'failed')],
            'Il PC può proseguire i batch senza un messaggio “continua”.',
            'Il verde riguarda questo ciclo di conversione; export e deploy restano separati.'),
        area('character', 'Personaggio e armi', [
            ('Mesh del personaggio pubblicata e leggibile', character_ok),
            ('Mesh di pistola e fucile pubblicate e leggibili', weapons_ok),
            ('Ricetta originale di personaggio, armi e animazioni esportata e validata', character_export_verified),
            ('Materiali originali verificati sul personaggio', False),
            ('Socket e impugnature verificati nella scena', False),
            ('Inizializzazione ed equipaggiamento completi', False),
            ('Comandi e movimento armato verificati', False),
            ('Sparo, ricarica e danni originali verificati', False),
            ('Accettazione visiva della versione corrente', False)],
            'Usare il personaggio originale, equipaggiare le armi e combattere.',
            'Le verifiche non dimostrate restano aperte; un file esportato non prova il gameplay.', True),
        area('blueprints', 'Blueprint e inventario', [
            ('Pacchetti disponibili nella cache', bool(state.get('counts'))),
            ('Tutte le funzioni necessarie tradotte', state.get('counts', {}).get('blocked') == 0),
            ('Chiamate, eventi e timer integrati', False),
            ('Inventario e trasferimenti utilizzabili nella scena', False),
            ('Equipaggiamento e persistenza verificati', False),
            ('Flussi completi confrontati con il progetto originale', False)],
            'Raccogliere, usare, spostare e conservare gli oggetti secondo le regole originali.',
            'La copertura delle funzioni è mostrata a parte: non è la percentuale del gioco.', True),
        area('animations', 'Animazioni', [
            ('Clip esportate leggibili', bool(clips) and all(glb(character / name) for name in clips)),
            ('Ricetta completa delle clip originali verificata', character_export_verified),
            ('Transizioni e blending verificati', False), ('Root motion, curve e notifiche verificati', False),
            ('Mira, armi, IK e montage integrati', False), ('Fedeltà 1:1 verificata', False)],
            'Movimenti e azioni fluidi e coerenti con l’originale.',
            'Verifica 1:1 rimandata su richiesta: area mantenuta gialla.', True),
        area('maps', 'Mappe e materiali', [
            ('Export delle mappe richieste disponibile e verificato', maps_verified),
            ('Trasformazioni, gerarchie e terreno verificati', False),
            ('Materiali e texture originali confrontati', False),
            ('Collisioni e punti di ingresso verificati', False),
            ('Mappe giocabili e navigazione verificate', False)],
            'Esplorare le mappe originali con superfici e ostacoli corretti.',
            rows.get('geometry', {}).get('evidence', 'Le precedenti prove parziali non certificano questa versione.'), True),
        area('systems', 'Shop, dialoghi e modalità', [
            ('Interazioni e condizioni originali tradotte', False), ('Shop e valute verificati', False),
            ('Dialoghi e progressione verificati', False), ('Lobby, raid ed estrazione integrati', False)],
            'Interagire con NPC, acquistare e completare le modalità originali.'),
        area('physics', 'Fisica, effetti, audio e multiplayer', [
            ('Collisioni, query e danni confrontati', False), ('Effetti e audio originali integrati', False),
            ('Autorità, RPC e replica tradotti', False), ('Sessione tra più client verificata', False)],
            'Vedere e sentire le azioni corrette e giocare con altri utenti.'),
        area('lighting', 'Illuminazione', [('Luci e ambiente confrontati', False),
            ('Ombre ed esposizione confrontate', False), ('Postprocessing e confronto visivo completati', False)],
            'Avvicinare l’aspetto delle scene al riferimento Unreal.', 'Ultima priorità.')]


def execution_label(identity, phase, jobs, pipeline, demo):
    if identity in ('automation', 'blueprints'):
        if phase == 'failed':
            return 'Bloccato · ripristino agente richiesto'
        if phase == 'waiting_account':
            return 'In attesa quota Codex'
        if any(job.get('live') for job in jobs):
            return 'In esecuzione · heartbeat confermato'
        return 'Pronto o in attesa · nessun worker attivo'
    if identity == 'maps':
        if pipeline.get('live'):
            return 'Export Unreal attivo · heartbeat recente'
        return 'Nessun export attivo verificato'
    if identity == 'demo':
        return 'Test Play verificato' if demo.get('legacy_play_visible') else 'Test Play da certificare'
    return 'Integrazione/accettazione da completare'


def snapshot(root, config_path):
    config = optional(config_path)
    state_dir = Path(config.get('state_dir', root / '.local/ue2three/automation'))
    state = optional(state_dir / 'state.json')
    checkpoint = optional(root / '.local/ue2three/dds-agent/checkpoint.json')
    heartbeat = optional(root / '.local/ue2three/dds-agent/heartbeat.json')
    bridge = optional(Path.home() / '.chat-local-bridge/connection-health.json')
    asset_pipeline = asset_snapshot(root)
    jobs = []
    lanes = []
    worker_count = config.get('parallel_workers', 4)
    if type(worker_count) is not int or not 1 <= worker_count <= 4:
        worker_count = 4
    for name, record in checkpoint.get('families', {}).items():
        worker = Path(record.get('worktree_path', root / '.local/ue2three/dds-agent/worktrees' / name))
        detail = recent_worker(worker)
        running = record.get('status') == 'running'
        dedicated = root / '.local/ue2three/dds-agent/heartbeats' / name / 'heartbeat.json'
        beat = optional(dedicated) if dedicated.exists() else heartbeat
        heartbeat_age = age(beat.get('updated_at'))
        live = (running and beat.get('status') == 'running'
                and heartbeat_age is not None and heartbeat_age < 120)
        progress = worker_progress({**record, 'name': name}, state)
        jobs.append({'name': name, 'status': 'running' if live else record.get('status', 'unknown'),
                     'live': live, 'stale': running and not live, 'attempt': record.get('attempts', 0),
                     'lane': record.get('lane'), 'heartbeat_at': beat.get('updated_at'),
                     'result': record.get('result'), 'commit': record.get('commit'),
                     'started_at': record.get('started_at'), 'finished_at': record.get('finished_at'),
                     'affected_areas': WORKER_IMPACT.get(name, ()), 'progress': progress, **detail})
    for lane in range(1, worker_count + 1):
        entries = [item for item in jobs if item['lane'] == lane]
        latest = max(entries, key=lambda item: item.get('started_at') or '') if entries else None
        lanes.append({'id': lane, 'name': latest['name'] if latest else None,
                      'status': latest['status'] if latest else 'not_started',
                      'live': latest['live'] if latest else False,
                      'stale': latest['stale'] if latest else False,
                      'heartbeat_at': latest.get('heartbeat_at') if latest else None,
                      'result': latest.get('result') if latest else None,
                      'progress': latest['progress'] if latest else worker_progress({}, state),
                      'affected_areas': latest['affected_areas'] if latest else ()})
    counts = state.get('counts', {})
    total = counts.get('translated', 0) + counts.get('blocked', 0)
    bridge_age = age(bridge.get('time'))
    connected = bridge.get('status') == 'connected' and bridge_age is not None and bridge_age < 120
    phase = state.get('phase', 'not_started')
    events = [{'time': row.get('time'), 'phase': row.get('phase'), 'label': LABELS.get(row.get('phase'), row.get('phase'))}
              for row in reversed(state.get('events', []))]
    area_rows = areas(root, config, state, checkpoint, asset_pipeline)
    demo = optional(root / '.local/ue2three/demo-acceptance.json')
    for row in area_rows:
        row['execution'] = execution_label(row['id'], phase, jobs, asset_pipeline, demo)
    return {'time': datetime.now(timezone.utc).isoformat(), 'phase': phase,
            'phase_label': LABELS.get(phase, phase), 'paused': config.get('paused', False),
            'continuous': config.get('session_seconds') == 0, 'counts': counts,
            'function_percent': round(100 * counts.get('translated', 0) / total, 1) if total else 0,
            'function_total': total, 'jobs': jobs, 'lanes': lanes,
            'asset_pipeline': asset_pipeline,
            'configured_workers': worker_count, 'active_workers': sum(item['live'] for item in lanes),
            'bridge': {'connected': connected, 'status': bridge.get('status', 'unknown'),
                       'last_seen': bridge.get('time'), 'pending_results': bridge.get('pending_results', 0),
                       'incremental': bridge.get('incremental', False)},
            'events': events, 'areas': area_rows,
            'last_commit': state.get('pushed_commit'), 'error': state.get('error') if phase == 'failed' else None,
            'retry_after': state.get('retry_after'), 'waiting_reason': state.get('waiting_reason'),
            'additional_stages': state.get('additional_stages', {}),
            'ui_delivery': 'Il timeout della UI ChatGPT è esterno al tool. I job locali proseguono indipendentemente.'}


def handler(root, config_path, port, state_root=None):
    state_root = state_root or root
    class Handler(SimpleHTTPRequestHandler):
        # Windows registry MIME associations can label .js/.mjs text/plain.
        # ES module loading is strict; use portable explicit types here.
        extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                          '.js': 'text/javascript', '.mjs': 'text/javascript',
                          '.wasm': 'application/wasm', '.glb': 'model/gltf-binary',
                          '.wav': 'audio/wav'}
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(root), **kwargs)

        def reply(self, status, value):
            data = json.dumps(value, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def allowed_host(self):
            return self.headers.get('Host') in (f'127.0.0.1:{port}', f'localhost:{port}')

        def do_GET(self):
            if not self.allowed_host():
                return self.reply(403, {'error': 'Loopback host required'})
            path = unquote(urlsplit(self.path).path)
            if path == '/__ue2three/status':
                try:
                    return self.reply(200, snapshot(state_root, config_path))
                except Exception as error:
                    return self.reply(503, {'error': type(error).__name__, 'time': datetime.now(timezone.utc).isoformat()})
            if path.endswith('/automation.html') or path == '/':
                data = (root / 'tools/ue2three/automation-dashboard.html').read_bytes()
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            if any(part.startswith('.') for part in Path(path).parts) or Path(path).name in ('localSettings.js', 'steam.txt'):
                return self.reply(403, {'error': 'Private files are not served'})
            return super().do_GET()

        def do_POST(self):
            origin = self.headers.get('Origin')
            if (not self.allowed_host() or origin not in (f'http://127.0.0.1:{port}', f'http://localhost:{port}')
                    or self.path != '/__ue2three/control'):
                return self.reply(403, {'error': 'Same-origin local controls required'})
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 1024:
                    raise ValueError('Invalid request size')
                action = json.loads(self.rfile.read(size)).get('action')
                if action not in ('start', 'pause'):
                    raise ValueError('Unknown action')
                config = optional(config_path)
                config['paused'] = action == 'pause'
                _atomic_json(config_path, config)
                if action == 'start':
                    # Return immediately; no HTTP request waits for the agent.
                    subprocess.Popen(['powershell', '-NoProfile', '-Command',
                                      "Enable-ScheduledTask -TaskName 'DDS-UE2Three-Agent' | Out-Null; "
                                      "Start-ScheduledTask -TaskName 'DDS-UE2Three-Agent'"],
                                     creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                return self.reply(202, {'accepted': action, 'paused': config['paused']})
            except (ValueError, OSError):
                return self.reply(400, {'error': 'Control request failed'})

        def log_message(self, *args):
            pass
    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--port', type=int, default=8401)
    parser.add_argument('--state-root', type=Path,
                        help='Separate checkout containing live DDS state; dashboard code remains isolated')
    args = parser.parse_args()
    state_root = args.state_root.resolve() if args.state_root else ROOT
    server = ThreadingHTTPServer(('127.0.0.1', args.port),
                                 handler(ROOT, args.config.resolve(), args.port, state_root))
    server.serve_forever()


if __name__ == '__main__':
    import subprocess
    main()
