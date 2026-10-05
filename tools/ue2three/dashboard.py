"""Loopback-only Migration Manager. The browser UI controls local CLI processes."""
import json
import mimetypes
import os
import secrets
import subprocess
import sys
import threading
import webbrowser
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from core import digest, read_json
from pipeline import TASKS

REPO_ROOT = Path(__file__).resolve().parents[2]
RECIPES = Path(__file__).with_name("recipes")

PAGE = """<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>ue2three · Migration Manager</title><style>
body{font:15px system-ui;max-width:1100px;margin:32px auto;padding:0 20px;background:#101923;color:#ecf3f9}
h1{font-size:28px}.hero{padding:18px;background:#172536;border:1px solid #35465a;border-radius:10px;margin:16px 0}
button,select,input{padding:9px;margin:4px;background:#213347;color:inherit;border:1px solid #63798e;border-radius:5px}
button.primary{background:#286da8;border-color:#69b8f3;font-weight:700}button:disabled{opacity:.5}
table{width:100%;border-collapse:collapse;margin:20px 0}td,th{text-align:left;padding:10px;border-bottom:1px solid #35465a}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#192736;padding:16px;max-height:340px;overflow:auto}
.note{color:#b9cbd9}#message{color:#ffc87d}.empty{padding:26px;text-align:center;color:#b9cbd9}
a{color:#8bd8ff}</style>
<h1>ue2three <small>Migration Manager</small></h1>
<div class="hero">
<strong>Local Unreal project</strong>
<p class="note">Choose a .uproject from this PC. The path and source project stay local.</p>
<button class="primary" data-action="pick-project-auto">Choose Unreal project & start</button>
<button data-action="pick-project">Choose project & scan only</button>
<button data-action="run-all">Run all available migration</button>
</div>
<label>Local jobs <select id="job" aria-label="Migration job"></select></label>
<div id="empty" class="empty" hidden>No project selected yet. Choose an Unreal .uproject above.</div>
<div id="job-ui">
<p id="project"></p><p id="engine"></p><p id="summary"></p><progress id="progress" max="100" value="0"></progress>
<p id="quality"></p><p id="current"></p><p id="message" role="status"></p>
<div><button data-action="resume">Resume</button><button data-action="migrate-character">Migrate detected character</button>
<button data-action="revalidate">Revalidate</button><button data-action="report">Refresh report</button>
<select id="task">__TASK_OPTIONS__</select><button data-action="retry">Retry task</button>
<input id="reason" placeholder="Reason for skipping" aria-label="Reason for skipping"><button data-action="skip">Skip task</button></div>
<table><thead><tr><th>Task</th><th>Status</th><th>Attempts</th><th>Detail</th></tr></thead><tbody id="tasks"></tbody></table>
<p><a id="report-link" href="/report">Open report</a> · <a id="log-link" href="/logs">Open logs</a>
<button data-action="open-output">Open output folder</button></p>
<h2>Requires reconstruction</h2><ul id="manual"></ul><h2>Recent log events</h2><pre id="logs"></pre>
</div>
<script>
const token='__TOKEN__';let busy=false,job='';
const message=document.querySelector('#message');
document.querySelector('#job').onchange=event=>{job=event.target.value;refresh();};
async function refresh(){try{
 const data=await fetch('/api/state?job='+encodeURIComponent(job)).then(r=>r.json());busy=data.busy;job=data.job||'';
 const selector=document.querySelector('#job');selector.replaceChildren();
 for(const item of data.jobs){const option=document.createElement('option');option.value=item.id;option.textContent=item.name+' · '+item.status;option.selected=item.id===job;selector.append(option);}
 const has=!!data.state;document.querySelector('#empty').hidden=has;document.querySelector('#job-ui').hidden=!has;
 document.querySelectorAll('button').forEach(b=>b.disabled=busy);
 if(!has)return;
 document.querySelector('#project').textContent='Project: '+data.state.config.project;
 const tasks=Object.values(data.state.tasks),done=tasks.filter(t=>t.status==='succeeded'||t.status==='skipped').length,percent=tasks.length?Math.round(done/tasks.length*100):0;
 document.querySelector('#engine').textContent='Unreal: '+(data.report.engine?.version||data.report.engine?.requested_association||'unknown')+' · '+(data.report.engine?.status||'pending');
 document.querySelector('#summary').textContent=(busy?'Working':'Idle')+' · Inspection '+done+'/'+tasks.length+' ('+percent+'%) · Source '+(data.state.source_verification_status||'pending')+(data.exit_code===null?'':' · Last action '+data.exit_code);
 document.querySelector('#progress').value=percent;
 const diagnostics=data.report.inspection?.diagnostics||[],character=data.character||{};
 document.querySelector('#quality').textContent='Character: '+(character.status||'not migrated')+' · Fidelity: '+(data.report.fidelity?.status||'not evaluated')+' · Warnings '+diagnostics.filter(d=>d.severity==='warning').length+' · Errors '+diagnostics.filter(d=>d.severity==='error').length;
 document.querySelector('#current').textContent='Latest stage: '+(data.progress.task||data.progress.event||'none')+(data.progress.current_asset?' · '+data.progress.current_asset:'')+' · '+(data.progress.message||'');
 document.querySelector('#report-link').href='/report?job='+encodeURIComponent(job);document.querySelector('#log-link').href='/logs?job='+encodeURIComponent(job);
 const manual=document.querySelector('#manual');manual.replaceChildren();for(const item of data.report.inspection?.capabilities||[]){const li=document.createElement('li');li.textContent=item.stage+': '+item.status+' — '+item.reason;manual.append(li);}
 const body=document.querySelector('#tasks');body.replaceChildren();
 for(const [name,task] of Object.entries(data.state.tasks)){const row=document.createElement('tr');for(const text of [name,task.status,task.attempts,task.error||task.skip_reason||task.reason||'']){const cell=document.createElement('td');cell.textContent=text;row.append(cell);}body.append(row);}
 document.querySelector('#logs').textContent=data.logs.join('\n');
 }catch(error){message.textContent=error.message;}}
document.querySelectorAll('button').forEach(button=>button.onclick=async()=>{
 const action=button.dataset.action;message.textContent='Starting '+action+'…';
 const response=await fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,job,action,task:document.querySelector('#task')?.value,reason:document.querySelector('#reason')?.value})});
 const result=await response.json();if(result.job)job=result.job;message.textContent=result.message||'';await refresh();
});
refresh();setInterval(refresh,1500);
</script></html>"""


