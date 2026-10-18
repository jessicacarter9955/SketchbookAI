# GaussiAnimate in SketchbookAI

Upstream: https://github.com/Net-Maker/GaussiAnimate
Pinned upstream commit: 77e356856379b098f67f2a50083b6df10fab9ea4
License: MIT (consult upstream/LICENSE and upstream/THIRD_PARTY_NOTICES.md).

The full upstream source has been imported by GitHub Actions into the
upstream/ directory on branch img2threejs-runner. This is a source snapshot,
not a separately forked repository, not a website deployment, and not an
automatic plugin for every static GLB. Original SketchbookAI reference images
are never overwritten by the importer.

## What GaussiAnimate actually does

GaussiAnimate can extract inner skeleton joints and expressive outer deforming
bones automatically from registered temporal 3D data (moving meshes or
tracked 3D Gaussian points). It does not require manual creation of the initial
skeleton, but it does create an *actual rig representation* ("skelebones").
Motion is transferred via Partwise Motion Matching (PartMM).

Important: a single flat photograph or ordinary static Sketchfab/Fab GLB
is NOT sufficient. It needs a registered sequence of points, where the same
index denotes the same surface location for every frame. Motion sources and
new target poses must also be provided.

## End-to-end commands

Use Python 3.10 on Linux, with upstream native CGAL, Eigen and pyssdr
dependencies. Use a GPU for Gaussian reconstruction upstream, if required.

    cd img2three/gaussianimate/upstream
    python -m pip install -e .
    bash scripts/install_geometry.sh

Extract the skelebones from a registered 3D point sequence:

    gaussianimate /path/to/sequence.npz /path/to/extracted

The input sequence.npz must contain 'points' of shape [T,N,3].
Shared triangle faces [M,3] and fps are optional.

Generate a novel deformed animation from an inner-skeleton pose (novel_pose.npz):

    gaussianimate-animate /path/to/extracted/skelebones.npz /path/to/novel_pose.npz /path/to/animation.npz

Both extraction and motion-transfer commands run in Python, not in the
browser. The motion-transfer output contains animated points [Q,N,3].

To convert the result for our Three.js playback bridge, run from the
SketchbookAI repository root:

    python img2three/gaussianimate/bridge/npz_to_three_frames.py \
      /path/to/animation.npz img2three/gaussianimate/bridge/exports/my-asset \
      --faces-npz /path/to/sequence.npz

Then serve the repository over HTTP:

    python -m http.server 8000

Open:

http://localhost:8000/img2three/gaussianimate/bridge/viewer.html?asset=exports/my-asset/animation.json

The Three.js player shows a mesh if triangle faces exist or animated points
otherwise. Both use baked frames with no skeleton updates in the browser.
This is a *debug/basic geometry viewer* and does not yet render
photorealistic Gaussian splats. The full animation may consume substantial
RAM; production should stream/chunk/quantize frames and add LOD.

Open viewer.html without the asset parameter to see a deliberately labelled
synthetic waving-cloth smoke test. That is NOT a real GaussiAnimate output.

## File format used by the bridge

- animation.json: metadata, number of frames, vertices and frames per second
- frames.f32.bin: little-endian float32 packed [frame, vertex, xyz]
- faces.u32.bin: optional little-endian uint32 [triangle, 3]

## Integration ideas

1. Animated pedestrians and animals: reconstruct a registered training clip,
   compute skelebones and PartMM motion, then export reusable walk, run and
   idle clips. Three.js can replay baked frames, while existing game AI handles
   movement and logic.
2. Soft clothing and tails: this system shines on non-rigid deformations that
   look stiff with ordinary linear skinning.
3. Importer assets: keep originals; process compatible dynamic sequences
   separately and never replace the source 3D assets.
4. For runtime control, a custom PartMM service or precomputed clip library
   will be needed. The present bridge is playback only.

GitHub Actions import success verifies the copy, not Gaussian inference,
end-to-end extraction, generated animation quality or a deployed website.
