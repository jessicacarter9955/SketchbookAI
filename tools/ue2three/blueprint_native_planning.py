"""Observed native API families in blocked source functions/event slices.

This is a dependency inventory, never an executable translation or an estimate
of how many whole functions implementing an adapter will actually unlock.
"""
from blueprint_migration import kind, memory_size, MATH_CALLS, BlueprintTranslationError
from blueprint_events import reachable_event
from blueprint_types import import_path
from blueprint_objects import NATIVE_OBJECT_CALLS


FAMILIES = {
    'native-objects': ('Oggetti e componenti', 'Typed receivers, class/instance ownership, source object lifecycle and original cross-component calls.'),
    'native-timers': ('Clock e timer', 'Original game time, handles, cancellation, callback ordering and standalone event scheduling.'),
    'native-animation': ('Mesh, socket e animazione', 'Original native mesh/component bindings, socket transforms, animation instances and montage events.'),
    'native-physics': ('Query, collisioni e danni', 'Source collision channels, trace/query results, hit data and original damage dispatch.'),
    'native-math': ('Matematica nativa', 'Exact source scalar/vector/rotator contracts, numeric widths and edge cases; no inferred game rules.'),
    'native-audio-vfx': ('Audio ed effetti', 'Source asset identities, instance lifetime, transforms and original audio/VFX dispatch.'),
    'native-data': ('Dati e contenitori', 'Typed source tables/arrays, original parameter modes, copy semantics and mutation ordering.'),
}


def nodes(value):
    if isinstance(value, dict):
        yield value
        for child in value.values(): yield from nodes(child)
    elif isinstance(value, list):
        for child in value: yield from nodes(child)


def family(identity):
    library, method = identity[-2:]
    if library == 'KismetMathLibrary': return 'native-math'
    if any(part in method.lower() for part in ('timer', 'gametime', 'realtime', 'delay')): return 'native-timers'
    if any(part in (library + method).lower() for part in ('sound', 'audio', 'niagara', 'emitter', 'particle')): return 'native-audio-vfx'
    if any(part in method.lower() for part in ('trace', 'overlap', 'collision', 'damage')): return 'native-physics'
    if any(part in (library + method).lower() for part in ('anim', 'montage', 'skeletal', 'socket', 'mesh')): return 'native-animation'
    if library in ('KismetArrayLibrary', 'DataTableFunctionLibrary'): return 'native-data'
    return 'native-objects'


def adapter_present(identity):
    # Presence is not acceptance of every receiver, overload or parameter shape.
    return (identity[:2] == ('/Script/Engine', 'KismetMathLibrary') and identity[-1] in MATH_CALLS
            or identity == ('/Script/Engine', 'ActorComponent', 'GetOwner')
            or identity == ('/Script/Engine', 'Actor', 'GetComponentByClass')
            or identity == ('/Script/Engine', 'KismetSystemLibrary', 'GetGameTimeInSeconds')
            or identity == ('/Script/Engine', 'KismetSystemLibrary', 'IsValid')
            or identity == ('/Script/Engine', 'NetPushModelHelpers', 'MarkPropertyDirtyFromRepIndex')
            or identity in NATIVE_OBJECT_CALLS
            or identity[:2] == ('/Script/Engine', 'KismetArrayLibrary')
            and identity[-1] in ('Array_Get', 'Array_Length', 'Array_IsValidIndex', 'Array_Set', 'Array_Remove', 'Array_Clear', 'Array_Add', 'Array_Append')
            or identity == ('/Script/Engine', 'DataTableFunctionLibrary', 'GetDataTableRowFromName'))


