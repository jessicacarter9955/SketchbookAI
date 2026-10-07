"""Run the automatic one-click local project analysis and character preparation."""
import hashlib
import json
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from urllib.parse import quote
from pathlib import Path


def auto_recipe(registry, bundled_recipe, destination):
    """Prefer a bundled profile only when its mesh belongs to this project; otherwise infer a basic profile."""
    assets = registry.get("assets", [])
    by_package = {entry.get("package"): entry for entry in assets}
    bundled = json.loads(bundled_recipe.read_text(encoding="utf-8"))
    if bundled.get("mesh") in by_package:
        destination.write_text(json.dumps(bundled, indent=2), encoding="utf-8")
        return destination

    meshes = [a for a in assets if a.get("class") == "SkeletalMesh" and not re.search(r"weapon|rifle|pistol|gun|hair|face", a.get("package", ""), re.I)]
    animations = [a for a in assets if a.get("class") in {"AnimSequence", "AnimSequenceBase", "AnimComposite"}]
    if not meshes or not animations:
        return None
    mesh = meshes[0]
    skeleton = str(mesh.get("tags", {}).get("Skeleton", ""))
    skeleton_name = skeleton.rsplit(".", 1)[-1].strip("'") if skeleton else ""
    compatible = [a for a in animations if not skeleton_name or skeleton_name in str(a.get("tags", {}).get("Skeleton", ""))]
    if not compatible:
        return None
    mapping = {}
    patterns = (("idle", r"idle|stand"), ("walk", r"walk"), ("run", r"run|sprint"), ("jump", r"jump"))
    for alias, pattern in patterns:
        match = next((a for a in compatible if re.search(pattern, a.get("object_name", ""), re.I)), None)
        if match:
            mapping[alias] = match["package"]
    if "idle" not in mapping:
        mapping["idle"] = compatible[0]["package"]
    if "walk" not in mapping and "run" in mapping:
        mapping["walk"] = mapping["run"]
    if len(mapping) < 2:
        return None
    profile = {"schema_version": 1, "id": "auto-character", "mesh": mesh["package"], "clips": mapping,
               "runtime": {"animation_aliases": {"stop": "idle"}}, "export": {"uniform_scale": 0.01}}
    destination.write_text(json.dumps(profile, indent=2), encoding="utf-8")
    return destination


