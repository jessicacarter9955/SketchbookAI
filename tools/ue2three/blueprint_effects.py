"""Strict source array adapters and synchronous local notification contracts."""
from blueprint_types import import_path, property_schema


def variable(value, package, owner, reads, outputs, depth):
    from blueprint_migration import kind, field, expression, BlueprintTranslationError as Error
    token = kind(value)
    if token not in ('EX_InstanceVariable', 'EX_LocalVariable', 'EX_LocalOutVariable'):
        raise Error('Source adapter requires a direct original property')
    pointer = value.get('Variable', {}).get('New', {})
    container = package.export(owner) if token == 'EX_InstanceVariable' else getattr(package, '_active_function', None)
    if not container or package.export(pointer.get('ResolvedOwner')) is not container:
        raise Error('Source adapter property belongs to another owner')
    name = field(value.get('Variable'))
    props = [p for p in container.get('LoadedProperties', []) if p.get('Name') == name]
    schema = property_schema(package, props[0]) if len(props) == 1 else None
    if not schema: raise Error('Source adapter property schema is unavailable')
    target = expression(value, reads, outputs, depth+1, package, owner)
    if target['scope'] not in ('self', 'local'): raise Error('Persistent container adapters are not supported')
    return target, schema


def array_context(value, package, owner, reads, outputs, depth):
    from blueprint_migration import kind, expression, memory_size, BlueprintTranslationError as Error
    obj, call = value.get('ObjectExpression', {}), value.get('ContextExpression', {})
    path = import_path(package, call.get('StackNode'))
    if (kind(obj) != 'EX_ObjectConst' or import_path(package, obj.get('Value')) != ('/Script/Engine', 'Default__KismetArrayLibrary')
            or kind(call) != 'EX_FinalFunction' or not path or path[:2] != ('/Script/Engine', 'KismetArrayLibrary')):
        return None
    name = path[-1]
    counts = {'Array_Length': 1, 'Array_IsValidIndex': 2, 'Array_Get': 3,
              'Array_Set': 4, 'Array_Remove': 2, 'Array_Clear': 1, 'Array_Add': 2, 'Array_Append': 2}
    if name not in counts: raise Error('Unsupported original array call: ' + name)
    args = call.get('Parameters', [])
    if len(args) != counts[name] or value.get('Offset') != memory_size(call, package=package):
        raise Error('Original array arity or source context offset differs')
    target, schema = variable(args[0], package, owner, reads, outputs, depth)
    if schema['type'] != 'ArrayProperty': raise Error('Original adapter target is not a typed array')
    expr = lambda arg: expression(arg, reads, outputs, depth+1, package, owner)
    if name == 'Array_Length': return {'op': 'array_length', 'array': target}
    if name == 'Array_IsValidIndex': return {'op': 'array_valid', 'array': target, 'index': expr(args[1])}
    if name == 'Array_Get':
        output, output_schema = variable(args[2], package, owner, reads, outputs, depth)
        if output['scope'] != 'local' or output_schema != schema['element']:
            raise Error('Array_Get output type or source owner differs')
        return {'op': 'array_get', 'array': target, 'index': expr(args[1]), 'target': output, 'element': schema['element']}
    # Preserve the already published Set/Add IR for source instance arrays.
    # The general mutation adapter also accepts source local arrays.
    if target['scope'] == 'self' and name == 'Array_Set':
        return {'op': 'array_set', 'target': target, 'element': schema['element'],
                'index': expr(args[1]), 'item': expr(args[2]), 'size_to_fit': expr(args[3])}
    if target['scope'] == 'self' and name == 'Array_Add':
        return {'op': 'array_add', 'target': target, 'element': schema['element'], 'item': expr(args[1])}
    result = {'op': 'array_mutate', 'operation': name, 'target': target, 'element': schema['element']}
    if name in ('Array_Set', 'Array_Remove'): result['index'] = expr(args[1])
    if name == 'Array_Set': result.update(value=expr(args[2]), resize=expr(args[3]))
    if name == 'Array_Add': result['value'] = expr(args[1])
    if name == 'Array_Append':
        other, other_schema = variable(args[1], package, owner, reads, outputs, depth)
        if other_schema != schema: raise Error('Array_Append element type differs')
        result['value'] = other
    return result


