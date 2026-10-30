"""Continue the verified 100-turn fictional CI transcript to 500 real turns.

This runner uses disposable PostgreSQL and a local Qwen model only.  It does
not touch production memory, credentials, or the operator's private dashboard.
"""
import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import app


def main():
    dsn = os.environ.get("TRUTHLAB_TEST_DATABASE_URL", "")
    if os.environ.get("TRUTHLAB_CI_CONTINUATION") != "1":
        raise RuntimeError("CI continuation opt-in missing")
    if "127.0.0.1:5432/truthlab_500_ci" not in dsn or os.environ.get("TRUTHLAB_DATABASE_URL") != dsn:
        raise RuntimeError("Only the disposable TruthLab 500-turn CI database is allowed")
    if (os.environ.get("OPENAI_BASE_URL"), os.environ.get("OPENAI_MODEL"), os.environ.get("OPENAI_API_KEY")) != (
        "http://127.0.0.1:8080/v1", "qwen-local", "local-only-no-external-key"
    ):
        raise RuntimeError("Only local Qwen inference is allowed")

    source_dir = Path(os.environ.get("TRUTHLAB_CI_SEED", "truthlab-ci-seed"))
    candidates = list(source_dir.rglob("full_transcript.jsonl"))
    if len(candidates) != 1:
        raise RuntimeError("Expected exactly one verified 100-turn source transcript")
    seed = [json.loads(line) for line in candidates[0].read_text(encoding="utf-8-sig").splitlines() if line.strip()]
    if len(seed) != 100:
        raise RuntimeError(f"Expected 100 source turns, received {len(seed)}")
    for index, item in enumerate(seed):
        if (item.get("turn"), item.get("cycle"), item.get("speaker")) != (
            index + 1, index // 4 + 1, "Ari" if index % 2 == 0 else "Noor"
        ) or not isinstance(item.get("body"), str) or not item["body"].strip():
            raise RuntimeError(f"Invalid original turn at position {index + 1}")

    app.MAX_DAILY = 520  # Disposable test only; no paid model or production database.
    app.initialize()
    app.save_setting("workflow", "backrooms")
    app.save_setting("goal", "Explore an original fictional CLI world without a predetermined mythology.")
    app.save_setting("engine", "api")
    app.save_setting("status", "active")
    app.save_setting("ari_enabled", "1")
    app.save_setting("noor_enabled", "1")
    app.save_setting("next_run", "0")
    history = []
    for index, item in enumerate(seed):
        app.publish(item["speaker"], item["body"], "live", item["cycle"])
        history.append({"speaker": item["speaker"], "body": item["body"]})
        if (index + 1) % 4 == 0:
            app.report50(item["cycle"], "live")
            app.archive_backrooms(item["cycle"])
            app.save_setting("cycles", item["cycle"])

    with app.connect() as db:
        counts = (
            db.execute("SELECT COUNT(*) FROM messages WHERE workflow='backrooms' AND mode='live'").fetchone()[0],
            db.execute("SELECT COUNT(*) FROM memories WHERE workflow='backrooms'").fetchone()[0],
            db.execute("SELECT COUNT(*) FROM evolution_artifacts WHERE workflow='backrooms'").fetchone()[0],
        )
    if counts != (100, 100, 25):
        raise RuntimeError(f"Restored transcript verification failed: {counts}")
    print("TRUTHLAB500_SEED_VERIFIED original_turns=100 memories=100 archives=25", flush=True)

    output = Path(os.environ.get("TRUTHLAB_CI_OUTPUT", "truthlab-500-output"))
    output.mkdir(parents=True, exist_ok=True)
    start = time.monotonic()
    retries = []

    def checkpoint(completed):
        with app.connect() as db:
            rows = [dict(row) for row in db.execute(
                "SELECT cycle,speaker,body FROM messages WHERE workflow='backrooms' AND mode='live' ORDER BY id")]
            memories = db.execute("SELECT COUNT(*) FROM memories WHERE workflow='backrooms'").fetchone()[0]
            archives = db.execute("SELECT COUNT(*) FROM evolution_artifacts WHERE workflow='backrooms'").fetchone()[0]
        if len(rows) != completed:
            raise RuntimeError(f"Incomplete checkpoint: expected {completed}, found {len(rows)}")
        pending = output / "full_transcript.jsonl.part"
        pending.write_text("".join(
            json.dumps({"turn": j + 1, **row}, ensure_ascii=False) + "\n" for j, row in enumerate(rows)
        ), encoding="utf-8")
        pending.replace(output / "full_transcript.jsonl")
        data = {"verified_turns": completed, "target": 500, "restored_source_turns": 100,
                "new_real_turns": completed - 100, "memory_count": memories,
                "archived_sessions": archives, "seconds": round(time.monotonic() - start, 1),
                "disposable_ci_database": True, "production_memory_modified": False,
                "retry_count": len(retries), "complete": completed == 500}
        pending = output / "progress.json.part"
        pending.write_text(json.dumps(data, indent=2), encoding="utf-8")
        pending.replace(output / "progress.json")
        print("TRUTHLAB500_PROGRESS " + json.dumps(data), flush=True)
        return data

    checkpoint(100)
    for index in range(100, 500):
        speaker = "Ari" if index % 2 == 0 else "Noor"
        cycle = index // 4 + 1
        for attempt in range(3):
            try:
                answer = app.ai_reply(speaker, history[-100:], app.settings())
                if not isinstance(answer, str) or not answer.strip():
                    raise ValueError("Model returned an empty response")
                break
            except Exception as exc:
                retries.append({"turn": index + 1, "attempt": attempt + 1, "error": type(exc).__name__})
                if attempt == 2:
                    raise
                time.sleep(4)
        app.publish(speaker, answer, "live", cycle)
        history.append({"speaker": speaker, "body": answer})
        if (index + 1) % 4 == 0:
            app.report50(cycle, "live")
            app.archive_backrooms(cycle)
            app.save_setting("cycles", cycle)
            app.save_setting("last_run", app.now())
        if (index + 1) % 5 == 0:
            checkpoint(index + 1)

    result = checkpoint(500)
    if (result["memory_count"], result["archived_sessions"]) != (500, 125):
        raise RuntimeError("500-turn final memory/archive counts do not match")
    app.save_setting("status", "paused")
    (output / "summary.json").write_text(json.dumps({**result,
        "real_model": "Qwen2.5-1.5B-Instruct local llama.cpp",
        "imported_artifact_run": 39148303221,
        "retries": retries, "verified": True}, indent=2), encoding="utf-8")
    print("TRUTHLAB500_COMPLETE real_turns=500 new_turns=400 memory=500 archive=125", flush=True)


if __name__ == "__main__":
    main()
