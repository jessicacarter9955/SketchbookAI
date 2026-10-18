"""100 REAL model turns, staged in 25 independently verified 4-turn chunks.

Safe by design: CI-local disposable PostgreSQL ONLY, synthetic fictional
conversation, no production DB/secret, no publication, cost-free Qwen CPU.
Every completed chunk refreshes human-readable transcript + JSON checkpoint.
"""
import argparse
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import app

parser=argparse.ArgumentParser()
parser.add_argument("--cycle",type=int,choices=range(1,26),required=True)
args=parser.parse_args()
url=os.environ.get("TRUTHLAB_TEST_DATABASE_URL","")
assert "127.0.0.1:5432/truthlab_100_turns" in url
assert os.environ.get("TRUTHLAB_DATABASE_URL")==url, "Require isolated CI database only"
assert os.environ.get("OPENAI_MODEL")=="qwen-local"
assert os.environ.get("OPENAI_BASE_URL")=="http://127.0.0.1:8080/v1"
assert os.environ.get("OPENAI_API_KEY")=="local-only-no-external-key"
assert os.environ.get("TRUTHLAB_100_TURNS_CI")=="1"

app.MAX_DAILY=120 # scoped to this disposable integration test, never production
app.initialize()
prior=app.settings()
expected=args.cycle-1
assert prior["cycles"] == expected, "Out-of-order run; previous block must finish"
if args.cycle==1:
    assert prior["status"]=="paused"
    app.save_setting("workflow","backrooms")
    app.save_setting("goal","Two fictional AI characters explore an impossible terminal world. Invent freely without preselected mythology.")
    app.save_setting("engine","api")
    app.save_setting("status","active")
    app.save_setting("ari_enabled","1")
    app.save_setting("noor_enabled","1")
    assert app.evolution_snapshot()["phase"]=="exploration"
else:
    assert prior["status"]=="active"
    assert prior["workflow"]=="backrooms"
app.save_setting("next_run","0")
app.scheduled_once()
after=app.settings()
assert after["cycles"]==args.cycle, "Cycle failed; inspect database errors"
with app.connect() as db:
    all_messages=[dict(x) for x in db.execute(
        "SELECT ts,cycle,speaker,body,mode FROM messages "
        "WHERE workflow='backrooms' AND mode='live' ORDER BY id")]
    all_memories=[dict(x) for x in db.execute(
        "SELECT cycle,content FROM memories WHERE workflow='backrooms' ORDER BY id")]
    artifacts=[dict(x) for x in db.execute(
        "SELECT cycle,kind,title,status,content FROM evolution_artifacts "
        "WHERE workflow='backrooms' ORDER BY cycle")]
    errors=[dict(x) for x in db.execute("SELECT ts,body FROM errors ORDER BY id")]
assert not errors, "Errors in DB: "+str(errors)[-1500:]
assert len(all_messages)==args.cycle*4, "Expected exactly 4 messages every cycle"
assert len(all_memories)==len(all_messages)
assert len(artifacts)==args.cycle
for cycle in range(1,args.cycle+1):
    turn=[m["speaker"] for m in all_messages if m["cycle"]==cycle]
    assert turn in (["Ari","Noor","Ari","Noor"],["Noor","Ari","Noor","Ari"]),turn
assert all(len(m["body"].strip())>0 for m in all_messages)
snap=app.evolution_snapshot()
progress={
    "batch":args.cycle,"turns":len(all_messages),"total_turns_requested":100,
    "model":"Qwen2.5-1.5B-Instruct Q4_K_M via llama.cpp",
    "environment":"CI synthetic fictional conversation; disposable PostgreSQL",
    "phase":snap["phase"],"motifs":snap["motifs"],"curated":snap["curated_count"],
    "messages":all_messages,"artifacts":artifacts,
    "memory_count":len(all_memories),"error_count":len(errors),
}
out=Path(os.environ.get("TRUTHLAB_100_OUTPUT","truthlab-100-output"))
out.mkdir(parents=True,exist_ok=True)
tmp=out/"checkpoint.json.part"
tmp.write_text(json.dumps(progress,ensure_ascii=False,indent=2),encoding="utf-8")
tmp.replace(out/"checkpoint.json")
md=[
"# TruthLab Backrooms — 100-turn experiment",
"",
"Real Qwen 1.5B inference · fictional CLI · disposable PostgreSQL 16",
"",
"**Status:** "+str(len(all_messages))+" of 100 complete. Not an uninterrupted production system.",
"**Observed phase:** "+snap["phase"],
"**Memories saved and reloaded:** "+str(len(all_memories)),
"**Archived fictional sessions:** "+str(len(artifacts)),
"",
"## Observed recurring motifs",
"",
]
md.extend("- "+m["motif"]+" (in "+str(m["cycles"])+" cycles)" for m in snap["motifs"])
md.extend(["","## Complete, unedited model transcript",""])
for m in all_messages:
    md.extend(["### Turn "+str(all_messages.index(m)+1)+" · Cycle "+str(m["cycle"])+" · "+m["speaker"],"",m["body"],""])
(out/"transcript.md").write_text("\n".join(md),encoding="utf-8")
(out/"metrics.json").write_text(json.dumps({
    "turns":len(all_messages),"cycles":args.cycle,"memory_count":len(all_memories),
    "archive_count":len(artifacts),"phase":snap["phase"],"motifs":snap["motifs"],
    "error_count":len(errors),"batch_success":True
},ensure_ascii=False,indent=2),encoding="utf-8")
print(f"TRUTHLAB100_VERIFIED batch={args.cycle} turns={len(all_messages)} stored_memories={len(all_memories)} archived={len(artifacts)} phase={snap['phase']}",flush=True)
if args.cycle==25:
    assert len(all_messages)==100
    app.save_setting("status","paused")
    app.save_setting("next_run","0")
    assert not app.cycle_is_due()
    print("TRUTHLAB100_COMPLETE real_turns=100 memory=100 archive=25 paused=true",flush=True)
