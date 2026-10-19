"""Fetch CC0 authored palms and photographic PBR sand for four-sided Miami coast.

Run at build time; deliver every asset from our own Netlify domain.
No Sketchfab/Fab credentials, generated substitute or user uploads are used.
"""
from pathlib import Path
import hashlib
import json
import struct
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1] / "assets" / "urban-kits" / "miami-coast"
PALM_SOURCE = "https://www.innerscene.com/api/library/palm-detailed-a8777b8c/download"
PALM_CREDIT = "https://www.innerscene.com/tools/library/3d-parts/palm-detailed-a8777b8c"
SAND_ASSET = "sand_03"
POLYHAVEN_API = f"https://api.polyhaven.com/files/{SAND_ASSET}"


def curl_bytes(url):
    return subprocess.check_output([
        "curl", "-fLsS", "--retry", "3", "--retry-all-errors",
        "--connect-timeout", "20", "--max-time", "125", url
    ], timeout=175)


def valid_glb(data):
    if len(data) < 8192 or len(data) > 20_000_000 or data[:4] != b"glTF":
        return False
    version, size = struct.unpack_from("<II", data, 4)
    if version != 2 or size != len(data):
        return False
    chunk_size, chunk_type = struct.unpack_from("<II", data, 12)
    if chunk_type != 0x4E4F534A or chunk_size > len(data) - 20:
        return False
    try:
        document = json.loads(data[20:20+chunk_size])
    except (ValueError, UnicodeDecodeError):
        return False
    return bool(document.get("meshes"))


def save_verified(url, path, check, name):
    if path.exists() and check(path.read_bytes()):
        print(f"{name}: verified local copy", flush=True)
        return
    payload = curl_bytes(url)
    if not check(payload):
        raise RuntimeError(f"{name}: download was not an authentic validated asset")
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, suffix=".part", delete=False) as temp:
        temporary = Path(temp.name)
        temp.write(payload)
    temporary.replace(path)
    print(f"{name}: verified {len(payload)} bytes", flush=True)


def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    save_verified(PALM_SOURCE, ROOT / "palm-detailed.glb", valid_glb, "CC0 detailed palm")
    files = json.loads(curl_bytes(POLYHAVEN_API))
    for channel, basename in (
        ("Diffuse", "sand-diff.jpg"),
        ("nor_gl", "sand-nor_gl.jpg"),
        ("Rough", "sand-rough.jpg"),
    ):
        resource = files[channel]["1k"]["jpg"]
        checksum = resource["md5"].lower()
        save_verified(resource["url"], ROOT / basename,
                      lambda content, expected=checksum: hashlib.md5(content).hexdigest() == expected,
                      f"Poly Haven {SAND_ASSET} {channel}")
    (ROOT / "ATTRIBUTION.json").write_text(json.dumps({
        "palm": {"source": PALM_CREDIT, "license": "CC0-1.0",
                 "asset": "palm-detailed.glb", "author": "Innerscene"},
        "sand": {"source": f"https://polyhaven.com/a/{SAND_ASSET}",
                 "license": "CC0", "asset": SAND_ASSET, "author": "Charlotte Baglioni"},
        "original_unreal_asset": False,
    }, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
