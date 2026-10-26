"""Durable DDS asset export supervisor; delegates conversion to the verified ue2three CLI.

The two independent Unreal lanes are *character/attachments/clips* and *maps*.
Blueprint Codex workers are separate and are neither started nor modified here.
Original Unreal packages remain inputs; exported GLBs, logs and checkpoint JSON
are confined to explicitly separate workspaces and publication directories.
"""
from __future__ import annotations

import argparse
import copy
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import threading
import time

from character import character_fingerprint, load_character_recipe, validate_character_output
from core import atomic_json, digest, file_hash, read_json, utc, workspace_lock
from map_migration import glb_summary, valid_glb

REPO_ROOT = Path(__file__).resolve().parents[2]
CLI = Path(__file__).with_name("ue2three.py")
DEFAULT_RECIPE = Path(__file__).parent / "recipes" / "dds-character.json"
STATES = {"not_started", "inventory", "converting", "validating", "completed", "partial", "blocked", "failed"}
HEARTBEAT_SECONDS = 3


class ExportPrerequisiteError(RuntimeError):
    """An input or installation is missing; do not claim a conversion happened."""


def outside_source(path: Path, source: Path, label: str) -> Path:
    path, root = path.resolve(), source.parent.resolve()
    if path == root or root in path.parents or path in root.parents:
        raise ValueError(f"{label} must be separate from the original Unreal project directory")
    return path


def _read(path: Path):
    try:
        return read_json(path)
    except (FileNotFoundError, ValueError, TypeError, PermissionError):
        return None


def _iso():
    return utc()


def _job(job_id: str):
    return {"id": job_id, "status": "not_started", "running": False,
            "completed": 0, "total": 0, "percent": None, "started_at": None,
            "heartbeat_at": None, "log": None, "manifest": None, "error": None,
            "converted": 0, "failed": 0, "skipped": 0, "outputs": [], "issues": [],
            "material_degraded": 0, "attempts": 0}


def new_progress(project: Path, publish_dir: Path):
    return {"schema_version": 1, "phase": "not_started", "status": "not_started",
            "running": False, "updated_at": _iso(), "heartbeat_at": None,
            "project": str(project), "assets": {"discovered": 0, "eligible": 0,
                "converted": 0, "verified": 0, "failed": 0, "skipped": 0},
            "progress": {"percent": None, "basis": "unknown",
                "description": "Attendo un inventario completo e verificato dei target GLB"},
            "jobs": [_job("character"), _job("maps")],
            "outputs": {"manifest_path": None, "published_dir": str(publish_dir),
                        "source_root": str(project.parent)},
            "error": None, "notes": ["Non prova la fedeltà visiva, la fisica o il gameplay 1:1"],
            "events": []}


def _verified_map_rows(manifest: dict | None, project: Path, packages: list[str],
                       source_snapshot_hash: str | None) -> tuple[list[dict], int, int]:
    """Reject stale snapshots, wrong project, empty scenes and corrupted GLBs."""
    if (not isinstance(manifest, dict) or manifest.get("project") != str(project)
            or manifest.get("source_snapshot_hash") != source_snapshot_hash):
        return [], 0, 0
    selected = set(packages)
    verified, failures, source_only = [], 0, 0
    for row in manifest.get("maps", []):
        if not isinstance(row, dict) or row.get("package") not in selected or not row.get("verified_in_run"):
            continue
        if row.get("status") == "source_only":
            source_only += 1
            continue
        if row.get("status") == "failed":
            failures += 1
            continue
        if row.get("status") not in ("exported", "reused"):
            continue
        output = Path(row.get("output") or "")
        source_root = project.parent.resolve()
        resolved = output.resolve()
        summary = glb_summary(output)
        checksum = file_hash(output) if output.is_file() else None
        if (resolved == source_root or source_root in resolved.parents or
                not output.is_file() or not valid_glb(output) or
                summary["mesh_count"] < 1 or row.get("output_sha256") != checksum):
            failures += 1
            continue
        verified.append({"kind": "map", "source_package": row["package"],
                         "path": str(output), "bytes": output.stat().st_size,
                         "sha256": checksum, "mesh_count": summary["mesh_count"],
                         "material_fidelity": row.get("material_fidelity")
                         if isinstance(row.get("material_fidelity"), dict) else None})
    return verified, failures, source_only


