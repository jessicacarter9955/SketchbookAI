"""Loopback-only view of real task state; actions launch the same CLI commands."""
import json
import secrets
import subprocess
import sys
import threading
import os
from urllib.parse import urlsplit, parse_qs
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from core import read_json
from pipeline import TASKS

PAGE = """<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>ue2three · offline inspection</title><style>
body{font:15px system-ui;max-width:1100px;margin:32px auto;padding:0 20px;background:#101923;color:#ecf3f9}
h1{font-size:28px}button,select,input{padding:9px;margin:4px;background:#213347;color:inherit;border:1px solid #63798e;border-radius:5px}
table{width:100%;border-collapse:collapse;margin:20px 0}td,th{text-align:left;padding:10px;border-bottom:1px solid #35465a}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#192736;padding:16px;max-height:340px;overflow:auto}
.note{color:#b9cbd9}#message{color:#ffc87d}</style>
<h1>ue2three <small>Stage 1</small></h1><p class="note">Offline project inspection. Converted assets: 0. Visual and gameplay fidelity: not evaluated.</p>
<label>Local jobs <select id="job" aria-label="Migration job"></select></label>
<p id="project"></p><p id="engine"></p><p id="summary"></p><progress id="progress" max="100" value="0"></progress><p id="quality"></p><p id="current"></p><p id="message" role="status"></p>
<div><button data-action="resume">Resume</button><button data-action="revalidate">Revalidate</button><button data-action="report">Refresh report</button>
<select id="task">__TASK_OPTIONS__</select><button data-action="retry">Retry task</button>
<input id="reason" placeholder="Reason for skipping" aria-label="Reason for skipping"><button data-action="skip">Skip task</button></div>
<table><thead><tr><th>Task</th><th>Status</th><th>Attempts</th><th>Detail</th></tr></thead><tbody id="tasks"></tbody></table>
<p><a id="report-link" href="/report" style="color:#8bd8ff">Open report</a> · <a id="log-link" href="/logs" style="color:#8bd8ff">Open logs</a> <button data-action="open-output">Open output folder</button></p><h2>Requires reconstruction</h2><ul id="manual"></ul><h2>Recent log events</h2><pre id="logs"></pre>
<script>
const token='__TOKEN__';let busy=false,job='';
document.querySelector('#job').onchange=event=>{job=event.target.value;refresh();};
async function refresh(){try{const data=await fetch('/api/state?job='+encodeURIComponent(job)).then(r=>r.json());busy=data.busy;job=data.job;
const selector=document.querySelector('#job');selector.replaceChildren();for(const item of data.jobs){const option=document.createElement('option');option.value=item.id;option.textContent=item.name+' · '+item.status;option.selected=item.id===job;selector.append(option);}
document.querySelector('#project').textContent=data.state.config.project;
const tasks=Object.values(data.state.tasks),done=tasks.filter(t=>t.status==='succeeded'||t.status==='skipped').length,percent=tasks.length?Math.round(done/tasks.length*100):0;
document.querySelector('#engine').textContent='Unreal: '+(data.report.engine?.version||data.report.engine?.requested_association||'unknown')+' · '+(data.report.engine?.status||'pending');
document.querySelector('#summary').textContent=(busy?'Working':'Idle')+' · Inspection tasks processed '+done+'/'+tasks.length+' ('+percent+'%) · Source verification: '+(data.state.source_verification_status||'pending')+(data.exit_code===null?'':' · Last action exit code: '+data.exit_code);
document.querySelector('#progress').value=percent;
const diagnostics=data.report.inspection?.diagnostics||[];
document.querySelector('#quality').textContent='Fidelity: not evaluated · Converted assets: 0 · Warnings '+diagnostics.filter(d=>d.severity==='warning').length+' · Errors '+diagnostics.filter(d=>d.severity==='error').length;
document.querySelector('#current').textContent='Latest stage: '+(data.progress.task||data.progress.event||'none')+(data.progress.current_asset?' · '+data.progress.current_asset:'')+' · '+(data.progress.message||'');
document.querySelector('#report-link').href='/report?job='+encodeURIComponent(job);document.querySelector('#log-link').href='/logs?job='+encodeURIComponent(job);
const manual=document.querySelector('#manual');manual.replaceChildren();for(const item of data.report.inspection?.capabilities||[]){const li=document.createElement('li');li.textContent=item.stage+': '+item.status+' — '+item.reason;manual.append(li);}
document.querySelectorAll('button').forEach(b=>b.disabled=busy);const body=document.querySelector('#tasks');body.replaceChildren();
for(const [name,task] of Object.entries(data.state.tasks)){const row=document.createElement('tr');for(const text of [name,task.status,task.attempts,task.error||task.skip_reason||task.reason||'']){const cell=document.createElement('td');cell.textContent=text;row.append(cell);}body.append(row);}
document.querySelector('#logs').textContent=data.logs.join('\\n');}catch(error){document.querySelector('#message').textContent=error.message;}}
document.querySelectorAll('button').forEach(button=>button.onclick=async()=>{const action=button.dataset.action;
const response=await fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,job,action,task:document.querySelector('#task').value,reason:document.querySelector('#reason').value})});
const result=await response.json();document.querySelector('#message').textContent=result.message;await refresh();});
refresh();setInterval(refresh,1500);
</script></html>"""


