"""Whole-project coverage from saved source inventories. Never scans or launches UE.

Cataloguing, exporting and compiling do not grant runtime or manual Play parity.
Unknown classes and inventory-only assets remain explicit work, not exclusions.
"""
from __future__ import annotations

import argparse
from collections import Counter
import html
from pathlib import Path

from core import atomic_json, digest, file_hash, read_json, utc

AREAS = {
    'maps': 'Mappe', 'characters': 'Personaggio', 'weapons': 'Armi',
    'animations': 'Animazioni', 'materials': 'Materiali', 'lighting': 'Illuminazione',
    'audio': 'Audio', 'ui': 'HUD/UI', 'inventory': 'Inventario',
    'blueprints': 'Blueprint', 'niagara': 'Niagara', 'physics': 'Collisioni/fisica',
    'gameplay': 'Gameplay 1:1',
}
EXTRA = {
    'data': ('DataTable', 'UserDefinedStruct', 'UserDefinedEnum', 'CurveFloat', 'CurveLinearColor', 'CurveLinearColorAtlas'),
    'input': ('InputAction', 'InputMappingContext'),
    'cinematics': ('LevelSequence', 'CameraAsset', 'CameraRigAsset'),
    'media': ('FileMediaSource', 'MediaPlayer', 'MediaTexture'),
    'advanced_animation': ('ControlRigBlueprintGeneratedClass', 'PoseSearchDatabase', 'PoseSearchSchema',
                          'PoseSearchNormalizationSet', 'ChooserTable', 'ProxyAsset', 'ProxyTable',
                          'MirrorDataTable', 'ControlRigShapeLibrary'),
    'audio_graphs': ('SoundCue', 'MetaSoundSource', 'SoundAttenuation', 'SoundConcurrency', 'SoundSubmix',
                     'SubmixEffectReverbPreset', 'DABP_FoleyAudioBank_C'),
}


def asset_areas(cls, package):
    """All source classes need a destination or an explicitly unresolved mapping."""
    if cls in ('World', 'MapBuildDataRegistry'): return ['maps', 'lighting']
    if cls == 'StaticMesh': return ['weapons'] if '/Weapons/' in package else ['maps']
    if cls in ('SkeletalMesh', 'Skeleton', 'GroomAsset', 'GroomBindingAsset', 'SkeletalMeshLODSettings'): return ['characters']
    if (cls.startswith(('Anim', 'Pose', 'BlendSpace', 'ControlRig')) or
            cls in ('ChooserTable', 'ProxyAsset', 'ProxyTable', 'MirrorDataTable')): return ['animations']
    if cls.startswith(('Material', 'Texture')) or cls in ('SubsurfaceProfile', 'AnimatedSparseVolumeTexture'): return ['materials']
    if cls.startswith(('Sound', 'MetaSound', 'SubmixEffect')) or cls == 'DABP_FoleyAudioBank_C': return ['audio']
    if cls in ('WidgetBlueprintGeneratedClass', 'Font', 'FontFace'): return ['ui']
    if cls == 'BlueprintGeneratedClass': return ['blueprints']
    if cls in ('UserDefinedStruct', 'UserDefinedEnum', 'DataTable'): return ['inventory', 'blueprints']
    if cls.startswith('Niagara'): return ['niagara']
    if cls in ('PhysicsAsset', 'PhysicalMaterial'): return ['physics']
    if cls.startswith(('Input', 'Camera', 'Curve', 'Media')) or cls in ('FileMediaSource', 'LevelSequence'): return ['gameplay']
    return []


def coverage(inventory, registry, *, evidence=None):
    if registry.get('complete') is not True:
        raise ValueError('Complete source Asset Registry evidence is required')
    if registry.get('source_snapshot_hash') != digest(inventory.get('files', [])):
        raise ValueError('Inventory and registry source snapshots differ')
    rows = registry.get('assets')
    if not isinstance(rows, list) or not all(isinstance(row, dict) and isinstance(row.get('package'), str) for row in rows):
        raise ValueError('Invalid source registry assets')
    asset_rows, classes, area_counts, unknown = [], Counter(), Counter(), Counter()
    packages = set()
    for row in rows:
        cls, package = row.get('class') or 'Unknown', row['package']
        destinations = asset_areas(cls, package)
        classes[cls] += 1; packages.add(package)
        for area in destinations: area_counts[area] += 1
        if not destinations: unknown[cls] += 1
        asset_rows.append({'package': package, 'object_name': row.get('object_name'), 'class': cls,
                           'areas': destinations, 'mapping': 'assigned' if destinations else 'unresolved',
                           'exported': None, 'translated': None, 'runtime_integrated': None,
                           'play_1to1': 'manual_pending'})
    # A source asset omitted by registry extraction is not silently dropped.
    inventory_only = [row for row in inventory.get('assets', []) if row.get('package') not in packages]
    extra = {name: {'count': sum(classes[cls] for cls in types), 'classes': {cls: classes[cls] for cls in types if classes[cls]},
                    'runtime_acceptance': 'manual_pending'} for name, types in EXTRA.items()}
    return {'schema_version': 1, 'generated_at': utc(), 'project': registry.get('project'),
            'source_snapshot_hash': registry['source_snapshot_hash'],
            'registry_assets': len(rows), 'inventory_assets': len(inventory.get('assets', [])),
            'source_files': len(inventory.get('files', [])), 'class_counts': dict(sorted(classes.items())),
            'areas': [{'id': name, 'title': title, 'source_assets': area_counts[name],
                       'status': 'yellow' if area_counts[name] else 'red',
                       'catalogued': True, 'exported': None, 'translated': None,
                       'runtime_integrated': None, 'play_1to1': 'manual_pending'} for name, title in AREAS.items()],
            'additional_systems': extra,
            'cross_cutting_requirements': [
                {'id': name, 'status': 'unverified', 'reason': reason} for name, reason in {
                    'multiplayer': 'Original authority, RPCs, replication, ownership, reconnect and matchmaking.',
                    'persistence': 'Original save/load, profiles, progression and data migration.',
                    'startup': 'Original GameInstance, GameMode, login, startup/menu and map transitions.',
                    'settings': 'Original input remapping, platform/config settings and localization.',
                    'plugins': 'Every source project/plugin dependency needs an adapter or a documented original editor-only witness.',
                    'packaging': 'All required runtime assets must be deployed; code-only CI/deploy is insufficient.',
                    'behavior_parity': 'Manual original-versus-Three.js acceptance; exported files and compiler tests do not certify Play.',
                }.items()],
            'unresolved_classes': dict(sorted(unknown.items())), 'inventory_only_assets': inventory_only,
            'unclassified_files': inventory.get('unclassified_files', []),
            'omitted_links': inventory.get('omitted_links', []), 'project_plugins': inventory.get('project_plugins', []),
            'asset_register': asset_rows, 'evidence': evidence or {},
            'whole_game_verified': False, 'browser_verification_performed': False,
            'rules': ['Areas overlap: do not sum their asset counts or average them into a game percentage.',
                      'null means unknown/unproven, not zero or complete.',
                      'Original editor-only assets require an explicit source witness before exclusion.',
                      'No whole-game area turns green from catalogues, exports or compiler tests.']}


