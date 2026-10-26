"""Publish an existing source-witnessed assembly as an explicitly partial preview.

No Unreal launch, rescanning, source writes or canonical map manifest changes.
Partial assemblies never contribute to the count of certified map exports.
"""
import argparse
import json
import os
from pathlib import Path
import re
import shutil

from core import atomic_json, digest, file_hash, read_json, utc, workspace_lock
from map_migration import glb_summary, valid_glb


def _outside(path, project):
    resolved = Path(path).resolve()
    root = project.parent
    if resolved == root or root in resolved.parents or resolved in root.parents:
        raise ValueError('Recovery outputs must be separate from the original project')
    return resolved


def _publish_file(source, destination, checksum):
    if destination.exists():
        if file_hash(destination) != checksum:
            raise ValueError('Existing published recovery file has a different hash; refusing overwrite')
        return 'reused'
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(source, destination)
        mode = 'hardlink'
    except FileExistsError:
        raise ValueError('Another publication created this recovery file; retry verification') from None
    except OSError:
        with source.open('rb') as incoming, destination.open('xb') as outgoing:
            shutil.copyfileobj(incoming, outgoing)
        mode = 'copy'
    if file_hash(destination) != checksum:
        raise ValueError('Published recovery hash differs; output is not certified')
    return mode


