"""Translate cached Kismet straight-line functions; reject unsupported behavior."""
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


def expression(value, reads, outputs, depth=0, package=None):
    if not isinstance(value, dict) or depth > 48:
        raise BlueprintTranslationError('Invalid or deeply nested Kismet expression')
    token = kind(value)
    if token == 'EX_CallMath':
        name = math_call(package, value.get('StackNode'))
        args = value.get('Parameters')
        if not isinstance(args, list) or len(args) != MATH_CALLS[name][0]:
            raise BlueprintTranslationError('Invalid native math parameter count')
        return {'op': 'math', 'name': name, 'args': [expression(arg, reads, outputs, depth+1, package) for arg in args]}
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


def translate_function(export, package=None):
    bytecode = export.get('ScriptBytecode')
    if not isinstance(bytecode, list) or not bytecode or len(bytecode) > 100000:
        raise BlueprintTranslationError('Parsed source bytecode is required')
    reads, outputs, writes, steps = set(), set(), set(), []
    returned = ended = False
    for index, instruction in enumerate(bytecode):
        token = kind(instruction)
        if token in ('EX_Tracepoint', 'EX_WireTracepoint', 'EX_Nothing'): continue
        if ended: raise BlueprintTranslationError('Bytecode after EndOfScript')
        if token == 'EX_EndOfScript':
            ended = True
            continue
        if returned: raise BlueprintTranslationError('Instructions after return require control-flow translation')
        if token in ('EX_Let', 'EX_LetBool', 'EX_LetObj'):
            variable = instruction.get('Variable' if token == 'EX_Let' else 'VariableExpression')
            if not isinstance(variable, dict) or kind(variable) not in ('EX_LocalVariable', 'EX_LocalOutVariable', 'EX_InstanceVariable'):
                raise BlueprintTranslationError('Unsupported assignment target')
            target = expression(variable, reads, outputs, package=package)
            if target['scope'] == 'self': writes.add(target['field'])
            source = instruction.get('Expression' if token == 'EX_Let' else 'AssignmentExpression')
            steps.append({'op': 'set', 'field': target['field'], 'scope': target['scope'], 'value': expression(source, reads, outputs, package=package),
                          'boolean': token == 'EX_LetBool', 'source_index': index})
        elif token == 'EX_Return':
            steps.append({'op': 'return', 'value': expression(instruction.get('ReturnExpression'), reads, outputs, package=package),
                          'source_index': index})
            returned = True
        else:
            raise BlueprintTranslationError(f'Unsupported opcode: {token}')
    if not returned or not ended: raise BlueprintTranslationError('Complete return and EndOfScript are required')
    return {'schema_version': 1, 'name': export['ObjectName'], 'status': 'translated_straight_line',
            'source_bytecode_sha256': digest(bytecode), 'self_reads': sorted(reads),
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
                local_reads(step['value'])
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
    no_ops = sum(not program['self_reads'] and not program['output_fields'] and not program['self_writes']
                 and all(step['op'] == 'return' and step['value'] == {'op': 'constant', 'value': None}
                         for step in program['steps']) for program in functions.values())
    return {'functions': functions, 'blocked': blocked, 'declarations': declarations,
            'counts': {'translated': len(functions), 'blocked': len(blocked),
                       'declarations': len(declarations), 'no_op_functions': no_ops}}


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
    fingerprint = digest({'project': str(project), 'inputs': key_inputs, 'missing': missing, 'implementation': file_hash(Path(__file__))})
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
    report = {'schema_version': 1, 'project': str(project), 'fingerprint': fingerprint,
              'packages': packages, 'counts': dict(counts), 'missing_cached_packages': missing,
              'limitations': ['Straight-line locals, instance state, property reads, comparisons, Boolean math, constants and returns execute.',
                             'Other calls, jumps, latent actions, native modules, replication and animation graphs are blocked.',
                             'Translated functions are not connected to the complete game runtime yet.']}
    report['content_sha256'] = digest(report)
    atomic_json(report_file, report)
    return report
