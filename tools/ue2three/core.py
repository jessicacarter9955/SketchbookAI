"""Persistence, hashes and process locking, independent of Unreal adapters."""
import hashlib
import json
import os
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = 1
TOOL_VERSION = "0.1.0"


def utc():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def file_hash(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def read_json(path):
    with Path(path).open("r", encoding="utf-8-sig") as stream:
        return json.load(stream)


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp")
    with temp.open("w", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, ensure_ascii=True, indent=2, sort_keys=True)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)


class Logger:
    def __init__(self, directory):
        self.directory = directory

    def event(self, event, message, **fields):
        record = {"time": utc(), "event": event, "message": message, **fields}
        # JSON escaping keeps paths/control characters from forging log entries.
        line = f"{record['time']} {event.upper():12} {json.dumps(message, ensure_ascii=True)}"
        print(line, flush=True)
        with (self.directory / "events.jsonl").open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(record, ensure_ascii=True, sort_keys=True) + "\n")
        with (self.directory / "run.log").open("a", encoding="utf-8") as stream:
            stream.write(line + "\n")
        if event in {"hash-start", "hash-progress", "hash-done", "task-start", "task-done", "task-failed", "complete", "incomplete", "error"}:
            atomic_json(self.directory / "progress.json", record)


@contextmanager
def workspace_lock(directory):
    """OS releases this lock after process termination; no stale PID guessing."""
    path = directory / "process.lock"
    stream = path.open("a+b")
    if path.stat().st_size == 0:
        stream.write(b"0")
        stream.flush()
    stream.seek(0)
    locked = False
    try:
        if os.name == "nt":
            import msvcrt
            try:
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as exc:
                raise RuntimeError("Another ue2three process owns this workspace") from exc
        else:
            import fcntl
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as exc:
                raise RuntimeError("Another ue2three process owns this workspace") from exc
        locked = True
        yield
    finally:
        if locked:
            stream.seek(0)
            if os.name == "nt":
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream, fcntl.LOCK_UN)
        stream.close()


def prepare_workspace(directory, project):
    directory, root = Path(directory).resolve(), Path(project).resolve().parent
    if directory == root or root in directory.parents or directory in root.parents:
        raise ValueError("Workspace and source project must be separate, non-nested directories")
    directory.mkdir(parents=True, exist_ok=True)
    # Local inventories can include licensed asset names. Keep every generated file private to this checkout.
    (directory / ".gitignore").write_text("*\n", encoding="utf-8")
    return directory


def checked_hash(path):
    """Never cache a partially changed source file as a verified input."""
    before = path.stat()
    checksum = file_hash(path)
    after = path.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise RuntimeError(f"Source changed while hashing; retry after saving: {path.name}")
    return checksum, after.st_size


def elapsed(start):
    return round(time.monotonic() - start, 3)
