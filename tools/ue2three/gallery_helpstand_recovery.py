#!/usr/bin/env python3
"""Original Gallery distant HelpStand static geometry from Unreal source witnesses.

Reads the authored GalleryLevel actor and its BP_HelpStand component template,
requires the original EditorHelpCPUReadable GLB export and checksum, then
builds a glTF node at its exact relative transform. No UE source files change.
This is a static subset, NOT the HelpStand physics/Niagara/Blueprint runtime.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

from blueprint_types import import_path
from core import atomic_json, file_hash
from gallery_fragment_assembly import AssemblyError, merge_fragment, read_glb, _write_glb
from map_fixup import source_scene, _authored_transform, _reference
from umg_migration import Package

LEVEL = '/Game/Fixers/VFX/NiagaraExamples/GalleryLevel'
BLUEPRINT = '/Game/Fixers/VFX/NiagaraExamples/Gallery/Blueprints/Tools/BP_HelpStand'
MESH = '/Game/Fixers/VFX/NiagaraExamples/Gallery/StaticMesh/EditorHelpCPUReadable.EditorHelpCPUReadable'
ACTOR = 'BP_HelpStand_C_8'


def recover(project, workspace, native_folder, output):
    project = Path(project).resolve(strict=True)
    workspace = Path(workspace).resolve(strict=True)
    native_folder = Path(native_folder).resolve(strict=True)
    output = Path(output).resolve()
    manifest_file = output.with_suffix('.instances.json')
    sidecar_file = output.with_suffix('.source.json')
    if any(p.exists() for p in (output, manifest_file, sidecar_file)):
        raise AssemblyError('Refusing overwrite of original or existing Gallery source witness')
    if project.parent in output.parents or output.parent == project.parent:
        raise AssemblyError('Output cannot be placed inside the original Unreal project')
    progress = json.loads((native_folder / 'native-mesh-exports.json').read_text(encoding='utf-8-sig'))
    meshes = [r for r in progress.get('meshes', []) if r.get('asset') == MESH]
    native_mesh = native_folder / 'EditorHelpCPUReadable.glb'
    if (progress.get('source_project') != str(project) or len(meshes) != 1
            or meshes[0].get('filename') != native_mesh.name
            or meshes[0].get('status') not in ('exported', 'reused')
            or meshes[0].get('sha256') != file_hash(native_mesh)):
        raise AssemblyError('Unverified original EditorHelpCPUReadable native GLB')
    scene = source_scene(project, LEVEL, workspace)
    original_map = project.parent / 'Content' / (LEVEL[6:] + '.umap')
    if scene.get('source_sha256') != file_hash(original_map):
        raise AssemblyError('Original GalleryLevel map source changed')
    actors = [a for a in scene['actors'] if a['source_object'] == ACTOR]
    if (len(actors) != 1 or actors[0].get('source_class') != 'BP_HelpStand_C'
            or actors[0].get('attached') or actors[0].get('root_component_class') != 'SceneComponent'):
        raise AssemblyError('Original HelpStand actor identity, attachment or source scene differs')
    root = actors[0].get('transform', {})
    if set(root) - {'translation'}:
        raise AssemblyError('Original root transform requires a non-trivial composition')
    root_position = root.get('translation')
    if (not isinstance(root_position, list) or len(root_position) != 3
            or not all(type(v) in (int, float) and math.isfinite(v) for v in root_position)):
        raise AssemblyError('Missing source actor root world translation')
    original_class = project.parent / 'Content' / (BLUEPRINT[6:] + '.uasset')
    inventory = json.loads((workspace / 'artifacts' / 'inventory.json').read_text(encoding='utf-8-sig'))
    entries = [a for a in inventory.get('assets', []) if a.get('package') == BLUEPRINT]
    if len(entries) != 1 or file_hash(original_class) != entries[0].get('sha256'):
        raise AssemblyError('Original BP_HelpStand class source hash differs')
    parsed_file = workspace / 'artifacts' / 'uasset-json' / (entries[0]['sha256'] + '.json')
    template = Package(json.loads(parsed_file.read_text(encoding='utf8')))
    matches = [e for e in template.exports if e.get('ObjectName') == 'QuestionMark_GEN_VARIABLE'
               and template.class_name(e) == 'StaticMeshComponent']
    if len(matches) != 1:
        raise AssemblyError('Original HelpStand QuestionMark component template missing')
    props = template.props(matches[0])
    if _reference(template, props.get('StaticMesh')) != MESH:
        raise AssemblyError('HelpStand template refers to another original asset')
    local = _authored_transform(props)
    if (not local or set(local) - {'translation', 'scale'}
            or 'translation' not in local or 'scale' not in local
            or not all(len(local[name]) == 3 for name in ('translation', 'scale'))):
        raise AssemblyError('HelpStand template requires an unverified transform')
    position = [a + b for a, b in zip(root_position, local['translation'])]
    if not all(math.isfinite(a) for a in position + local['scale']):
        raise AssemblyError('Invalid original HelpStand world transform')
    gltf, binary, native_checksum = read_glb(native_mesh)
    if native_checksum != meshes[0].get('sha256'):
        raise AssemblyError('Original HelpStand source geometry changed')
    out = {'binary': b'', 'roots': [], 'extensionsUsed': set(), 'extensionsRequired': set(),
           **{name: [] for name in ('bufferViews', 'accessors', 'materials', 'samplers', 'images',
                                    'textures', 'meshes', 'nodes', 'cameras', 'lights', 'skins',
                                    'animations')}}
    merge_fragment(out, gltf, binary)
    children = out['roots']
    out['roots'] = []
    marker = len(out['nodes'])
    out['nodes'].append({'name': ACTOR + '/QuestionMark',
                         'translation': position, 'scale': local['scale'],
                         'children': children, 'extras': {
                             'unreal_actor': ACTOR, 'unreal_component': 'QuestionMark',
                             'original_asset': MESH, 'static_geometry_only': True}})
    out['roots'] = [marker]
    manifest = {'level': LEVEL, 'source_project': str(project),
                'source_map_sha256': scene['source_sha256'],
                'source_class_sha256': entries[0]['sha256'],
                'source_mesh_sha256': native_checksum,
                'actors': [[ACTOR, [['QuestionMark', MESH, [{
                    'source_world_translation': position, 'source_world_scale': local['scale']
                }]]]]]}
    output.parent.mkdir(parents=True, exist_ok=True)
    atomic_json(manifest_file, manifest)
    checksum, result = _write_glb(out, output)
    sidecar = {'status': 'static_geometry_subset_only', 'level': LEVEL,
               'complete_level': False, 'play_verified': False, 'visual_1to1_verified': False,
               'actors': 1, 'source_manifest': str(manifest_file),
               'source_manifest_sha256': hashlib.sha256(manifest_file.read_bytes()).hexdigest(),
               'output_sha256': checksum, 'source_map_sha256': scene['source_sha256'],
               'source_class_sha256': entries[0]['sha256'],
               'source_mesh_sha256': native_checksum,
               'mesh_count': len(result['meshes']), 'node_count': len(result['nodes']),
               'material_count': len(result.get('materials', [])),
               'texture_count': len(result.get('textures', [])),
               'limitations': ['No original HelpStand Niagara, physics, collision or Blueprint runtime',
                               'Visual/material and Play 1:1 fidelity not yet certified']}
    atomic_json(sidecar_file, sidecar)
    return sidecar


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', type=Path, required=True)
    parser.add_argument('--workspace', type=Path, required=True)
    parser.add_argument('--native-meshes', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    a = parser.parse_args()
    result = recover(a.project, a.workspace, a.native_meshes, a.output)
    print(json.dumps({k: result[k] for k in ('status', 'actors', 'mesh_count',
          'node_count', 'material_count', 'texture_count', 'output_sha256')}, sort_keys=True))


if __name__ == '__main__':
    main()
