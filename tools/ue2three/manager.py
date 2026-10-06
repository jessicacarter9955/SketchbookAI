"""Loopback-only one-button project picker and ue2three workflow UI."""
import json
import os
import secrets
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


PAGE = r'''<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>ue2three · Unreal → Three.js</title><style>
:root{color-scheme:dark}body{font:16px system-ui;max-width:760px;margin:42px auto;padding:0 22px;background:#101923;color:#ecf3f9}h1{font-size:32px;margin:0 0 8px}p{line-height:1.5;color:#c6d4df}.card{background:#192736;border:1px solid #35465a;border-radius:14px;padding:24px;margin:20px 0}label{display:block;font-weight:650;margin:12px 0 7px}input,select{box-sizing:border-box;width:100%;padding:13px;background:#101923;color:#ecf3f9;border:1px solid #63798e;border-radius:7px;font-size:15px}button{padding:12px 17px;background:#34495e;color:white;border:0;border-radius:7px;font-weight:650;cursor:pointer}.row{display:flex;gap:9px;align-items:center}.row input{flex:1}.primary{width:100%;margin-top:18px;background:#087e71;font-size:17px;padding:15px}.primary:hover{background:#099887}button:disabled{opacity:.6;cursor:wait}small{color:#9fb0bf}#message{color:#f2d18a;font-weight:600;min-height:1.5em}progress{width:100%;height:16px;accent-color:#2ec4a6}.steps{display:flex;justify-content:space-between;color:#8295a7;font-size:12px;margin-top:10px}.steps span.active{color:#7ee2ca;font-weight:700}.steps span.done{color:#b3c7d4}.activity{margin-top:20px;border-top:1px solid #35465a;padding-top:10px}.activity h2{font-size:15px;margin:4px 0}#activity{margin:7px 0;padding-left:21px;color:#b8ccd7;max-height:170px;overflow:auto;font-size:14px}#activity li{padding:2px 0}#preview a{color:#8bd8ff;font-weight:650}</style><body>
<h1>ue2three</h1><p>Scegli un progetto Unreal e premi Avvia. Il tool analizza gli asset, cerca un personaggio compatibile e apre una scena Three.js quando è pronto. Tutto resta su questo PC.</p>
<section class="card"><label for="project">Progetto Unreal (.uproject)</label><div class="row"><input id="project" value="__PROJECT__" placeholder="Percorso del file .uproject"><button id="pick-project">Sfoglia…</button></div><small>Puoi scegliere un progetto diverso ogni volta. Personaggio e animazioni vengono rilevati automaticamente quando sono compatibili.</small>
<button id="start" class="primary">Avvia</button><p id="message" role="status">Progetto DDS selezionato. Premi Avvia per iniziare.</p><progress id="progress" max="100" value="0"></progress><div class="steps"><span data-phase="scan">Analisi progetto</span><span data-phase="assets">Ricerca asset</span><span data-phase="scene">Personaggio</span><span data-phase="maps">Mappe</span><span data-phase="done">Pronto</span></div><section class="activity"><h2>Attività</h2><ol id="activity" aria-live="polite"><li>In attesa di Avvia.</li></ol></section><label id="destination-label" for="destination" hidden>Scene portate dal progetto</label><select id="destination" hidden aria-label="Scegli una scena migrata"></select><p id="preview"></p></section>
<script>const token='__TOKEN__';let previewTab=null,lastState='';const project=document.querySelector('#project'),start=document.querySelector('#start'),destination=document.querySelector('#destination');
async function post(path,data={}){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,...data})});const b=await r.json();if(!r.ok)throw Error(b.message||'Impossibile avviare l’operazione.');return b;}
document.querySelector('#pick-project').onclick=async()=>{try{const r=await post('/api/pick');if(r.path)project.value=r.path;}catch(e){document.querySelector('#message').textContent=e.message;}};
start.onclick=async()=>{if(!project.value.trim()){document.querySelector('#message').textContent='Seleziona un progetto Unreal.';return;}try{previewTab=window.open('about:blank','_blank');start.disabled=true;document.querySelector('#message').textContent='Sto avviando l’analisi…';document.querySelector('#preview').textContent='';document.querySelector('#activity').replaceChildren();await post('/api/run',{project:project.value.trim()});}catch(e){if(previewTab){previewTab.close();previewTab=null;}start.disabled=false;document.querySelector('#message').textContent=e.message;}};
destination.onchange=()=>{const url=destination.value;if(!url)return;if(previewTab&&!previewTab.closed){previewTab.location=url;previewTab=null;}else window.open(url,'_blank');};
async function refresh(){try{const r=await fetch('/api/status');const s=await r.json();start.disabled=s.busy;const phases=['scan','assets','scene','maps','done'];const index=phases.indexOf(s.phase);document.querySelector('#progress').value=s.busy?Math.max(4,Math.min(95,s.progress)):s.exit_code===0?100:0;document.querySelectorAll('[data-phase]').forEach((node,i)=>{node.className=i<index?'done':i===index?'active':'';});if(s.message)document.querySelector('#message').textContent=s.message;const activity=document.querySelector('#activity');if(s.events?.length){activity.replaceChildren();for(const text of s.events){const li=document.createElement('li');li.textContent=text;activity.append(li);}}if(s.scenes?.length){destination.replaceChildren();for(const scene of s.scenes){const option=document.createElement('option');option.value=scene.url;option.textContent=scene.name;destination.append(option);}document.querySelector('#destination-label').hidden=false;destination.hidden=false;}if(s.preview_url){const safe=s.preview_url.startsWith('http://127.0.0.1:8401/');const preview=document.querySelector('#preview');preview.replaceChildren();if(safe){const a=document.createElement('a');a.href=s.preview_url;a.target='_blank';a.rel='noopener';a.textContent='Apri la scena selezionata';preview.append(a);destination.value=s.preview_url;if(previewTab&&s.exit_code===0){previewTab.location=s.preview_url;previewTab=null;}}}else if(!s.busy&&previewTab&&s.exit_code!==null){previewTab.close();previewTab=null;}if(s.exit_code!==null&&s.exit_code!==0)start.disabled=false;lastState=s.phase;}catch(e){document.querySelector('#message').textContent='Dashboard non raggiungibile. Ricarica la pagina.';start.disabled=false;}}
refresh();setInterval(refresh,900);</script></body></html>'''


