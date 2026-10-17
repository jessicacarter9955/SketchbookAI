"""Versioned dependency graph with durable transitions and verified artifacts."""
import time
from pathlib import Path

from core import SCHEMA, TOOL_VERSION, atomic_json, digest, elapsed, file_hash, read_json, utc
from scanner import diagnostics, import_registry, inspect_project, inventory

TASKS = {
    "project": (), "engine": (), "inventory": ("project",),
    "engine_metadata": ("project", "engine", "inventory"),
    "registry": ("inventory", "engine_metadata"), "diagnostics": ("project", "engine", "inventory", "registry"),
    "report": ("project", "inventory", "diagnostics"),
}
STATUSES = {"pending", "running", "succeeded", "failed", "skipped", "blocked"}


def task_graph(state):
    enabled = state["config"].get("extract_engine", False)
    return {name: tuple(dep for dep in deps if enabled or dep != "engine_metadata")
            for name, deps in TASKS.items() if enabled or name != "engine_metadata"}


def new_state(config):
    return {"schema_version": SCHEMA, "tool_version": TOOL_VERSION, "created": utc(),
            "config": config, "tasks": {}, "history": []}


def load_state(directory):
    state = read_json(directory / "state.json")
    if not isinstance(state, dict) or state.get("schema_version") != SCHEMA:
        raise ValueError("Unsupported state schema. Preserve this workspace and use a new directory.")
    if not isinstance(state.get("config"), dict) or not isinstance(state.get("tasks"), dict):
        raise ValueError("Malformed task state")
    if any(name not in TASKS or item.get("status") not in STATUSES for name, item in state["tasks"].items()):
        raise ValueError("Unknown task or status in state")
    return state


def save_state(directory, state):
    state["updated"] = utc()
    atomic_json(directory / "state.json", state)


def artifact_path(directory, name):
    if name not in TASKS:
        raise ValueError(f"Unknown task: {name}")
    return directory / "artifacts" / (name + ".json")


def artifact_valid(directory, name, task):
    path = artifact_path(directory, name)
    return bool(task.get("artifact_sha256") and path.is_file() and file_hash(path) == task["artifact_sha256"])


def verify_state(directory, state, logger):
    invalidated = []
    for name, task in state["tasks"].items():
        if task["status"] == "running":
            task.update(status="pending", error="Previous process interrupted; task will restart atomically")
            invalidated.append(name)
            logger.event("recovered", f"Interrupted task {name} is pending", task=name)
        elif task["status"] == "succeeded" and not artifact_valid(directory, name, task):
            task.update(status="pending", error="Artifact missing or checksum mismatch")
            invalidated.append(name)
            logger.event("invalidated", f"Artifact validation failed for {name}", task=name)
    # A regenerated upstream artifact requires reevaluation of downstream output,
    # even when the expected source hash has not changed (e.g. manual corruption).
    invalidate_dependents(state, invalidated)
    return invalidated


def invalidate_dependents(state, names):
    affected = set(names)
    for name, deps in task_graph(state).items():
        if any(dep in affected for dep in deps):
            affected.add(name)
            task = state["tasks"].get(name)
            if task and task["status"] != "skipped":
                task.update(status="pending", reason="Dependency invalidated")
    return affected


def plan(state, snapshot):
    implementation = {name: file_hash(Path(__file__).with_name(name)) for name in ("core.py", "pipeline.py", "scanner.py", "adapters.py", "engine_runner.py", "registry_extract.py")}
    inputs = {
        "project": {"project": snapshot["project"], "descriptor": snapshot["descriptor"]},
        "engine": snapshot["engine"],
        "inventory": {"files": snapshot["files"], "omitted_links": snapshot["omitted_links"]},
        "registry": {"path": snapshot["registry_path"], "hash": snapshot["registry_sha256"]},
        "engine_metadata": {"files": snapshot["files"], "engine": snapshot["engine"]},
        "diagnostics": {}, "report": {},
    }
    for name, deps in task_graph(state).items():
        fingerprint = digest({"task": name, "implementation": implementation, "tool_version": TOOL_VERSION, "schema": SCHEMA,
                              "options": inputs[name], "dependencies": {dep: state["tasks"][dep]["input_hash"] for dep in deps}})
        task = state["tasks"].get(name)
        if task is None:
            task = {"status": "pending", "attempts": 0, "reason": "New task"}
            state["tasks"][name] = task
        elif task.get("input_hash") != fingerprint:
            task.update(status="pending", reason="Source, options, adapter or dependency changed")
            task.pop("skip_reason", None)
        task.update(input_hash=fingerprint, dependencies=list(deps))
    state["tool_version"] = TOOL_VERSION
    state["last_source_verification"] = utc()
    state["source_verification_status"] = "verified"
    state.pop("last_error", None)
    state["snapshot_hash"] = digest(snapshot)
    return state


def retry_task(state, name):
    selected = list(task_graph(state)) if name == "all" else [name]
    for task_name in selected:
        if task_name not in state["tasks"]:
            raise ValueError(f"Task not planned: {task_name}")
        state["tasks"][task_name].update(status="pending", reason="Explicit retry")
        state["tasks"][task_name].pop("skip_reason", None)
    invalidate_dependents(state, selected)


def skip_task(state, name, reason):
    if name not in state["tasks"]:
        raise ValueError(f"Task not planned: {name}")
    if not reason.strip():
        raise ValueError("Skipping a task requires a nonempty reason")
    state["tasks"][name].update(status="skipped", skip_reason=reason)
    affected = invalidate_dependents(state, [name])
    for child in affected - {name}:
        if state["tasks"][child]["status"] != "skipped":
            state["tasks"][child].update(status="blocked", reason=f"Dependency {name} skipped")