def _map_issues(manifest: dict | None, project: Path, packages: list[str], source_hash: str | None):
    """Surface individual blockers and material downgrades without inventing a green map."""
    if (not isinstance(manifest, dict) or manifest.get("project") != str(project)
            or manifest.get("source_snapshot_hash") != source_hash):
        return [], 0
    selected = set(packages)
    issues, degraded = [], 0
    for row in manifest.get("maps", []):
        if not isinstance(row, dict) or row.get("package") not in selected or not row.get("verified_in_run"):
            continue
        package = row["package"]
        fidelity = row.get("material_fidelity")
        if isinstance(fidelity, dict) and fidelity.get("degraded") is True:
            degraded += 1
            issues.append({"package": package, "status": "material_degraded",
                           "detail": str(fidelity.get("warning") or fidelity.get("bake_mode") or "Materiali non equivalenti a Unreal")[:400]})
        if row.get("status") in ("failed", "source_only"):
            issues.append({"package": package, "status": row["status"],
                           "detail": str(row.get("error") or "Nessun GLB giocabile esportato")[:400]})
    return issues[:30], degraded


def _verified_character_files(output_dir: Path, project: Path, fingerprint: str,
                              expected_count: int, expected_clips: set | None = None,
                              expected_attachments: set | None = None) -> list[dict]:
    checked = validate_character_output(output_dir, fingerprint)
    manifest = checked["manifest"]
    if expected_clips is not None and set(manifest["clips"]) != expected_clips:
        raise ValueError("Character exporter omitted or renamed required source animation clips")
    if expected_attachments is not None and set(manifest.get("attachment_assets", {})) != expected_attachments:
        raise ValueError("Character exporter omitted or renamed required original weapon attachments")
    files = [("character", manifest["mesh"])]
    files.extend((f"clip:{name}", filename) for name, filename in manifest["clips"].items())
    files.extend((f"attachment:{name}", row["file"])
                 for name, row in manifest.get("attachment_assets", {}).items())
    if len(files) != expected_count:
        raise ValueError("Character exporter omitted expected clips or attachments")
    outputs = []
    for kind, filename in files:
        target = output_dir / filename
        # Skeletal mesh and weapon assets must be renderable; clips can contain only animation tracks.
        geometry = glb_summary(target)
        if kind == "character" or kind.startswith("attachment:"):
            if geometry["mesh_count"] < 1:
                raise ValueError(f"Non-renderable character/attachment GLB: {filename}")
        elif kind.startswith("clip:") and _animation_channels(target) < 1:
            raise ValueError(f"Animation clip has no glTF animation channels: {filename}")
        outputs.append({"kind": kind, "source_recipe": manifest.get("recipe_id"),
                        "path": str(target), "bytes": target.stat().st_size,
                        "sha256": file_hash(target), "mesh_count": geometry["mesh_count"]})
    return outputs


def _animation_channels(path: Path) -> int:
    """An animation-only glTF must still carry actual animated channels."""
    try:
        with path.open("rb") as stream:
            header = stream.read(20)
            if len(header) < 20 or header[:4] != b"glTF":
                return 0
            size, kind = struct.unpack_from("<II", header, 12)
            if kind != 0x4E4F534A or size > 64 * 1024 * 1024:
                return 0
            document = json.loads(stream.read(size).decode("utf-8").strip(" \0"))
        return sum(len(animation.get("channels", []))
                   for animation in document.get("animations", [])
                   if animation.get("samplers"))
    except (OSError, ValueError, TypeError, KeyError):
        return 0


