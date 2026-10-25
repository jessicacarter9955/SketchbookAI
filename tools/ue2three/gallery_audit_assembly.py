"""Assemble already-verified Gallery crash-audit GLBs, preserving original data.

Uses the independently audited (non-overlapping) complete glTF fragments. An
Unreal exit code of 1 is retained as evidence, never misreported as a clean
Unreal run. This does NOT certify actor-by-actor mesh parity, effects or Play.
Original source assets and GLB fragments are read-only.
"""
import argparse
import hashlib
import json
from pathlib import Path
from gallery_fragment_assembly import AssemblyError, read_glb, merge_fragment, _write_glb


LEVEL = '/Game/Fixers/VFX/NiagaraExamples/GalleryLevel'


def assemble_audit(audit_path, diagnosis_path, output_path):
    audit_path = Path(audit_path).resolve(strict=True)
    diagnosis_path = Path(diagnosis_path).resolve(strict=True)
    output_path = Path(output_path).resolve()
    if output_path.exists() or output_path.with_suffix('.source.json').exists():
        raise AssemblyError('Refusing to overwrite existing Gallery output or witness')
    audit = json.loads(audit_path.read_text(encoding='utf-8-sig'))
    diagnosis = json.loads(diagnosis_path.read_text(encoding='utf-8-sig'))
    if (audit.get('schema_version') != 1 or audit.get('map') != LEVEL
            or diagnosis.get('map') != LEVEL or diagnosis.get('complete') is not True
            or diagnosis.get('pending')
            or audit.get('source_snapshot_hash') != diagnosis.get('source_snapshot_hash')):
        raise AssemblyError('Original Gallery inventory, diagnosis or source hash differs')
    source = diagnosis.get('actors')
    if not isinstance(source, list) or not source or len(source) != len(set(source)):
        raise AssemblyError('Invalid original actor census')
    source = set(source)
    groups = audit.get('verified_nonoverlapping_groups')
    if not isinstance(groups, list) or not groups:
        raise AssemblyError('Missing verified original native groups')
    output = {'binary': b'', 'roots': [], 'extensionsUsed': set(), 'extensionsRequired': set(),
              **{name: [] for name in ('bufferViews', 'accessors', 'materials', 'samplers', 'images',
                                       'textures', 'meshes', 'nodes', 'cameras', 'lights', 'skins',
                                       'animations')}}
    covered, witnesses = set(), []
    for group in groups:
        actors = group.get('actor_names')
        if (group.get('success') is not True or not isinstance(actors, list)
                or not actors or len(actors) != len(set(actors)) or
                not set(actors) <= source or set(actors) & covered):
            raise AssemblyError('Audit group is foreign, failed or overlaps an earlier group')
        if group.get('verification_mode') not in (
                'complete_export_unclean_exit', 'complete_export_clean_exit'):
            raise AssemblyError('Group GLB completion is not independently verified')
        path = Path(group.get('glb') or '').resolve(strict=True)
        if path in (output_path, audit_path, diagnosis_path):
            raise AssemblyError('Output aliases an original source')
        gltf, binary, fingerprint = read_glb(path)
        if fingerprint != group.get('glb_sha256'):
            raise AssemblyError('Previously verified native GLB has changed')
        merge_fragment(output, gltf, binary)
        covered.update(actors)
        witnesses.append({'actors': actors, 'glb': str(path), 'sha256': fingerprint,
                          'unreal_exit_code': group.get('unreal_exit_code'),
                          'verification_mode': group['verification_mode']})
    missing = source - covered
    if (len(covered) != audit.get('recovered_actor_count')
            or len(source) != audit.get('source_actor_count')
            or sorted(missing) != sorted(audit.get('unrecovered_actor_names', []))):
        raise AssemblyError('Audited actor accounting differs from assembled source groups')
    output_hash, gltf = _write_glb(output, output_path)
    report = {'schema_version': 1, 'map': LEVEL,
              'status': 'audited_partial_native_gallery',
              'source_snapshot_hash': audit['source_snapshot_hash'],
              'source_audit_sha256': hashlib.sha256(audit_path.read_bytes()).hexdigest(),
              'source_diagnosis_sha256': hashlib.sha256(diagnosis_path.read_bytes()).hexdigest(),
              'original_actor_count': len(source),
              'selected_original_actors': len(covered),
              'unrecovered_original_actors': sorted(missing),
              'native_fragments': witnesses, 'mesh_count': len(gltf['meshes']),
              'node_count': len(gltf['nodes']),
              'material_count': len(gltf.get('materials', [])),
              'texture_count': len(gltf.get('textures', [])),
              'glb_sha256': output_hash, 'play_verified': False,
              'visual_1to1_verified': False, 'complete_level': False,
              'limitations': ['Selected actor counts do not prove per-actor visible mesh parity',
                              'Unclean Unreal exit retained, original GLB payloads checked by SHA-256',
                              'Lighting/volumetrics/Blueprints/Niagara/physics and Play 1:1 are not certified']}
    path = output_path.with_suffix('.source.json')
    # Witness is written last; a crash cannot create a falsely complete witness.
    path.write_text(json.dumps(report, indent=2), encoding='utf-8')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audit', required=True, type=Path)
    parser.add_argument('--diagnosis', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    report = assemble_audit(args.audit, args.diagnosis, args.output)
    print(json.dumps({k: report[k] for k in (
        'original_actor_count', 'selected_original_actors', 'unrecovered_original_actors',
        'mesh_count', 'node_count', 'material_count', 'texture_count', 'glb_sha256')},
        sort_keys=True))


if __name__ == '__main__':
    main()
