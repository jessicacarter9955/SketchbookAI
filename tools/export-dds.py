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
ACTION_CLIPS = {
    'rifle_ready': '/Game/Fixers/Animations/Mover/WeaponPoses/Rifle/Rifle_Stand_Ready_Idle',
    'rifle_aim': '/Game/Fixers/Animations/Mover/WeaponPoses/Rifle/Rifle_Stand_Aim_Idle',
    'rifle_fire': '/Game/Fixers/Animations/Mover/FixersWeapons/ArSharkCharacterAnims/NEWArShark_CharacterFireAnimation1',
    'rifle_reload': '/Game/Fixers/Weapons/GenericWeapons/Rifle/Animations/AS_AR_ReloadEmpty',
    'rifle_unequip': '/Game/Fixers/Animations/Mover/EquipsUnequips/Mover_UnEquipRifle_Stand',
    'pistol_ready': '/Game/Fixers/Animations/Mover/WeaponPoses/Pistol1H/Pistol1H_Stand_Ready_Idle',
    'pistol_aim': '/Game/Fixers/Animations/Mover/WeaponPoses/Pistol1H/Pistol1H_Stand_Aim_Idle',
    'pistol_fire': '/Game/Fixers/Animations/Mover/FixersWeapons/Bull9CharacterAnims/Bull9FireFIXED',
    'pistol_reload': '/Game/Fixers/Weapons/GenericWeapons/Pistol/Animations/AS_Reload_Pistol',
    'pistol_equip': '/Game/Fixers/Animations/Mover/EquipsUnequips/Mover_Equip_Pistol_1H_Stand',
    'crouch_idle': BASE + 'Animations/Idle/M_Neutral_Crouch_Idle_Loop',
}
WEAPONS = {
    'rifle': '/Game/Fixers/Weapons/GenericWeapons/Rifle/Mesh/SK_Rifle',
    'pistol': '/Game/Fixers/Weapons/GenericWeapons/Pistol/Mesh/SK_Pistol',
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
    if (OUT / filename).exists() and not os.environ.get('DDS_EXPORT_FORCE'):
        return
    messages = unreal.GLTFExporter.export_to_gltf(asset, str(OUT / filename), options, set())
    if messages is None or messages.errors:
        raise RuntimeError('Export failed: ' + filename + ' ' + str(messages))
    unreal.log('DDS_EXPORTED ' + filename)

mesh = unreal.load_asset(BASE + 'Meshes/SKM_UEFN_Mannequin')
if not isinstance(mesh, unreal.SkeletalMesh):
    raise RuntimeError('Missing editable UEFN mannequin mesh')
export(mesh, 'mannequin.glb')
options.export_preview_mesh = False
manifest = {'version': 1, 'mesh': 'mannequin.glb', 'clips': {}, 'weapons': {}}
paths = {name: BASE + 'Animations/' + relative for name, relative in CLIPS.items()}
paths.update(ACTION_CLIPS)
for name, path in paths.items():
    asset = unreal.load_asset(path)
    if not isinstance(asset, unreal.AnimSequence):
        raise RuntimeError('Missing animation: ' + path)
    export(asset, name + '.glb')
    manifest['clips'][name] = name + '.glb'
for name, path in WEAPONS.items():
    export(unreal.load_asset(path), name + '.glb')
    manifest['weapons'][name] = name + '.glb'
(OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2))
unreal.log('DDS_EXPORT_DONE')