def _native_project_picker():
    """Return a user-selected local .uproject path, or None when cancelled."""
    if sys.platform == "win32":
        script = (
            "Add-Type -AssemblyName System.Windows.Forms;"
            "$d=New-Object System.Windows.Forms.OpenFileDialog;"
            "$d.Title='Choose Unreal project';"
            "$d.Filter='Unreal project (*.uproject)|*.uproject';"
            "$d.CheckFileExists=$true;"
            "if($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){"
            "[Console]::Write($d.FileName)}"
        )
        flags = subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-STA", "-Command", script],
            capture_output=True, text=True, creationflags=flags
        )
        if result.returncode:
            raise RuntimeError("Windows project picker failed: " + (result.stderr.strip() or "PowerShell error"))
        selected = result.stdout.strip()
        return Path(selected).resolve() if selected else None
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk(); root.withdraw()
        selected = filedialog.askopenfilename(title="Choose Unreal project", filetypes=[("Unreal project", "*.uproject")])
        root.destroy()
        return Path(selected).resolve() if selected else None
    except Exception as exc:
        raise RuntimeError("Native project picker unavailable on this system") from exc


def _matching_character_recipe(project):
    """Find a bundled character recipe whose declared package files exist in this project."""
    try:
        from character import load_character_recipe, package_files
    except ImportError:
        return None
    matches = []
    for path in sorted(RECIPES.glob("*.json")):
        try:
            recipe = load_character_recipe(path)
            for package in {recipe["mesh"], *recipe["clips"].values()}:
                package_files(project, package)
            matches.append(path)
        except (OSError, ValueError):
            continue
    return matches[0] if len(matches) == 1 else None


