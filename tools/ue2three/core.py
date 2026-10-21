"""Persistence, hashes and process locking, independent of Unreal adapters."""
import hashlib
import errno
import json
import os
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = 1
TOOL_VERSION = "0.2.0"


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
    # Destination replacement can briefly deny an open on Windows as well.
    # Retry only sharing/access errors; malformed JSON and persistent failures
    # must remain visible to callers rather than becoming empty state.
    for attempt in range(8):
        try:
            with Path(path).open("r", encoding="utf-8-sig") as stream:
                return json.load(stream)
        except PermissionError as error:
            # CPython's CRT-backed open can drop winerror on Windows and
            # expose a transient sharing violation as plain EACCES instead.
            retryable = getattr(error, 'winerror', None) in (5, 32) or (
                os.name == 'nt' and getattr(error, 'winerror', None) is None and error.errno == errno.EACCES)
            if not retryable or attempt == 7:
                raise
            time.sleep(min(0.01 * 2 ** attempt, 0.1))


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp")
    with temp.open("w", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, ensure_ascii=True, indent=2, sort_keys=True)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    # Windows readers can briefly prevent replacement of an open destination.
    # Keep the complete temporary file and retry; never truncate the live state.
    for attempt in range(8):
        try:
            os.replace(temp, path)
            break
        except PermissionError as error:
            if getattr(error, 'winerror', None) not in (5, 32) or attempt == 7:
                raise
            time.sleep(min(0.01 * 2 ** attempt, 0.1))


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
        if event in {"hash-start", "hash-progress", "hash-done", "task-start", "task-done", "task-failed", "engine-start", "engine-progress", "engine-done", "complete", "incomplete", "error"}:
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