def serve(directory, port):
    root = Path(directory).resolve()
    root.mkdir(parents=True, exist_ok=True)
    token = secrets.token_urlsafe(32)
    guard = threading.Lock()
    activity = {"process": None, "exit_code": None, "project": None, "phase": "", "log": root / "web-manager.log"}
    repo = Path(__file__).resolve().parents[2]
    project_default = r"C:\Users\jessi\OneDrive\Desktop\unreal\VIPDDSExtractionKitv2.1\VIPExtractionKitDDS.uproject"

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def response(self, code, value):
            raw = json.dumps(value, ensure_ascii=True).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(raw)

        def allowed(self):
            return self.headers.get("Host") == f"127.0.0.1:{self.server.server_port}"

        def do_GET(self):
            if not self.allowed():
                return self.response(403, {"message": "Apri l’interfaccia dall’indirizzo locale 127.0.0.1."})
            if self.path == "/":
                page = PAGE.replace("__TOKEN__", token).replace("__PROJECT__", project_default)
                raw = page.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(raw)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                return self.wfile.write(raw)
            if self.path != "/api/status":
                return self.response(404, {"message": "Not found"})
            process = activity["process"]
            code = process.poll() if process else activity["exit_code"]
            if process and code is not None:
                activity["exit_code"] = code
                activity["process"] = None
            try:
                log = activity["log"].read_text(encoding="utf-8", errors="replace")
            except OSError:
                log = ""
            if not activity["project"]:
                return self.response(200, {"busy": False, "exit_code": None, "phase": "", "message":
                                           "Progetto DDS selezionato. Premi Avvia per iniziare.", "progress": 0,
                                           "preview_url": None})
            markers = [line.split(" ", 1)[1].strip() for line in log.splitlines() if line.startswith("PHASE ")]
            phase = markers[-1] if markers else activity["phase"]
            notes = [line.split(" ", 1)[1].strip() for line in log.splitlines() if line.startswith("MESSAGE ")]
            events = notes[:]
            for line in log.splitlines():
                if (" MAP-PROGRESS " not in line and " MAP-EXPORT-DONE " not in line and
                        " MAP-EXPORT-FAILED " not in line and " UI-PROGRESS " not in line and
                        " UI-EXPORT-SUMMARY " not in line):
                    continue
                try:
                    encoded = line.split(None, 2)[2]
                    event_text = json.loads(encoded)
                except (IndexError, ValueError):
                    continue
                if event_text and event_text not in events:
                    events.append(event_text)
            events = events[-10:]
            scenes = []
            for line in log.splitlines():
                if line.startswith("SCENE\t"):
                    fields = line.split("\t", 2)
                    if len(fields) == 3 and fields[2].startswith("http://127.0.0.1:8401/"):
                        scenes.append({"name": fields[1], "url": fields[2]})
            message = notes[-1] if notes else "Sto lavorando al progetto…"
            if code not in (None, 0) and not process:
                message = "Non sono riuscito a completare la preparazione. Riprova o controlla la configurazione Unreal."
            elif code == 0 and phase == "done":
                message = notes[-1] if notes else "Preparazione completata. Scegli una scena migrata qui sotto."
            elif code == 0 and phase == "no-character":
                message = "Analisi completata. Non ho trovato automaticamente un personaggio e animazioni compatibili per creare una scena giocabile."
            preview_lines = [line.split("=", 1)[1] for line in log.splitlines() if line.startswith("PREVIEW_URL=")]
            preview_url = preview_lines[-1] if code == 0 and phase == "done" and preview_lines else None
            progress = {"scan": 12, "assets": 38, "scene": 69, "maps": 82, "done": 100, "no-character": 100}.get(phase, 0)
            return self.response(200, {"busy": bool(process and code is None), "exit_code": activity["exit_code"],
                                       "phase": phase, "message": message, "progress": progress,
                                       "events": events, "scenes": scenes, "preview_url": preview_url})

        def do_POST(self):
            if not self.allowed() or self.path not in {"/api/pick", "/api/run"}:
                return self.response(403, {"message": "Richiesta rifiutata."})
            origin = self.headers.get("Origin")
            if origin and origin != f"http://127.0.0.1:{self.server.server_port}":
                return self.response(403, {"message": "Origine non autorizzata."})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 8192:
                    raise ValueError("Richiesta non valida.")
                data = json.loads(self.rfile.read(length))
                if not isinstance(data, dict) or not secrets.compare_digest(str(data.get("token", "")), token):
                    return self.response(403, {"message": "Sessione scaduta: ricarica la pagina."})
                if self.path == "/api/pick":
                    import tkinter as tk
                    from tkinter import filedialog
                    window = tk.Tk()
                    window.withdraw()
                    window.attributes("-topmost", True)
                    path = filedialog.askopenfilename(parent=window, title="Seleziona il progetto Unreal (.uproject)",
                                                      filetypes=[("Progetti Unreal", "*.uproject"), ("Tutti i file", "*.*")])
                    window.destroy()
                    return self.response(200, {"path": path})
                project = Path(str(data.get("project", ""))).expanduser().resolve(strict=True)
                if project.suffix.lower() != ".uproject" or not project.is_file():
                    raise ValueError("Scegli un file .uproject valido.")
                descriptor = json.loads(project.read_text(encoding="utf-8-sig"))
                if not isinstance(descriptor, dict):
                    raise ValueError("Il file progetto non è valido.")
                with guard:
                    if activity["process"] and activity["process"].poll() is None:
                        return self.response(409, {"message": "Sto già preparando un progetto."})
                    log_path = root / "web-manager.log"
                    stream = log_path.open("wb")
                    command = [sys.executable, str(Path(__file__).with_name("web_runner.py")),
                               "--project", str(project), "--workspace-root", str(root), "--repo", str(repo)]
                    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
                    try:
                        process = subprocess.Popen(command, cwd=repo, stdin=subprocess.DEVNULL, stdout=stream,
                                                   stderr=subprocess.STDOUT, creationflags=flags)
                    finally:
                        stream.close()
                    activity.update(process=process, exit_code=None, project=str(project), phase="scan", log=log_path)
                return self.response(202, {"message": "Preparazione avviata."})
            except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as exc:
                return self.response(400, {"message": f"Non riesco a leggere quel progetto: {exc}"})

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"ue2three manager: http://127.0.0.1:{server.server_port}/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0
