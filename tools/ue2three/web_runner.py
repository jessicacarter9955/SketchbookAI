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
    workspace = root / "jobs" / f"{label}-{key}"
    migration_workspace = root / "jobs" / f"{label}-{key}-character"
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
    character_url = "http://127.0.0.1:8401/editor.html?scene=ue2three-character&play=1"
    if recipe is not None:
        scenes.append(("Sketchbook · personaggio giocabile", character_url))
    for name, scene_url in scenes:
        print("SCENE\t" + name + "\t" + scene_url, flush=True)
    visual_maps = [item for item in map_report.get("maps", [])
                   if item.get("status") in {"exported", "reused"} and item.get("mesh_count", 0) > 0]
    default_name = next((item["package"].rsplit("/", 1)[-1] for item in visual_maps
                         if item["package"].endswith("/LV_Fixers_MainMenu")), None)
    if default_name is None and visual_maps:
        default_name = visual_maps[0]["package"].rsplit("/", 1)[-1]
    default = next((url for name, url in scenes if name == default_name), scenes[0][1] if scenes else "")
    if default:
        print("PREVIEW_URL=" + default, flush=True)
    failed_maps = map_report.get("counts", {}).get("failed", 0)
    if not maps_command_ok and not map_report.get("maps"):
        phase("done", "Analisi completata; non è stato possibile esportare mappe. Vedi il report locale.")
    elif failed_maps:
        phase("done", f"Mappa pronta con {failed_maps} livelli non esportati. Il personaggio resta giocabile.")
    else:
        phase("done", f"Porting asset completato: {len(map_report.get('maps', []))} mappe. Le scene sono pronte.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
