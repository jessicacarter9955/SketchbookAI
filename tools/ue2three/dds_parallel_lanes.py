"""Run a single source-scoped DDS test lane when human visual QA is approved.

This script does not execute Unreal Engine. Each lane exercises only the
available migration code, fixtures, and contracts already in GitHub.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LANES = {
    "character-weapons": {
        "python": ["test_character.py", "test_controls_migration.py"],
        "js": ["tests/ue2three-attachment.test.mjs", "tests/ue2three-manifest.test.mjs", "tests/dds-game.test.mjs"],
        "not_proven": "No real skinned DDS export or UE weapon equivalence on GitHub runners."
    },
    "animations": {
        "python": ["test_character.py", "test_engine_runner.py"],
        "js": ["tests/ue2three-manifest.test.mjs", "tests/ue2three-attachment.test.mjs"],
        "not_proven": "No 1:1 Unreal AnimBP, motion matching, curves or animation notifies."
    },
    "blueprints-inventory": {
        "python": ["test_blueprint*.py", "test_progress_report.py"],
        "js": ["tests/ue2three-blueprint.test.mjs", "tests/ue2three-blueprint-runtime.test.mjs",
               "tests/ue2three-source-verification.test.mjs", "tests/ue2three-native-math.test.mjs"],
        "not_proven": "Blocked functions, native calls and original equip/equipment UI remain."
    },
    "maps-materials": {
        "python": ["test_map_*.py", "test_material_graph.py", "test_ue2three.py"],
        "js": ["tests/ue2three-collision.test.mjs", "tests/ue2three-presentation.test.mjs"],
        "not_proven": "No new Unreal map export, original 1:1 material fidelity or final city."
    },
    "shop-dialogues": {
        "python": ["test_umg_migration.py", "test_blueprint_events.py"],
        "js": ["tests/dds-game.test.mjs", "tests/ue2three-objects.test.mjs"],
        "not_proven": "Local demo interactions only; original DDS quests/shop/dialogue incomplete."
    },
    "physics-fx-audio": {
        "python": ["test_map_processing.py", "test_blueprint_effects.py"],
        "js": ["tests/ue2three-collision.test.mjs", "tests/ue2three-effects.test.mjs"],
        "not_proven": "No original Unreal physics solver, Niagara or MetaSounds playback."
    },
    "multiplayer": {
        "python": ["test_blueprint_objects.py", "test_blueprint_events.py"],
        "js": ["tests/ue2three-objects.test.mjs", "tests/ue2three-blueprint-runtime.test.mjs"],
        "not_proven": "No transport, server authority, RPC, replication or multi-client test."
    },
    "lighting": {
        "python": ["test_material_graph.py", "test_map_fixup.py"],
        "js": ["tests/ue2three-presentation.test.mjs"],
        "not_proven": "No visual equivalence with Unreal Lumen, SkyLight or postprocessing."
    }
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lane", required=True, choices=LANES)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    lane = LANES[args.lane]
    args.report.parent.mkdir(parents=True, exist_ok=True)
    entries = []
    for pattern in lane["python"]:
        command = [sys.executable, "-m", "unittest", "discover",
                   "-s", "tools/ue2three/tests", "-p", pattern, "-v"]
        print("+", " ".join(command), flush=True)
        result = subprocess.run(command, cwd=ROOT, check=False)
        entries.append({"kind": "python", "pattern": pattern, "exit_code": result.returncode})
    command = ["node", "--test", *lane["js"]]
    print("+", " ".join(command), flush=True)
    result = subprocess.run(command, cwd=ROOT, check=False)
    entries.append({"kind": "javascript", "files": lane["js"], "exit_code": result.returncode})
    success = all(entry["exit_code"] == 0 for entry in entries)
    report = {
        "schema": "dds-lane-qa-v1", "lane": args.lane,
        "unit_test_status": "passed" if success else "failed",
        "results": entries, "not_proven": lane["not_proven"],
        "real_unreal_export_tested": False,
        "real_multiplayer_tested": False,
        "one_to_one_fidelity_verified": False
    }
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if success else 1


if __name__ == "__main__":
    raise SystemExit(main())
