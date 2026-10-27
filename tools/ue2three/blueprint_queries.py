"""Typed original component calls with explicit transactional mutation admission."""
from blueprint_types import import_path, property_schema
from blueprint_effects import variable


def component_access(value, package, owner, reads, outputs, depth):
    from blueprint_migration import kind, memory_size, field, BlueprintTranslationError as Error
    call = value.get('ContextExpression', {})
    path = import_path(package, call.get('StackNode'))
    if path == ('/Script/Engine', 'Actor', 'GetComponentByClass') and kind(call) == 'EX_FinalFunction':
        target, schema = variable(value.get('ObjectExpression', {}), package, owner, reads, outputs, depth)
        args = call.get('Parameters', [])
        if (schema.get('reference_kind') != 'runtime_actor' or len(args) != 1 or kind(args[0]) != 'EX_ObjectConst'
                or value.get('Offset') != memory_size(call, package=package)):
            raise Error('Unresolved original GetComponentByClass receiver, class or context layout')
        identity = import_path(package, args[0].get('Value'))
        source = getattr(package, 'source_packages', {}).get((identity or (None,))[0])
        from blueprint_objects import class_metadata
        meta = class_metadata(source) if source else None
        if not meta or [meta['object']] != list(identity[1:]) or meta['native_base'] != ['/Script/Engine', 'ActorComponent']:
            raise Error('GetComponentByClass requires an available original direct component class')
        return {'op': 'native_find_component', 'target': target, 'actor_schema': schema,
                'package': identity[0], 'class_object': identity[1], 'class_export_index': meta['export_index']}
    if kind(call) != 'EX_InstanceVariable': return None
    target, target_schema = variable(value.get('ObjectExpression', {}), package, owner, reads, outputs, depth)
    if target_schema.get('reference_kind') != 'runtime_component': return None
    identity = tuple(target_schema['class'])
    pointer = call.get('Variable', {}).get('New', {})
    source = getattr(package, 'source_packages', {}).get(identity[0])
    from blueprint_objects import class_metadata
    meta = class_metadata(source) if source else None
    if (not meta or meta['object'] != identity[1] or import_path(package, pointer.get('ResolvedOwner')) != identity
            or value.get('RValuePointer') != call.get('Variable')
            or value.get('Offset') != memory_size(call, package=package)):
        raise Error('Original component property owner or context layout differs')
    name = field(call.get('Variable'))
    props = [prop for prop in source.export(meta['export_index']).get('LoadedProperties', []) if prop.get('Name') == name]
    schema = property_schema(source, props[0]) if len(props) == 1 else None
    if not schema: raise Error('Original component property schema is unavailable')
    return {'op': 'component_member', 'target': target, 'package': identity[0], 'class_object': identity[1],
            'class_export_index': meta['export_index'], 'field': name, 'schema': schema}


def game_time(value, package, owner):
    from blueprint_migration import kind, BlueprintTranslationError as Error
    if import_path(package, value.get('StackNode')) != ('/Script/Engine', 'KismetSystemLibrary', 'GetGameTimeInSeconds'): return None
    args = value.get('Parameters')
    if not isinstance(args, list) or len(args) != 1 or kind(args[0]) != 'EX_Self' or not package.export(owner):
        raise Error('Original game clock requires the current source world context')
    return {'op': 'native_game_time', 'source_owner_index': owner}


def object_validity(value, package, owner, reads, outputs, depth):
    from blueprint_migration import BlueprintTranslationError as Error
    if import_path(package, value.get('StackNode')) != ('/Script/Engine', 'KismetSystemLibrary', 'IsValid'): return None
    args = value.get('Parameters')
    if not isinstance(args, list) or len(args) != 1: raise Error('Original IsValid arity differs')
    target, schema = variable(args[0], package, owner, reads, outputs, depth)
    if schema.get('reference_kind') not in ('runtime_actor', 'runtime_component', 'runtime_native_component',
                                             'runtime_native_widget'):
        raise Error('IsValid requires an explicit original live-object binding; asset loading is not implied')
    return {'op': 'native_object_valid', 'target': target, 'schema': schema}