def array_literal(value, package, owner, reads, outputs, depth):
    from blueprint_migration import expression, BlueprintTranslationError as Error
    if value.get('ArrayInnerProp') is not None:
        raise Error('Legacy SetArray layout requires explicit version support')
    target, schema = variable(value.get('AssigningProperty', {}), package, owner, reads, outputs, depth)
    elements = value.get('Elements')
    if schema['type'] != 'ArrayProperty' or not isinstance(elements, list) or len(elements) > 100000:
        raise Error('Unresolved or oversized original SetArray')
    return {'op': 'array_literal', 'target': target, 'element': schema['element'],
            'elements': [expression(item, reads, outputs, depth+1, package, owner) for item in elements]}


def dirty_call(value, package, owner):
    from blueprint_migration import kind, field, BlueprintTranslationError as Error
    if import_path(package, value.get('StackNode')) != ('/Script/Engine', 'NetPushModelHelpers', 'MarkPropertyDirtyFromRepIndex'):
        return None
    args = value.get('Parameters', [])
    if (len(args) != 3 or kind(args[0]) != 'EX_Self' or kind(args[1]) != 'EX_IntConst'
            or type(args[1].get('Value')) is not int or args[1]['Value'] < 0 or kind(args[2]) != 'EX_NameConst'):
        raise Error('Unsupported original dirty-property call')
    name = field({'New': {'Path': [args[2].get('Value')]}})
    prop = next((p for p in (package.export(owner) or {}).get('LoadedProperties', []) if p.get('Name') == name), {})
    if 'CPF_Net' not in str(prop.get('PropertyFlags')): raise Error('Dirty source property is not declared replicated')
    # Serialized FProperty.RepIndex is not the runtime ClassReps index. Retain
    # the actual source call witness; track local changes without claiming RPC.
    return {'op': 'mark_dirty', 'field': prop['Name'], 'source_rep_index': args[1]['Value']}


def delegate_signature(package, owner, name):
    from blueprint_migration import BlueprintTranslationError as Error
    prop = next((p for p in (package.export(owner) or {}).get('LoadedProperties', []) if p.get('Name') == name), {})
    signature = package.export(prop.get('SignatureFunction'))
    if (prop.get('SerializedType') != 'MulticastInlineDelegateProperty' or not signature or signature.get('OuterIndex') != owner
            or not str(signature.get('ObjectName', '')).endswith('__DelegateSignature')):
        raise Error('Unresolved original multicast signature')
    parameters = []
    for p in signature.get('LoadedProperties', []):
        flags = str(p.get('PropertyFlags'))
        if 'CPF_Parm' not in flags: continue
        schema = property_schema(package, p)
        if not schema or 'CPF_ReturnParm' in flags or 'CPF_OutParm' in flags and 'CPF_ConstParm' not in flags:
            raise Error('Unsupported original multicast parameter')
        parameters.append({'name': p['Name'], 'schema': schema})
    return {'export_index': prop['SignatureFunction'], 'parameters': parameters}


def multicast(value, package, owner, reads, outputs, depth):
    from blueprint_migration import kind, field, expression, BlueprintTranslationError as Error
    target = value.get('Delegate', {})
    if kind(target) != 'EX_InstanceVariable' or target.get('Variable', {}).get('New', {}).get('ResolvedOwner') != owner:
        raise Error('Cross-object multicast requires an object adapter')
    name = field(target.get('Variable')); signature = delegate_signature(package, owner, name)
    args = value.get('Parameters', [])
    if value.get('StackNode') != signature['export_index'] or len(args) != len(signature['parameters']):
        raise Error('Original multicast signature differs')
    return {'op': 'broadcast', 'delegate': name, **signature,
            'args': [expression(arg, reads, outputs, depth+1, package, owner) for arg in args]}
