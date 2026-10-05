import argparse
import json
import sys
from pathlib import Path

from core import TOOL_VERSION, Logger, atomic_json, digest, prepare_workspace, read_json, utc, workspace_lock
from pipeline import TASKS, build_report, load_state, new_state, plan, retry_task, run, save_state, skip_task, verify_state
from scanner import collect_snapshot


def parser():
    result = argparse.ArgumentParser(description="ue2three: offline Unreal inspection and migration toolkit")
    result.add_argument("--version", action="version", version=TOOL_VERSION)
    commands = result.add_subparsers(dest="command", required=True)
    for name in ("scan", "extract", "plan", "resume", "retry", "skip", "revalidate", "report", "status", "dashboard"):
        cmd = commands.add_parser(name)
        cmd.add_argument("--workspace", type=Path, help="Local task state directory, separate from source project")
        if name in {"scan", "extract", "plan"}:
            cmd.add_argument("project", type=Path, nargs="?", help="Editable .uproject; required for a new workspace")
        if name in {"scan", "extract", "plan", "resume", "retry", "revalidate"}:
            cmd.add_argument("--engine", help="Engine installation root; 'auto' restores discovery")
            reg = cmd.add_mutually_exclusive_group()
            reg.add_argument("--registry", type=Path, help="Optional JSON from registry_extract.py; never executes Unreal")
            reg.add_argument("--without-registry", action="store_true", help="Clear a previous registry import")
        if name in {"retry", "skip"}:
            cmd.add_argument("--task", choices=list(TASKS) + (["all"] if name == "retry" else []), required=True)
        if name == "skip":
            cmd.add_argument("--reason", required=True)
        if name == "dashboard":
            cmd.add_argument("--port", type=int, default=8766)
            cmd.add_argument("--open", action="store_true", help="Open the local Migration Manager in the default browser")

    character = commands.add_parser("migrate-character", help="Export one recipe-defined Unreal skeletal character to validated GLB")
    character.add_argument("project", type=Path, help="Editable Unreal .uproject")
    character.add_argument("--recipe", type=Path, required=True, help="Character migration recipe JSON")
    character.add_argument("--workspace", type=Path, help="Local migration workspace, separate from source project")
    character.add_argument("--engine", help="Optional Unreal Engine installation root")
    character.add_argument("--force", action="store_true", help="Ignore a valid cached character export")
    character.add_argument("--publish-dir", type=Path,
                           help="Optional local directory to mirror the validated runtime assets")
    maps = commands.add_parser("migrate-maps", help="Export inventoried Unreal levels to cached, validated GLB scenes")
    maps.add_argument("project", type=Path, help="Editable Unreal .uproject")
    maps.add_argument("--workspace", type=Path, required=True, help="Verified ue2three scan and Asset Registry workspace")
    maps.add_argument("--publish-dir", type=Path, required=True, help="Local output directory, outside the source project")
    maps.add_argument("--engine", help="Optional matching Unreal Engine installation root")
    maps.add_argument("--force", action="store_true", help="Re-export maps even when a valid cached GLB exists")
    return result


def default_workspace(project):
    return Path.cwd() / ".local" / "ue2three" / (project.stem + "-" + digest(str(project))[:10])


