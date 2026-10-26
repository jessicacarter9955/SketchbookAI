"""Checksum-verified raw exports and independent, replayable offline processing."""
import os
import re
import shutil
import time
from pathlib import Path

from core import atomic_json, digest, file_hash, read_json


EXPORT_CACHE_VERSION = 2
NON_RENDERING_NATIVE_ACTORS = {
    'Actor', 'Info', 'WorldSettings', 'LevelScriptActor', 'PointLight', 'SpotLight',
    'DirectionalLight', 'SkyLight', 'RectLight', 'CameraActor', 'CineCameraActor',
    'PlayerStart', 'TargetPoint', 'PostProcessVolume', 'ReflectionCapture',
    'SphereReflectionCapture', 'BoxReflectionCapture', 'PlaneReflectionCapture',
    'TriggerVolume', 'BlockingVolume', 'PhysicsVolume', 'NavMeshBoundsVolume',
    'NavModifierVolume',
}


def classify_empty_export_source(source):
    """Classify a zero-mesh export from read-only serialized map evidence.

    A source-only result is deliberately narrower than "Unreal exported no
    geometry": Blueprint instances and assigned mesh components mean geometry
    may have been lost or created during construction, so they remain failures.
    """
    if (not isinstance(source, dict) or source.get('schema_version') != 1 or
            not source.get('source_sha256') or not isinstance(source.get('source_hashes'), dict) or
            not source.get('source_hashes') or not isinstance(source.get('actors'), list) or
            not isinstance(source.get('mesh_components'), list)):
        return {'classification': 'source_unavailable',
                'reason': 'Complete actor and mesh-component source provenance was not available.'}

    actors = source['actors']
    components = source['mesh_components']
    assigned = [item for item in components if isinstance(item, dict) and item.get('asset_reference')]
    if assigned:
        return {'classification': 'source_geometry_present',
                'reason': 'Serialized source components reference mesh or geometry assets.',
                'actor_count': len(actors), 'mesh_component_count': len(components),
                'assigned_mesh_component_count': len(assigned)}

    blueprint_actors = [item for item in actors if isinstance(item, dict) and
                        (str(item.get('source_class', '')).endswith('_C') or
                         'BlueprintGeneratedClass' in str(item.get('source_class', '')))]
    unknown_actor_classes = [item for item in actors if not isinstance(item, dict) or
                             item.get('source_class') not in NON_RENDERING_NATIVE_ACTORS]
    dynamic_components = [item for item in components if isinstance(item, dict) and
                          item.get('source_class') in {'LandscapeComponent', 'GeometryCollectionComponent',
                                                       'ProceduralMeshComponent', 'TextRenderComponent',
                                                       'WidgetComponent'}]
    if blueprint_actors or unknown_actor_classes or dynamic_components:
        return {'classification': 'source_geometry_indeterminate',
                'reason': 'Blueprint construction, an unclassified actor, or a procedural/renderable component may supply geometry.',
                'actor_count': len(actors), 'blueprint_actor_count': len(blueprint_actors),
                'unclassified_actor_count': len(unknown_actor_classes),
                'mesh_component_count': len(components),
                'indeterminate_component_count': len(dynamic_components)}
    return {'classification': 'source_meshless',
            'reason': 'Serialized map data contains only recognized non-rendering native actors and no assigned or procedural geometry components.',
            'actor_count': len(actors), 'mesh_component_count': len(components),
            'limitations': ['Runtime-spawned or native code-generated geometry is not represented by serialized map references.']}


def export_implementation_hash():
    root = Path(__file__).parent
    # Offline processing and orchestration edits must not invalidate UE exports.
    return digest({'contract': EXPORT_CACHE_VERSION,
                   'exporter': file_hash(root / 'unreal_world_export.py'),
                   'actor_selection': file_hash(root / 'map_actor_selection.py'),
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
