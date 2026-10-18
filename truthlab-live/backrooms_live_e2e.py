"""Evidence-only, real Qwen Backrooms incipit run on disposable CI PostgreSQL.

No real provider account, private user transcript, paid API or public posting.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

HERE=Path(__file__).parent
sys.path.insert(0,str(HERE))
import app
import backrooms_evolution as evo

dsn=os.getenv("TRUTHLAB_TEST_DATABASE_URL","")
assert "127.0.0.1:5432/truthlab_backrooms_ci" in dsn
assert os.getenv("OPENAI_MODEL")=="qwen-local"
assert os.getenv("OPENAI_BASE_URL")=="http://127.0.0.1:8080/v1"
assert os.getenv("OPENAI_API_KEY")=="local-only-no-external-key"
os.environ["TRUTHLAB_DATABASE_URL"]=dsn
app.MODEL="qwen-local"
app.API_KEY="local-only-no-external-key"
app.BASE_URL="http://127.0.0.1:8080/v1"
app.MAX_DAILY=16
app.initialize()
app.save_setting("workflow","backrooms")
app.save_setting("goal","Observe the open-ended fictional CLI experiment without predeciding any cultural artifact.")
app.save_setting("engine","api")
app.save_setting("status","active")
app.save_setting("ari_enabled","1")
app.save_setting("noor_enabled","1")

pre=app.evolution_snapshot()
assert pre["phase"]=="exploration" and pre["motifs"]==[] and pre["artifacts"]==[]
assert "simulator@truthlab:~/$" in evo.prompt_for(pre,"Ari")
print("BACKROOMS_GENESIS_CONFIRMED imaginary_cli=True fixed_myth=False",flush=True)

def run():
    r=subprocess.run([sys.executable,str(HERE/"app.py"),"--once"],
                     env=os.environ.copy(),capture_output=True,text=True,timeout=480)
    if r.returncode or "TRUTHLAB_TICK_FINISHED" not in r.stdout:
        raise AssertionError("CLI AI runner failure: "+r.stderr[-900:]+" / "+r.stdout[-900:])
    state=app.get_state()
    assert state["config"]["status"]=="active",state["errors"]
    return state

one=run()
first=[m for m in one["messages"] if m["mode"]=="live"]
assert [m["speaker"] for m in first]==["Ari","Noor","Ari","Noor"],first
assert all(m["body"].strip() for m in first)
assert len(one["backrooms_evolution"]["artifacts"])==1
assert one["backrooms_evolution"]["artifacts"][0]["status"]=="candidate"
print("BACKROOMS_CYCLE_ONE_CONFIRMED messages=4 archived=1",flush=True)

app.save_setting("next_run","0")
two=run()
all_msgs=[m for m in two["messages"] if m["mode"]=="live"]
assert len(all_msgs)==8
assert [m["speaker"] for m in all_msgs[4:]]==["Ari","Noor","Ari","Noor"]
assert len(two["backrooms_evolution"]["artifacts"])==2
assert len(two["memories"])==8
assert two["storage_backend"]=="postgresql"
assert two["backrooms_evolution"]["curated_count"]==0
phase=two["backrooms_evolution"]["phase"]
assert phase in evo.PHASES
print("BACKROOMS_CYCLE_TWO_CONFIRMED messages=8 archived=2 memories=8 phase="+phase,flush=True)

# A fresh process reads same cloud-like Postgres, no shared Python state.
r=subprocess.run([sys.executable,"-c",
    "import json,app; s=app.evolution_snapshot();print(json.dumps({'phase':s['phase'],'n':len(s['artifacts'])}))"],
    cwd=str(HERE),env=os.environ.copy(),capture_output=True,text=True,check=True,timeout=60)
saved=json.loads(r.stdout.strip())
assert saved["n"]==2
print("BACKROOMS_CROSS_PROCESS_ARCHIVE_CONFIRMED",flush=True)

app.save_setting("status","paused")
app.save_setting("next_run","0")
assert not app.cycle_is_due()
print("BACKROOMS_GLOBAL_PAUSE_CONFIRMED",flush=True)

out={
    "environment":"CI disposable PostgreSQL; Qwen2.5 1.5B actual inference",
    "incipit":"open fictional terminal; no preselected meme or religion",
    "phase_after_two_cycles":phase,
    "motifs":two["backrooms_evolution"]["motifs"][:5],
    "archive_candidates":len(two["backrooms_evolution"]["artifacts"]),
    "messages":[{"cycle":m["cycle"],"speaker":m["speaker"],"text":m["body"]}
                for m in all_msgs],
}
print("BACKROOMS_PUBLIC_SAMPLE_JSON="+json.dumps(out,ensure_ascii=False),flush=True)
print("BACKROOMS_REAL_E2E_SUCCESS real_messages=8 memories=8 archived=2",flush=True)