def native_surface(package, export):
    code = list(export.get('ScriptBytecode') or [])
    entries, errors = [], []
    for node in list(nodes(code)):
        if kind(node) not in ('EX_LocalFinalFunction', 'EX_FinalFunction'): continue
        target = package.export(node.get('StackNode'))
        if not target or not str(target.get('ObjectName', '')).startswith('ExecuteUbergraph_'): continue
        args = node.get('Parameters', [])
        if (target.get('OuterIndex') != export.get('OuterIndex') or len(args) != 1 or kind(args[0]) != 'EX_IntConst'
                or type(args[0].get('Value')) is not int):
            errors.append('Unresolved original constant event entry'); continue
        try:
            offsets, boundaries, size, reachable, prologue = reachable_event(
                target, args[0]['Value'], package, kind, memory_size, BlueprintTranslationError)
            code.extend(target['ScriptBytecode'][index] for index in sorted(reachable))
            entries.append({'function': target['ObjectName'], 'entry_offset': args[0]['Value'],
                            'reachable_instructions': len(reachable), 'memory_size_verified': size})
        except (BlueprintTranslationError, KeyError, TypeError, IndexError) as error:
            errors.append(str(error))
    calls, virtual = {}, set()
    for node in nodes(code):
        if kind(node) == 'EX_VirtualFunction': virtual.add(node.get('VirtualFunctionName', ''))
        if kind(node) not in ('EX_CallMath', 'EX_FinalFunction', 'EX_LocalFinalFunction'): continue
        ref = node.get('StackNode')
        identity = import_path(package, ref)
        if (not identity or len(identity) != 3 or not identity[0].startswith('/Script/')
                or package.imports[-ref-1].get('ClassName') != 'Function'): continue
        api = '.'.join(identity)
        item = calls.setdefault(api, {'api': api, 'identity': list(identity), 'family': family(identity),
            'adapter_family_present': bool(adapter_present(identity)), 'observed_arities': set(), 'dispatch': set()})
        parameters = node.get('Parameters')
        if isinstance(parameters, list): item['observed_arities'].add(len(parameters))
        item['dispatch'].add(kind(node))
    return {'calls': [{**item, 'observed_arities': sorted(item['observed_arities']), 'dispatch': sorted(item['dispatch'])}
                      for _, item in sorted(calls.items())],
            'event_entries': entries, 'event_slice_errors': sorted(set(errors)),
            'virtual_calls_requiring_receiver_resolution': sorted(name for name in virtual if isinstance(name, str) and name)}


def rank_native_families(records):
    groups, operations = {}, {}
    for record in records:
        witness = {key: record[key] for key in ('package', 'function', 'export_index', 'source_bytecode_sha256')}
        for call in record.get('native_surface', {}).get('calls', []):
            api = call['api']; op = operations.setdefault(api, {**call, 'observed_in_blocked_functions': []})
            op['observed_in_blocked_functions'].append(witness)
            op['observed_arities'] = sorted(set(op['observed_arities']) | set(call['observed_arities']))
            op['dispatch'] = sorted(set(op['dispatch']) | set(call['dispatch']))
            group = groups.setdefault(call['family'], {'id': call['family'], 'title': FAMILIES[call['family']][0],
                'functions': set(), 'missing': set(), 'apis': set()})
            group['functions'].add((record['package'], record['export_index']))
            group['apis'].add(api)
            if not call['adapter_family_present']: group['missing'].add(api)
    ranked = [{**{key: value for key, value in row.items() if key not in ('functions', 'missing', 'apis')},
               'blocked_source_functions_involved': len(row['functions']), 'distinct_observed_apis': len(row['apis']),
               'apis_without_known_adapter_family': sorted(row['missing']), 'packet': 'work-packets/' + row['id'] + '.md'}
              for row in groups.values()]
    ranked.sort(key=lambda row: (-row['blocked_source_functions_involved'], row['id']))
    ops = sorted(operations.values(), key=lambda item: (item['adapter_family_present'], -len(item['observed_in_blocked_functions']), item['api']))
    return {'families': ranked, 'operations': ops,
            'resolved_event_entries': sum(len(record.get('native_surface', {}).get('event_entries', [])) for record in records),
            'event_slice_failures': sum(bool(record.get('native_surface', {}).get('event_slice_errors')) for record in records),
            'scope': 'Observed dependencies in blocked functions and verified constant-entry event slices. Counts overlap; adapter presence does not prove call-site support or complete-function unlocking.'}