def component_query(value, package, owner, reads, outputs, depth):
    from blueprint_migration import kind, expression, memory_size, BlueprintTranslationError as Error
    call = value.get('ContextExpression', {})
    dispatch = kind(call)
    if dispatch not in ('EX_LocalVirtualFunction', 'EX_VirtualFunction', 'EX_FinalFunction', 'EX_LocalFinalFunction'):
        return None
    target, schema = variable(value.get('ObjectExpression', {}), package, owner, reads, outputs, depth)
    if schema.get('reference_kind') != 'runtime_component': return None
    identity = tuple(schema['class']); source = getattr(package, 'source_packages', {}).get(identity[0])
    if source is package: raise Error('Same-instance component aliases require shared active storage')
    from blueprint_objects import class_metadata
    meta = class_metadata(source) if source else None
    if not meta or meta['object'] != identity[1]: raise Error('Original component class is unavailable')
    if dispatch in ('EX_FinalFunction', 'EX_LocalFinalFunction'):
        reference = call.get('StackNode')
        function_identity = import_path(package, reference)
        imported = package.imports[-reference-1] if type(reference) is int and reference < 0 and -reference <= len(package.imports) else {}
        outer = imported.get('OuterIndex')
        if (type(reference) is not int or reference >= 0 or -reference > len(package.imports)
                or imported.get('ClassName') != 'Function' or type(outer) is not int or outer >= 0
                or -outer > len(package.imports) or package.imports[-outer-1].get('ClassName') != 'Class'
                or not function_identity or function_identity[:2] != identity
                or len(function_identity) != 3):
            raise Error('Original component direct function import belongs to another package or class')
        function_name = function_identity[2]
    else:
        function_name = call.get('VirtualFunctionName')
    candidates = [(i, e) for i, e in enumerate(source.exports, 1) if e.get('ObjectName') == function_name
                  and e.get('OuterIndex') == meta['export_index'] and e.get('ScriptBytecode')]
    if len(candidates) != 1: raise Error('Original component query implementation is unresolved')
    index, function = candidates[0]
    props = [p for p in function.get('LoadedProperties', []) if 'CPF_Parm' in str(p.get('PropertyFlags'))]
    if any('CPF_ReturnParm' in str(p.get('PropertyFlags')) for p in props):
        raise Error('Component query return storage requires an explicit adapter')
    args = call.get('Parameters')
    if (not isinstance(args, list) or len(args) != len(props)
            or value.get('Offset') != memory_size(call, package=package)):
        raise Error('Original component query signature or context offset differs')
    bindings, output_targets = [], set()
    for prop, arg in zip(props, args):
        parameter_schema = property_schema(source, prop)
        if not parameter_schema: raise Error('Original component query parameter schema is unavailable')
        if 'CPF_OutParm' in str(prop.get('PropertyFlags')) and 'CPF_ConstParm' not in str(prop.get('PropertyFlags')):
            destination, output_schema = variable(arg, package, owner, reads, outputs, depth)
            if parameter_schema != output_schema: raise Error('Original component query output schema differs')
            if destination['scope'] == 'local':
                active = getattr(package, '_active_function', None)
                caller_prop = next((item for item in (active or {}).get('LoadedProperties', [])
                                    if item.get('Name') == destination['field']), None)
                if caller_prop and 'CPF_OutParm' in str(caller_prop.get('PropertyFlags')):
                    outputs.add(destination['field'])
            output_targets.add((destination.get('scope'), destination.get('frame'), destination['field']))
            bindings.append({'mode': 'output', 'parameter': prop['Name'], 'target': destination,
                             'schema': parameter_schema})
        else:
            if 'CPF_ReferenceParm' in str(prop.get('PropertyFlags')):
                raise Error('Original component reference parameter requires an explicit output contract')
            bindings.append({'mode': 'input', 'parameter': prop['Name'],
                             'value': expression(arg, reads, outputs, depth+1, package, owner), 'schema': parameter_schema})
    if len(output_targets) != sum(binding['mode'] == 'output' for binding in bindings):
        raise Error('Aliased original component output targets are unsupported')
    output_safe = all('CPF_ReferenceParm' not in str(prop.get('PropertyFlags')) for prop in props)
    return {'op': 'component_query', 'target': target, 'package': identity[0], 'class_object': identity[1],
            'receiver_schema': schema, 'class_export_index': meta['export_index'], 'function': function['ObjectName'],
            'export_index': index, 'dispatch': dispatch,
            'context_offset': value.get('Offset'), 'bindings': bindings,
            'transactional_outputs_safe': output_safe,
            'value_parameters_only': all('CPF_OutParm' not in str(prop.get('PropertyFlags'))
                                         and 'CPF_ReferenceParm' not in str(prop.get('PropertyFlags')) for prop in props)}