def execute(args):
    project = getattr(args, "project", None)
    if project:
        project = project.resolve(strict=True)
        if project.suffix.lower() != ".uproject" or not project.is_file():
            raise ValueError("Expected an editable .uproject file")

    latest = Path.cwd() / ".local" / "ue2three" / "last-workspace.json"
    directory = args.workspace.resolve() if args.workspace else default_workspace(project) if project else None
    if directory is None and latest.is_file():
        try:
            directory = Path(read_json(latest)["workspace"]).resolve()
        except (OSError, ValueError, KeyError):
            directory = None

    if args.command == "dashboard":
        if directory is None:
            directory = Path.cwd() / ".local" / "ue2three"
        if not (directory / "state.json").is_file():
            from manager import serve
            return serve(directory, args.port)
        from dashboard import serve
        return serve(directory, args.port, args.open)

    if directory is None:
        raise ValueError("Provide --workspace from the initial scan (or a project path for scan/plan)")

    if args.command == "migrate-character":
        from character import migrate_character
        directory = prepare_workspace(directory, project)
        atomic_json(latest, {"workspace": str(directory)})
        logger = Logger(directory)
        with workspace_lock(directory):
            result = migrate_character(project, args.recipe, directory, args.engine, args.force, logger, args.publish_dir)
            atomic_json(directory / "character-last.json", result)
        print(f"Character {result['status']}: {result['output']}")
        if result.get("published"):
            print(f"Published runtime assets: {result['published']}")
        return 0

    if args.command == "migrate-maps":
        from map_migration import migrate_maps
        if not directory.is_dir():
            raise ValueError("Map export requires a completed scan workspace")
        logger = Logger(directory)
        with workspace_lock(directory):
            report = migrate_maps(project, directory, args.publish_dir, logger,
                                  engine_override=args.engine, force=args.force)
        print(f"Unreal maps exported: {report['counts']['exported']}; reused: {report['counts']['reused']}; failed: {report['counts']['failed']}")
        print(f"Map report: {Path(args.publish_dir) / 'migration-report.json'}")
        return 0 if report["counts"]["exported"] + report["counts"]["reused"] else 1

    if (directory / "state.json").exists():
        state = load_state(directory)
        existing_project = Path(state["config"]["project"]).resolve()
        if project and project != existing_project:
            raise ValueError("Workspace belongs to another project. Choose a different --workspace.")
        project = existing_project
    elif project and args.command in {"scan", "extract", "plan"}:
        state = new_state({"project": str(project), "engine": None, "registry": None})
    else:
        raise ValueError("No state.json found. Start with scan PROJECT --workspace DIRECTORY")

    directory = prepare_workspace(directory, project)
    if args.command in {"scan", "extract", "plan"}:
        atomic_json(latest, {"workspace": str(directory)})
    logger = Logger(directory)
    with workspace_lock(directory):
        if (directory / "state.json").exists():
            state = load_state(directory)
        config = state["config"]
        if args.command == "extract":
            config["extract_engine"] = True
        if getattr(args, "engine", None):
            config["engine"] = None if args.engine == "auto" else str(Path(args.engine).resolve())
        if getattr(args, "without_registry", False):
            config["registry"] = None
        elif getattr(args, "registry", None):
            config["registry"] = str(args.registry.resolve(strict=True))
        state["history"].append({"time": utc(), "command": args.command})
        state["history"] = state["history"][-200:]
        verify_state(directory, state, logger)
        save_state(directory, state)
        logger.event("command", f"{args.command}: {directory}", command=args.command)

        if args.command in {"status", "report", "skip"}:
            if args.command == "skip":
                skip_task(state, args.task, args.reason)
                logger.event("skipped", f"{args.task}: {args.reason}", task=args.task)
                save_state(directory, state)
            report = build_report(directory, state)
            if args.command == "status":
                print(json.dumps(report["processing"], indent=2))
            else:
                print(f"Report: {directory / 'report.md'}")
            return 0

        try:
            state["source_verification_status"] = "running"
            save_state(directory, state)
            snapshot = collect_snapshot(project, config["engine"], Path(config["registry"]) if config["registry"] else None, logger)
            atomic_json(directory / "snapshot.json", snapshot)
            plan(state, snapshot)
            if args.command == "retry":
                retry_task(state, args.task)
            save_state(directory, state)
            if args.command == "plan":
                for name, task in state["tasks"].items():
                    print(f"{name:12} {task['status']:10} {task['input_hash'][:12]}")
                build_report(directory, state)
                return 0
            ok = run(directory, state, snapshot, logger)
            build_report(directory, state)
            logger.event("complete" if ok else "incomplete",
                         f"Inspection {'complete' if ok else 'incomplete'}; converted assets: 0; fidelity: not evaluated")
            print(f"Report: {directory / 'report.md'}")
            return 0 if ok else 1
        except (OSError, ValueError, RuntimeError) as exc:
            state["source_verification_status"] = "failed"
            state["last_error"] = {"time": utc(), "code": "SOURCE_SCAN_FAILED",
                                   "error": f"{type(exc).__name__}: {exc}"}
            save_state(directory, state)
            logger.event("error", state["last_error"]["error"], code="SOURCE_SCAN_FAILED")
            build_report(directory, state)
            raise


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        return execute(args)
    except KeyboardInterrupt:
        print("Interrupted. Durable task state is preserved; use resume.", file=sys.stderr)
        return 130
    except (OSError, ValueError, RuntimeError) as exc:
        print(f"ue2three [COMMAND_FAILED]: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2
