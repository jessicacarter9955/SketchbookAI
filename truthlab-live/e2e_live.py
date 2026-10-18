"""TruthLab end-to-end real-model integration on a DISPOSABLE Postgres database.

This script must only be used with TRUTHLAB_TEST_DATABASE_URL pointing to a
fresh CI service container. No production credentials or real conversations.
It launches the existing one-shot process separately, verifies durable messages
and recall after reconnect, proves skip-not-due and pause, and tests per-agent
enablement with a second full two-agent cycle, a solo pause check, then a resumed turn. Never run against the operator's DB.
"""
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app

root = Path(__file__).resolve().parent
url = os.environ.get("TRUTHLAB_TEST_DATABASE_URL", "")
assert "127.0.0.1:5432/truthlab_e2e" in url, "Only dedicated local CI database accepted"
assert os.environ.get("OPENAI_BASE_URL") == "http://127.0.0.1:8080/v1", "Expect isolated local Qwen"
assert os.environ.get("OPENAI_MODEL") == "qwen-local", "Only local Qwen for CI"
assert os.environ.get("OPENAI_API_KEY") == "local-only-no-external-key", "No external credentials"

os.environ["TRUTHLAB_DATABASE_URL"] = url
app.DB = "/tmp/truthlab-e2e-sentinel-not-used.sqlite"
app.MODEL = "qwen-local"
app.API_KEY = "local-only-no-external-key"
app.BASE_URL = "http://127.0.0.1:8080/v1"
app.MAX_DAILY = 16

def run_one(expect_run=True):
    result = subprocess.run(
        [sys.executable, str(root / "app.py"), "--once"],
        env=os.environ.copy(), timeout=480, text=True, capture_output=True,
    )
    if result.returncode:
        raise AssertionError("One-shot runner exited nonzero: " + result.stderr[-1500:])
    expected = "TRUTHLAB_TICK_FINISHED" if expect_run else "TRUTHLAB_TICK_SKIPPED"
    if expected not in result.stdout:
        raise AssertionError("Expected "+expected+": " + result.stdout[-1000:])
    return result.stdout

# Keep this test entirely synthetic; operator's actual goals are not used.
app.initialize()
app.save_setting("workflow", "truthlab")
app.save_setting("goal", "Develop a reproducible test for persistent AI dialogue, verify results after restarting, and report only observed evidence.")
app.save_setting("status", "active")
app.save_setting("engine", "api")
app.save_setting("next_run", "0")
app.save_setting("ari_enabled", "1")
app.save_setting("noor_enabled", "1")

assert app.cycle_is_due()
print("TRUTHLAB_E2E_STEP_1_RUNNING_LIVE_PAIR", flush=True)
run_one()
first = app.get_state()
assert first["config"]["cycles"] == 1, first["config"]["cycles"]
first_msgs = [m for m in first["messages"] if m["mode"] == "live"]
assert [m["speaker"] for m in first_msgs] == ["Ari", "Noor", "Ari", "Noor"]
assert all(m["body"].strip() for m in first_msgs), "Real model returned an empty reply"
print("TRUTHLAB_E2E_RESPONSE_LENGTHS", [len(m["body"]) for m in first_msgs], flush=True)
assert first["daily_calls"] == 4
assert len(first["reports"]) == 1 and len(first["reports"][0]["body"].split()) == 50
assert len(first["memories"]) == 4
assert first["storage_backend"] == "postgresql"
assert first["persistent_memory"]
print("TRUTHLAB_E2E_STEP_1_OK: actual model messages and durable memories", flush=True)

# Different process and connection: no cache / no faked in-memory store.
check = subprocess.run(
    [sys.executable, "-c",
     "import app; s=app.get_state(); "
     "print(__import__('json').dumps({'messages':len(s['messages']),"
     "'memories':len(s['memories']),'cycles':s['config']['cycles']}))"],
    cwd=str(root), env=os.environ.copy(), text=True, capture_output=True, timeout=60,
    check=True,
)
saved = json.loads(check.stdout.strip())
assert saved == {"messages": 4, "memories": 4, "cycles": 1}, saved
assert not app.cycle_is_due(), "Must not run before scheduled time"
run_one(expect_run=False)
assert app.settings()["cycles"] == 1, "Duplicate cycle ran despite next-run timestamp"
print("TRUTHLAB_E2E_STEP_2_OK: distinct process recall and idempotent schedule", flush=True)