def expressions(value):
    if isinstance(value, dict):
        if 'op' in value: yield value
        for child in value.values(): yield from expressions(child)
    elif isinstance(value, list):
        for child in value: yield from expressions(child)


def query_safe(program, library, visited=None, packages=None, package_name=None, receiver_chain=None):
    visited = set() if visited is None else visited
    name = (package_name, program.get('name'))
    if name in visited: return False  # No recursive cross-object query graph.
    if program.get('self_writes') or program.get('persistent_types'): return False
    visited = visited | {name}
    for node in expressions(program.get('steps', [])):
        if node['op'] in ('broadcast', 'mark_dirty', 'native_force_net_update', 'component_call','set_actor_member'): return False
        if node['op'] == 'call':
            child = library.get(node.get('function'))
            if not child or child['source_export_index'] != node['export_index'] or not query_safe(
                    child, library, visited, packages, package_name, receiver_chain): return False
        if node['op'] == 'component_query' and packages is not None:
            target_name = node['package']; chain = receiver_chain or {package_name}
            if target_name in chain: return False
            target = packages.get(target_name, {}); child = target.get('functions', {}).get(node['function'])
            child_library = {**target.get('functions', {}), **target.get('event_programs', {})}
            if not child or child['source_export_index'] != node['export_index'] or not query_safe(
                    child, child_library, visited, packages, target_name, chain | {target_name}): return False
    return True


def component_call_safe(program, packages, package_name, receiver_chain, visited=None):
    """Reject cross-component recursion before admitting copied out storage."""
    visited = set() if visited is None else visited
    identity = (package_name, program.get('name'), program.get('source_export_index'))
    if identity in visited: return False
    visited = visited | {identity}
    library = packages.get(package_name, {})
    functions = {**library.get('functions', {}), **library.get('event_programs', {})}
    for node in expressions(program.get('steps', [])):
        if node.get('op') == 'call':
            child = functions.get(node.get('function'))
            if (not child or child.get('source_export_index') != node.get('export_index')
                    or not component_call_safe(child, packages, package_name, receiver_chain, visited)):
                return False
        elif node.get('op') in ('component_query', 'component_call'):
            target_name = node.get('package')
            if target_name in receiver_chain: return False
            target = packages.get(target_name, {})
            child = {**target.get('functions', {}), **target.get('event_programs', {})}.get(node.get('function'))
            if (not child or child.get('source_export_index') != node.get('export_index')
                    or not component_call_safe(child, packages, target_name, receiver_chain | {target_name}, visited)):
                return False
    return True


def prune_queries(packages):
    """Never publish a caller whose required original receiver failed migration."""
    while True:
        changed = False
        for package_name, data in packages.items():
            library = {**data['functions'], **data['event_programs']}
            for name, program in list(library.items()):
                reason = None
                for node in expressions(program['steps']):
                    if node['op'] == 'call' and node.get('function') not in library:
                        reason = 'Untranslated function dependency: ' + node['function']; break
                    if node['op'] not in ('component_query', 'component_call'): continue
                    target = packages.get(node['package'], {})
                    callee = target.get('functions', {}).get(node['function'])
                    target_library = {**target.get('functions', {}), **target.get('event_programs', {})}
                    if node['package'] == package_name or not callee or callee['source_export_index'] != node['export_index']:
                        reason = 'Untranslated component receiver: ' + node['package'] + ':' + node['function']; break
                    if not query_safe(callee, target_library, packages=packages, package_name=node['package'],
                                      receiver_chain={package_name, node['package']}):
                        if (node.get('transactional_outputs_safe') is True
                                and all(b['mode'] in ('input', 'output') for b in node['bindings'])
                                and component_call_safe(callee, packages, node['package'],
                                                        {package_name, node['package']})):
                            node['op'] = 'component_call'
                        else:
                            reason = 'Effectful component call requires live out/reference storage: ' + node['package'] + ':' + node['function']; break
                if reason:
                    group = 'event_programs' if program.get('internal_event_entry') else 'functions'
                    del data[group][name]
                    row = {'function': name, 'source_export_index': program['source_export_index'], 'reason': reason}
                    data['event_blocked' if group == 'event_programs' else 'blocked'].append(row)
                    changed = True
        if not changed: break
    for data in packages.values():
        data['counts']['translated'] = len(data['functions'])
        data['counts']['blocked'] = len(data['blocked'])
        if 'event_entries' in data['counts']: data['counts']['event_entries'] = len(data['event_programs'])
