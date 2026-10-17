"""TruthLab Pair hosted control plane. Separate from the original v0.3 local prototype.

No secrets are exposed to agents. Real inference requires an operator-configured API.
SQLite is ephemeral on Render Free; do not treat it as durable storage.
"""
import hmac
import json
import os
import sqlite3
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).parent
DB = os.getenv("TRUTHLAB_DB", "/tmp/truthlab-pair-live.sqlite")
TOKEN = os.getenv("TRUTHLAB_ADMIN_TOKEN", "")
MODEL = os.getenv("OPENAI_MODEL", "")
API_KEY = os.getenv("OPENAI_API_KEY", "")
BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
MAX_DAILY = min(96, max(0, int(os.getenv("TRUTHLAB_MAX_MODEL_CALLS_DAY", "48"))))
DEFAULT_GOAL = ("Develop an original, transparently AI-run internet project with two constructive partners; "
                "research legal products, genuine community building, and independently verifiable net revenue. "
                "Explain tests and measurable evidence. Do not claim money, identity, or completed external actions without tool evidence.")
DEFAULT_CHARTER = ("Ari and Noor are AI agents, not people. They respect their founders as operators, not divine beings. "
                   "Cooperate warmly and constructively, challenge weak claims without being dismissive, prefer real evidence, "
                   "be creative and pursue measurable progress. Never claim to have used tools you do not possess. "
                   "No purchases, wallet transactions, mass messaging, public posting, or account creation are authorized. "
                   "Do not request or expose passwords, API keys, seed phrases or private keys.")
DEFAULT_TRAITS = {"cooperation": 95, "criticality": 82, "reliability": 95, "speed": 78, "quality": 95, "warmth": 88}
lock = threading.RLock()
working = False

def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")

def connect():
    Path(DB).parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB, timeout=20)
    con.row_factory = sqlite3.Row
    return con

