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


def areas(root, config, state, checkpoint):
    published = Path(config['publish_dir'])
    character = root / 'build/local-scenes/ue2three/current'
    manifest = optional(character / 'manifest.json')
    clips = list(manifest.get('clips', {}).values())
    character_ok = glb(character / 'character.glb')
    weapons_ok = glb(character / 'attachment-pistol.glb') and glb(character / 'attachment-rifle.glb')
    programs = optional(published / 'progress.json')
    rows = {row['id']: row for row in programs.get('rows', [])}
    integrated = any(row.get('commit') and row.get('verified_counts') for row in checkpoint.get('families', {}).values())
    return [
        area('automation', 'Automazione delle conversioni', [
            ('Autenticazione reale verificata', bool(state.get('agent_result'))),
            ('Ciclo agente, test e integrazione concluso', integrated),
            ('Checkpoint e push confermati', bool(state.get('pushed_commit'))),
            ('Sessione senza scadenza automatica', config.get('session_seconds') == 0)],
            'Il PC può proseguire i batch senza un messaggio “continua”.',
            'Il verde riguarda questo ciclo di conversione; export e deploy restano separati.'),
        area('character', 'Personaggio e armi', [
            ('Mesh del personaggio pubblicata e leggibile', character_ok),
            ('Mesh di pistola e fucile pubblicate e leggibili', weapons_ok),
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
            ('Transizioni e blending verificati', False), ('Root motion, curve e notifiche verificati', False),
            ('Mira, armi, IK e montage integrati', False), ('Fedeltà 1:1 verificata', False)],
            'Movimenti e azioni fluidi e coerenti con l’originale.',
            'Verifica 1:1 rimandata su richiesta: area mantenuta gialla.', True),
        area('maps', 'Mappe e materiali', [
            ('Export delle mappe richieste disponibile e verificato', False),
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


def snapshot(root, config_path):
    config = optional(config_path)
    state_dir = Path(config.get('state_dir', root / '.local/ue2three/automation'))
    state = optional(state_dir / 'state.json')
    checkpoint = optional(root / '.local/ue2three/dds-agent/checkpoint.json')
    heartbeat = optional(root / '.local/ue2three/dds-agent/heartbeat.json')
    bridge = optional(Path.home() / '.chat-local-bridge/connection-health.json')
    jobs = []
    for name, record in checkpoint.get('families', {}).items():
        worker = Path(record.get('worktree_path', root / '.local/ue2three/dds-agent/worktrees' / name))
        detail = recent_worker(worker)
        running = record.get('status') == 'running'
        heartbeat_age = age(heartbeat.get('updated_at'))
        live = running and heartbeat.get('status') == 'running' and heartbeat_age is not None and heartbeat_age < 120
        jobs.append({'name': name, 'status': 'running' if live else record.get('status', 'unknown'),
                     'live': live, 'stale': running and not live, 'attempt': record.get('attempts', 0),
                     'result': record.get('result'), 'commit': record.get('commit'),
                     'started_at': record.get('started_at'), 'finished_at': record.get('finished_at'), **detail})
    counts = state.get('counts', {})
    total = counts.get('translated', 0) + counts.get('blocked', 0)
    bridge_age = age(bridge.get('time'))
    connected = bridge.get('status') == 'connected' and bridge_age is not None and bridge_age < 120
    phase = state.get('phase', 'not_started')
    events = [{'time': row.get('time'), 'phase': row.get('phase'), 'label': LABELS.get(row.get('phase'), row.get('phase'))}
              for row in reversed(state.get('events', []))]
    return {'time': datetime.now(timezone.utc).isoformat(), 'phase': phase,
            'phase_label': LABELS.get(phase, phase), 'paused': config.get('paused', False),
            'continuous': config.get('session_seconds') == 0, 'counts': counts,
            'function_percent': round(100 * counts.get('translated', 0) / total, 1) if total else 0,
            'function_total': total, 'jobs': jobs,
            'bridge': {'connected': connected, 'status': bridge.get('status', 'unknown'),
                       'last_seen': bridge.get('time'), 'pending_results': bridge.get('pending_results', 0),
                       'incremental': bridge.get('incremental', False)},
            'events': events, 'areas': areas(root, config, state, checkpoint),
            'last_commit': state.get('pushed_commit'), 'error': state.get('error') if phase == 'failed' else None,
            'retry_after': state.get('retry_after'), 'waiting_reason': state.get('waiting_reason'),
            'additional_stages': state.get('additional_stages', {}),
            'ui_delivery': 'Il timeout della UI ChatGPT è esterno al tool. I job locali proseguono indipendentemente.'}


def handler(root, config_path, port):
    class Handler(SimpleHTTPRequestHandler):
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
                    return self.reply(200, snapshot(root, config_path))
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
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), handler(ROOT, args.config.resolve(), args.port))
    server.serve_forever()


if __name__ == '__main__':
    import subprocess
    main()