def publish_recovered_map(project, workspace, source_manifest, audit, diagnosis, publish_dir):
    project = Path(project).resolve(strict=True)
    workspace = Path(workspace).resolve(strict=True)
    source_manifest = Path(source_manifest).resolve(strict=True)
    audit = Path(audit).resolve(strict=True)
    diagnosis = Path(diagnosis).resolve(strict=True)
    publish_dir = _outside(publish_dir, project)
    source = read_json(source_manifest)
    snapshot = read_json(workspace / 'snapshot.json')
    state = read_json(workspace / 'state.json')
    registry = read_json(workspace / 'artifacts' / 'engine_metadata.json')
    snapshot_hash, files_hash = digest(snapshot), digest(snapshot.get('files', []))
    if (snapshot.get('project') != str(project) or state.get('source_verification_status') != 'verified'
            or state.get('snapshot_hash') != snapshot_hash or not registry.get('complete')
            or registry.get('project') != str(project) or registry.get('source_snapshot_hash') != files_hash):
        raise ValueError('Recovery requires the same project and fully verified source snapshot')
    if (source.get('schema_version') != 1 or source.get('complete_level') is not False
            or source.get('play_verified') is not False or source.get('visual_1to1_verified') is not False
            or source.get('source_snapshot_hash') != snapshot_hash):
        raise ValueError('Partial assembly source snapshot or acceptance flags differ')
    package = source.get('map', '')
    if not isinstance(package, str) or not re.fullmatch(r'/Game/[A-Za-z0-9_/]+', package):
        raise ValueError('Original project map package is invalid or unsupported')
    original = project.parent / 'Content' / (package[6:] + '.umap')
    relative = original.relative_to(project.parent).as_posix()
    witnesses = [row for row in snapshot['files'] if row.get('path', '').replace('\\', '/') == relative]
    if len(witnesses) != 1 or not original.is_file() or file_hash(original) != witnesses[0].get('sha256'):
        raise ValueError('Original map no longer matches its source snapshot witness')
    audit_doc, diagnosis_doc = read_json(audit), read_json(diagnosis)
    if (file_hash(audit) != source.get('source_audit_sha256')
            or file_hash(diagnosis) != source.get('source_diagnosis_sha256')
            or any(doc.get('map') != package or doc.get('source_snapshot_hash') != snapshot_hash
                   for doc in (audit_doc, diagnosis_doc))
            or diagnosis_doc.get('complete') is not True or diagnosis_doc.get('pending')):
        raise ValueError('Source audit or completed actor diagnosis hash differs')
    glb = source_manifest.with_suffix('.glb') if source_manifest.suffix != '.json' else Path(
        str(source_manifest).removesuffix('.source.json') + '.glb')
    if not glb.is_file() or not valid_glb(glb) or file_hash(glb) != source.get('glb_sha256'):
        raise ValueError('Recovered GLB is missing, corrupt or has a different hash')
    summary = glb_summary(glb)
    if summary['mesh_count'] < 1 or any(summary[key] != source.get(key) for key in (
            'mesh_count', 'material_count', 'texture_count')):
        raise ValueError('Recovered GLB geometry/material/texture counts differ from its witness')
    actors = diagnosis_doc.get('actors', [])
    original_count = source.get('original_actor_count')
    represented = source.get('represented_original_actors')
    if (not isinstance(actors, list) or len(actors) != original_count or len(set(actors)) != len(actors)
            or type(represented) is not int or not 0 < represented <= original_count
            or len(source.get('unrepresented_original_actors', [])) != original_count - represented):
        raise ValueError('Original actor census differs from assembly coverage')
    proof_hash = file_hash(source_manifest)
    key = digest({'map': package, 'glb': source['glb_sha256'], 'proof': proof_hash})[:20]
    recovery_root = _outside(publish_dir / 'recovered-maps', project)
    folder = _outside(recovery_root / key, project)
    if publish_dir not in folder.parents:
        raise ValueError('Recovery publication directory escapes the selected destination')
    recovery_root.mkdir(parents=True, exist_ok=True)
    with workspace_lock(recovery_root):
        modes = {}
        for name, path, checksum in (
                ('model.glb', glb, source['glb_sha256']), ('source.json', source_manifest, proof_hash),
                ('audit.json', audit, source['source_audit_sha256']),
                ('diagnosis.json', diagnosis, source['source_diagnosis_sha256'])):
            modes[name] = _publish_file(path, folder / name, checksum)
        row = {'id': key, 'package': package, 'kind': 'recovered_source_assembly',
               'status': 'partial_source_assembly', 'certified_map_export': False,
               'model': (folder / 'model.glb').relative_to(publish_dir).as_posix(),
               'source_manifest': (folder / 'source.json').relative_to(publish_dir).as_posix(),
               'sha256': source['glb_sha256'], 'bytes': glb.stat().st_size, **summary,
               'verified_workspace_snapshot_hash': snapshot_hash, 'verified_source_files_hash': files_hash,
               'original_map_sha256': witnesses[0]['sha256'], 'source_manifest_sha256': proof_hash,
               'original_actor_count': original_count, 'represented_original_actors': represented,
               'geometry_covered_actors': source.get('geometry_covered_actors'),
               'complete_level': False, 'play_verified': False, 'visual_1to1_verified': False,
               'physics_verified': False, 'niagara_verified': False,
               'limitations': source.get('limitations', []), 'publication_modes': modes}
        catalog_path = publish_dir / 'recovered-map-catalog.json'
        if catalog_path.exists():
            catalog = read_json(catalog_path)
            if catalog.get('project') != str(project):
                raise ValueError('Recovery catalog belongs to another project; refusing overwrite')
        else:
            catalog = {'schema_version': 1, 'project': str(project), 'maps': []}
        rows = [item for item in catalog['maps'] if item.get('id') != key]
        catalog.update(generated_at=utc(), maps=rows + [row],
                       acceptance='Partial source assemblies; excluded from certified map export totals')
        atomic_json(catalog_path, catalog)
    return {'catalog': str(catalog_path), 'map': row}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('project', 'workspace', 'source-manifest', 'audit', 'diagnosis', 'publish-dir'):
        parser.add_argument('--' + name, required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        result = publish_recovered_map(args.project, args.workspace, args.source_manifest,
                                       args.audit, args.diagnosis, args.publish_dir)
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(2, f'Recovered map publication blocked: {error}\n')
    print(json.dumps(result, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
