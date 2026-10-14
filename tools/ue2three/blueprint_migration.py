"""Translate cached Kismet state, control flow and source-class function calls."""
import math
import re
from collections import Counter
from pathlib import Path

from core import atomic_json, digest, file_hash, read_json
from umg_migration import Package, _tool, _asset_document


class BlueprintTranslationError(ValueError):
    pass


def kind(value):
    return str(value.get('$type', '')).split(',', 1)[0].rsplit('.', 1)[-1]


def field(pointer):
    path = pointer.get('New', {}).get('Path') if isinstance(pointer, dict) else None
    if (not isinstance(path, list) or len(path) != 1 or not isinstance(path[0], str)
            or not path[0] or path[0] in ('__proto__', 'constructor', 'prototype')):
        raise BlueprintTranslationError('Unsupported property pointer')
    return path[0]


def property_type(prop):
    result = prop.get('SerializedType')
    if result == 'EnumProperty':
        result = prop.get('UnderlyingProp', {}).get('SerializedType')
    if result not in ('BoolProperty', 'ByteProperty', 'IntProperty', 'FloatProperty',
                      'DoubleProperty', 'StrProperty', 'NameProperty', 'StructProperty'):
        raise BlueprintTranslationError(f'Unsupported source property type: {result}')
    return result


MATH_CALLS = {'BooleanAND': (2, 'bool'), 'BooleanOR': (2, 'bool'), 'BooleanXOR': (2, 'bool'), 'Not_PreBool': (1, 'bool')}
for _type in ('ByteByte', 'IntInt', 'DoubleDouble'):
    for _operation in ('EqualEqual', 'NotEqual', 'Greater', 'GreaterEqual', 'Less', 'LessEqual'):
        MATH_CALLS[_operation + '_' + _type] = (2, _type)
for _type in ('IntInt', 'DoubleDouble'):
    for _operation in ('Add', 'Subtract', 'Multiply'):
        MATH_CALLS[_operation + '_' + _type] = (2, _type)
MATH_CALLS.update({'Divide_DoubleDouble': (2, 'DoubleDouble'),
                   'EqualEqual_BoolBool': (2, 'bool'), 'NotEqual_BoolBool': (2, 'bool'),
                   'FClamp': (3, 'DoubleDouble'), 'Clamp': (3, 'IntInt')})


def math_call(package, reference):
    if not package or not isinstance(reference, int) or reference >= 0 or -reference > len(package.imports):
        raise BlueprintTranslationError('Unresolved native math call')
    function = package.imports[-reference-1]
    owner = function.get('OuterIndex')
    if not isinstance(owner, int) or owner >= 0 or -owner > len(package.imports):
        raise BlueprintTranslationError('Unresolved native math owner')
    library = package.imports[-owner-1]
    outer = library.get('OuterIndex')
    if (function.get('ClassName') != 'Function' or library.get('ObjectName') != 'KismetMathLibrary'
            or not isinstance(outer, int) or not -len(package.imports) <= outer < 0
            or package.imports[-outer-1].get('ObjectName') != '/Script/Engine'):
        raise BlueprintTranslationError('Native call is outside Engine.KismetMathLibrary')
    name = function.get('ObjectName')
    if name not in MATH_CALLS: raise BlueprintTranslationError(f'Unsupported native math call: {name}')
    return name


