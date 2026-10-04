"""Run inside UE's Python commandlet. Never saves or modifies source packages.

DDS_EXPORT_DIR selects a local (gitignored) destination. See docs/dds-port.md.
"""
import json
import os
from pathlib import Path
import unreal

OUT = Path(os.environ['DDS_EXPORT_DIR'])
OUT.mkdir(parents=True, exist_ok=True)
BASE = '/Game/Characters/UEFN_Mannequin/'
CLIPS = {
    'idle': 'Idle/M_Relaxed_Stand_Idle_Loop',
    'walk': 'Walk/M_Relaxed_Walk_Loop_F',
    'run': 'Run/M_Relaxed_Run_Loop_F',
    'sprint': 'Sprint/M_Relaxed_Sprint_Loop_F',
    'falling': 'Jump/M_Relaxed_Jump_Loop_Fall',
    'jump_idle': 'Jump/M_Relaxed_Jump_F_Start_Stand_Rfoot',
    'jump_running': 'Jump/M_Relaxed_Jump_F_Start_Run_Rfoot',
    'drop_idle': 'Jump/M_Relaxed_Jump_F_Land_Stand_Light_Rfoot',
    'rotate_left': 'Idle/M_Relaxed_Stand_Turn_090_L',
    'rotate_right': 'Idle/M_Relaxed_Stand_Turn_090_R',
}

registry = unreal.AssetRegistryHelpers.get_asset_registry()
registry.search_all_assets(True)
inventory = [{'path': str(a.package_name), 'type': str(a.asset_class_path.asset_name)}
             for a in registry.get_assets_by_path('/Game', recursive=True)]
(OUT / 'inventory.json').write_text(json.dumps(inventory, indent=2))

options = unreal.GLTFExportOptions()
options.export_uniform_scale = 0.01
options.export_vertex_skin_weights = True
options.export_animation_sequences = True
options.export_preview_mesh = True
options.bake_material_inputs = unreal.GLTFMaterialBakeMode.DISABLED
options.export_material_variants = unreal.GLTFMaterialVariantMode.NONE

def export(asset, filename):
    messages = unreal.GLTFExporter.export_to_gltf(asset, str(OUT / filename), options, set())
    if messages is None or messages.errors:
        raise RuntimeError('Export failed: ' + filename + ' ' + str(messages))
    unreal.log('DDS_EXPORTED ' + filename)

mesh = unreal.load_asset(BASE + 'Meshes/SKM_UEFN_Mannequin')
if not isinstance(mesh, unreal.SkeletalMesh):
    raise RuntimeError('Missing editable UEFN mannequin mesh')
export(mesh, 'mannequin.glb')
options.export_preview_mesh = False
manifest = {'version': 1, 'mesh': 'mannequin.glb', 'clips': {}}
for name, relative in CLIPS.items():
    asset = unreal.load_asset(BASE + 'Animations/' + relative)
    if not isinstance(asset, unreal.AnimSequence):
        raise RuntimeError('Missing animation: ' + relative)
    export(asset, name + '.glb')
    manifest['clips'][name] = name + '.glb'
(OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2))
unreal.log('DDS_EXPORT_DONE')
