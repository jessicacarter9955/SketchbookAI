"""Source-witnessed component ownership; no construction script or network execution."""
from blueprint_types import import_path, property_schema
from blueprint_values import serialized_value
from core import digest

ACTOR_BASES = {('/Script/Engine', name) for name in ('Actor', 'Pawn', 'Character')}


def class_metadata(package):
    candidates = [(i, e) for i, e in enumerate(package.exports, 1)
                  if str(e.get('ObjectName', '')).endswith('_C') and not str(e.get('ObjectName', '')).startswith('Default__')]
    if len(candidates) != 1: return None
    index, cls = candidates[0]
    return {'export_index': index, 'object': cls['ObjectName'],
            'native_base': list(import_path(package, cls.get('SuperStruct')) or ()),
            'force_net_update_override': any(e.get('OuterIndex') == index and e.get('ObjectName') == 'ForceNetUpdate'
                                             for e in package.exports)}


def native_owner(value, package, owner):
    from blueprint_migration import BlueprintTranslationError as Error
    if import_path(package, value.get('StackNode')) != ('/Script/Engine', 'ActorComponent', 'GetOwner'): return None
    cls = package.export(owner)
    if (not cls or import_path(package, cls.get('SuperStruct')) != ('/Script/Engine', 'ActorComponent')
            or value.get('Parameters') != []):
        raise Error('GetOwner requires an original direct ActorComponent subclass and no arguments')
    return {'op': 'native_get_owner', 'source_owner_index': owner}


def native_actor_context(value, package, owner, reads, outputs, depth):
    from blueprint_migration import kind, expression, memory_size, BlueprintTranslationError as Error
    from blueprint_effects import variable
    call = value.get('ContextExpression', {})
    if kind(call) != 'EX_VirtualFunction' or call.get('VirtualFunctionName') != 'ForceNetUpdate': return None
    target, schema = variable(value.get('ObjectExpression', {}), package, owner, reads, outputs, depth)
    if (schema.get('reference_kind') != 'runtime_actor' or schema.get('class') != ['/Script/Engine', 'Actor']
            or call.get('Parameters') != [] or value.get('Offset') != memory_size(call, package=package)):
        raise Error('Unresolved source Actor.ForceNetUpdate receiver or context offset')
    return {'op': 'native_force_net_update', 'target': target}


def actor_graph(packages, sources):
    """Validate reachable original SCS nodes, fields and templates before binding."""
    roots, blocked = {}, []
    for name, package in packages.items():
        meta = class_metadata(package)
        if not meta or tuple(meta['native_base']) not in ACTOR_BASES: continue
        try:
            if meta['force_net_update_override']: raise ValueError('Source actor overrides ForceNetUpdate')
            cls = package.export(meta['export_index'])
            script_index = package.props(cls).get('SimpleConstructionScript')
            script = package.export(script_index)
            if (not script or script.get('OuterIndex') != meta['export_index']
                    or import_path(package, script.get('ClassIndex')) != ('/Script/Engine', 'SimpleConstructionScript')):
                raise ValueError('Unresolved original construction script')
            script_data = package.props(script)
            all_nodes, roots_list = script_data.get('AllNodes'), script_data.get('RootNodes')
            if (not isinstance(all_nodes, list) or not isinstance(roots_list, list) or len(all_nodes) > 10000
                    or any(type(i) is not int for i in all_nodes) or len(set(all_nodes)) != len(all_nodes)):
                raise ValueError('Invalid original construction-node list')
            reachable, pending = set(), list(roots_list)
            while pending:
                node_index = pending.pop()
                if type(node_index) is not int or node_index not in all_nodes or node_index in reachable:
                    raise ValueError('Repeated or unresolved original construction node')
                node = package.export(node_index)
                if (not node or node.get('OuterIndex') != script_index
                        or import_path(package, node.get('ClassIndex')) != ('/Script/Engine', 'SCS_Node')):
                    raise ValueError('Wrong original construction-node owner')
                reachable.add(node_index); pending.extend(package.props(node).get('ChildNodes', []))
            if reachable != set(all_nodes): raise ValueError('Original construction-node lists differ')
            fields = {p['Name']: p for p in cls.get('LoadedProperties', [])}
            components, component_blocked, used = [], [], set()
            for index in sorted(reachable):
                data = package.props(package.export(index)); identity = import_path(package, data.get('ComponentClass'))
                if not identity or identity[0] not in packages: continue
                source = packages[identity[0]]; source_meta = class_metadata(source)
                if not source_meta or source_meta['native_base'] != ['/Script/Engine', 'ActorComponent']: continue
                variable_name = data.get('InternalVariableName'); template = package.export(data.get('ComponentTemplate'))
                if (not isinstance(variable_name, str) or variable_name in ('__proto__', 'constructor', 'prototype')
                        or variable_name in used or fields.get(variable_name, {}).get('SerializedType') != 'ObjectProperty'
                        or identity != import_path(package, fields.get(variable_name, {}).get('PropertyClass'))
                        or not template or template.get('OuterIndex') != meta['export_index']
                        or template.get('ClassIndex') != data['ComponentClass'] or source_meta['object'] != identity[-1]):
                    raise ValueError('Original component field, template or class differs')
                used.add(variable_name)
                source_props = {p['Name']: p for p in source.export(source_meta['export_index']).get('LoadedProperties', [])}
                overrides, native_fields = {}, []
                try:
                    for value in template.get('Data', []):
                        prop = source_props.get(value['Name'])
                        if not prop: native_fields.append(value['Name']); continue
                        schema = property_schema(source, prop)
                        if not schema: raise ValueError('Unresolved original component override type')
                        overrides[value['Name']] = serialized_value(package, prop, schema, value)
                except (ValueError, KeyError, TypeError) as error:
                    component_blocked.append({'variable': variable_name, 'reason': str(error)}); continue
                components.append({'variable': variable_name, 'package': identity[0], 'class_object': identity[-1],
                    'class_export_index': source_meta['export_index'], 'scs_node_export_index': index,
                    'template_export_index': data['ComponentTemplate'], 'template_sha256': digest(template),
                    'source_overrides': overrides, 'native_template_fields': native_fields, 'source': sources[identity[0]]})
            roots[name] = {**meta, 'source': sources[name], 'scs_export_index': script_index,
                           'scs_sha256': digest(script), 'components': components, 'component_blocked': component_blocked}
        except (ValueError, TypeError, KeyError) as error: blocked.append({'package': name, 'reason': str(error)})
    return {'schema_version': 1, 'roots': roots, 'blocked': blocked,
            'scope': 'Original SCS component ownership only; native template behavior, construction scripts and BeginPlay are not executed'}
