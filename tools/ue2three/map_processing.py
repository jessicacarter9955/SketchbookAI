"""Checksum-verified raw exports and independent, replayable offline processing."""
import os
import re
import shutil
import time
from pathlib import Path

from core import atomic_json, digest, file_hash, read_json


EXPORT_CACHE_VERSION = 2


def export_implementation_hash():
    root = Path(__file__).parent
    # Offline processing and orchestration edits must not invalidate UE exports.
    return digest({'contract': EXPORT_CACHE_VERSION,
                   'exporter': file_hash(root / 'unreal_world_export.py'),
                   'scratch': file_hash(root / 'engine_runner.py')})


def _raw_path(workspace, fingerprint):
    if not re.fullmatch(r'[a-f0-9]{64}', fingerprint):
        raise ValueError('Invalid raw export fingerprint')
    return Path(workspace).resolve() / 'maps' / 'raw' / (fingerprint + '.glb')


def read_raw_export(workspace, fingerprint, project, package):
    from map_migration import valid_glb
    path = _raw_path(workspace, fingerprint)
    try:
        info = read_json(path.with_suffix('.json'))
        if (isinstance(info, dict) and info.get('fingerprint') == fingerprint and info.get('project') == str(Path(project).resolve())
                and info.get('package') == package and valid_glb(path)
                and info.get('output_sha256') == file_hash(path)):
            return {**info, 'path': str(path)}
    except (OSError, ValueError):
        pass
    return None


def store_raw_export(model, workspace, fingerprint, project, package, warnings=(), provenance=None, source_hashes=None):
    from map_migration import valid_glb, glb_summary
    if not valid_glb(model) or not glb_summary(model)['mesh_count']:
        raise ValueError('Raw export contains no valid mesh GLB')
    path = _raw_path(workspace, fingerprint)
    source_root = Path(project).resolve().parent
    if source_root in path.parents:
        raise ValueError('Raw cache must stay outside the source project')
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.glb.tmp')
    shutil.copyfile(model, temp)
    os.replace(temp, path)
    info = {'schema_version': 1, 'fingerprint': fingerprint, 'project': str(Path(project).resolve()),
            'package': package, 'output_sha256': file_hash(path), 'warnings': list(warnings),
            'source_hashes': source_hashes or {},
            'provenance': provenance or {'kind': 'ue_export', 'contract': EXPORT_CACHE_VERSION}}
    atomic_json(path.with_suffix('.json'), info)
    return {**info, 'path': str(path)}


def processing_implementation_hash(workspace):
    root = Path(__file__).parent
    reader = Path(workspace) / 'tool-cache' / 'UAssetGUI-1.1.0.exe'
    return digest({'processor': file_hash(Path(__file__)), 'fixup': file_hash(root / 'map_fixup.py'),
                   'material_graph': file_hash(root / 'material_graph.py'),
                   'source_reader': file_hash(root / 'umg_migration.py'),
                   'parser': file_hash(reader) if reader.is_file() else None})


def _source_hashes_match(project, hashes):
    root = Path(project).resolve().parent
    if not isinstance(hashes, dict):
        return False
    try:
        return all(root in Path(path).resolve().parents and file_hash(path) == sha
                   for path, sha in hashes.items())
    except (OSError, ValueError, TypeError):
        return False


def process_raw_export(raw, target, project, workspace, implementation_hash=None):
    """Never launches UE. Always starts from raw bytes, not previous corrections."""
    from map_migration import valid_glb, glb_summary
    from map_fixup import source_scene, fixup_map
    started = time.monotonic()
    target, project = Path(target).resolve(), Path(project).resolve()
    if project.parent == target or project.parent in target.parents:
        raise ValueError('Processed output must stay outside the source project')
    if raw['project'] != str(project) or file_hash(raw['path']) != raw['output_sha256']:
        raise ValueError('Raw export identity or checksum mismatch')
    if not _source_hashes_match(project, raw.get('source_hashes', {})):
        raise ValueError('Raw export source dependencies changed; a fresh export is required')
    version = implementation_hash or processing_implementation_hash(workspace)
    key = digest({'export': raw['fingerprint'], 'raw': raw['output_sha256'], 'processing': version})
    cache_path = target.with_suffix('.processing.json')
    source_path, validation_path = target.with_suffix('.source.json'), target.with_suffix('.validation.json')
    try:
        prior = read_json(cache_path)
        if (isinstance(prior, dict) and prior.get('fingerprint') == key and valid_glb(target)
                and prior.get('output_sha256') == file_hash(target)
                and _source_hashes_match(project, prior['source_hashes'])
                and file_hash(source_path) == prior['source_metadata_sha256']
                and file_hash(validation_path) == prior['validation_sha256']):
            return {**prior, 'reused': True, 'processing_seconds': time.monotonic() - started}
    except (OSError, ValueError, KeyError):
        pass
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_name(target.stem + '.processing-stage.glb')
    shutil.copyfile(raw['path'], temp)
    source = {'project': str(project), 'map': raw['package'], 'source_hashes': {}}
    validation = {'status': 'unavailable', 'warnings': []}
    try:
        try:
            source = source_scene(project, raw['package'], workspace)
            validation = fixup_map(temp, source)
            validation['status'] = 'source_constraints_checked'
        except (OSError, ValueError, KeyError, TypeError, RuntimeError) as error:
            validation['warnings'].append(str(error))
        if not _source_hashes_match(project, source.get('source_hashes', {})):
            raise ValueError('Source changed during offline map processing')
        geometry = glb_summary(temp)
        if not valid_glb(temp) or not geometry['mesh_count']:
            raise ValueError('Processed map contains no valid mesh GLB')
        os.replace(temp, target)
        atomic_json(source_path, source)
        atomic_json(validation_path, validation)
        info = {'fingerprint': key, 'raw_fingerprint': raw['fingerprint'],
                'raw_output_sha256': raw['output_sha256'], 'processing_implementation': version,
                'source_hashes': source.get('source_hashes', {}),
                'source_metadata_sha256': file_hash(source_path), 'validation_sha256': file_hash(validation_path),
                'output_sha256': file_hash(target), 'validation': validation,
                'bytes': target.stat().st_size, **geometry}
        atomic_json(cache_path, info)
        return {**info, 'reused': False, 'processing_seconds': time.monotonic() - started}
    finally:
        temp.unlink(missing_ok=True)
