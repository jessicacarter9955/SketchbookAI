#!/usr/bin/env python3
"""Export PartMM animation.npz to a deterministic Three.js binary clip."""
import argparse
import json
from pathlib import Path
import numpy as np


def export_animation(animation_path, output_dir, faces_npz=None):
    with np.load(animation_path, allow_pickle=False) as source:
        if "points" not in source:
            raise ValueError("animation.npz must contain points [frames, vertices, 3]")
        points = np.asarray(source["points"], dtype=np.float32)
        fps = float(np.asarray(source["fps"]).item()) if "fps" in source else 30.0
        faces = np.asarray(source["faces"]) if "faces" in source else None

    if points.ndim != 3 or points.shape[2] != 3 or min(points.shape[:2]) < 1:
        raise ValueError("Expected non-empty [frames, vertices, 3]")
    if not np.isfinite(points).all():
        raise ValueError("Non-finite positions")
    if not (np.isfinite(fps) and 0 < fps <= 240):
        raise ValueError("FPS must be finite and in (0, 240]")

    if faces_npz:
        with np.load(faces_npz, allow_pickle=False) as registration:
            if "faces" not in registration:
                raise ValueError("faces_npz must contain faces [triangles, 3]")
            faces = np.asarray(registration["faces"])

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    np.ascontiguousarray(points, dtype="<f4").tofile(output_dir / "frames.f32.bin")
    manifest = {
        "format": "gaussianimate-three-frames-v1",
        "frames_file": "frames.f32.bin",
        "frame_count": int(points.shape[0]),
        "vertex_count": int(points.shape[1]),
        "fps": fps,
        "vertex_type": "float32-le",
        "source": "GaussiAnimate PartMM animation.npz",
    }

    if faces is not None:
        if faces.ndim != 2 or faces.shape[1] != 3 or not np.issubdtype(faces.dtype, np.integer):
            raise ValueError("faces must be [triangles, 3] integer indices")
        if faces.size and (faces.min() < 0 or faces.max() >= points.shape[1]):
            raise ValueError("Triangle indices outside vertex range")
        np.ascontiguousarray(faces, dtype="<u4").tofile(output_dir / "faces.u32.bin")
        manifest["faces_file"] = "faces.u32.bin"
        manifest["face_count"] = int(faces.shape[0])

    (output_dir / "animation.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("animation_npz", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--faces-npz", type=Path, help="Original registered sequence with shared triangle faces")
    args = parser.parse_args()
    print(json.dumps(export_animation(args.animation_npz, args.output_dir, args.faces_npz), indent=2))


if __name__ == "__main__":
    main()
