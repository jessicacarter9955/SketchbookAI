#!/usr/bin/env python3
"""Audit an authentic Unreal package before attempting DDS conversion.

A .uasset Blueprint interface is not a GLB mesh. This script records objective
package evidence and refuses to claim an export without an actual GLB.
"""
import argparse
import hashlib
import json
import re
import struct
from pathlib import Path

PACKAGE_MAGIC = 0x9E2A83C1

def audit(path):
    p = Path(path)
    raw = p.read_bytes()
    magic = struct.unpack_from("<I", raw)[0] if len(raw) >= 4 else None
    strings = [s.decode("ascii") for s in re.findall(rb"[\x20-\x7e]{8,}", raw)]
    unreal_versions = sorted(set(s for s in strings if "++UE" in s))
    blueprint_interfaces = [s for s in strings if s.startswith("BPI_")]
    result = {
        "source_file": p.name,
        "bytes": len(raw),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "unreal_package_magic_valid": magic == PACKAGE_MAGIC,
        "engine_versions": unreal_versions,
        "blueprint_interface_markers": sorted(set(blueprint_interfaces))[:30],
        "glb_mesh_exported": False,
        "one_to_one_port_verified": False,
    }
    if magic != PACKAGE_MAGIC:
        raise ValueError("Not an Unreal package: wrong package magic")
    return result

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("package")
    parser.add_argument("--out", help="Optional JSON report destination")
    args = parser.parse_args()
    report = audit(args.package)
    data = json.dumps(report, indent=2, ensure_ascii=False) + "\n"
    if args.out:
        Path(args.out).write_text(data, encoding="utf-8")
    print(data, end="")

if __name__ == "__main__":
    main()
