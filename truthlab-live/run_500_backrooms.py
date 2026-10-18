"""500-turn resumable Backrooms experiment. Requires configured inference and durable DB."""
import json, os, sys, time
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import app

TOTAL=500
OUT=HERE/"batch500-output"
OUT.mkdir(exist_ok=True)
app.initialize()
app.save_setting("workflow","backrooms")
app.save_setting("goal","Explore an original fictional CLI world without predetermined mythology; build on previous discoveries.")
app.save_setting("engine","api")
app.save_setting("status","active")
app.save_setting("ari_enabled","1")
app.save_setting("noor_enabled","1")
app.MAX_DAILY=max(app.MAX_DAILY, TOTAL+20)
# Durable database is mandatory: never pretend a disposable CI database is persistent.
if app.backend()!="postgresql" or not os.environ.get("TRUTHLAB_DATABASE_URL"):
    raise RuntimeError("500-turn continuation requires persistent PostgreSQL")
with app.connect() as db:
    prior=[dict(r) for r in db.execute("SELECT speaker,body FROM messages WHERE workflow='backrooms' AND mode='live' ORDER BY id")]
    existing=len(prior)
if existing>TOTAL:
    raise RuntimeError("Database already contains more than 500 Backrooms turns")
history=prior
failures=[]
start=time.monotonic()
for i in range(existing,TOTAL):
    speaker="Ari" if i%2==0 else "Noor"
    cycle=i//4+1
    for attempt in range(3):
        try:
            reply=app.ai_reply(speaker,history[-100:],app.settings())
            if not reply.strip(): raise ValueError("Empty reply")
            break
        except Exception as exc:
            failures.append({"turn":i+1,"attempt":attempt+1,"error":str(exc)[:200]})
            if attempt==2: raise
            time.sleep(4)
    app.publish(speaker,reply,"live",cycle)
    history.append({"speaker":speaker,"body":reply})
    if (i+1)%4==0:
        app.report50(cycle,"live")
        app.archive_backrooms(cycle)
        app.save_setting("cycles",cycle)
        app.save_setting("last_run",app.now())
    if (i+1)%5==0:
        with app.connect() as db:
            rows=[dict(r) for r in db.execute("SELECT cycle,speaker,body FROM messages WHERE workflow='backrooms' AND mode='live' ORDER BY id")]
        (OUT/"full_transcript.jsonl").write_text("".join(json.dumps(dict(turn=j+1,**r),ensure_ascii=False)+"\n" for j,r in enumerate(rows)),encoding="utf-8")
        (OUT/"progress.json").write_text(json.dumps({"turns":len(rows),"target":TOTAL,"archived":len(app.evolution_snapshot()["artifacts"]),"failures":failures},indent=2))
        print("BACKROOMS_500_PROGRESS",len(rows),flush=True)
app.save_setting("status","paused")
with app.connect() as db:
    turns=db.execute("SELECT COUNT(*) FROM messages WHERE workflow='backrooms' AND mode='live'").fetchone()[0]
    memories=db.execute("SELECT COUNT(*) FROM memories WHERE workflow='backrooms'").fetchone()[0]
    archives=db.execute("SELECT COUNT(*) FROM evolution_artifacts WHERE workflow='backrooms'").fetchone()[0]
assert turns==TOTAL
(OUT/"summary.json").write_text(json.dumps({"turns":turns,"memories":memories,"archived_sessions":archives,"failures":failures,"persistent_db":True,"elapsed_seconds":round(time.monotonic()-start,1)},indent=2))
print("BACKROOMS_500_COMPLETE",turns,flush=True)