def run(directory, state, snapshot, logger, handlers=None):
    def output(name):
        return read_json(artifact_path(directory, name))
    def engine_metadata():
        from engine_runner import run_engine
        return run_engine(directory, snapshot, logger)
    def registry_import():
        if state["config"].get("extract_engine"):
            path = artifact_path(directory, "engine_metadata")
            adjusted = {**snapshot, "registry_path": str(path), "registry_sha256": file_hash(path)}
            return import_registry(adjusted, output("inventory"), verified_engine=True)
        return import_registry(snapshot, output("inventory"))
    handlers = handlers or {
        "project": lambda: inspect_project(snapshot),
        "engine": lambda: snapshot["engine"],
        "inventory": lambda: inventory(snapshot),
        "engine_metadata": engine_metadata,
        "registry": registry_import,
        "diagnostics": lambda: diagnostics(output("project"), output("engine"), output("inventory"), output("registry")),
        "report": lambda: {"schema_version": SCHEMA, "project": output("project")["name"], **output("diagnostics")},
    }
    for name, deps in task_graph(state).items():
        task = state["tasks"][name]
        if task["status"] in {"succeeded", "skipped"}:
            logger.event("reuse" if task["status"] == "succeeded" else "skipped", f"{name}: {task['status']}", task=name)
            continue
        blockers = [dep for dep in deps if state["tasks"][dep]["status"] != "succeeded"]
        if blockers:
            task.update(status="blocked", reason="Unfinished dependencies: " + ", ".join(blockers))
            save_state(directory, state)
            logger.event("blocked", f"{name}: {task['reason']}", task=name)
            continue
        start = time.monotonic()
        task.update(status="running", attempts=task["attempts"] + 1, started=utc())
        task.pop("error", None)
        save_state(directory, state)
        logger.event("task-start", name, task=name, attempt=task["attempts"])
        try:
            data = handlers[name]()
            path = artifact_path(directory, name)
            atomic_json(path, data)
            task.update(status="succeeded", artifact_sha256=file_hash(path), finished=utc(), seconds=elapsed(start))
            logger.event("task-done", name, task=name, seconds=task["seconds"])
        except Exception as exc:
            task.update(status="failed", error_code=getattr(exc, "code", "TASK_FAILED"), error=f"{type(exc).__name__}: {exc}", finished=utc(), seconds=elapsed(start))
            logger.event("task-failed", task["error"], task=name, code=task["error_code"])
        save_state(directory, state)
    return all(task["status"] == "succeeded" for task in state["tasks"].values())


def build_report(directory, state):
    tasks = {name: {key: value for key, value in task.items() if key != "artifact_sha256"} for name, task in state["tasks"].items()}
    counts = {status: sum(task["status"] == status for task in tasks.values()) for status in sorted(STATUSES)}
    report = {"schema_version": SCHEMA, "tool_version": TOOL_VERSION, "generated": utc(),
              "source_project": state["config"]["project"], "last_source_verification": state.get("last_source_verification"),
              "source_verification_status": state.get("source_verification_status", "unverified"),
              "last_error": state.get("last_error"),
              "processing": {"tasks": tasks, "counts": counts, "complete": bool(tasks) and counts["succeeded"] == len(task_graph(state)) and state.get("source_verification_status") == "verified"},
              "fidelity": {"status": "not_evaluated", "converted_assets": 0, "playable_game": False, "percentage": None},
              "report_note": "Task completion is inspection processing, never conversion fidelity. Source freshness is the last verification timestamp."}
    for name, key in (("diagnostics", "inspection"), ("engine", "engine")):
        task = state["tasks"].get(name, {})
        if task.get("status") == "succeeded" and artifact_valid(directory, name, task):
            report[key] = read_json(artifact_path(directory, name))
    atomic_json(directory / "report.json", report)
    lines = ["# ue2three inspection report", "", f"Generated: {report['generated']}", "",
             f"Source: `{report['source_project']}`", "",
             f"Inspection tasks succeeded: {counts['succeeded']}/{len(task_graph(state))}. "
             f"Failed: {counts['failed']}; skipped: {counts['skipped']}; blocked: {counts['blocked']}.", "",
             "Converted assets: **0**. Fidelity: **not evaluated**. Playable game: **no**.", "",
             f"Source verification: **{report['source_verification_status']}**. Last error: {report['last_error'] or 'none'}.", "",
             report["report_note"], "", "## Tasks", "", "| Task | Status | Attempts | Detail |", "|---|---|---:|---|"]
    def safe(value):
        return str(value).replace("|", "\\|").replace("\n", " ").replace("\r", " ").replace("<", "&lt;").replace(">", "&gt;")
    for name, task in tasks.items():
        lines.append(f"| {name} | {task['status']} | {task['attempts']} | {safe(task.get('error', task.get('skip_reason', task.get('reason', ''))))} |")
    inspection = report.get("inspection", {})
    if inspection:
        lines += ["", "## Inventory", "", "```json", __import__("json").dumps(inspection["processing"]["inventory_counts"], indent=2), "```",
                  "", "## Diagnostics", ""]
        lines.extend(f"- {item['severity'].upper()} `{item['code']}`: {safe(item['message'])}" for item in inspection["diagnostics"])
        lines += ["", "## Conversion stages", ""]
        lines.extend(f"- **{item['stage']} — {item['status']}**: {item['reason']}" for item in inspection["capabilities"])
    (directory / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return report