def write_report(report, output):
    output = Path(output).resolve()
    source = Path(report['project']).resolve().parent
    if output == source or source in output.parents or output in source.parents:
        raise ValueError('Coverage report must be outside the original source project')
    output.mkdir(parents=True, exist_ok=True)
    atomic_json(output / 'project-coverage.json', report)
    esc = lambda value: html.escape(str(value), quote=True)
    rows = ''.join(f'<tr><td>{esc(row["title"])}</td><td>🟡 Da integrare/verificare</td>'
                   f'<td>{row["source_assets"]}</td><td>In attesa della verifica manuale</td></tr>' for row in report['areas'])
    class_rows = ''.join(f'<tr><td>{esc(cls)}</td><td>{count}</td></tr>' for cls, count in report['class_counts'].items())
    extras = ''.join(f'<li>{esc(key)}: {esc(value["count"])} risorse originali</li>' for key, value in report['additional_systems'].items())
    unknown = ', '.join(f'{key}: {value}' for key, value in report['unresolved_classes'].items()) or 'Nessuna classe senza destinazione assegnata; integrazione ancora da verificare.'
    contents = f'''<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ue2three · Copertura completa del progetto</title><style>body{{font:15px system-ui;background:#101923;color:#e3edf5;max-width:1100px;margin:auto;padding:24px}}table{{border-collapse:collapse;width:100%}}td,th{{padding:10px;border-bottom:1px solid #385164;text-align:left}}p,li{{line-height:1.6}}a{{color:#75d9d0}}</style>
<h1>Copertura completa del progetto</h1><p>{esc(report['registry_assets'])} asset nel Registry · {esc(report['inventory_assets'])} nell’inventario · {len(report['inventory_only_assets'])} voci di inventario da riconciliare.</p>
<p>Questa pagina legge gli inventari già salvati. Le prove Play e la fedeltà 1:1 sono affidate alla verifica manuale. Il censimento non dimostra la conversione del gioco.</p>
<table><tr><th>Area</th><th>Stato</th><th>Asset censiti nell’area</th><th>Play 1:1</th></tr>{rows}</table>
<h2>Sistemi aggiuntivi da non dimenticare</h2><ul>{extras}</ul><ul>{''.join('<li>'+esc(row['reason'])+'</li>' for row in report['cross_cutting_requirements'])}</ul>
<h2>Classi ancora senza destinazione</h2><p>{esc(unknown)}</p><p>Le {len(report['inventory_only_assets'])} voci non presenti nel Registry e i file non classificati restano nel report JSON. Non sono esclusi dal porting.</p>
<details><summary>Tutte le classi originali</summary><table><tr><th>Classe</th><th>Numero</th></tr>{class_rows}</table></details>
<p><a href="project-coverage.json">Registro di ogni asset e delle verifiche mancanti</a></p></html>'''
    (output / 'project-coverage.html').write_text(contents, encoding='utf-8')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--evidence', type=Path, action='append', default=[],
                        help='Saved reports to record with SHA-256; no evidence implies runtime success')
    args = parser.parse_args(argv)
    inventory = read_json(args.workspace / 'artifacts/inventory.json')
    registry = read_json(args.workspace / 'artifacts/engine_metadata.json')
    witnesses = {str(path.resolve()): {'sha256': file_hash(path)} for path in args.evidence}
    report = coverage(inventory, registry, evidence=witnesses)
    write_report(report, args.output)
    print(f'Coverage: {report["registry_assets"]} registry assets; {len(report["inventory_only_assets"])} inventory-only records; manual Play pending')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