class ExportSupervisor:
    def __init__(self, project: Path, map_workspace: Path, publish_dir: Path,
                 state_dir: Path, recipe_path: Path = DEFAULT_RECIPE,
                 engine: str | None = None, max_parallel: int = 2, scan_if_needed: bool = True,
                 cli_path: Path = CLI, python: str = sys.executable,
                 retry_base_seconds: int = 300, retry_cap_seconds: int = 3600, clock=time.time):
        self.project = Path(project).resolve()
        self.map_workspace = Path(map_workspace).resolve()
        self.publish_dir = Path(publish_dir).resolve()
        self.state_dir = Path(state_dir).resolve()
        self.recipe_path = Path(recipe_path).resolve()
        self.engine = engine
        self.max_parallel = max_parallel
        self.scan_if_needed = scan_if_needed
        self.cli_path = Path(cli_path).resolve()
        self.python = python
        if not 30 <= retry_base_seconds <= retry_cap_seconds:
            raise ValueError("Invalid durable export retry interval")
        self.retry_base_seconds = retry_base_seconds
        self.retry_cap_seconds = retry_cap_seconds
        self.clock = clock
        self.character_workspace = self.state_dir / "character-workspace"
        self.character_output = self.publish_dir / "dds-assets" / "character"
        self.map_output = self.publish_dir / "dds-assets" / "maps"
        self.progress_path = self.state_dir / "progress.json"
        self.manifest_path = self.state_dir / "manifest.json"
        self.retry_path = self.state_dir / "retry.json"
        self._retry_records = {}
        self._attempt_signatures = {}
        self._source_metadata_guard = None
        self.guard = threading.RLock()
        self.progress = new_progress(self.project, self.publish_dir)
        self._inventory_complete = False
        self._fingerprint = None
        self._map_packages = []
        self._source_snapshot_hash = None
        self._map_manifest_initial_mtime = None
        self._source_project_initial_hash = None
        if max_parallel not in (1, 2):
            raise ValueError("max_parallel must be one or two")
        if not self.project.is_file() or self.project.suffix.lower() != ".uproject":
            raise ExportPrerequisiteError(f"Unreal .uproject not found: {self.project}")
        for label, path in (("map workspace", self.map_workspace),
                            ("export checkpoint directory", self.state_dir),
                            ("GLB publication directory", self.publish_dir)):
            outside_source(path, self.project, label)
        # Distinct workspaces are necessary for actually concurrent ue2three CLI processes.
        if (self.map_workspace == self.state_dir or self.map_workspace in self.state_dir.parents
                or self.state_dir in self.map_workspace.parents):
            raise ValueError("Map scan workspace and asset export state directory must be non-nested")
        if (self.map_workspace == self.publish_dir or self.map_workspace in self.publish_dir.parents
                or self.publish_dir in self.map_workspace.parents):
            raise ValueError("Map scan workspace and publication directory must be non-nested")
        if (self.state_dir == self.publish_dir or self.state_dir in self.publish_dir.parents
                or self.publish_dir in self.state_dir.parents):
            raise ValueError("Checkpoint directory and publication directory must be non-nested")
        if self.map_workspace == self.character_workspace:
            raise ValueError("Character and map jobs must have distinct workspaces")

    def _write(self, event: str | None = None, message: str | None = None):
        with self.guard:
            jobs = self.progress["jobs"]
            active = any(job["running"] for job in jobs)
            self.progress["running"] = active
            self.progress["updated_at"] = _iso()
            if active:
                self.progress["heartbeat_at"] = _iso()
            totals = {key: sum(job[key] for job in jobs) for key in ("total", "converted", "completed", "failed", "skipped")}
            self.progress["assets"] = {"discovered": totals["total"],
                "eligible": totals["total"], "converted": totals["converted"],
                "verified": totals["completed"], "failed": totals["failed"],
                "skipped": totals["skipped"]}
            for job in jobs:
                job["percent"] = round(100 * job["completed"] / job["total"], 1) if job["total"] else None
            known = self._inventory_complete and all(job["total"] > 0 for job in jobs)
            self.progress["progress"] = {
                "percent": round(100 * totals["completed"] / totals["total"], 1) if known else None,
                "basis": "verified_outputs_over_eligible" if known else "unknown",
                "description": "GLB verificati / output attesi; non misura fedeltà del gameplay" if known
                    else "Inventario mappe o ricetta personaggio non ancora verificati"}
            if event:
                self.progress["events"] = (self.progress["events"] + [{
                    "time": _iso(), "event": event, "message": message or ""}])[-80:]
            statuses = {job["status"] for job in jobs}
            if active:
                self.progress["status"] = self.progress["phase"] = "converting" if "converting" in statuses else "inventory"
            elif "validating" in statuses:
                self.progress["status"] = self.progress["phase"] = "validating"
            elif statuses == {"completed"} and known:
                self.progress["status"] = self.progress["phase"] = "completed"
            elif "failed" in statuses and not totals["completed"]:
                self.progress["status"] = self.progress["phase"] = "failed"
            elif "blocked" in statuses and not totals["completed"]:
                self.progress["status"] = self.progress["phase"] = "blocked"
            elif (statuses & {"failed", "partial", "blocked"}) and totals["completed"]:
                self.progress["status"] = self.progress["phase"] = "partial"
            elif statuses <= {"not_started", "inventory"}:
                self.progress["status"] = self.progress["phase"] = "inventory"
            else:
                self.progress["status"] = self.progress["phase"] = "partial"
            atomic_json(self.progress_path, self.progress)

    def _update_job(self, job_id, **changes):
        with self.guard:
            job = next(item for item in self.progress["jobs"] if item["id"] == job_id)
            job.update(changes)
            if job["running"]:
                job["heartbeat_at"] = _iso()
            self._write()

    def _launch(self, job_id, args, *, manifest=None, read_progress=None, initial_status="converting"):
        log = self.state_dir / (job_id + ".log")
        job = next(item for item in self.progress["jobs"] if item["id"] == job_id)
        self._update_job(job_id, status=initial_status, running=True, log=str(log), error=None,
                         started_at=_iso(), attempts=job["attempts"] + 1,
                         retry_deferred=False, next_retry_at=None)
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        with log.open("ab") as stream:
            stream.write((f"\n[{_iso()}] launching {job_id}: {json.dumps(args)}\n").encode("utf-8"))
            stream.flush()
            process = subprocess.Popen(args, cwd=self.cli_path.parent, stdin=subprocess.DEVNULL,
                                       stdout=stream, stderr=subprocess.STDOUT, creationflags=flags)
            self._update_job(job_id, process_id=process.pid)
            while process.poll() is None:
                if read_progress:
                    try:
                        read_progress()
                    except (OSError, ValueError, TypeError):
                        # Progress reading is best-effort. The final validation is authoritative.
                        pass
                self._update_job(job_id)
                time.sleep(HEARTBEAT_SECONDS)
            code = process.wait()
        self._update_job(job_id, running=False, engine_exit_code=code, manifest=str(manifest) if manifest else None)
        return code

    def _read_map_inventory(self):
        state = _read(self.map_workspace / "state.json")
        inventory = _read(self.map_workspace / "artifacts" / "inventory.json")
        snapshot = _read(self.map_workspace / "snapshot.json")
        registry = _read(self.map_workspace / "artifacts" / "engine_metadata.json")
        if (not all(isinstance(item, dict) for item in (state, inventory, snapshot, registry))
                or state.get("source_verification_status") != "verified"
                or Path(state.get("config", {}).get("project", "")).resolve() != self.project
                or snapshot.get("project") != str(self.project)
                or digest(snapshot) != state.get("snapshot_hash")
                or not registry.get("complete")
                or registry.get("project") != str(self.project)
                or registry.get("source_snapshot_hash") != digest(snapshot.get("files", []))):
            raise ExportPrerequisiteError("Map export requires the same project's fully verified UE Asset Registry scan")
        packages = sorted(set(inventory.get("maps", [])))
        if not packages:
            raise ExportPrerequisiteError("Verified scan contains no .umap maps to export")
        self._map_packages = packages
        self._source_snapshot_hash = state["snapshot_hash"]
        self._update_job("maps", total=len(packages))
        self._inventory_complete = True

    def _prepare_maps(self):
        self._update_job("maps", status="inventory", running=True, started_at=_iso())
        try:
            try:
                self._read_map_inventory()
            except ExportPrerequisiteError:
                if not self.scan_if_needed:
                    raise
                args = [self.python, str(self.cli_path), "scan", str(self.project),
                        "--workspace", str(self.map_workspace)]
                if self.engine:
                    args.extend(("--engine", self.engine))
                self._write("map-scan", "Autonomous verified source scan; no uploads or source writes")
                if self._launch("maps", args, manifest=self.map_workspace / "snapshot.json",
                                initial_status="inventory"):
                    raise ExportPrerequisiteError("Project scan could not verify Unreal sources; inspect maps.log")
                self._read_map_inventory()
            self._update_job("maps", status="inventory", running=False)
            return True
        except (ExportPrerequisiteError, OSError, ValueError) as exc:
            self._update_job("maps", status="blocked", running=False, error=str(exc))
            return False

    def _prepare_character(self):
        try:
            recipe = load_character_recipe(self.recipe_path)
            total = 1 + len(recipe["clips"]) + len(recipe["attachment_assets"])
            self._update_job("character", total=total)
            fingerprint, _source_files = character_fingerprint(self.project, recipe)
            self._fingerprint = fingerprint
            # Repeated --loop ticks must not re-export the same 48 original
            # assets when the prior GLBs and source fingerprint still match.
            # Validate every output again rather than trusting the old status.
            try:
                cached = _verified_character_files(
                    self.character_output, self.project, fingerprint, total,
                    set(recipe["clips"]), set(recipe["attachment_assets"]))
            except (OSError, ValueError, KeyError):
                cached = []
            if len(cached) == total:
                self._update_job("character", status="completed", completed=total,
                                 converted=total, failed=0, outputs=cached,
                                 reused_verified_outputs=True, error=None)
                return False
            return True
        except (OSError, ValueError) as exc:
            self._update_job("character", status="blocked", running=False,
                             error=f"Original character/weapon/animation sources unavailable: {exc}")
            return False

    def _convert_character(self):
        args = [self.python, str(self.cli_path), "migrate-character", str(self.project),
                "--recipe", str(self.recipe_path), "--workspace", str(self.character_workspace),
                "--publish-dir", str(self.character_output)]
        if self.engine:
            args.extend(("--engine", self.engine))
        code = self._launch("character", args, manifest=self.character_output / "manifest.json",
                            read_progress=self._character_checkpoint)
        self._update_job("character", status="validating")
        try:
            if code:
                raise RuntimeError(f"Character exporter exited {code}; inspect character.log")
            total = next(job["total"] for job in self.progress["jobs"] if job["id"] == "character")
            recipe = load_character_recipe(self.recipe_path)
            checked = _verified_character_files(self.character_output, self.project, self._fingerprint, total,
                                                set(recipe["clips"]), set(recipe["attachment_assets"]))
            new_fingerprint, _ = character_fingerprint(self.project, recipe)
            if new_fingerprint != self._fingerprint:
                raise RuntimeError("Character source inputs changed during conversion")
            self._update_job("character", status="completed", completed=len(checked),
                             converted=len(checked), outputs=checked, error=None)
        except (OSError, ValueError, RuntimeError) as exc:
            self._update_job("character", status="failed", outputs=[], completed=0,
                             converted=0, failed=1, error=str(exc))

    def _character_checkpoint(self):
        # During Unreal export this is merely "file structurally present", not
        # source-verified. Full checks run only after the command exits.
        recipe = load_character_recipe(self.recipe_path)
        staging = self.character_workspace / "staging" / ("character-" + recipe["id"])
        run_recipe = _read(staging / "recipe.json")
        if not isinstance(run_recipe, dict) or run_recipe.get("fingerprint") != self._fingerprint:
            return
        expected = ["character.glb"]
        expected.extend("clip-" + key + ".glb" for key in recipe["clips"])
        expected.extend("attachment-" + key + ".glb" for key in recipe["attachment_assets"])
        converted = sum(valid_glb(staging / filename) for filename in expected)
        self._update_job("character", converted=converted)

    def _map_checkpoint(self):
        path = self.map_output / "map-manifest.json"
        if not path.is_file() or path.stat().st_mtime_ns == self._map_manifest_initial_mtime:
            return
        manifest = _read(path)
        verified, failed, skipped = _verified_map_rows(manifest, self.project,
                                                       self._map_packages, self._source_snapshot_hash)
        issues, degraded = _map_issues(manifest, self.project,
                                      self._map_packages, self._source_snapshot_hash)
        self._update_job("maps", completed=len(verified), converted=len(verified),
                         failed=failed, skipped=skipped, outputs=verified,
                         issues=issues, material_degraded=degraded)

    def _convert_maps(self):
        try:
            # The stock CLI already owns this OS lock while a source-witnessed
            # map batch is underway. Another chat's export is never superseded.
            with workspace_lock(self.map_workspace):
                pass
        except RuntimeError:
            self._update_job("maps", status="blocked", error="Existing ue2three map/scan job owns the workspace lock; retry next tick")
            return
        # Retain previously verified maps even if this retry crashes before it
        # can write a new manifest. They remain partial, never a green level.
        self._map_checkpoint()
        path = self.map_output / "map-manifest.json"
        self._map_manifest_initial_mtime = path.stat().st_mtime_ns if path.is_file() else None
        args = [self.python, str(self.cli_path), "migrate-maps", str(self.project),
                "--workspace", str(self.map_workspace), "--publish-dir", str(self.map_output)]
        if self.engine:
            args.extend(("--engine", self.engine))
        code = self._launch("maps", args, manifest=self.map_output / "map-manifest.json",
                            read_progress=self._map_checkpoint)
        self._update_job("maps", status="validating")
        self._map_checkpoint()
        job = next(item for item in self.progress["jobs"] if item["id"] == "maps")
        count = job["completed"]
        if code and not count:
            self._update_job("maps", status="failed", error=f"Map exporter exited {code}; inspect maps.log")
        elif job["total"] != count or code:
            self._update_job("maps", status="partial", error=f"Only {count}/{job['total']} renderable maps verified; exit {code}")
        else:
            self._update_job("maps", status="completed", error=None)

    def _retry_signature(self, job_id):
        """Stat only files already named by the verified snapshot; never rescan the PC.

        Metadata changes invalidate the wait immediately. The CLI still owns
        authoritative full source hashes before accepting any new conversion.
        """
        if self._source_metadata_guard is None:
            snapshot = _read(self.map_workspace / "snapshot.json") or {}
            guards = []
            root = self.project.parent.resolve()
            for row in snapshot.get("files", []):
                path = (root / row.get("path", "")).resolve()
                if path == root or root not in path.parents:
                    raise ExportPrerequisiteError("Snapshot contains a path outside the original project")
                try:
                    info = path.stat()
                    guards.append((row["path"], info.st_size, info.st_mtime_ns))
                except OSError:
                    guards.append((row["path"], "unavailable"))
            self._source_metadata_guard = digest(guards)
        names = {"dds_asset_export.py", "ue2three.py", "core.py", "adapters.py", "engine_runner.py"}
        if job_id == "maps":
            names.update({"map_migration.py", "map_processing.py", "map_fixup.py",
                          "map_actor_selection.py", "unreal_world_export.py", "pipeline.py"})
        else:
            names.update({"character.py", "unreal_character_export.py"})
        implementation = {name: file_hash(path) if path.is_file() else None
                          for name in sorted(names) for path in [self.cli_path.parent / name]}
        return digest({"project": str(self.project), "descriptor": file_hash(self.project),
                       "snapshot": self._source_snapshot_hash, "source_metadata": self._source_metadata_guard,
                       "character_fingerprint": self._fingerprint if job_id == "character" else None,
                       "recipe": file_hash(self.recipe_path) if self.recipe_path.is_file() else None,
                       "engine": self.engine, "implementation": implementation})

    def _map_manifest_guard(self):
        path = self.map_output / 'map-manifest.json'
        return file_hash(path) if path.is_file() else None

    def _output_guards(self, outputs):
        guards = []
        for row in outputs:
            path = Path(row["path"]).resolve()
            outside_source(path, self.project, "Cached GLB")
            if not valid_glb(path):
                raise ValueError("Previously verified GLB is no longer structurally valid")
            info = path.stat()
            guards.append((str(path), info.st_size, info.st_mtime_ns, row["sha256"]))
        return digest(guards)

    def _defer_retry(self, job_id):
        prior = self._retry_records.get(job_id)
        if not isinstance(prior, dict) or prior.get("signature") != self._retry_signature(job_id):
            return False
        if job_id == 'maps' and prior.get('map_manifest_guard') != self._map_manifest_guard():
            return False
        if prior.get("retry_after", 0) <= self.clock() and prior.get("job", {}).get("status") != "completed":
            return False
        cached = prior.get("job", {})
        try:
            if self._output_guards(cached.get("outputs", [])) != prior.get("output_guards"):
                return False
        except (OSError, ValueError, KeyError):
            return False
        job = next(item for item in self.progress["jobs"] if item["id"] == job_id)
        job.update(copy.deepcopy(cached))
        job.update(running=False, retry_deferred=True, next_retry_at=prior.get("retry_after"),
                   skipped_duplicate_launches=int(prior.get("skipped_duplicate_launches", 0)) + 1)
        job.pop("process_id", None)
        prior["skipped_duplicate_launches"] = job["skipped_duplicate_launches"]
        atomic_json(self.retry_path, {"schema_version": 1, "project": str(self.project), "jobs": self._retry_records})
        self._write("retry-deferred", f"{job_id}: unchanged inputs; verified outputs retained without launching Unreal")
        return True

    def _record_retry(self, job_id):
        job = next(item for item in self.progress["jobs"] if item["id"] == job_id)
        # A different worker may edit exporter sources while this attempt is
        # running. Never stamp an old failure with code that was not executed.
        signature = self._attempt_signatures.get(job_id) or self._retry_signature(job_id)
        result = digest({key: job[key] for key in ("completed", "failed", "skipped", "outputs", "issues")})
        prior = self._retry_records.get(job_id, {})
        unchanged = (int(prior.get("unchanged_rounds", 0)) + 1
                     if prior.get("signature") == signature and prior.get("result") == result else 0)
        delay = stalled_retry_delay(self.retry_base_seconds, unchanged, self.retry_cap_seconds)
        retry_after = 0 if job["status"] == "completed" else self.clock() + delay
        job.update(retry_deferred=False, next_retry_at=retry_after)
        self._retry_records[job_id] = {
            "signature": signature, "result": result, "unchanged_rounds": unchanged,
            "retry_after": retry_after, "last_attempt_at": self.clock(), "job": copy.deepcopy(job),
            "output_guards": self._output_guards(job["outputs"]),
            "map_manifest_guard": self._map_manifest_guard() if job_id == 'maps' else None,
            "skipped_duplicate_launches": prior.get("skipped_duplicate_launches", 0)}
        atomic_json(self.retry_path, {"schema_version": 1, "project": str(self.project), "jobs": self._retry_records})

    def run(self):
        self.state_dir.mkdir(parents=True, exist_ok=True)
        with workspace_lock(self.state_dir):
            self._source_project_initial_hash = file_hash(self.project)
            prior = _read(self.progress_path)
            if isinstance(prior, dict) and prior.get("project") == str(self.project):
                for job in self.progress["jobs"]:
                    old = next((item for item in prior.get("jobs", []) if item.get("id") == job["id"]), {})
                    job["attempts"] = int(old.get("attempts", 0))
            retry = _read(self.retry_path)
            if isinstance(retry, dict) and retry.get("project") == str(self.project):
                self._retry_records = retry.get("jobs", {})
            self._write("started", "Source-preserving Unreal export lanes started")
            character_ready = self._prepare_character()
            maps_ready = self._prepare_maps()
            targets = []
            if character_ready and not self._defer_retry("character"):
                targets.append(("character", self._convert_character))
            if maps_ready and not self._defer_retry("maps"):
                targets.append(("maps", self._convert_maps))
            self._attempt_signatures = {name: self._retry_signature(name) for name, _operation in targets}
            with ThreadPoolExecutor(max_workers=self.max_parallel, thread_name_prefix="dds-assets") as pool:
                futures = {pool.submit(operation): name for name, operation in targets}
                for future in as_completed(futures):
                    name = futures[future]
                    try:
                        future.result()
                    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as exc:
                        self._update_job(name, status="failed", running=False, error=str(exc))
            self._write("finished", "Export jobs exited; checking manifest")
            outputs = [item for job in self.progress["jobs"] for item in job["outputs"]]
            if file_hash(self.project) != self._source_project_initial_hash:
                # A conversion cannot certify any output if the project
                # descriptor changed during this run. Preserve the evidence.
                self.progress["notes"].append("Original .uproject changed during export; investigate before accepting outputs")
                for job in self.progress["jobs"]:
                    if job["completed"]:
                        job.update(status="partial", completed=0, converted=0, outputs=[],
                                   error="Original .uproject changed during export; verification invalidated")
                self._write("source-changed", "Original project descriptor changed during export")
            for name, _operation in targets:
                self._record_retry(name)
            report = {"schema_version": 1, "source_project": str(self.project),
                "source_project_sha256": file_hash(self.project),
                "source_snapshot_hash": self._source_snapshot_hash,
                "generated_at": _iso(), "assets": self.progress["assets"],
                "status": self.progress["status"], "files": outputs,
                "prerequisites": {"unreal_editor": "must be detected by ue2three and match the source engine",
                    "maps": "verified Unreal Asset Registry, original .umap/.uasset packages",
                    "character": "recipe-defined original packages, required plugins, GLTFExporter"},
                "acceptance": {"geometry": "GLB structure, mesh presence and SHA-256",
                    "visual_1to1": "not verified", "gameplay_play": "user acceptance pending",
                    "multiplayer": "not verified"}}
            atomic_json(self.manifest_path, report)
            self.progress["outputs"]["manifest_path"] = str(self.manifest_path)
            self._write()
            return 0 if self.progress["status"] == "completed" else 3


