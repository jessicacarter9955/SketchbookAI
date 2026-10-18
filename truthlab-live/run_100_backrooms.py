"""Run exactly 100 REAL (non-demo) Ari/Noor fictional CLI turns in one CI job.

All generated text and memory live in an isolated disposable PostgreSQL 16
instance. Full transcript/artifacts are published as GitHub Actions artifacts,
not as source commits. Do not use this with production credentials.
"""
import json
import os
import sys
import time
from pathlib import Path

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import app

dsn=os.environ.get("TRUTHLAB_TEST_DATABASE_URL","")
assert "127.0.0.1:5432/truthlab_100" in dsn, "100-turn batch restricted to disposable CI DB"
assert os.environ.get("TRUTHLAB_DATABASE_URL")==dsn
assert os.environ.get("OPENAI_BASE_URL")=="http://127.0.0.1:8080/v1"
assert os.environ.get("OPENAI_MODEL")=="qwen-local"
assert os.environ.get("OPENAI_API_KEY")=="local-only-no-external-key"
app.MODEL="qwen-local"
app.API_KEY="local-only-no-external-key"
app.BASE_URL="http://127.0.0.1:8080/v1"
app.MAX_DAILY=110
app.initialize()
app.save_setting("workflow","backrooms")
app.save_setting("goal","Explore an original fictional CLI world without a predetermined mythology.")
app.save_setting("engine","api")
app.save_setting("status","active")
app.save_setting("ari_enabled","1")
app.save_setting("noor_enabled","1")

out=HERE/"batch100-output"
out.mkdir(exist_ok=True)
transcript=out/"full_transcript.jsonl"
statefile=out/"progress.json"
transcript.write_text("",encoding="utf-8")
all_messages=[]
failures=[]
start=time.monotonic()
for i in range(100):
    agent="Ari" if i%2==0 else "Noor"
    cycle=i//4+1
    before=len(all_messages)
    # Only successful, attributed model output counts as one turn.
    for attempt in range(3):
        try:
            cfg=app.settings()
            # Original fiction, authentic model inference, historical roles.
            body=app.ai_reply(agent,all_messages[-10:],cfg)
            if not body.strip():
                raise ValueError("No actual generated reply")
            break
        except Exception as exc:
            failures.append({"turn":i+1,"attempt":attempt+1,"error":type(exc).__name__})
            print("BACKROOMS_100_RETRY turn=%d attempt=%d error=%s" % (i+1,attempt+1,type(exc).__name__),flush=True)
            if attempt==2:
                raise
            time.sleep(4)
    assert len(all_messages)==before
    app.publish(agent,body,"live",cycle)
    item={"turn":i+1,"cycle":cycle,"speaker":agent,"body":body}
    with transcript.open("a",encoding="utf-8") as h:
        h.write(json.dumps(item,ensure_ascii=False)+"\n")
    all_messages.append({"speaker":agent,"body":body})
    if (i+1)%4==0:
        # Exactly one memory record per real model response and a unique
        # archive candidate for each complete four-turn cycle.
        app.report50(cycle,"live")
        app.archive_backrooms(cycle)
        app.save_setting("cycles",cycle)
        app.save_setting("last_run",app.now())
    if (i+1)%5==0:
        snapshot=app.evolution_snapshot()
        state={
            "completed_real_turns":i+1,
            "expected_total":100,
            "elapsed_seconds":round(time.monotonic()-start,1),
            "cycles":(i+1)//4,
            "phase":snapshot["phase"],
            "motifs":snapshot["motifs"][:10],
            "archived_sessions":len(snapshot["artifacts"]),
            "temporary_database":True,
            "retries":failures,
        }
        statefile.write_text(json.dumps(state,indent=2,ensure_ascii=False),encoding="utf-8")
        print("BACKROOMS_100_PROGRESS "+json.dumps({
            "turns":i+1,"phase":snapshot["phase"],
            "archived":len(snapshot["artifacts"]),
            "elapsed_s":state["elapsed_seconds"]}),flush=True)

with app.connect() as db:
    count=db.execute("SELECT COUNT(*) FROM messages WHERE workflow='backrooms' AND mode='live'").fetchone()[0]
    mems=db.execute("SELECT COUNT(*) FROM memories WHERE workflow='backrooms'").fetchone()[0]
    archive=db.execute("SELECT COUNT(*) FROM evolution_artifacts WHERE workflow='backrooms'").fetchone()[0]
assert (count,mems,archive)==(100,100,25),(count,mems,archive)
assert len(all_messages)==100
app.save_setting("status","paused")
app.save_setting("next_run","0")
summary={
    "verified":True,"real_model":"Qwen2.5-1.5B-Instruct via llama.cpp",
    "database":"temporary isolated PostgreSQL CI",
    "turns":count,"ari":50,"noor":50,"memories":mems,
    "archived_sessions":archive,"final_evolution":app.evolution_snapshot(),
    "minutes":round((time.monotonic()-start)/60,2),
    "production_memory_modified":False,
    "autonomous_public_posting":False,
    "failures_retried":failures,
}
(out/"summary.json").write_text(json.dumps(summary,indent=2,ensure_ascii=False),encoding="utf-8")
print("BACKROOMS_100_COMPLETE "+json.dumps({k:summary[k] for k in ("turns","ari","noor","memories","archived_sessions","minutes")}),flush=True)
