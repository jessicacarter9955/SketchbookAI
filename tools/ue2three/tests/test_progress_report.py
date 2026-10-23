import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import atomic_json, digest, file_hash
from progress_report import project_progress, offline_source_checks
from test_map_processing import model


class ProgressReportTests(unittest.TestCase):
    def test_offline_data_comparisons_require_current_source_and_exact_typed_results(self):
        from copy import deepcopy
        programs = {'project': 'Original', 'content_sha256': 'current', 'packages': {'/Game/A': {'functions': {'Write': {'source_bytecode_sha256': 'source'}}}}}
        sample = {'runtime': 'inventory', 'outputs': {}, 'expected': {}, 'resulting_state': {'Count': 2}, 'expected_state': {'Count': 2},
                  'effects': [], 'expected_effects': []}
        proof = {'schema_version': 1, 'status': 'passed', 'project': 'Original', 'programs_content_sha256': 'current',
                 'source_cases': 1, 'inventory_checked': 1, 'evidence': [{'package': '/Game/A', 'function': 'Write',
                    'source_bytecode_sha256': 'source', 'source_cases': [sample]}]}
        self.assertEqual(offline_source_checks(programs, proof), {'source_cases': 1, 'inventory_checked': 1})
        for corrupt in [lambda p:p.update(programs_content_sha256='stale'),lambda p:p.update(source_cases=2),
                        lambda p:p['evidence'][0].update(source_bytecode_sha256='wrong'),
                        lambda p:p['evidence'][0]['source_cases'][0].update(resulting_state={'Count': True}),
                        lambda p:p['evidence'][0]['source_cases'][0].update(effects=[{'op':'invented'}])]:
            changed=deepcopy(proof);corrupt(changed);self.assertFalse(offline_source_checks(programs,changed))

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        self.workspace = self.root / 'work'; self.published = self.root / 'published'; self.character = self.root / 'character'
        self.project = str(self.root / 'source' / 'Game.uproject')
        files = [{'path': 'Content/Map.umap', 'sha256': 'source'}]
        atomic_json(self.workspace / 'artifacts/inventory.json', {'files': files, 'maps': ['/Game/A', '/Game/B']})
        atomic_json(self.workspace / 'artifacts/engine_metadata.json', {'project': self.project, 'complete': True,
                    'source_snapshot_hash': digest(files), 'assets': [{'class': 'AnimSequence'}]*10 + [{'class': 'World'}]*2})
        self.map = self.published / 'maps/A.glb'; model(self.map)
        validation = {'transforms': {'matched': 2, 'mismatched': 0, 'skipped': 1}, 'material_fallbacks': [{}],
                      'material_graphs': {'Grid': {'root_connections': 'direct_connections_recovered', 'connection_count': 5}}}
        atomic_json(self.map.with_suffix('.validation.json'), validation)
        atomic_json(self.published / 'map-manifest.json', {'project': self.project, 'maps': [
                    {'package': '/Game/A', 'filename': 'A.glb', 'status': 'exported',
                     'output_sha256': file_hash(self.map), 'validation': validation}]})
        model(self.character / 'clip.glb')
        atomic_json(self.character / 'manifest.json', {'source': {'project': self.project}, 'clips': {'idle': 'clip.glb'}})

    def tearDown(self): self.temp.cleanup()

    def test_checklist_distinguishes_file_exports_from_fidelity_and_lighting_is_last(self):
        report = project_progress(self.workspace, self.published, self.character)
        self.assertEqual(report['rows'][-1]['id'], 'lighting')
        self.assertTrue(all(not row['fidelity_1_to_1'] for row in report['rows']))
        self.assertEqual(report['direct_shader_connections'], 5)
        self.assertTrue(any(m['title'] == 'Trasformazioni confrontabili' for m in report['milestones']))
        self.assertEqual(report['source_classes']['AnimSequence'], 10)
        self.assertEqual(report, project_progress(self.workspace, self.published, self.character))

    def test_audio_progress_only_counts_source_witnessed_intact_wav(self):
        inventory = {'files': [{'path': 'Content/Map.umap', 'sha256': 'source'}], 'maps': ['/Game/A', '/Game/B'],
                     'assets': [{'package': '/Game/Audio/Birds', 'sha256': 'original-asset-hash'}]}
        registry = {'project': self.project, 'complete': True,
                    'source_snapshot_hash': digest(inventory['files']),
                    'assets': [{'class': 'SoundWave', 'package': '/Game/Audio/Birds'}]}
        atomic_json(self.workspace / 'artifacts/inventory.json', inventory)
        atomic_json(self.workspace / 'artifacts/engine_metadata.json', registry)
        name = 'audio/' + 'a' * 64 + '.wav'
        source = self.published / name
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_bytes(b'RIFF' + (36).to_bytes(4, 'little') + b'WAVE' + b'\x00' * 32)
        item = {'package': '/Game/Audio/Birds', 'kind': 'SoundWave', 'source_sha256': 'original-asset-hash',
                'filename': name, 'output_sha256': file_hash(source)}
        manifest = {'schema_version': 1, 'project': self.project,
                    'source_snapshot_hash': registry['source_snapshot_hash'], 'sounds': [item]}
        atomic_json(self.published / 'audio-manifest.json', manifest)
        report = project_progress(self.workspace, self.published, self.character)
        audio = next(row for row in report['rows'] if row['id'] == 'audio')
        self.assertEqual(audio['status'], 'yellow')
        self.assertIn('1/1 SoundWave WAV', audio['evidence'])
        self.assertFalse(audio['fidelity_1_to_1'])
        source.write_bytes(b'not-an-original-wav')
        changed = project_progress(self.workspace, self.published, self.character)
        audio = next(row for row in changed['rows'] if row['id'] == 'audio')
        self.assertNotEqual(changed['fingerprint'], report['fingerprint'])
        self.assertEqual(audio['status'], 'red')
        self.assertIn('0/1 SoundWave WAV', audio['evidence'])
        source.write_bytes(b'RIFF' + (36).to_bytes(4, 'little') + b'WAVE' + b'\x00' * 32)
        manifest['sounds'][0]['source_sha256'] = 'wrong-original'
        atomic_json(self.published / 'audio-manifest.json', manifest)
        forged = project_progress(self.workspace, self.published, self.character)
        self.assertEqual(next(row for row in forged['rows'] if row['id'] == 'audio')['status'], 'red')
        manifest['sounds'][0]['source_sha256'] = 'original-asset-hash'
        manifest['source_snapshot_hash'] = 'stale'
        atomic_json(self.published / 'audio-manifest.json', manifest)
        stale = project_progress(self.workspace, self.published, self.character)
        self.assertEqual(next(row for row in stale['rows'] if row['id'] == 'audio')['status'], 'red')

    def test_offline_inventory_proof_is_partial_and_never_a_visual_green(self):
        program={'project':self.project,'packages':{'/Game/A':{'functions':{'Write':{'source_bytecode_sha256':'source'}}}}}
        program['content_sha256']=digest(program);atomic_json(self.published/'blueprint-programs.json',program)
        proof={'schema_version':1,'status':'passed','project':self.project,'programs_content_sha256':program['content_sha256'],
            'source_cases':1,'inventory_checked':1,'evidence':[{'package':'/Game/A','function':'Write','source_bytecode_sha256':'source',
            'source_cases':[{'runtime':'inventory','outputs':{},'expected':{},'resulting_state':{'Count':2},'expected_state':{'Count':2},'effects':[],'expected_effects':[]}]}]}
        atomic_json(self.published/'blueprint-offline-verification.json',proof)
        report=project_progress(self.workspace,self.published,self.character)
        self.assertEqual(next(row for row in report['rows'] if row['id']=='inventory')['status'],'yellow')
        self.assertFalse(any('Scritture inventario' in item['title'] for item in report['milestones']))
        self.assertIn('Prova visiva corrente della scena da completare',(self.published/'progress.html').read_text(encoding='utf-8'))

    def test_missing_outputs_and_modified_html_invalidate_report(self):
        original = project_progress(self.workspace, self.published, self.character)
        self.map.unlink()
        changed = project_progress(self.workspace, self.published, self.character)
        self.assertNotEqual(original['fingerprint'], changed['fingerprint'])
        self.assertEqual(changed['rows'][0]['status'], 'red')
        (self.published / 'progress.html').write_text('corrupt')
        project_progress(self.workspace, self.published, self.character)
        self.assertIn('Sistemi da completare', (self.published / 'progress.html').read_text(encoding='utf-8'))

    def test_other_project_character_is_not_counted(self):
        atomic_json(self.character / 'manifest.json', {'source': {'project': 'Other.uproject'}, 'clips': {'idle': 'clip.glb'}})
        report = project_progress(self.workspace, self.published, self.character)
        clips = next(row for row in report['rows'] if row['id'] == 'clips')
        self.assertEqual(clips['status'], 'red')

    def test_live_green_evidence_expires_when_program_or_screenshot_changes(self):
        program = {'schema_version': 1, 'project': self.project, 'packages': {}, 'counts': {},
                   'character_guards': {'run': {'function': 'CanSprint'}},
                   'character_metrics': [{'function': 'GetHealthPercent'}]}
        program['content_sha256'] = digest(program)
        atomic_json(self.published / 'blueprint-programs.json', program)
        image = self.published / 'verification/blueprint-live.jpg'; image.parent.mkdir(); image.write_bytes(b'test-screenshot')
        proof = {'schema_version': 1, 'project': self.project, 'status': 'passed',
                 'programs_content_sha256': program['content_sha256'], 'screenshot_sha256': file_hash(image),
                 'checked': 1, 'results': [{'action': 'run', 'source_function': 'CanSprint', 'allowed': True, 'expected': True}],
                 'metrics_checked': 1, 'metric_results': [{'source_function': 'GetHealthPercent', 'value': 0.5, 'expected': 0.5}]}
        atomic_json(self.published / 'blueprint-live-verification.json', proof)
        report = project_progress(self.workspace, self.published, self.character)
        self.assertTrue(any('vitalità' in m['title'] for m in report['milestones']))
        image.write_bytes(b'different-screenshot')
        report = project_progress(self.workspace, self.published, self.character)
        self.assertFalse(any('vitalità' in m['title'] for m in report['milestones']))
        proof['screenshot_sha256'] = file_hash(image); proof['programs_content_sha256'] = 'stale'
        atomic_json(self.published / 'blueprint-live-verification.json', proof)
        report = project_progress(self.workspace, self.published, self.character)
        self.assertFalse(any('vitalità' in m['title'] for m in report['milestones']))

    def test_owner_evidence_requires_actual_player_and_matching_source_graph_and_visual_proof(self):
        component = {'package': '/Game/Component', 'variable': 'Inventory', 'class_export_index': 2,
                     'scs_node_export_index': 5, 'template_sha256': 'template', 'source': {'source_sha256': 'component'}}
        graph = {'source': {'source_sha256': 'actor'}, 'scs_sha256': 'scs', 'components': [component]}
        program = {'project': self.project, 'packages': {}, 'actor_graph': {'roots': {'/Game/Pawn': graph}}}
        program['content_sha256'] = digest(program); atomic_json(self.published / 'blueprint-programs.json', program)
        folder = self.published / 'verification'; folder.mkdir(); image = folder / 'blueprint-live.jpg'; image.write_bytes(b'live')
        owner = {'package': '/Game/Component', 'source_class': '/Game/Pawn', 'component': 'Inventory',
                 'class_export_index': 2, 'scs_node_export_index': 5, 'template_sha256': 'template',
                 'source_sha256': 'component', 'actor_source_sha256': 'actor', 'scs_sha256': 'scs',
                 'owner_is_player': True, 'scope': 'standalone_no_drivers'}
        proof = {'schema_version': 1, 'project': self.project, 'status': 'passed',
                 'programs_content_sha256': program['content_sha256'], 'screenshot_sha256': file_hash(image),
                 'owners_checked': 1, 'owner_results': [owner]}
        def green():
            atomic_json(self.published / 'blueprint-live-verification.json', proof)
            return any(m['title'].startswith('Proprietà sorgente') for m in project_progress(self.workspace, self.published, self.character)['milestones'])
        self.assertTrue(green())
        for key in ['source_sha256', 'actor_source_sha256', 'scs_sha256', 'template_sha256', 'scs_node_export_index', 'class_export_index', 'component', 'owner_is_player', 'scope']:
            original = owner[key]; owner[key] = 'wrong'
            self.assertFalse(green(), key); owner[key] = original
        image.write_bytes(b'changed'); self.assertFalse(green())

    def test_source_audit_requires_exact_outputs_and_matching_programs(self):
        program = {'project': self.project, 'packages': {'/Game/A': {'functions': {'Probe': {'source_bytecode_sha256': 'bytecode',
                   'steps': [{'op': 'evaluate', 'value': {'op': 'table_get'}}]}}}}}
        program['content_sha256'] = digest(program); atomic_json(self.published / 'blueprint-programs.json', program)
        image = self.published / 'verification/blueprint-audit.jpg'; image.parent.mkdir(); image.write_bytes(b'audit-image')
        sample = {'outputs': {'Result': 1}, 'expected': {'Result': True}}
        audit = {'project': self.project, 'status': 'passed', 'programs_content_sha256': program['content_sha256'],
                 'screenshot_sha256': file_hash(image), 'golden_source_cases': 1,
                 'evidence': [{'package': '/Game/A', 'function': 'Probe', 'source_bytecode_sha256': 'bytecode', 'source_cases': [sample]}]}
        path = self.published / 'blueprint-audit-verification.json'; atomic_json(path, audit)
        report = project_progress(self.workspace, self.published, self.character)
        self.assertFalse(any('confronti sorgenti' in m['title'] for m in report['milestones']))
        sample['expected']['Result'] = 1; atomic_json(path, audit)
        report = project_progress(self.workspace, self.published, self.character)
        self.assertTrue(any('confronti sorgenti' in m['title'] for m in report['milestones']))
        sample['expected_members'] = {'Item': {'Weight': 2}}
        sample['actual_members'] = {'Item': {'Weight': True}}; atomic_json(path, audit)
        self.assertFalse(any('confronti sorgenti' in m['title'] for m in project_progress(self.workspace, self.published, self.character)['milestones']))
        sample['actual_members']['Item']['Weight'] = 2; atomic_json(path, audit)
        self.assertTrue(any('confronti sorgenti' in m['title'] for m in project_progress(self.workspace, self.published, self.character)['milestones']))
        self.assertTrue(any('tabelle con campi' in m['title'] for m in project_progress(self.workspace, self.published, self.character)['milestones']))
        audit['programs_content_sha256'] = 'stale'; atomic_json(path, audit)
        report = project_progress(self.workspace, self.published, self.character)
        self.assertFalse(any('confronti sorgenti' in m['title'] for m in report['milestones']))
        self.assertFalse(any('tabelle con campi' in m['title'] for m in report['milestones']))

    def test_source_event_evidence_checks_state_when_outputs_are_void(self):
        program = {'project': self.project, 'packages': {'/Game/A': {'functions': {'Event': {'source_bytecode_sha256': 'event'}}}}}
        program['content_sha256'] = digest(program); atomic_json(self.published / 'blueprint-programs.json', program)
        image = self.published / 'verification/blueprint-audit.jpg'; image.parent.mkdir(); image.write_bytes(b'event-image')
        sample = {'outputs': {}, 'expected': {}, 'resulting_state': {'Enabled': False}, 'expected_state': {'Enabled': True}}
        audit = {'project': self.project, 'status': 'passed', 'programs_content_sha256': program['content_sha256'],
                 'screenshot_sha256': file_hash(image), 'golden_source_cases': 1,
                 'evidence': [{'package': '/Game/A', 'function': 'Event', 'source_bytecode_sha256': 'event', 'source_cases': [sample]}]}
        path = self.published / 'blueprint-audit-verification.json'; atomic_json(path, audit)
        self.assertFalse(any('confronti sorgenti' in m['title'] for m in project_progress(self.workspace, self.published, self.character)['milestones']))
        sample['resulting_state']['Enabled'] = True; atomic_json(path, audit)
        self.assertTrue(any('confronti sorgenti' in m['title'] for m in project_progress(self.workspace, self.published, self.character)['milestones']))

    def test_mutations_and_notifications_require_exact_effects_state_and_visual_proof(self):
        function = {'source_bytecode_sha256': 'bytecode', 'self_writes': ['Count']}
        program = {'project': self.project, 'packages': {'/Game/A': {'functions': {'Change': function}}}}
        program['content_sha256'] = digest(program); atomic_json(self.published / 'blueprint-programs.json', program)
        folder = self.published / 'verification'; folder.mkdir()
        (folder / 'blueprint-audit.jpg').write_bytes(b'audit'); (folder / 'blueprint-live.jpg').write_bytes(b'live')
        effects = [{'op': 'broadcast', 'delegate': 'Changed', 'parameters': {'Count': 2}, 'listeners': 0}]
        sample = {'inputs': {}, 'outputs': {}, 'expected': {}, 'resulting_state': {'Count': 2}, 'expected_state': {'Count': 2},
                  'effects': effects, 'expected_effects': effects}
        audit = {'project': self.project, 'status': 'passed', 'programs_content_sha256': program['content_sha256'],
                 'screenshot_sha256': file_hash(folder / 'blueprint-audit.jpg'), 'golden_source_cases': 1,
                 'evidence': [{'package': '/Game/A', 'function': 'Change', 'source_bytecode_sha256': 'bytecode', 'source_cases': [sample]}]}
        atomic_json(self.published / 'blueprint-audit-verification.json', audit)
        result = {'package': '/Game/A', 'source_function': 'Change', 'source_bytecode_sha256': 'bytecode', **sample}
        live = {'schema_version': 1, 'project': self.project, 'status': 'passed', 'programs_content_sha256': program['content_sha256'],
                'screenshot_sha256': file_hash(folder / 'blueprint-live.jpg'), 'inventory_checked': 1, 'inventory_results': [result]}
        path = self.published / 'blueprint-live-verification.json'
        def has_checkpoint():
            atomic_json(path, live)
            return any(m['title'].startswith('Scritture inventario') for m in project_progress(self.workspace, self.published, self.character)['milestones'])
        self.assertTrue(has_checkpoint())
        result['effects'] = []; self.assertFalse(has_checkpoint())
        result['effects'] = effects; result['resulting_state'] = {'Count': True}; self.assertFalse(has_checkpoint())
        result['resulting_state'] = {'Count': 2}; result['outputs'] = {'Wrong': 1}; self.assertFalse(has_checkpoint())
        result['outputs'] = {}; live['screenshot_sha256'] = 'stale'; self.assertFalse(has_checkpoint())
        live['screenshot_sha256'] = file_hash(folder / 'blueprint-live.jpg'); self.assertTrue(has_checkpoint())
        sample['effects'] = []; atomic_json(self.published / 'blueprint-audit-verification.json', audit)
        self.assertFalse(has_checkpoint())

    def test_scene_calculations_require_matching_source_cases_and_current_visual_proof(self):
        function = {'source_bytecode_sha256': 'bytecode', 'input_fields': ['X'], 'output_fields': ['Y'], 'self_writes': []}
        program = {'project': self.project, 'packages': {'/Game/A': {'functions': {'Probe': function}}}}
        program['content_sha256'] = digest(program); atomic_json(self.published / 'blueprint-programs.json', program)
        folder = self.published / 'verification'; folder.mkdir()
        (folder / 'blueprint-audit.jpg').write_bytes(b'audit'); (folder / 'blueprint-live.jpg').write_bytes(b'live')
        sample = {'inputs': {'X': 1}, 'outputs': {'Y': 2}, 'expected': {'Y': 2}}
        audit = {'project': self.project, 'status': 'passed', 'programs_content_sha256': program['content_sha256'],
                 'screenshot_sha256': file_hash(folder / 'blueprint-audit.jpg'), 'golden_source_cases': 1,
                 'evidence': [{'package': '/Game/A', 'function': 'Probe', 'source_bytecode_sha256': 'bytecode', 'source_cases': [sample]}]}
        atomic_json(self.published / 'blueprint-audit-verification.json', audit)
        result = {'package': '/Game/A', 'source_function': 'Probe', 'source_bytecode_sha256': 'bytecode', **sample}
        live = {'schema_version': 1, 'project': self.project, 'status': 'passed', 'programs_content_sha256': program['content_sha256'],
                'screenshot_sha256': file_hash(folder / 'blueprint-live.jpg'), 'calculations_checked': 1, 'calculation_results': [result]}
        path = self.published / 'blueprint-live-verification.json'
        def has_checkpoint():
            atomic_json(path, live)
            return any(m['title'] == 'Calcoli sorgenti sul runtime della scena'
                       for m in project_progress(self.workspace, self.published, self.character)['milestones'])
        self.assertTrue(has_checkpoint())
        result['source_bytecode_sha256'] = 'stale'; self.assertFalse(has_checkpoint())
        result['source_bytecode_sha256'] = 'bytecode'; result['inputs'] = {'X': 7}; self.assertFalse(has_checkpoint())
        result['inputs'] = {'X': 1}; result['outputs'] = {'Y': True}; self.assertFalse(has_checkpoint())
        result['outputs'] = {'Y': 2}; live['screenshot_sha256'] = 'stale'; self.assertFalse(has_checkpoint())


if __name__ == '__main__': unittest.main()