def serve(directory, port, open_browser=False):
    directory = Path(directory).resolve()
    has_initial_state = (directory / "state.json").is_file()
    job_root = directory.parent if has_initial_state else directory
    initial_job = directory if has_initial_state else None
    job_root.mkdir(parents=True, exist_ok=True)

    token, guard = secrets.token_urlsafe(32), threading.Lock()
    activity = {"process": None, "worker": None, "exit_code": None, "job": initial_job.name if initial_job else ""}

    def jobs():
        found = {}
        if not job_root.is_dir():
            return found
        for path in job_root.iterdir():
            if not path.is_dir() or path.is_symlink():
                continue
            try:
                state = read_json(path / "state.json")
                if state.get("schema_version") == 1 and state.get("config", {}).get("project"):
                    found[path.name] = path
            except (OSError, ValueError):
                pass
        if has_initial_state:
            found.setdefault(directory.name, directory)
        return dict(sorted(found.items()))

    def select_job(name):
        available = jobs()
        if name:
            selected = available.get(name)
            if selected is None:
                raise ValueError("Unknown migration job")
            return selected
        if activity["job"] in available:
            return available[activity["job"]]
        if initial_job and initial_job.name in available:
            return initial_job
        return next(iter(available.values()), None)

    def is_busy():
        process = activity["process"]
        worker = activity["worker"]
        return bool((process and process.poll() is None) or (worker and worker.is_alive()))

    def spawn(command):
        flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
        activity["process"] = subprocess.Popen(
            command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, creationflags=flags
        )
        activity["exit_code"] = None
        return activity["process"]

    def scan_command(project, workspace):
        return [sys.executable, str(Path(__file__).with_name("ue2three.py")),
                "scan", str(project), "--workspace", str(workspace)]

    def character_command(project, workspace, recipe):
        publish = REPO_ROOT / "build" / "local-scenes" / "ue2three" / "current"
        return [sys.executable, str(Path(__file__).with_name("ue2three.py")),
                "migrate-character", str(project), "--recipe", str(recipe),
                "--workspace", str(workspace), "--publish-dir", str(publish)]

    def start_sequence(commands):
        def worker():
            last = 0
            try:
                for command in commands:
                    process = spawn(command)
                    last = process.wait()
                    activity["exit_code"] = last
                    if last:
                        break
            finally:
                activity["process"] = None
                activity["exit_code"] = last
        thread = threading.Thread(target=worker, name="ue2three-dashboard-worker", daemon=True)
        activity["worker"] = thread
        thread.start()

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
                return self.response(403, {"message": "Use the local 127.0.0.1 URL"})
            parsed = urlsplit(self.path)
            try:
                selected = select_job(parse_qs(parsed.query).get("job", [""])[0])
            except ValueError as exc:
                return self.response(404, {"message": str(exc)})
            if parsed.path == "/":
                page = PAGE.replace("__TOKEN__", token).replace(
                    "__TASK_OPTIONS__", "".join(f"<option>{name}</option>" for name in TASKS)
                )
                return self.response(200, page, "text/html")
            if parsed.path == "/api/state":
                process = activity["process"]
                status = process.poll() if process else None
                if process and status is not None:
                    activity["exit_code"] = status
                summaries = []
                for key, path in jobs().items():
                    state = read_json(path / "state.json")
                    summaries.append({"id": key, "name": Path(state["config"]["project"]).stem,
                                      "status": state.get("source_verification_status", "pending")})
                if selected is None:
                    return self.response(200, {"state": None, "job": "", "jobs": summaries,
                                               "report": {}, "progress": {}, "character": {},
                                               "busy": is_busy(), "exit_code": activity["exit_code"], "logs": []})
                activity["job"] = selected.name
                logs = selected / "run.log"
                with logs.open(encoding="utf-8") if logs.exists() else __import__("io").StringIO("") as stream:
                    recent = [line.rstrip() for line in deque(stream, maxlen=100)]
                def optional(name):
                    try:
                        return read_json(selected / name)
                    except (OSError, ValueError):
                        return {}
                return self.response(200, {
                    "state": read_json(selected / "state.json"), "job": selected.name, "jobs": summaries,
                    "report": optional("report.json"), "progress": optional("progress.json"),
                    "character": optional("character-last.json"), "busy": is_busy(),
                    "exit_code": activity["exit_code"], "logs": recent
                })
            if selected is None:
                return self.response(404, {"message": "No project selected"})
            if parsed.path == "/report" and (selected / "report.json").exists():
                return self.response(200, read_json(selected / "report.json"))
            if parsed.path == "/logs":
                return self.response(200, (selected / "run.log").read_text(encoding="utf-8")
                                     if (selected / "run.log").exists() else "No logs yet", "text/plain")
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
                with guard:
                    if is_busy():
                        return self.response(409, {"message": "A migration action is already running"})
                    if action in {"pick-project", "pick-project-auto"}:
                        project = _native_project_picker()
                        if project is None:
                            return self.response(200, {"message": "Project selection cancelled"})
                        if not project.is_file() or project.suffix.lower() != ".uproject":
                            raise ValueError("Choose a valid Unreal .uproject file")
                        workspace = job_root / (project.stem + "-" + digest(str(project))[:10])
                        activity["job"] = workspace.name
                        commands = [scan_command(project, workspace)]
                        if action == "pick-project-auto":
                            recipe = _matching_character_recipe(project)
                            if recipe:
                                commands.append(character_command(project, workspace, recipe))
                        start_sequence(commands)
                        suffix = " and matching character migration" if len(commands) > 1 else ""
                        return self.response(202, {"message": "Started project scan" + suffix,
                                                   "job": workspace.name})
                    selected = select_job(data.get("job"))
                    if selected is None:
                        raise ValueError("Choose an Unreal project first")
                    state = read_json(selected / "state.json")
                    project = Path(state["config"]["project"]).resolve()
                    if action == "run-all":
                        recipe = _matching_character_recipe(project)
                        commands = [scan_command(project, selected)]
                        if recipe:
                            commands.append(character_command(project, selected, recipe))
                        start_sequence(commands)
                        return self.response(202, {"message": "Started all currently available migration stages",
                                                   "job": selected.name})
                    if action == "migrate-character":
                        recipe = _matching_character_recipe(project)
                        if not recipe:
                            raise ValueError("No bundled character recipe matches this project yet")
                        spawn(character_command(project, selected, recipe))
                        return self.response(202, {"message": "Started detected character migration",
                                                   "job": selected.name})
                    if action == "open-output":
                        output = selected / "output"
                        if not output.is_dir():
                            output = selected / "artifacts"
                        if not output.is_dir():
                            raise ValueError("Output has not been produced yet")
                        if sys.platform == "win32":
                            os.startfile(output)
                        else:
                            subprocess.Popen(["open" if sys.platform == "darwin" else "xdg-open", str(output)],
                                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                        return self.response(200, {"message": "Opened " + str(output)})
                    if action not in {"resume", "retry", "skip", "revalidate", "report"}:
                        raise ValueError("Unknown action")
                    command = [sys.executable, str(Path(__file__).with_name("ue2three.py")),
                               action, "--workspace", str(selected)]
                    if action in {"retry", "skip"}:
                        if data.get("task") not in TASKS:
                            raise ValueError("Unknown task")
                        command += ["--task", data["task"]]
                    if action == "skip":
                        if not isinstance(data.get("reason"), str) or not data["reason"].strip():
                            raise ValueError("Enter a reason for skipping")
                        command += ["--reason", data["reason"]]
                    spawn(command)
                    return self.response(202, {"message": f"Started {action}; state and logs show actual progress",
                                               "job": selected.name})
            except (ValueError, OSError, RuntimeError) as exc:
                return self.response(400, {"message": str(exc)})

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{server.server_port}/"
    print(f"Dashboard: {url} (Ctrl+C stops the server)", flush=True)
    if open_browser:
        threading.Timer(0.2, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0