def stalled_retry_delay(base_seconds: int, unchanged_rounds: int, cap_seconds: int = 3600) -> int:
    """Retry unchanged partial exports without exhausting disk with identical runs.

    Both scheduled --once and --loop use this bounded delay. A deferred tick
    keeps verified outputs visible. Changed sources, exporter code or outputs
    invalidate the persisted wait on the next tick.
    """
    if not 30 <= base_seconds <= cap_seconds or unchanged_rounds < 0:
        raise ValueError("Invalid retry delay or unchanged-round count")
    return min(cap_seconds, base_seconds * (2 ** min(unchanged_rounds, 16)))


def parser():
    p = argparse.ArgumentParser(description="Run resumable DDS Unreal-to-GLB exports beside the four Blueprint workers")
    actions = p.add_mutually_exclusive_group(required=True)
    actions.add_argument("--run", "--once", dest="run", action="store_true",
                         help="One resumable character/map conversion tick")
    actions.add_argument("--loop", action="store_true", help="Independent long-running scheduler, retrying at an interval")
    actions.add_argument("--status", action="store_true", help="Read live persisted telemetry without starting Unreal")
    p.add_argument("--project", type=Path, help="Original editable VIPExtractionKitDDS.uproject")
    p.add_argument("--map-workspace", type=Path, help="Previously verified ue2three workspace; scanned if needed")
    p.add_argument("--publish-dir", type=Path, help="Private export root; writes only dds-assets/{character,maps}")
    p.add_argument("--state-dir", type=Path, default=REPO_ROOT / ".local" / "ue2three" / "asset-export")
    p.add_argument("--recipe", type=Path, default=DEFAULT_RECIPE)
    p.add_argument("--engine", help="Explicit Unreal installation path; otherwise detect installed matching editor")
    p.add_argument("--max-parallel", type=int, choices=(1, 2), default=2,
                   help="One or two concurrent Unreal conversion lanes; default two")
    p.add_argument("--no-scan", action="store_true", help="Block maps when the verified inventory is unavailable")
    p.add_argument("--interval-seconds", type=int, default=300,
                   help="Base durable retry interval, also the --loop interval; default 300 seconds")
    p.add_argument("--max-stalled-delay-seconds", type=int, default=3600,
                   help="Maximum retry interval after unchanged partial results; default one hour")
    return p


