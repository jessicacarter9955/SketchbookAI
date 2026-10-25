"""Restore seven original Gallery StaticMeshActors from source map and native mesh.

No Unreal process, no changes to source .umap/.uasset, and no guessed geometry.
Read-only UAssetAPI source witness + exact native GLB SHA-256 + authored actor
component transformations. Produces an independent, explicitly partial GLB.
"""
import argparse
import json
import math
from pathlib import Path

from core import atomic_json, file_hash
from gallery_static_rebuild import rebuild, source_transform
from map_fixup import source_scene, _reference
from umg_migration import Package

LEVEL = '/Game/Fixers/VFX/NiagaraExamples/GalleryLevel'
MESH = '/Game/Fixers/VFX/NiagaraExamples/Gallery/StaticMesh/SM_ExplosionTarget.SM_ExplosionTarget'
ACTORS = ('StaticMeshActor_5', 'StaticMeshActor_15', 'StaticMeshActor_23',
          'StaticMeshActor_24', 'StaticMeshActor_28', 'StaticMeshActor_29',
          'StaticMeshActor_32')


class StaticActorRecoveryError(ValueError):
    pass


def encode_verified_transform(source):
    """The original level's serialized RelativeLocation/Scale, in glTF axes."""
    if not isinstance(source, dict) or not source or 'rotation' in source:
        raise StaticActorRecoveryError('Unexpected source rotation or missing transformation')
    translation = source.get('translation', [0, 0, 0])
    scale = source.get('scale', [1, 1, 1])
    if (not all(isinstance(x, list) and len(x) == 3 for x in (translation, scale))
            or not all(isinstance(n, (float, int)) and math.isfinite(n)
                       for vec in (translation, scale) for n in vec)):
        raise StaticActorRecoveryError('Nonfinite or invalid source transform')
    # glTF X/Z/Y and metres back to native Unreal X/Y/Z and centimetres.
    t = [translation[0]*100, translation[2]*100, translation[1]*100]
    z = [scale[0], scale[2], scale[1]]
    value = ('rotation: {x: 0, y: 0, z: 0, w: 1} '
             + 'translation: {x: %r, y: %r, z: %r} ' % tuple(t)
             + 'scale3d: {x: %r, y: %r, z: %r}' % tuple(z))
    recovered = source_transform(value)
    for field, original in (('translation', translation), ('scale', scale)):
        if any(not math.isclose(a, b, rel_tol=1e-12, abs_tol=1e-12)
               for a, b in zip(recovered[field], original)):
            raise StaticActorRecoveryError('Original relative actor transform did not roundtrip')
    return value


def create_original_manifest(project, workspace, native_dir):
    project = Path(project).resolve(strict=True)
    workspace = Path(workspace).resolve(strict=True)
    native_dir = Path(native_dir).resolve(strict=True)
    progress = json.loads((native_dir / 'native-mesh-exports.json').read_text(encoding='utf8'))
    row = [r for r in progress.get('meshes', []) if r.get('asset') == MESH]
    mesh_file = native_dir / 'SM_ExplosionTarget.glb'
    if (progress.get('source_project') != str(project) or len(row) != 1
            or row[0].get('filename') != mesh_file.name
            or row[0].get('status') not in ('exported', 'reused')
            or file_hash(mesh_file) != row[0].get('sha256')):
        raise StaticActorRecoveryError('Original native SM_ExplosionTarget GLB SHA is unavailable')
    # Original package is only read, and any parser output is kept in workspace cache.
    scene = source_scene(project, LEVEL, workspace)
    source_file = project.parent / 'Content' / (LEVEL[6:] + '.umap')
    if scene.get('source_sha256') != file_hash(source_file):
        raise StaticActorRecoveryError('Original GalleryLevel map checksum changed')
    doc_file = workspace / 'artifacts' / 'uasset-json' / (scene['source_sha256'] + '.json')
    parsed = Package(json.loads(doc_file.read_text(encoding='utf8')))
    by_name = {r['source_object']: r for r in scene['actors']}
    manifest = {'level': LEVEL, 'source_project': str(project),
                'source_map_sha256': scene['source_sha256'],
                'source_mesh_sha256': row[0]['sha256'], 'actors': []}
    for name in ACTORS:
        actor = by_name.get(name)
        if (not actor or actor.get('source_class') != 'StaticMeshActor'
                or actor.get('attached') or actor.get('root_component_class') != 'StaticMeshComponent'):
            raise StaticActorRecoveryError('Original static actor missing or unexpected: ' + name)
        index = actor.get('source_export_index')
        if type(index) is not int or parsed.export(index).get('ObjectName') != name:
            raise StaticActorRecoveryError('Actor export index does not match original map')
        components = [(i, e) for i, e in enumerate(parsed.exports, 1)
                      if e.get('OuterIndex') == index and parsed.class_name(e) == 'StaticMeshComponent']
        if len(components) != 1 or components[0][1].get('ObjectName') != actor['root_component']:
            raise StaticActorRecoveryError('Original root StaticMeshComponent identity differs')
        actual_mesh = _reference(parsed, parsed.props(components[0][1]).get('StaticMesh'))
        if actual_mesh != MESH:
            raise StaticActorRecoveryError('Original authored mesh differs: ' + name)
        manifest['actors'].append([name, [[actor['root_component'], MESH,
                                          [encode_verified_transform(actor['transform'])]]]])
    return manifest


def recover(project, workspace, native_dir, output_file):
    output_file = Path(output_file).resolve()
    witness = output_file.with_suffix('.instances.json')
    sidecar = output_file.with_suffix('.source.json')
    if any(p.exists() for p in (output_file, sidecar, witness)):
        raise StaticActorRecoveryError('Refusing to overwrite Gallery output or source witness')
    manifest = create_original_manifest(project, workspace, native_dir)
    witness.parent.mkdir(parents=True, exist_ok=True)
    atomic_json(witness, manifest)
    result = rebuild(witness, native_dir, output_file)
    if result['actors'] != len(ACTORS) or result['instances'] != len(ACTORS):
        raise StaticActorRecoveryError('Original source actor instance count differs')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', type=Path, required=True)
    parser.add_argument('--workspace', type=Path, required=True)
    parser.add_argument('--native-meshes', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(recover(args.project, args.workspace, args.native_meshes,
                             args.output), sort_keys=True), flush=True)


if __name__ == '__main__':
    main()
