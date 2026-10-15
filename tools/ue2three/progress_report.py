"""Cached, evidence-bounded project checklist; never starts Unreal or rescans assets."""
import html
import math
from collections import Counter
from pathlib import Path

from core import atomic_json, digest, file_hash, read_json
from map_migration import valid_glb


def project_progress(workspace, published, character_dir=None):
    workspace, published = Path(workspace).resolve(), Path(published).resolve()
    inputs = {'inventory': workspace / 'artifacts/inventory.json',
              'registry': workspace / 'artifacts/engine_metadata.json',
              'maps': published / 'map-manifest.json', 'ui': published / 'ui-manifest.json',
              'blueprints': published / 'blueprint-programs.json',
              'live_blueprints': published / 'blueprint-live-verification.json',
              'audit_blueprints': published / 'blueprint-audit-verification.json'}
    if character_dir:
        inputs['character'] = Path(character_dir).resolve() / 'manifest.json'
    for path in sorted((published / 'maps').glob('*.validation.json')):
        if path.name.endswith('-cache-check.validation.json') or path.name.endswith('-validated.validation.json'):
            continue
        inputs['validation:' + path.stem] = path
    hashes = {key: file_hash(path) for key, path in inputs.items() if path.is_file()}
    fingerprint = digest({'inputs': hashes, 'implementation': file_hash(Path(__file__))})
    documents = {key: read_json(inputs[key]) for key in hashes}
    registry, inventory = documents['registry'], documents['inventory']
    project = registry['project']
    if Path(project).resolve().parent in published.parents or Path(project).resolve().parent == published:
        raise ValueError('Progress output must stay outside the source project')
    if documents.get('maps', {}).get('project', project) != project:
        raise ValueError('Map catalog belongs to another project')
    if not registry.get('complete'):
        raise ValueError('Complete cached Asset Registry metadata is required')
    if registry.get('source_snapshot_hash') != digest(inventory.get('files', [])):
        raise ValueError('Cached registry and inventory snapshots differ')
    classes = Counter(asset.get('class') or 'Unknown' for asset in registry.get('assets', []))
    maps = documents.get('maps', {}).get('maps', [])
    ready = []
    # Check only published outputs, never source assets. Include missing/corrupt
    # outputs in the key so stale green/partial evidence cannot survive deletion.
    outputs = {}
    for row in maps:
        if not isinstance(row.get('package'), str) or not isinstance(row.get('filename'), str):
            continue
        path = published / 'maps' / row.get('filename', '')
        if published not in path.resolve().parents:
            continue
        sha = file_hash(path) if path.is_file() else None
        outputs[row.get('package')] = sha
        if row.get('status') in ('exported', 'reused') and valid_glb(path) and sha == row.get('output_sha256'):
            ready.append(row)
    character = documents.get('character', {})
    if character.get('source', {}).get('project') != project:
        character = {}
    clip_files = character.get('clips', {})
    def local_glb(name):
        if not isinstance(name, str) or not name or '/' in name or '\\' in name or not name.endswith('.glb'):
            return None
        path = Path(character_dir) / name
        if not valid_glb(path):
            return None
        return file_hash(path)
    character_outputs = {name: local_glb(name) for name in clip_files.values()}
    clips = sum(bool(sha) for sha in character_outputs.values())
    attachment_outputs = {name: local_glb(row.get('file'))
                          for name, row in character.get('attachment_assets', {}).items()}
    attachments = sum(bool(sha) for sha in attachment_outputs.values())
    outputs['character_files'] = character_outputs
    outputs['attachment_files'] = attachment_outputs
    live_image = published / 'verification/blueprint-live.jpg'
    outputs['live_blueprint_screenshot'] = file_hash(live_image) if live_image.is_file() else None
    audit_image = published / 'verification/blueprint-audit.jpg'
    outputs['audit_blueprint_screenshot'] = file_hash(audit_image) if audit_image.is_file() else None
    fingerprint = digest({'manifest_key': fingerprint, 'outputs': outputs})
    report_path = published / 'progress.json'
    try:
        prior = read_json(report_path)
        if (prior.get('fingerprint') == fingerprint and (published / 'progress.html').is_file()
                and prior.get('html_sha256') == file_hash(published / 'progress.html')):
            return prior
    except (OSError, ValueError):
        pass
    # Associate diagnostics only with checksum-verified published maps.
    validations = [row['validation'] for row in ready if row.get('validation') and
                   documents.get('validation:' + Path(row['filename']).with_suffix('.validation').name) == row['validation']]
    fallbacks = sum(len(v.get('material_fallbacks', [])) for v in validations)
    transforms = Counter()
    graphs, connections = 0, 0
    for validation in validations:
        transforms.update({k: validation.get('transforms', {}).get(k, 0) for k in ('matched', 'mismatched', 'skipped')})
        for graph in validation.get('material_graphs', {}).values():
            if graph.get('root_connections') == 'direct_connections_recovered':
                graphs += 1; connections += graph.get('connection_count', 0)
    rows = []
    def row(key, title, evidence, action, partial=False):
        rows.append({'id': key, 'title': title, 'status': 'yellow' if partial else 'red',
                     'evidence': evidence, 'next': action, 'fidelity_1_to_1': False})
    row('geometry', 'Geometria e trasformazioni',
        f"{transforms['matched']} trasformazioni coerenti, {transforms['mismatched']} diverse, {transforms['skipped']} non confrontabili",
        'Associare gli attori mancanti; confrontare componenti, dimensioni, gerarchie e terreno', bool(ready))
    row('materials', 'Materiali, texture e shader',
        f"{classes['Material'] + classes['MaterialInstanceConstant']} materiali/istanze, {classes['Texture2D']} texture sorgenti; {fallbacks} ripieghi nella selezione pubblicata",
        'Tradurre funzioni e shader originali, risolvere i ripieghi e confrontare tutti i canali PBR', bool(ready))
    row('lighting', 'Luci, esposizione e postprocessing', 'Luci glTF conservate; ambiente approssimato' if ready else 'Nessuna scena pubblicata verificata',
        'Migrare SkyLight, esposizione, ombre, riflessi e postprocessing con confronto visivo', bool(ready))
    row('maps', 'Altre mappe e streaming', f"{len(ready)}/{len(inventory.get('maps', []))} file mappa pubblicati e integri; {classes['World']} World nel registry",
        'Convertire le mappe mancanti e verificarle; tradurre streaming e passaggi tra livelli', bool(ready))
    row('characters', 'Personaggi, rig e accessori', f"{classes['SkeletalMesh']} mesh scheletriche sorgenti; profilo personaggio {'presente' if character else 'assente'}",
        'Verificare rig, skin, materiali, socket, IK e gli altri personaggi', bool(character))
    row('clips', 'Clip di animazione', f"{clips} file clip pubblicati; {classes['AnimSequence']} sequenze sorgenti (incluse pose e varianti)",
        'Assunte funzionanti per proseguire su richiesta; fedeltà 1:1 non verificata. Rimandati curve, notifies, root motion e transizioni', bool(clips))
    row('animation_systems', 'Sistemi di animazione',
        f"{classes['AnimBlueprintGeneratedClass']} AnimBlueprint, {classes['AnimMontage']} montage, {classes['BlendSpace'] + classes['BlendSpace1D']} blendspace, {classes['PoseSearchDatabase']} database pose",
        'Tradurre stati, blending, Motion Matching, chooser, Control Rig e IK')
    row('weapons', 'Armi e movimento armato', f'{attachments} accessori pubblicati; socket e clip nel profilo',
        'Verificare impugnature, movimento armato, mira, recoil, ricarica, hit detection e danni originali', bool(attachments))
    blueprint_report = documents.get('blueprints', {})
    if blueprint_report.get('project') != project or blueprint_report.get('content_sha256') != digest({k: v for k, v in blueprint_report.items() if k != 'content_sha256'}):
        blueprint_report = {}
    translated = blueprint_report.get('counts', {}).get('translated', 0)
    blocked = blueprint_report.get('counts', {}).get('blocked', 0)
    no_ops = blueprint_report.get('counts', {}).get('no_op_functions', 0)
    empty_events = blueprint_report.get('counts', {}).get('empty_event_functions', 0)
    row('blueprints', 'Blueprint e moduli nativi', f"{classes['BlueprintGeneratedClass']} classi Blueprint; {translated} funzioni tradotte ({no_ops} vuote, {empty_events} callback senza effetti di gioco), {blocked} bloccate nei pacchetti letti",
        'Completare chiamate tra oggetti, eventi, timer e moduli nativi' +
        (f"; {len(blueprint_report.get('character_guards', {}))} vincoli sorgenti disponibili per il controller provvisorio" if blueprint_report.get('character_guards') else ''), bool(translated))
    ui = documents.get('ui', {})
    ui_layout = bool(ui.get('tree') and ui.get('project') == project)
    row('ui', 'Menu, HUD e schermate', f"{classes['WidgetBlueprintGeneratedClass']} widget sorgenti; {int(ui_layout)} gerarchia UI pubblicata",
        'Migrare altre schermate, immagini, stili, binding, input ed eventi', ui_layout)
    row('inventory', 'Inventario, loot e salvataggi', 'Comportamento originale non verificato',
        'Tradurre contenitori, oggetti, limiti, equipaggiamento, persistenza e regole sorgenti')
    row('npc', 'NPC, shop, dialoghi e missioni', 'Comportamento originale non verificato',
        'Tradurre interazioni, AI, condizioni, prezzi, conversazioni e progressione presenti nel progetto')
    row('modes', 'Modalità, lobby ed estrazione', 'Flussi originali non verificati',
        'Tradurre avvio, lobby, sessioni, raid, estrazione, morte e cambio livello')
    row('physics', 'Collisioni e fisica', f"{classes['PhysicsAsset']} PhysicsAsset; collisioni di runtime da confrontare",
        'Conservare primitive, canali, query, contatti, ragdoll e comportamento del terreno')
    row('vfx', 'Effetti, Niagara e groom', f"{classes['NiagaraSystem']} sistemi Niagara, {classes['GroomAsset']} groom",
        'Tradurre emitter, materiali, eventi, effetti armi e personaggi')
    row('audio', 'Audio e sequenze', f"{classes['SoundWave']} SoundWave, {classes['SoundCue']} SoundCue, {classes['MetaSoundSource']} MetaSound, {classes['LevelSequence']} sequenze",
        'Migrare suoni, attenuazione, cue, MetaSound, animazioni temporali e cinematiche')
    row('network', 'Multiplayer e servizi', 'Replica e servizi Unreal non tradotti',
        'Tradurre autorità, RPC, replica, sessioni e servizi presenti nel progetto')
    row('acceptance', 'Gioco completo 1:1', 'Nessuna equivalenza complessiva dimostrata',
        'Verificare i flussi originali e confrontare immagini, tempi, input, dati e risultati')
    # Lighting is the user's last priority. Preserve explicit aggregate status;
    # completed, narrower checkpoints are displayed separately below.
    lighting = next(r for r in rows if r['id'] == 'lighting'); rows.remove(lighting); rows.append(lighting)
    milestones = [{'title': 'Inventario sorgente disponibile', 'status': 'green',
                   'evidence': f"{len(registry.get('assets', []))} asset classificati nei metadati in cache"}]
    if ready:
        milestones.append({'title': 'Integrità delle mappe pubblicate', 'status': 'green',
                           'evidence': f'{len(ready)} GLB con checksum e intestazione verificati'})
    if transforms['matched'] and not transforms['mismatched']:
        milestones.append({'title': 'Trasformazioni confrontabili', 'status': 'green',
                           'evidence': f"{transforms['matched']} coerenti; escluse le {transforms['skipped']} non confrontabili"})
    repaired = sum(row.get('repaired_vertices', 0) for v in validations for row in v.get('landscapes', []))
    if repaired:
        milestones.append({'title': 'Riparazione del terreno piatto', 'status': 'green',
                           'evidence': f'{repaired} vertici corretti entro i limiti sorgenti; non prova tutti i terreni'})
    if connections:
        milestones.append({'title': 'Lettura dei collegamenti diretti degli shader', 'status': 'green',
                           'evidence': f'{connections} collegamenti recuperati; funzioni interne ed esecuzione escluse'})
    live = documents.get('live_blueprints', {})
    live_valid = (bool(blueprint_report) and live.get('schema_version') == 1 and live.get('status') == 'passed'
                  and live.get('project') == project
                  and live.get('programs_content_sha256') == blueprint_report.get('content_sha256')
                  and bool(outputs['live_blueprint_screenshot'])
                  and live.get('screenshot_sha256') == outputs['live_blueprint_screenshot'])
    results = live.get('results', [])
    if (live_valid and results and live.get('checked') == len(results)
            and all(r.get('action') in blueprint_report.get('character_guards', {})
                    and r.get('source_function') == blueprint_report['character_guards'][r['action']]['function']
                    and isinstance(r.get('allowed'), bool) and r.get('allowed') == r.get('expected') for r in results)):
        milestones.append({'title': 'Vincoli sorgenti sugli input del personaggio', 'status': 'green',
                           'evidence': f"{len(results)} casi nella scena; screenshot legato alla versione dei programmi"})
    metrics = live.get('metric_results', [])
    source_metrics = {m['function'] for m in blueprint_report.get('character_metrics', [])}
    if (live_valid and metrics and source_metrics and live.get('metrics_checked') == len(metrics)
            and {r.get('source_function') for r in metrics} == source_metrics
            and all(type(r.get('value')) in (int, float) and math.isfinite(r['value']) and r['value'] == r.get('expected') for r in metrics)):
        milestones.append({'title': 'Lettura dei valori originali di vitalità', 'status': 'green',
                           'evidence': f"{len(source_metrics)} getter e {len(metrics)} casi; consumo, danni e rigenerazione esclusi"})
    audit = documents.get('audit_blueprints', {})
    if (blueprint_report and audit.get('status') == 'passed' and audit.get('project') == project
            and audit.get('programs_content_sha256') == blueprint_report.get('content_sha256')
            and outputs['audit_blueprint_screenshot'] and audit.get('screenshot_sha256') == outputs['audit_blueprint_screenshot']):
        verified, cases, event_verified, event_cases = [], 0, [], 0
        for entry in audit.get('evidence', []):
            program = blueprint_report.get('packages', {}).get(entry.get('package'), {}).get('functions', {}).get(entry.get('function'), {})
            samples = entry.get('source_cases', [])
            if (program and samples and program.get('source_bytecode_sha256') == entry.get('source_bytecode_sha256')
                    and all((sample.get('expected') or sample.get('expected_state'))
                            and all(key in sample.get('outputs', {}) and digest(sample['outputs'][key]) == digest(value)
                                    for key, value in sample.get('expected', {}).items())
                            and all(key in sample.get('resulting_state', {}) and digest(sample['resulting_state'][key]) == digest(value)
                                    for key, value in sample.get('expected_state', {}).items()) for sample in samples)):
                verified.append(entry['function']); cases += len(samples)
                if all(sample.get('expected_state') for sample in samples):
                    event_verified.append(entry['function']); event_cases += len(samples)
        if verified and cases == audit.get('golden_source_cases'):
            milestones.append({'title': 'Funzioni con confronti sorgenti verificati', 'status': 'green',
                               'evidence': f"{len(verified)} funzioni, {cases} casi; incluse {', '.join(sorted(set(verified)))}; non prova i sistemi completi"})
            if event_verified:
                milestones.append({'title': 'Percorsi di evento con stato verificato', 'status': 'green',
                                   'evidence': f"{len(event_verified)} percorsi, {event_cases} casi: {', '.join(event_verified)}; timer, Mover e replica esclusi"})
    report = {'schema_version': 1, 'project': project, 'fingerprint': fingerprint,
              'scope': 'cached registry and published outputs; no full-game percentage inferred',
              'source_classes': dict(classes), 'rows': rows, 'milestones': milestones,
              'shader_graphs_recovered': graphs, 'direct_shader_connections': connections,
              'resource_policy': ['Reuse raw exports; process changed dependencies only',
                                  'Reuse source metadata and checksummed visual evidence',
                                  'No geometry simplification or texture reduction as a speed shortcut',
                                  'Green checkpoints require scoped evidence; full systems require fidelity evidence']}
    published.mkdir(parents=True, exist_ok=True)
    rendered = ''.join('<tr><td>' + html.escape(r['title']) + '</td><td class="' + r['status'] + '">' +
                       ('🟡 Parziale' if r['status'] == 'yellow' else '🔴 Da tradurre/verificare') + '</td><td>' +
                       html.escape(r['evidence']) + '</td><td>' + html.escape(r['next']) + '</td></tr>' for r in rows)
    completed = ''.join('<li>🟢 <b>' + html.escape(m['title']) + '</b>: ' + html.escape(m['evidence']) + '</li>' for m in milestones)
    page = '''<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ue2three · Avanzamento progetto</title>
<style>body{background:#101923;color:#e8f0f5;font:15px system-ui;margin:24px}h1{font-size:24px}p{color:#bdd0df}table{border-collapse:collapse;width:100%}th,td{border:1px solid #344d61;padding:12px;text-align:left;vertical-align:top}th{background:#1b3040}.yellow{color:#f6d378}.red{color:#ffaaa0}a{color:#8edbff}li{margin:8px 0}</style><h1>''' + html.escape(Path(project).stem) + ''' · Avanzamento</h1>
<p>Verde = passaggio completato e verificato nel perimetro dichiarato. Giallo = migrazione parziale. Rosso = traduzione o verifica ancora da fare.</p>
<p>Checklist generata dai dati in cache. Un file esportato non dimostra da solo la fedeltà 1:1.</p><p>Shader sorgenti: ''' + str(connections) + ''' collegamenti diretti recuperati; esecuzione ancora da tradurre.</p>
<h2>Passaggi completati · perimetro indicato</h2><ul>''' + completed + '''</ul><h2>Sistemi da completare</h2>
<table><thead><tr><th>Area</th><th>Stato</th><th>Prove disponibili</th><th>Prossimo passo</th></tr></thead><tbody>''' + rendered + '</tbody></table></html>'
    (published / 'progress.html').write_text(page, encoding='utf-8')
    report['html_sha256'] = file_hash(published / 'progress.html')
    atomic_json(report_path, report)
    return report
