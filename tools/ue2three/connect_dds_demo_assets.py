"""Reconnect locally-owned DDS and Portland assets without duplicating or overwriting them."""
from pathlib import Path
import json
import os
import subprocess

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT.parent / "SketchbookAI" / "build" / "local-scenes"
TARGET = ROOT / "build" / "local-scenes"

def connect(source=SOURCE, target=TARGET):
    records = []
    for name in ("dds", "liberty-city"):
        src, dst = Path(source) / name, Path(target) / name
        if not src.is_dir() or not (src / "manifest.json").is_file():
            raise FileNotFoundError(f"Original {name} assets unavailable: {src}")
        dst.parent.mkdir(parents=True, exist_ok=True)
        if dst.exists():
            if dst.resolve() != src.resolve():
                raise RuntimeError(f"Refusing to replace existing {dst}")
        elif os.name == "nt":
            subprocess.run(["cmd", "/c", "mklink", "/J", str(dst), str(src)], check=True)
        else:
            dst.symlink_to(src, target_is_directory=True)
        if dst.resolve() != src.resolve():
            raise RuntimeError(f"Link did not resolve to source: {name}")
        records.append({"name": name, "source": str(src), "target": str(dst)})
    return records

if __name__ == "__main__":
    result = connect()
    checkpoint = ROOT / ".local" / "ue2three" / "demo-asset-links.json"
    checkpoint.parent.mkdir(parents=True, exist_ok=True)
    checkpoint.write_text(json.dumps({"status":"connected","links":result}, indent=2))
    print(json.dumps({"status":"connected","links":result}))