# Directly verify the next turn can retrieve actual first-cycle model content
# from a new PostgreSQL connection, not just recent process memory.
memory_before_second=app.recall_memories("truthlab", first_msgs[0]["body"], max_items=10)
assert first_msgs[0]["body"][:30] in memory_before_second, "First-cycle answer not found in persistent recall"
print("TRUTHLAB_E2E_MEMORY_RECALL first_turn_retrieved=True", flush=True)

# Second complete conversation with both agents; new worker process reuses the
# first cycle's messages as both context and explicit durable memories.
app.save_setting("next_run", "0")
run_one()
second = app.get_state()
assert second["config"]["cycles"] == 2
second_msgs = [m for m in second["messages"] if m["mode"]=="live" and m["cycle"]==2]
assert [m["speaker"] for m in second_msgs] == ["Ari","Noor","Ari","Noor"]
assert len(second["memories"]) == 8 and len(second["reports"]) == 2
assert second["daily_calls"] == 8
print("TRUTHLAB_E2E_STEP_3_OK: two successive real AI pair conversations with recalled memory", flush=True)

# Ari paused: Noor gets a single solo update, not a fake two-sided exchange.
app.save_setting("ari_enabled", "0")
app.save_setting("next_run", "0")
run_one()
third = app.get_state()
assert third["config"]["cycles"] == 3
third_msgs = [m for m in fourth["messages"] if m["mode"]=="live" and m["cycle"]==3]
assert len(third_msgs) == 1 and third_msgs[0]["speaker"] == "Noor"
assert len(third["memories"]) == 9 and len(third["reports"]) == 3
assert third["daily_calls"] == 9
print("TRUTHLAB_E2E_STEP_4_OK: Noor solo update, no repeated fake conversation", flush=True)

# Restart with Ari resumed: his first live message MUST answer the last Noor.
app.save_setting("ari_enabled", "1")
app.save_setting("next_run", "0")
run_one()
fourth = app.get_state()
assert fourth["config"]["cycles"] == 4
fourth_msgs = [m for m in fourth["messages"] if m["mode"]=="live" and m["cycle"]==4]
assert [m["speaker"] for m in fourth_msgs] == ["Ari","Noor","Ari","Noor"]
assert len(fourth["memories"]) == 13 and len(fourth["reports"]) == 4
assert fourth["daily_calls"] == 13
print("TRUTHLAB_E2E_STEP_5_OK: Ari RESUMED and replied immediately after Noor", flush=True)

app.save_setting("status", "paused")
app.save_setting("next_run", "0")
assert not app.cycle_is_due()
run_one(expect_run=False)
assert app.settings()["cycles"] == 4, "Paused agents should not run"
print("TRUTHLAB_E2E_STEP_6_OK: global pause is durable and blocks next tick", flush=True)

# Publish ONLY synthetic CI conversations. The production application NEVER
# logs private transcripts, passwords, DB strings, or user messages.
transcript = [{"cycle":m["cycle"],"speaker":m["speaker"],"body":m["body"]}
              for m in third["messages"] if m["mode"]=="live"]
reports = [{"cycle":r["cycle"], "body":r["body"]}
           for r in sorted(fourth["reports"],key=lambda r:r["cycle"])]
assert len(transcript) == 13
print("TRUTHLAB_E2E_PUBLIC_CONVERSATION_JSON="+json.dumps({
    "environment":"isolated CI; synthetic project goal, not production",
    "model":"Qwen2.5 1.5B Instruct Q4_K_M through llama.cpp",
    "database":"disposable PostgreSQL 16",
    "memory_verified":True,
    "model_messages":transcript,
    "reports":reports
}, ensure_ascii=False), flush=True)
print("TRUTHLAB_E2E_COMPLETE real_model=Qwen1.5B cycles=4 messages=13 memories=13 reports=4", flush=True)