def serve(directory, port):
    token, guard = secrets.token_urlsafe(32), threading.Lock()
    activity = {"process": None, "exit_code": None}

    def jobs():
        candidates = [directory] + [p for p in directory.parent.iterdir() if p.is_dir() and not p.is_symlink() and p != directory]
        found = {}
        for path in candidates:
            try:
                state = read_json(path / "state.json")
                if state.get("schema_version") == 1 and state.get("config", {}).get("project"):
                    found[path.name] = path
            except (OSError, ValueError):
                pass
        return found

    def select_job(name):
        if not name:
            return directory
        selected = jobs().get(name)
        if selected is None:
            raise ValueError("Unknown migration job")
        return selected

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def response(self, code, value, content_type="application/json"):
            raw = (json.dumps(value, ensure_ascii=True) if content_type == "application/json" else value).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", content_type + "; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(raw)

        def allowed(self):
            return self.headers.get("Host") == f"127.0.0.1:{self.server.server_port}"

        def do_GET(self):
            if not self.allowed():
                return self.response(403, {"message": "Use the printed 127.0.0.1 URL"})
            parsed = urlsplit(self.path)
            try:
                directory = select_job(parse_qs(parsed.query).get("job", [""])[0])
            except ValueError as exc:
                return self.response(404, {"message": str(exc)})
            if parsed.path == "/":
                page = PAGE.replace("__TOKEN__", token).replace("__TASK_OPTIONS__", "".join(f"<option>{name}</option>" for name in TASKS))
                return self.response(200, page, "text/html")
            if parsed.path == "/api/state":
                process = activity["process"]
                status = process.poll() if process else None
                if process and status is not None:
                    activity["exit_code"] = status
                logs = directory / "run.log"
                with logs.open(encoding="utf-8") if logs.exists() else __import__("io").StringIO("") as stream:
                    recent = [line.rstrip() for line in deque(stream, maxlen=100)]
                def optional(name):
                    try:
                        return read_json(directory / name)
                    except (OSError, ValueError):
                        return {}
                summaries = []
                for key, path in jobs().items():
                    state = read_json(path / "state.json")
                    summaries.append({"id": key, "name": Path(state["config"]["project"]).stem, "status": state.get("source_verification_status", "pending")})
                return self.response(200, {"state": read_json(directory / "state.json"), "job": directory.name, "jobs": summaries, "report": optional("report.json"), "progress": optional("progress.json"), "busy": bool(process and status is None), "exit_code": activity["exit_code"], "logs": recent})
            if parsed.path == "/report" and (directory / "report.json").exists():
                return self.response(200, read_json(directory / "report.json"))
            if parsed.path == "/logs":
                return self.response(200, (directory / "run.log").read_text(encoding="utf-8") if (directory / "run.log").exists() else "No logs yet", "text/plain")
            return self.response(404, {"message": "Not found"})

        def do_POST(self):
            if not self.allowed() or self.path != "/api/action":
                return self.response(403, {"message": "Request rejected"})
            origin = self.headers.get("Origin")
            if origin and origin != f"http://127.0.0.1:{self.server.server_port}":
                return self.response(403, {"message": "Origin rejected"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 4096:
                    raise ValueError("Invalid request size")
                data = json.loads(self.rfile.read(length))
                if not isinstance(data, dict) or not secrets.compare_digest(str(data.get("token", "")), token):
                    return self.response(403, {"message": "Session token rejected"})
                action = data.get("action")
                directory = select_job(data.get("job"))
                if action == "open-output":
                    output = directory / "artifacts"
                    if not output.is_dir():
                        raise ValueError("Output has not been produced yet")
                    if sys.platform == "win32":
                        os.startfile(output)
                    else:
                        subprocess.Popen(["open" if sys.platform == "darwin" else "xdg-open", str(output)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    return self.response(200, {"message": "Opened " + str(output)})
                if action not in {"resume", "retry", "skip", "revalidate", "report"}:
                    raise ValueError("Unknown action")
                command = [sys.executable, str(Path(__file__).with_name("ue2three.py")), action, "--workspace", str(directory)]
                if action in {"retry", "skip"}:
                    if data.get("task") not in TASKS:
                        raise ValueError("Unknown task")
                    command += ["--task", data["task"]]
                if action == "skip":
                    if not isinstance(data.get("reason"), str) or not data["reason"].strip():
                        raise ValueError("Enter a reason for skipping")
                    command += ["--reason", data["reason"]]
                with guard:
                    if activity["process"] and activity["process"].poll() is None:
                        return self.response(409, {"message": "A task action is already running"})
                    flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
                    activity["process"] = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=flags)
                    activity["exit_code"] = None
                return self.response(202, {"message": f"Started {action}; state and logs show actual progress"})
            except (ValueError, OSError) as exc:
                return self.response(400, {"message": str(exc)})

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Dashboard: http://127.0.0.1:{server.server_port}/ (Ctrl+C stops the server)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0