def reusable_workspace(root, preferred, project):
    """Reuse a prior verified scan for this exact project when the default job is elsewhere."""
    project_key = str(project.resolve()).casefold()
    candidates = [preferred]
    if root.is_dir():
        candidates.extend(root.rglob("state.json"))
    matches = []
    seen = set()
    for candidate in candidates:
        directory = candidate.parent if candidate.name == "state.json" else candidate
        key = str(directory.resolve()).casefold()
        if key in seen:
            continue
        seen.add(key)
        try:
            state = json.loads((directory / "state.json").read_text(encoding="utf-8"))
            source = str(Path(state["config"]["project"]).resolve()).casefold()
            if source != project_key or state.get("source_verification_status") != "verified":
                continue
            has_map_runs = (directory / "maps" / "runs").is_dir()
            matches.append((directory == preferred, has_map_runs, (directory / "state.json").stat().st_mtime, directory))
        except (OSError, ValueError, KeyError, TypeError):
            continue
    if not matches:
        return preferred
    # Prefer the canonical job, then a verified workspace with level-export cache, then recency.
    matches.sort(key=lambda item: (item[0], item[1], item[2]), reverse=True)
    return matches[0][3]


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True, type=Path)
    parser.add_argument("--workspace-root", required=True, type=Path)
    parser.add_argument("--repo", required=True, type=Path)
    parser.add_argument("--engine", default="")
    args = parser.parse_args()

    project, repo, root = args.project.resolve(strict=True), args.repo.resolve(strict=True), args.workspace_root.resolve()
    key = hashlib.sha256(str(project).casefold().encode("utf-8")).hexdigest()[:10]
    label = "".join(c if c.isalnum() or c in "-_" else "-" for c in project.stem).strip("-")[:48] or "unreal-project"
    preferred_workspace = root / "jobs" / f"{label}-{key}"
    workspace = reusable_workspace(root, preferred_workspace, project)
    migration_workspace = workspace.parent / f"{workspace.name}-character"
    if not migration_workspace.is_dir():
        cached_character_jobs = list(root.rglob(f"{label}-{key}-character")) if root.is_dir() else []
        if cached_character_jobs:
            migration_workspace = max(cached_character_jobs, key=lambda item: item.stat().st_mtime)
    cli = repo / "tools" / "ue2three" / "ue2three.py"
    registry_file = workspace / "artifacts" / "engine_metadata.json"
    project_output = repo / "build" / "local-scenes" / "ue2three" / "projects" / f"{label}-{key}"

    def phase(name, text):
        print("PHASE " + name, flush=True)
        print("MESSAGE " + text, flush=True)

    def run_cli(parts, title):
        print(f"\n=== {title} ===", flush=True)
        result = subprocess.run([sys.executable, str(cli), *parts], cwd=repo)
        return result.returncode == 0

    # `extract PROJECT` performs the project scan and registry read in a single
    # pipeline run, avoiding a second full hash pass over large Unreal projects.
    phase("scan", "Analizzo il progetto e cerco mesh e animazioni compatibili...")
    extract = ["extract", str(project), "--workspace", str(workspace)]
    if args.engine:
        extract += ["--engine", args.engine]
    if not run_cli(extract, "Unreal asset analysis"):
        return 2

    phase("assets", "Sto preparando il personaggio trovato...")
    registry = json.loads(registry_file.read_text(encoding="utf-8"))
    profile_path = workspace / "artifacts" / "detected-character.json"
    recipe = auto_recipe(registry, repo / "tools" / "ue2three" / "recipes" / "dds-character.json", profile_path)
    if recipe is None:
        phase("assets", "Non ho trovato una combinazione automatica di mesh e animazioni; continuo con le mappe...")
    else:
        phase("scene", "Personaggio trovato. Preparo il modello e la scena controllabile...")
        migrate = ["migrate-character", str(project), "--recipe", str(recipe), "--workspace", str(migration_workspace),
                   "--publish-dir", str(repo / "build" / "local-scenes" / "ue2three" / "current")]
        if args.engine:
            migrate += ["--engine", args.engine]
        if not run_cli(migrate, "Character preparation"):
            return 2

    phase("maps", "Esporto le mappe Unreal e riuso quelle gia convertite...")
    map_export = ["migrate-maps", str(project), "--workspace", str(workspace), "--publish-dir", str(project_output)]
    if args.engine:
        map_export += ["--engine", args.engine]
    maps_command_ok = run_cli(map_export, "Unreal level migration")
    report_file = project_output / "migration-report.json"
    map_report = {}
    if report_file.is_file():
        try:
            map_report = json.loads(report_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass

    phase("maps", "Sto traducendo le schermate originali collegate alla mappa iniziale...")
    ui_command = ["migrate-ui", str(project), "--workspace", str(workspace), "--publish-dir", str(project_output)]
    ui_command_ok = run_cli(ui_command, "Unreal interface migration")

    url = "http://127.0.0.1:8401/editor.html?scene=ue2three-character&play=1"
    try:
        urllib.request.urlopen("http://127.0.0.1:8401/", timeout=1).close()
    except OSError:
        npm = shutil.which("npm.cmd") or shutil.which("npm")
        if not npm:
            print("FAILED: Three.js editor runtime is unavailable.", flush=True)
            return 2
        command = ["cmd.exe", "/c", npm, "run", "editor"] if sys.platform == "win32" else [npm, "run", "editor"]
        flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
        subprocess.Popen(command, cwd=repo, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, creationflags=flags)
        for _ in range(90):
            try:
                urllib.request.urlopen("http://127.0.0.1:8401/", timeout=1).close()
                break
            except OSError:
                time.sleep(1)
        else:
            print("FAILED: Three.js editor runtime did not become ready.", flush=True)
            return 2
    scenes = []
    for item in map_report.get("maps", []):
        if item.get("status") not in {"exported", "reused"}:
            continue
        scene_url = "http://127.0.0.1:8401/ue2three-level.html?model=" + quote(
            "build/local-scenes/ue2three/projects/" + project_output.name + "/maps/" + item["filename"], safe="/")
        scene_url += "&title=" + quote(item["package"].rsplit("/", 1)[-1])
        scenes.append((item["package"].rsplit("/", 1)[-1], scene_url))
    ui_manifest = project_output / "ui-manifest.json"
    # The first UMG batch overlays the source menu layout on its own migrated level.
    # Keep the map and widget manifest separate so later screen exports can reuse them.
    if ui_command_ok and ui_manifest.is_file():
        manifest = json.loads(ui_manifest.read_text(encoding="utf-8"))
        root_map = manifest.get("root_map")
        map_entry = next((item for item in map_report.get("maps", [])
                          if item.get("package") == root_map and item.get("status") in {"exported", "reused"}), None)
        if map_entry:
            model_path = "build/local-scenes/ue2three/projects/" + project_output.name + "/maps/" + map_entry["filename"]
            manifest_path = "build/local-scenes/ue2three/projects/" + project_output.name + "/ui-manifest.json"
            ui_url = "http://127.0.0.1:8401/ue2three-ui.html?model=" + quote(model_path, safe="/")
            ui_url += "&manifest=" + quote(manifest_path, safe="/")
            scenes.insert(1 if recipe is not None else 0, ("DDS Menu (mappa originale)", ui_url))
    character_url = "http://127.0.0.1:8401/editor.html?scene=ue2three-character&play=1"
    if recipe is not None:
        character_preview_url = "http://127.0.0.1:8401/ue2three-character.html?base=build/local-scenes/ue2three/current/"
        scenes.insert(0, ("Personaggio DDS · animazioni e armi originali", character_preview_url))
        scenes.append(("Sketchbook - personaggio giocabile", character_url))
    for name, scene_url in scenes:
        print("SCENE\t" + name + "\t" + scene_url, flush=True)
    visual_maps = [item for item in map_report.get("maps", [])
                   if item.get("status") in {"exported", "reused"} and item.get("mesh_count", 0) > 0]
    default_name = next((item["package"].rsplit("/", 1)[-1] for item in visual_maps
                         if item["package"].endswith("/LV_Fixers_MainMenu")), None)
    if default_name is None and visual_maps:
        default_name = visual_maps[0]["package"].rsplit("/", 1)[-1]
    default = (scenes[0][1] if recipe is not None else
               scenes[0][1] if ui_command_ok and ui_manifest.is_file() else
               next((url for name, url in scenes if name == default_name), scenes[0][1] if scenes else ""))
    if default:
        print("PREVIEW_URL=" + default, flush=True)
    failed_maps = map_report.get("counts", {}).get("failed", 0)
    ready_maps = map_report.get("counts", {}).get("exported", 0) + map_report.get("counts", {}).get("reused", 0)
    if not maps_command_ok and not map_report.get("maps"):
        phase("done", "Analisi completata; non è stato possibile esportare mappe. Vedi il report locale.")
    elif not ui_command_ok:
        phase("done", "Mappe pronte; la conversione delle schermate originali non è riuscita. Vedi il report locale.")
    elif failed_maps:
        ui_note = "Menu originale pronto." if ui_command_ok else "La schermata menu non è stata esportata."
        phase("done", f"Prima tranche pronta: {ready_maps} mappe leggibili, {failed_maps} livelli non esportati. {ui_note} Logiche Blueprint ancora da tradurre.")
    else:
        phase("done", f"Prima tranche pronta: {ready_maps} mappe e schermata menu originale. Logiche Blueprint ancora da tradurre.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