def local_call(value, package, owner, reads, outputs, depth):
    if not package: raise BlueprintTranslationError('Source package required for Blueprint calls')
    token = kind(value)
    if token in ('EX_FinalFunction', 'EX_LocalFinalFunction'):
        ref = value.get('StackNode'); callee = package.export(ref)
        if not callee or not callee.get('ScriptBytecode'):
            raise BlueprintTranslationError('Native or unresolved direct function call')
    else:
        name = value.get('VirtualFunctionName')
        candidates = [(i, e) for i, e in enumerate(package.exports, 1)
                      if e.get('ObjectName') == name and e.get('ScriptBytecode') and e.get('OuterIndex') == owner]
        if len(candidates) != 1: raise BlueprintTranslationError(f'Unresolved local virtual call: {name}')
        ref, callee = candidates[0]
    if owner is None or callee.get('OuterIndex') != owner:
        raise BlueprintTranslationError('Cross-instance function call requires an object adapter')
    parameters = [p for p in callee.get('LoadedProperties', []) if 'CPF_Parm' in str(p.get('PropertyFlags'))
                  and 'CPF_ReturnParm' not in str(p.get('PropertyFlags'))]
    args = value.get('Parameters')
    if not isinstance(args, list) or len(args) != len(parameters):
        raise BlueprintTranslationError('Source function signature does not match call arguments')
    bindings = []
    for prop, arg in zip(parameters, args):
        name = prop.get('Name'); field({'New': {'Path': [name]}})
        if 'CPF_OutParm' in str(prop.get('PropertyFlags')):
            if kind(arg) not in ('EX_LocalVariable', 'EX_LocalOutVariable', 'EX_InstanceVariable'):
                raise BlueprintTranslationError('Unsupported output argument target')
            target = expression(arg, reads, outputs, depth+1, package, owner)
            bindings.append({'mode': 'output', 'parameter': name, 'target': target})
        else:
            bindings.append({'mode': 'input', 'parameter': name, 'value': expression(arg, reads, outputs, depth+1, package, owner)})
    return {'op': 'call', 'function': callee['ObjectName'], 'export_index': ref, 'bindings': bindings}