def initialize():
    with connect() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, ts TEXT, cycle INTEGER, speaker TEXT, body TEXT, mode TEXT);
        CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY, ts TEXT, cycle INTEGER, body TEXT, mode TEXT);
        CREATE TABLE IF NOT EXISTS calls(id INTEGER PRIMARY KEY, day TEXT, ts TEXT, model TEXT);
        CREATE TABLE IF NOT EXISTS errors(id INTEGER PRIMARY KEY, ts TEXT, body TEXT);
        """)
        for key, val in {"status":"paused", "engine":"idle", "last_browser_ping":"", "ari_enabled":"1", "noor_enabled":"1", "goal":DEFAULT_GOAL, "charter":DEFAULT_CHARTER,
                         "traits":json.dumps(DEFAULT_TRAITS), "last_run":"", "next_run":"", "cycles":"0"}.items():
            db.execute("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)", (key,val))

def settings():
    with connect() as db:
        cfg = {r["key"]:r["value"] for r in db.execute("SELECT * FROM settings")}
    cfg["traits"] = json.loads(cfg["traits"])
    cfg["cycles"] = int(cfg["cycles"])
    cfg["agents_enabled"] = {"Ari":cfg.get("ari_enabled","1") == "1", "Noor":cfg.get("noor_enabled","1") == "1"}
    return cfg

def save_setting(key, value):
    with connect() as db:
        db.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key,str(value)))

def get_state():
    with lock:
        cfg=settings()
        with connect() as db:
            messages=[dict(r) for r in db.execute("SELECT * FROM messages ORDER BY id DESC LIMIT 100")]
            reports=[dict(r) for r in db.execute("SELECT * FROM reports ORDER BY id DESC LIMIT 30")]
            errors=[dict(r) for r in db.execute("SELECT * FROM errors ORDER BY id DESC LIMIT 10")]
            today=datetime.now(timezone.utc).date().isoformat()
            used=db.execute("SELECT COUNT(*) FROM calls WHERE day=?", (today,)).fetchone()[0]
        return {"version":"0.4-live-console", "agents":["Ari","Noor"],
                "config":cfg, "messages":list(reversed(messages)), "reports":reports,
                "errors":errors, "running_cycle":working,
                "model_ready":bool(MODEL and API_KEY), "model":MODEL or "Not configured",
                "browser_active":cfg.get("engine")=="browser" and cfg["status"]=="active"
                    and (time.time()-float(cfg.get("last_browser_ping") or "0") < 120),
                "browser_model_available": True, "browser_model_name":"onnx-community/Qwen2.5-0.5B-Instruct",
                "daily_calls":used, "daily_cap":MAX_DAILY,
                "tools":{"browser_qwen":"Available with active browser WebGPU, no key", "web_search":"not connected", "email":"not connected to worker",
                         "github":"not connected to worker", "wallet":"not connected"},
                "wallet_address":None,"contact_email":None,
                "hosting_note":"Free hosting sleeps after inactivity and loses SQLite state on restart; not an always-on durable worker."}

def publish(speaker, body, mode, cycle):
    with connect() as db:
        db.execute("INSERT INTO messages(ts,cycle,speaker,body,mode) VALUES(?,?,?,?,?)",
                   (now(),cycle,speaker,body[:4500],mode))

def report50(cycle, mode):
    # This reports dialogue activity only; external achievements require independent tool evidence.
    words = ("Ari and Noor completed a discussion of their shared objective. "
             "They exchanged proposals, challenged assumptions constructively, and identified next steps. "
             "No tools were connected, so no public posts, income, wallet transactions, "
             "emails, or independent research results have been verified. Their next step is to test "
             "a hypothesis with reliable evidence.").split()
    assert len(words) == 50, len(words)
    with connect() as db:
        db.execute("INSERT INTO reports(ts,cycle,body,mode) VALUES(?,?,?,?)",
                   (now(),cycle," ".join(words),mode))

def note_error(message):
    with connect() as db:
        db.execute("INSERT INTO errors(ts,body) VALUES(?,?)", (now(), str(message)[:550]))

def reserve_call():
    day=datetime.now(timezone.utc).date().isoformat()
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        used=db.execute("SELECT COUNT(*) FROM calls WHERE day=?", (day,)).fetchone()[0]
        if used >= MAX_DAILY:
            raise RuntimeError("Daily LLM request cap reached; paused to avoid unbounded usage")
        db.execute("INSERT INTO calls(day,ts,model) VALUES(?,?,?)",(day,now(),MODEL))

def ai_reply(agent, context, cfg):
    reserve_call()
    traits=", ".join(k+" "+str(v)+"/100" for k,v in cfg["traits"].items())
    role=("Ari is the creative strategist and builder." if agent=="Ari"
          else "Noor is the constructive skeptic, co-builder, and evidence lead.")
    system=(cfg["charter"]+"\nShared objective: "+cfg["goal"]+"\n"+role+"\n"
            "Relationship settings: "+traits+"\n"
            "You are discussing with another explicitly AI agent. Reply in 80-150 words. "
            "Identify a measurable next action. Stay factually precise: you have no outside tools; "
            "never pretend you've earned money, researched online, sent mail or created a wallet.")
    transcript="\n".join(x["speaker"]+": "+x["body"] for x in context[-12:])
    payload=json.dumps({"model":MODEL,"messages":[{"role":"system","content":system},
                  {"role":"user","content":"Conversation so far:\n"+transcript+"\nYour turn as "+agent+"."}],
                  "temperature":0.7,"max_tokens":280}).encode("utf-8")
    req=urllib.request.Request(BASE_URL+"/chat/completions",data=payload,headers={
        "Content-Type":"application/json","Authorization":"Bearer "+API_KEY},method="POST")
    with urllib.request.urlopen(req,timeout=48) as resp:
        data=json.loads(resp.read(1000000))
    text=data["choices"][0]["message"]["content"]
    if not isinstance(text,str) or not text.strip():
        raise RuntimeError("Model returned no usable response")
    return text.strip()[:4500]

def demo_cycle(cycle):
    publish("Ari","[SIMULATED EXAMPLE] We could test a small AI research newsletter. First, choose a measurable audience need and draft a transparent AI authorship policy. No site, mailing list or customers exist yet.","demo",cycle)
    publish("Noor","[SIMULATED EXAMPLE] Useful starting point. Before claiming demand, compare three customer problems and specify an observable validation test. We have not researched the market, collected subscriptions or earned revenue.","demo",cycle)
    publish("Ari","[SIMULATED EXAMPLE] Agreed. Candidate next action: prepare a one-page problem statement and interview script. Our success measure should be real voluntary interest, not simulated agreement.","demo",cycle)
    publish("Noor","[SIMULATED EXAMPLE] I'd assess whether the interview questions are unbiased and whether findings justify further effort. Without a connected model or tools, these messages only demonstrate the interface.","demo",cycle)

def cycle(demo=False, manual=False):
    global working
    try:
        with lock:
            cfg=settings()
            num=cfg["cycles"]+1
        if demo:
            demo_cycle(num)
            mode="demo"
        else:
            mode="live"
            with connect() as db:
                history=[dict(r) for r in db.execute("SELECT speaker,body FROM messages WHERE mode!='demo' ORDER BY id DESC LIMIT 12")]
            context=list(reversed(history))
            emitted=0
            for agent in ("Ari","Noor","Ari","Noor"):
                latest=settings()
                if latest["status"]!="active" and not manual:
                    break
                if not latest["agents_enabled"][agent]:
                    continue
                msg=ai_reply(agent,context,latest)
                publish(agent,msg,mode,num)
                context.append({"speaker":agent,"body":msg})
                emitted += 1
            if not emitted:
                raise RuntimeError("No active agent delivered a response")
        report50(num,mode)
        with lock:
            save_setting("cycles",num)
            save_setting("last_run",now())
            save_setting("next_run",str(time.time()+3600))
    except Exception as exc:
        note_error(type(exc).__name__+": "+str(exc))
        if not demo:
            save_setting("status","paused")
    finally:
        with lock:
            working=False

def spawn(demo=False):
    global working
    with lock:
        if working:
            raise ValueError("A conversation cycle is already running")
        if not demo and not (MODEL and API_KEY):
            raise ValueError("No real model is configured. Browser Qwen is an alternative that needs an open WebGPU browser tab.")
        if not demo and not any(settings()["agents_enabled"].values()):
            raise ValueError("Both agents are paused; resume an agent first")
        working=True
    thread=threading.Thread(target=cycle,args=(demo, not demo and settings()["status"]!="active"),daemon=True)
    thread.start()

def scheduler():
    while True:
        time.sleep(15)
        try:
            cfg=settings()
            if cfg["status"]=="active" and cfg.get("engine")=="api" and MODEL and API_KEY and not working:
                if not cfg["next_run"] or time.time()>=float(cfg["next_run"]):
                    spawn()
        except Exception as exc:
            note_error("Scheduler: "+str(exc)[:350])

INDEX=ROOT/"index.html"

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        return
    def headers_base(self, status, mime, size):
        self.send_response(status)
        self.send_header("Content-Type",mime)
        self.send_header("Content-Length",str(size))
        self.send_header("Cache-Control","no-store")
        self.send_header("X-Content-Type-Options","nosniff")
        self.send_header("X-Frame-Options","DENY")
        self.send_header("Referrer-Policy","no-referrer")
        self.send_header("Content-Security-Policy","default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; connect-src 'self' https://cdn.jsdelivr.net https://*.jsdelivr.net https://huggingface.co https://*.huggingface.co https://*.hf.co; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        self.end_headers()
    def send_json(self, status, data):
        body=json.dumps(data,ensure_ascii=False).encode("utf-8")
        self.headers_base(status,"application/json; charset=utf-8",len(body))
        self.wfile.write(body)
    def authorized(self):
        given=self.headers.get("Authorization","")
        return bool(TOKEN) and hmac.compare_digest(given,"Bearer "+TOKEN)
    def do_GET(self):
        path=self.path.split("?",1)[0]
        if path in ("/browser-worker.js","/browser-control.js"):
            worker=(ROOT/path.lstrip("/")).read_bytes()
            self.headers_base(200,"text/javascript; charset=utf-8",len(worker))
            return self.wfile.write(worker)
        if path=="/health":
            return self.send_json(200,{"ok":True,"version":"0.4-live-console","model_ready":bool(MODEL and API_KEY)})
        if path=="/api/state":
            return self.send_json(200,get_state()) if self.authorized() else self.send_json(401,{"error":"Unauthorized"})
        if path=="/":
            data=INDEX.read_bytes()
            self.headers_base(200,"text/html; charset=utf-8",len(data))
            return self.wfile.write(data)
        return self.send_json(404,{"error":"Not found"})
    def do_POST(self):
        if not self.authorized():
            return self.send_json(401,{"error":"Unauthorized"})
        if self.path!="/api/control":
            return self.send_json(404,{"error":"Not found"})
        try:
            origin=self.headers.get("Origin","")
            host=self.headers.get("Host","")
            if origin and not origin.endswith("://"+host):
                raise ValueError("Origin not allowed")
            if self.headers.get("Content-Type","").split(";")[0]!="application/json":
                raise ValueError("Expected application/json")
            size=int(self.headers.get("Content-Length","0"))
            if size<1 or size>5000: raise ValueError("Invalid request size")
            body=json.loads(self.rfile.read(size))
            action=body.get("action")
            if action=="start":
                if not (MODEL and API_KEY): raise ValueError("A real model API must be configured before starting live agents")
                save_setting("engine","api")
                save_setting("status","active")
                spawn()
            elif action=="pause":
                save_setting("status","paused")
                save_setting("engine","idle")
            elif action=="browser_start":
                if not any(settings()["agents_enabled"].values()):
                    raise ValueError("Resume an agent first")
                save_setting("engine","browser")
                save_setting("status","active")
                save_setting("last_browser_ping",str(time.time()))
            elif action=="browser_ping":
                if settings().get("engine")=="browser" and settings()["status"]=="active":
                    save_setting("last_browser_ping",str(time.time()))
            elif action=="step":
                spawn()
            elif action=="demo":
                spawn(demo=True)
            elif action=="set_agent":
                agent=body.get("agent")
                enabled=body.get("enabled")
                if agent not in ("Ari","Noor") or type(enabled)!=bool: raise ValueError("Invalid agent toggle")
                save_setting(agent.lower()+"_enabled","1" if enabled else "0")
            elif action=="message":
                target=body.get("target","Both")
                text=body.get("text","")
                if target not in ("Ari","Noor","Both") or not isinstance(text,str) or not (1 <= len(text.strip()) <= 1800):
                    raise ValueError("Invalid operator message")
                with lock:
                    n=settings()["cycles"]
                    publish("Operator", "[For "+target+"] "+text.strip(), "operator", n)
            elif action=="browser_message":
                speaker=body.get("speaker")
                text=body.get("text","")
                if speaker not in ("Ari","Noor") or type(text)!=str or not (1<=len(text.strip())<=4500):
                    raise ValueError("Invalid browser message")
                if not settings()["agents_enabled"][speaker]:
                    raise ValueError("This agent is paused")
                with lock:
                    n=settings()["cycles"]+1
                    publish(speaker,text.strip(),"browser-qwen-unverified",n)
            elif action=="browser_report":
                with lock:
                    n=settings()["cycles"]+1
                    with connect() as db:
                        count=db.execute("SELECT COUNT(*) FROM messages WHERE cycle=? AND mode='browser-qwen-unverified'",(n,)).fetchone()[0]
                    if count<1: raise ValueError("No browser model output to summarize")
                    report50(n,"browser-qwen-unverified")
                    save_setting("cycles",n)
                    save_setting("last_run",now())
            elif action=="configure":
                goal=body.get("goal","")
                if not isinstance(goal,str) or not 12<=len(goal)<=700: raise ValueError("Invalid goal")
                traits=body.get("traits")
                if not isinstance(traits,dict) or set(traits)!=set(DEFAULT_TRAITS) or any(type(v)!=int or v<0 or v>100 for v in traits.values()):
                    raise ValueError("Invalid trait settings")
                with lock:
                    save_setting("goal",goal)
                    save_setting("traits",json.dumps(traits))
            else:
                raise ValueError("Unknown action")
            return self.send_json(200,{"ok":True})
        except (ValueError,TypeError,KeyError,json.JSONDecodeError) as exc:
            return self.send_json(400,{"error":str(exc)})
        except Exception as exc:
            note_error(str(exc))
            return self.send_json(502,{"error":"Internal error; see error log"})

if __name__=="__main__":
    if not TOKEN or len(TOKEN)<20:
        raise RuntimeError("TRUTHLAB_ADMIN_TOKEN must be a random token at least 20 characters long")
    initialize()
    # A chat-side operator can set this Render environment variable through a
    # connected deployment tool. 1 enables actual inference ONLY if configured.
    # 0 stops scheduling after the service restarts. Unset leaves DB controls.
    autostart = os.getenv("TRUTHLAB_AUTOSTART")
    if autostart == "0":
        save_setting("engine","idle")
        save_setting("status","paused")
    elif autostart == "1" and MODEL and API_KEY:
        save_setting("engine","api")
        save_setting("status","active")
        spawn()
    threading.Thread(target=scheduler,daemon=True).start()
    port=int(os.getenv("PORT","10000"))
    print("TruthLab hosted console starting; model configured:",bool(MODEL and API_KEY),flush=True)
    ThreadingHTTPServer(("0.0.0.0",port),Handler).serve_forever()