def main(argv=None):
    args = parser().parse_args(argv)
    status_path = args.state_dir.resolve() / "progress.json"
    if args.status:
        data = _read(status_path)
        if data is None:
            print(json.dumps({"schema_version": 1, "status": "not_started", "running": False,
                              "path": str(status_path)}, indent=2))
        else:
            print(json.dumps(data, indent=2, ensure_ascii=False))
        return 0
    if args.interval_seconds < 30:
        parser().error("--interval-seconds must be at least 30")
    if args.max_stalled_delay_seconds < args.interval_seconds:
        parser().error("--max-stalled-delay-seconds must be >= --interval-seconds")
    for field in ("project", "map_workspace", "publish_dir"):
        if getattr(args, field) is None:
            parser().error(f"--run/--loop requires --{field.replace('_', '-')}")
    last_signature = None
    unchanged_rounds = 0
    try:
        while True:
            runner = ExportSupervisor(args.project, args.map_workspace, args.publish_dir, args.state_dir,
                                      args.recipe, args.engine, args.max_parallel, not args.no_scan,
                                      retry_base_seconds=args.interval_seconds,
                                      retry_cap_seconds=args.max_stalled_delay_seconds)
            result = runner.run()
            if not args.loop:
                return result
            # A deterministic native crash should not create thousands of
            # identical directories every five minutes. Keep retrying but
            # exponentially back off until output or source evidence changes.
            signature = (runner._source_snapshot_hash, runner._fingerprint,
                         tuple((job['id'], job['completed'], job['failed'], job['skipped'])
                               for job in runner.progress['jobs']))
            unchanged_rounds = unchanged_rounds + 1 if result and signature == last_signature else 0
            last_signature = signature
            wait_seconds = stalled_retry_delay(args.interval_seconds, unchanged_rounds,
                                               args.max_stalled_delay_seconds)
            if unchanged_rounds:
                print(f"DDS_EXPORT_UNCHANGED {unchanged_rounds} retries; next attempt in {wait_seconds}s",
                      flush=True)
            time.sleep(wait_seconds)
    except KeyboardInterrupt:
        return 130
    except (OSError, ValueError, RuntimeError) as exc:
        print(f"DDS asset export: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