def expression(value, reads, outputs, depth=0, package=None, owner=None):
    if not isinstance(value, dict) or depth > 48:
        raise BlueprintTranslationError('Invalid or deeply nested Kismet expression')
    token = kind(value)
    if token in ('EX_LocalVirtualFunction', 'EX_LocalFinalFunction', 'EX_FinalFunction'):
        return local_call(value, package, owner, reads, outputs, depth)
    if token == 'EX_CallMath':
        name = math_call(package, value.get('StackNode'))
        args = value.get('Parameters')
        if not isinstance(args, list) or len(args) != MATH_CALLS[name][0]:
            raise BlueprintTranslationError('Invalid native math parameter count')
        return {'op': 'math', 'name': name, 'args': [expression(arg, reads, outputs, depth+1, package, owner) for arg in args]}
    scopes = {'EX_InstanceVariable': 'self', 'EX_LocalVariable': 'local', 'EX_LocalOutVariable': 'local'}
    if token in scopes:
        name = field(value.get('Variable'))
        if token == 'EX_InstanceVariable': reads.add(name)
        if token == 'EX_LocalOutVariable': outputs.add(name)
        return {'op': 'get', 'scope': scopes[token], 'field': name}
    if token in ('EX_True', 'EX_False', 'EX_IntZero', 'EX_IntOne', 'EX_Nothing'):
        return {'op': 'constant', 'value': {'EX_True': True, 'EX_False': False,
                'EX_IntZero': 0, 'EX_IntOne': 1, 'EX_Nothing': None}[token]}
    if token in ('EX_IntConst', 'EX_IntConstByte', 'EX_ByteConst', 'EX_FloatConst', 'EX_DoubleConst',
                 'EX_StringConst', 'EX_UnicodeStringConst', 'EX_NameConst'):
        result = value.get('Value')
        if token in ('EX_FloatConst', 'EX_DoubleConst') and isinstance(result, str) and re.fullmatch(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?', result):
            result = float(result)
        if token in ('EX_StringConst', 'EX_UnicodeStringConst', 'EX_NameConst'):
            valid = isinstance(result, str)
        elif token in ('EX_FloatConst', 'EX_DoubleConst'):
            valid = isinstance(result, (int, float)) and not isinstance(result, bool) and math.isfinite(result)
        else:
            valid = isinstance(result, int) and not isinstance(result, bool)
            if token in ('EX_ByteConst', 'EX_IntConstByte'): valid = valid and 0 <= result <= 255
            else: valid = valid and -2**31 <= result < 2**31
        if not valid: raise BlueprintTranslationError(f'Invalid constant: {token}')
        return {'op': 'constant', 'value': result}
    raise BlueprintTranslationError(f'Unsupported opcode: {token}')


def memory_size(value, depth=0):
    """Kismet VM offsets (64-bit pointers), not serialized package byte sizes.

    Layouts follow UAssetAPI expression Visit implementations. Unknown layouts
    are rejected so no jump is ever guessed from on-disk offsets.
    """
    if not isinstance(value, dict) or depth > 48:
        raise BlueprintTranslationError('Invalid bytecode size expression')
    token = kind(value)
    if token in ('EX_Tracepoint', 'EX_WireTracepoint', 'EX_Nothing', 'EX_EndOfScript',
                 'EX_True', 'EX_False', 'EX_IntZero', 'EX_IntOne'): return 1
    if token in ('EX_InstanceVariable', 'EX_LocalVariable', 'EX_LocalOutVariable'): return 9
    if token in ('EX_ByteConst', 'EX_IntConstByte'): return 2
    if token in ('EX_IntConst', 'EX_FloatConst'): return 5
    if token == 'EX_DoubleConst': return 9
    if token == 'EX_NameConst': return 13
    if token in ('EX_StringConst', 'EX_UnicodeStringConst'):
        text = value.get('Value')
        if not isinstance(text, str) or '\0' in text: raise BlueprintTranslationError('Invalid string layout')
        if token == 'EX_StringConst':
            if any(ord(c) > 127 for c in text): raise BlueprintTranslationError('Unsupported non-ASCII narrow string layout')
            return 2 + len(text)
        return 3 + len(text.encode('utf-16-le'))
    if token in ('EX_Let', 'EX_LetBool', 'EX_LetObj'):
        left = value.get('Variable' if token == 'EX_Let' else 'VariableExpression')
        right = value.get('Expression' if token == 'EX_Let' else 'AssignmentExpression')
        return (9 if token == 'EX_Let' else 1) + memory_size(left, depth+1) + memory_size(right, depth+1)
    if token == 'EX_Return': return 1 + memory_size(value.get('ReturnExpression'), depth+1)
    if token == 'EX_Jump': return 5
    if token == 'EX_JumpIfNot': return 5 + memory_size(value.get('BooleanExpression'), depth+1)
    if token in ('EX_CallMath', 'EX_LocalFinalFunction', 'EX_FinalFunction', 'EX_LocalVirtualFunction'):
        args = value.get('Parameters')
        if not isinstance(args, list): raise BlueprintTranslationError('Invalid math layout')
        return (14 if token == 'EX_LocalVirtualFunction' else 10) + sum(memory_size(arg, depth+1) for arg in args)
    raise BlueprintTranslationError(f'Unsupported bytecode memory layout: {token}')


def translate_function(export, package=None):
    bytecode = export.get('ScriptBytecode')
    if not isinstance(bytecode, list) or not bytecode or len(bytecode) > 100000:
        raise BlueprintTranslationError('Parsed source bytecode is required')
    reads, outputs, writes, steps = set(), set(), set(), []
    branching = any(kind(instruction) in ('EX_Jump', 'EX_JumpIfNot') for instruction in bytecode)
    offsets, boundaries, offset = {}, {}, 0
    if branching:
        for index, instruction in enumerate(bytecode):
            offsets[index] = offset; boundaries[offset] = index
            offset += memory_size(instruction)
        if not isinstance(export.get('ScriptBytecodeSize'), int) or export['ScriptBytecodeSize'] != offset:
            raise BlueprintTranslationError('Computed Kismet memory size differs from ScriptBytecodeSize')
    returned = ended = False
    for index, instruction in enumerate(bytecode):
        token = kind(instruction)
        if ended: raise BlueprintTranslationError('Bytecode after EndOfScript')
        if token in ('EX_Tracepoint', 'EX_WireTracepoint', 'EX_Nothing'):
            if branching: steps.append({'op': 'nop', 'source_index': index})
            continue
        if token == 'EX_EndOfScript':
            ended = True
            if branching: steps.append({'op': 'end', 'source_index': index})
            continue
        if returned and not branching: raise BlueprintTranslationError('Instructions after return require control-flow translation')
        if token in ('EX_Jump', 'EX_JumpIfNot'):
            target = instruction.get('CodeOffset')
            if not isinstance(target, int) or isinstance(target, bool) or target not in boundaries:
                raise BlueprintTranslationError('Jump target is not a Kismet instruction boundary')
            entry = {'op': 'jump' if token == 'EX_Jump' else 'branch', 'target': boundaries[target],
                     'target_offset': target, 'source_index': index}
            if token == 'EX_JumpIfNot': entry['value'] = expression(instruction.get('BooleanExpression'), reads, outputs, package=package, owner=export.get('OuterIndex'))
            steps.append(entry)
            continue
        if token in ('EX_Let', 'EX_LetBool', 'EX_LetObj'):
            variable = instruction.get('Variable' if token == 'EX_Let' else 'VariableExpression')
            if not isinstance(variable, dict) or kind(variable) not in ('EX_LocalVariable', 'EX_LocalOutVariable', 'EX_InstanceVariable'):
                raise BlueprintTranslationError('Unsupported assignment target')
            target = expression(variable, reads, outputs, package=package, owner=export.get('OuterIndex'))
            if target['scope'] == 'self': writes.add(target['field'])
            source = instruction.get('Expression' if token == 'EX_Let' else 'AssignmentExpression')
            steps.append({'op': 'set', 'field': target['field'], 'scope': target['scope'], 'value': expression(source, reads, outputs, package=package, owner=export.get('OuterIndex')),
                          'boolean': token == 'EX_LetBool', 'source_index': index})
        elif token == 'EX_Return':
            steps.append({'op': 'return', 'value': expression(instruction.get('ReturnExpression'), reads, outputs, package=package, owner=export.get('OuterIndex')),
                          'source_index': index})
            returned = True
        elif token in ('EX_LocalVirtualFunction', 'EX_LocalFinalFunction', 'EX_FinalFunction'):
            steps.append({'op': 'evaluate', 'value': expression(instruction, reads, outputs, package=package, owner=export.get('OuterIndex')),
                          'source_index': index})
        else:
            raise BlueprintTranslationError(f'Unsupported opcode: {token}')
    if not returned or not ended: raise BlueprintTranslationError('Complete return and EndOfScript are required')
    if branching:
        for step in steps: step['source_offset'] = offsets[step['source_index']]
    return {'schema_version': 1, 'name': export['ObjectName'], 'status': 'translated_control_flow' if branching else 'translated_straight_line',
            'memory_size_verified': offset if branching else None,
            'source_bytecode_sha256': digest(bytecode), 'self_reads': sorted(reads),
            'source_owner_index': export.get('OuterIndex'),
            'self_writes': sorted(writes),
            'output_fields': sorted(outputs), 'steps': steps}


def translate_package(package):
    functions, blocked, declarations = {}, [], []
    class_properties = {prop['Name']: prop for export in package.exports
                        if str(export.get('ObjectName', '')).endswith('_C')
                        for prop in export.get('LoadedProperties', []) if prop.get('Name')}
    defaults = {}
    for export in package.exports:
        if str(export.get('ObjectName', '')).startswith('Default__'):
            defaults.update(package.props(export))
    for index, export in enumerate(package.exports, 1):
        if not export.get('ScriptBytecode'): continue
        if str(export.get('ObjectName', '')).endswith('__DelegateSignature'):
            declarations.append(export['ObjectName'])
            continue
        try:
            program = translate_function(export, package)
            used_locals = set(program['output_fields'])
            for step in program['steps']:
                if step['op'] == 'set' and step.get('scope') == 'local': used_locals.add(step['field'])
                def local_reads(value):
                    if isinstance(value, dict):
                        if value.get('scope') == 'local': used_locals.add(value['field'])
                        for arg in value.get('args', []): local_reads(arg)
                        for binding in value.get('bindings', []):
                            if 'value' in binding: local_reads(binding['value'])
                            if 'target' in binding: local_reads(binding['target'])
                if 'value' in step: local_reads(step['value'])
            program['field_types'] = {
                'self': {name: property_type(class_properties[name]) for name in program['self_reads'] if name in class_properties},
                'local': {prop['Name']: property_type(prop) for prop in export.get('LoadedProperties', []) if prop.get('Name') in used_locals}}
            program['source_property_types'] = {prop['Name']: prop for prop in export.get('LoadedProperties', []) if prop.get('Name')}
            program['input_fields'] = [prop['Name'] for prop in export.get('LoadedProperties', [])
                                       if prop.get('Name') in used_locals and 'CPF_Parm' in str(prop.get('PropertyFlags'))
                                       and 'CPF_OutParm' not in str(prop.get('PropertyFlags'))
                                       and 'CPF_ReturnParm' not in str(prop.get('PropertyFlags'))]
            program['source_defaults'] = {name: defaults[name] for name in program['self_reads'] if name in defaults}
            program['source_export_index'] = index
            if program['name'] in functions: raise BlueprintTranslationError('Duplicate function name')
            functions[program['name']] = program
        except BlueprintTranslationError as error:
            blocked.append({'function': export.get('ObjectName'), 'source_export_index': index, 'reason': str(error)})
    def calls(value):
        if isinstance(value, dict):
            if value.get('op') == 'call': yield value
            for child in value.values(): yield from calls(child)
        elif isinstance(value, list):
            for child in value: yield from calls(child)
    # Reject a whole caller if any required callee failed conversion. Repeat to
    # remove transitive dependencies; no successful-looking partial paths remain.
    while True:
        removed = []
        for name, program in functions.items():
            required = list(calls(program['steps']))
            missing = next((call['function'] for call in required if call['function'] not in functions
                            or functions[call['function']]['source_export_index'] != call['export_index']), None)
            if missing:
                blocked.append({'function': name, 'source_export_index': program['source_export_index'],
                                'reason': 'Untranslated function dependency: ' + missing})
                removed.append(name)
        if not removed: break
        for name in removed: del functions[name]
    # Include transitive state requirements so runtime instances can be created
    # from original defaults and checked without guessing fields in the caller.
    for _ in range(len(functions)):
        changed = False
        for program in functions.values():
            reads, writes = set(program['self_reads']), set(program['self_writes'])
            for call in calls(program['steps']):
                callee = functions[call['function']]
                reads.update(callee['self_reads']); writes.update(callee['self_writes'])
                for binding in call['bindings']:
                    if binding['mode'] == 'output' and binding['target']['scope'] == 'self':
                        writes.add(binding['target']['field'])
            if reads != set(program['self_reads']) or writes != set(program['self_writes']): changed = True
            program['self_reads'], program['self_writes'] = sorted(reads), sorted(writes)
            program['field_types']['self'] = {name: property_type(class_properties[name]) for name in reads | writes if name in class_properties}
            program['source_defaults'] = {name: defaults[name] for name in reads | writes if name in defaults}
        if not changed: break
    default_state = {}
    for name, prop in class_properties.items():
        try: type_name = property_type(prop)
        except BlueprintTranslationError: continue
        if name in defaults: default_state[name] = defaults[name]
        elif type_name in ('BoolProperty', 'ByteProperty', 'IntProperty', 'FloatProperty', 'DoubleProperty', 'StrProperty', 'NameProperty'):
            default_state[name] = {'BoolProperty': False, 'StrProperty': '', 'NameProperty': 'None'}.get(type_name, 0)
    no_ops = sum(not program['self_reads'] and not program['output_fields'] and not program['self_writes']
                 and all(step['op'] == 'return' and step['value'] == {'op': 'constant', 'value': None}
                         for step in program['steps']) for program in functions.values())
    return {'functions': functions, 'blocked': blocked, 'declarations': declarations, 'default_state': default_state,
            'counts': {'translated': len(functions), 'blocked': len(blocked),
                       'declarations': len(declarations), 'no_op_functions': no_ops}}


def character_guards(controls, packages, source_package):
    """Publish a partial compatibility binding only with original call witnesses."""
    class_props = {p['Name']: p for e in source_package.exports if str(e.get('ObjectName', '')).endswith('_C')
                   for p in e.get('LoadedProperties', []) if p.get('Name')}
    def referenced_package(reference):
        for _ in range(16):
            if not isinstance(reference, int) or not -len(source_package.imports) <= reference < 0: return None
            item = source_package.imports[-reference-1]
            if item.get('ClassName') == 'Package' and str(item.get('ObjectName', '')).startswith('/Game/'):
                return item['ObjectName']
            reference = item.get('OuterIndex')
        return None
    guards = {}
    for action, source_action, method, key in [('run', 'IA_Sprint', 'CanSprint', 'LeftShift'),
                                             ('jump', 'IA_Jump', 'CanJump', 'SpaceBar')]:
        mapping = [m for m in controls.get('default_key_mappings', []) if m.get('action') == source_action and m.get('key') == key]
        events = [e for e in controls.get('blueprint_input_events', []) if e.get('action') == source_action]
        if not mapping or not events: continue
        for export in source_package.exports:
            for index, instruction in enumerate(export.get('ScriptBytecode') or []):
                if kind(instruction) != 'EX_Context': continue
                called, obj = instruction.get('ContextExpression', {}), instruction.get('ObjectExpression', {})
                if called.get('VirtualFunctionName') != method or kind(obj) != 'EX_InstanceVariable': continue
                component = field(obj.get('Variable'))
                target = referenced_package(class_props.get(component, {}).get('PropertyClass'))
                program = packages.get(target, {}).get('functions', {}).get(method)
                if not program or program['self_writes'] or len(program['output_fields']) != 1: continue
                if any(name not in packages[target]['default_state'] for name in program['self_reads']): continue
                output = program['output_fields'][0]
                if program['field_types']['local'].get(output) != 'BoolProperty': continue
                guards[action] = {'package': target, 'component': component, 'function': method, 'output': output,
                                  'source_action': source_action, 'source_keys': mapping,
                                  'witness': {'function': export['ObjectName'], 'source_index': index,
                                              'source_expression_sha256': digest(instruction)},
                                  'scope': 'Original prerequisite only; complete input event graph and Mover simulation not translated'}
    return guards


def character_metrics(guards, packages):
    """Find pure source ratio getters on components already witnessed on the character."""
    metrics = []
    for package_name in sorted({guard['package'] for guard in guards.values()}):
        data = packages[package_name]
        for name, program in data['functions'].items():
            if program['self_writes'] or program['input_fields'] or len(program['output_fields']) != 1: continue
            ratio = next((step['value'] for step in program['steps'] if step['op'] == 'set'
                          and step['value'].get('op') == 'math' and step['value'].get('name') == 'Divide_DoubleDouble'), None)
            if not ratio or any(arg.get('op') != 'get' or arg.get('scope') != 'self' for arg in ratio['args']): continue
            if any(field not in data['default_state'] for field in program['self_reads']): continue
            output = program['output_fields'][0]
            if program['field_types']['local'].get(output) not in ('DoubleProperty', 'FloatProperty'): continue
            metrics.append({'package': package_name, 'function': name, 'output': output,
                            'current': ratio['args'][0]['field'], 'maximum': ratio['args'][1]['field']})
    return metrics


def migrate_blueprints(project, workspace, publish_dir, package_name=None, read_packages=()):
    """Reuse parsed packages only; no Unreal launch, parser process or scan."""
    project, workspace, output = Path(project).resolve(strict=True), Path(workspace).resolve(strict=True), Path(publish_dir).resolve()
    if output == project.parent or project.parent in output.parents:
        raise BlueprintTranslationError('Blueprint outputs must stay outside the source project')
    inventory = read_json(workspace / 'artifacts/inventory.json')
    registry = read_json(workspace / 'artifacts/engine_metadata.json')
    if (Path(registry['project']).resolve() != project or not registry.get('complete')
            or registry.get('source_snapshot_hash') != digest(inventory['files'])):
        raise BlueprintTranslationError('Matching complete cached registry and inventory are required')
    assets = {a['package']: a for a in inventory['assets']}
    candidates = [a['package'] for a in registry['assets'] if a.get('class') in
                  ('BlueprintGeneratedClass', 'AnimBlueprintGeneratedClass', 'WidgetBlueprintGeneratedClass')]
    if package_name:
        if package_name not in candidates: raise BlueprintTranslationError('Requested package is not an inventoried Blueprint')
        candidates = [package_name]
    if read_packages:
        # Parsing is explicit and bounded to named inventoried packages. Cache
        # population never starts Unreal and never modifies source assets.
        version = str(read_json(workspace / 'artifacts/engine.json')['version']).split('-')[0]
        tool = _tool(workspace / 'tool-cache')
        for name in dict.fromkeys(read_packages):
            if name not in candidates or name not in assets:
                raise BlueprintTranslationError(f'Requested parser input is not an inventoried Blueprint: {name}')
            asset = assets[name]; source = (project.parent / asset['path']).resolve()
            if project.parent not in source.parents or file_hash(source) != asset['sha256']:
                raise BlueprintTranslationError(f'Source changed since cached inspection: {name}')
            print('Blueprint source read: ' + name, flush=True)
            _asset_document(name, source, tool, workspace / 'artifacts/uasset-json', version)
    key_inputs, cached, missing = {}, [], []
    for name in sorted(set(candidates)):
        asset = assets.get(name, {})
        cache = workspace / 'artifacts/uasset-json' / (asset.get('sha256', 'missing') + '.json')
        if not cache.is_file():
            missing.append(name)
            continue
        source = (project.parent / asset['path']).resolve()
        if project.parent not in source.parents or file_hash(source) != asset['sha256']:
            raise BlueprintTranslationError(f'Source changed since cached inspection: {name}')
        key_inputs[name] = {'source_sha256': asset['sha256'], 'parsed_sha256': file_hash(cache)}
        cached.append((name, cache))
    controls_file = output / 'character-controls.json'
    fingerprint = digest({'project': str(project), 'inputs': key_inputs, 'missing': missing,
                          'controls': file_hash(controls_file) if controls_file.is_file() else None,
                          'implementation': file_hash(Path(__file__))})
    report_file = output / 'blueprint-programs.json'
    try:
        prior = read_json(report_file)
        if prior.get('fingerprint') == fingerprint and prior.get('content_sha256') == digest({k: v for k, v in prior.items() if k != 'content_sha256'}):
            return prior
    except (OSError, ValueError): pass
    packages, counts = {}, Counter()
    for name, cache in cached:
        packages[name] = translate_package(Package(read_json(cache)))
        packages[name]['source'] = key_inputs[name]
        counts.update(packages[name]['counts'])
    guards = {}
    if controls_file.is_file():
        controls = read_json(controls_file)
        source = controls.get('sources', {}).get('character_blueprint', {})
        if controls.get('project') == str(project) and key_inputs.get(source.get('package'), {}).get('source_sha256') == source.get('sha256'):
            cache_path = dict(cached).get(source['package'])
            guards = character_guards(controls, packages, Package(read_json(cache_path)))
    report = {'schema_version': 1, 'project': str(project), 'fingerprint': fingerprint,
              'packages': packages, 'counts': dict(counts), 'missing_cached_packages': missing,
              'character_guards': guards, 'character_metrics': character_metrics(guards, packages),
              'limitations': ['Locals, instance state, comparisons, static jumps and same-source-class calls with out parameters execute.',
                             'Cross-object calls, derived-class virtual overrides, dynamic jumps, latent actions and replication remain blocked.',
                             'Translated functions are not connected to the complete game runtime yet.']}
    report['content_sha256'] = digest(report)
    atomic_json(report_file, report)
    return report
