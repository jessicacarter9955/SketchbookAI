"""Translate cached Kismet state, control flow and source-class function calls."""
import math
import re
from collections import Counter
from pathlib import Path

from core import atomic_json, digest, file_hash, read_json
from umg_migration import Package, _tool, _asset_document
from blueprint_events import reachable_event
from blueprint_types import source_structs, property_schema, import_path
from blueprint_values import asset_reference, native_schema, source_tables


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


def property_type(prop, package=None):
    result = prop.get('SerializedType')
    if result == 'ObjectProperty' and package:
        schema = property_schema(package, prop)
        from blueprint_values import STATIC_ASSET_CLASSES
        if schema and (schema.get('class', [None, None])[0] == '/Script/Engine'
                       and schema['class'][1] in STATIC_ASSET_CLASSES or schema.get('reference_kind') == 'runtime_actor'): return result
    if result == 'EnumProperty':
        result = prop.get('UnderlyingProp', {}).get('SerializedType')
    if result not in ('BoolProperty', 'ByteProperty', 'IntProperty', 'FloatProperty',
                      'DoubleProperty', 'StrProperty', 'NameProperty', 'StructProperty', 'ArrayProperty'):
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
                   'Lerp': (3, 'DoubleDouble'), 'FMin': (2, 'DoubleDouble'), 'FMax': (2, 'DoubleDouble'),
                   'InRange_FloatFloat': (5, 'double_range'),
                   'Min': (2, 'IntInt'), 'Max': (2, 'IntInt'),
                   'Conv_IntToDouble': (1, 'IntInt'), 'SelectInt': (3, 'int_select'), 'SelectFloat': (3, 'double_select'),
                   'EqualEqual_BoolBool': (2, 'bool'), 'NotEqual_BoolBool': (2, 'bool'),
                   'EqualEqual_NameName': (2, 'name'), 'NotEqual_NameName': (2, 'name'),
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
        if 'CPF_OutParm' in str(prop.get('PropertyFlags')) and 'CPF_ConstParm' not in str(prop.get('PropertyFlags')):
            if kind(arg) not in ('EX_LocalVariable', 'EX_LocalOutVariable', 'EX_InstanceVariable'):
                raise BlueprintTranslationError('Unsupported output argument target')
            target = expression(arg, reads, outputs, depth+1, package, owner)
            bindings.append({'mode': 'output', 'parameter': name, 'target': target})
        else:
            bindings.append({'mode': 'input', 'parameter': name, 'value': expression(arg, reads, outputs, depth+1, package, owner)})
    result = {'op': 'call', 'function': callee['ObjectName'], 'export_index': ref, 'bindings': bindings}
    if callee['ObjectName'].startswith('ExecuteUbergraph_'):
        if (len(parameters) != 1 or parameters[0].get('Name') != 'EntryPoint'
                or property_type(parameters[0], package) != 'IntProperty' or bindings[0]['mode'] != 'input'
                or bindings[0]['value'].get('op') != 'constant'
                or type(bindings[0]['value'].get('value')) is not int):
            raise BlueprintTranslationError('Event graph requires an original constant EntryPoint')
        result['entry_offset'] = bindings[0]['value']['value']
        result['function'] += '@' + str(result['entry_offset'])
    return result


def expression(value, reads, outputs, depth=0, package=None, owner=None):
    if not isinstance(value, dict) or depth > 48:
        raise BlueprintTranslationError('Invalid or deeply nested Kismet expression')
    token = kind(value)
    if token == 'EX_ObjectConst' and package:
        from blueprint_values import asset_constant
        try: return asset_constant(package, value.get('Value'))
        except ValueError as error: raise BlueprintTranslationError(str(error))
    if token == 'EX_SetArray' and package:
        from blueprint_effects import array_literal
        return array_literal(value, package, owner, reads, outputs, depth)
    if token == 'EX_Context' and package:
        obj, call = value.get('ObjectExpression', {}), value.get('ContextExpression', {})
        if (kind(obj) == 'EX_ObjectConst' and import_path(package, obj.get('Value')) == ('/Script/Engine', 'Default__DataTableFunctionLibrary')
                and kind(call) == 'EX_FinalFunction'
                and import_path(package, call.get('StackNode')) == ('/Script/Engine', 'DataTableFunctionLibrary', 'GetDataTableRowFromName')):
            args = call.get('Parameters', [])
            if len(args) != 3 or kind(args[0]) != 'EX_InstanceVariable' or kind(args[2]) not in ('EX_LocalVariable', 'EX_LocalOutVariable'):
                raise BlueprintTranslationError('Unsupported original table lookup arguments')
            table_name = field(args[0].get('Variable')); target_name = field(args[2].get('Variable'))
            cls = package.export(owner); function = getattr(package, '_active_function', {})
            prop = next((p for p in (cls or {}).get('LoadedProperties', []) if p.get('Name') == table_name), {})
            target_prop = next((p for p in function.get('LoadedProperties', []) if p.get('Name') == target_name), {})
            schema = property_schema(package, target_prop)
            try: default = asset_reference(package, getattr(package, 'source_defaults', {}).get(table_name), ('/Script/Engine', 'DataTable'))
            except ValueError as error: raise BlueprintTranslationError(str(error))
            table = getattr(package, 'source_tables', {}).get((default or {}).get('asset'))
            if (import_path(package, prop.get('PropertyClass')) != ('/Script/Engine', 'DataTable')
                    or args[0].get('Variable', {}).get('New', {}).get('ResolvedOwner') != owner
                    or package.export(args[2].get('Variable', {}).get('New', {}).get('ResolvedOwner')) is not function
                    or not schema or not table or table['schema'] != schema
                    or value.get('Offset') != memory_size(call, package=package)):
                raise BlueprintTranslationError('Unresolved original table, row type, owner or context offset')
            return {'op': 'table_get', 'table': expression(args[0], reads, outputs, depth+1, package, owner),
                    'row': expression(args[1], reads, outputs, depth+1, package, owner),
                    'target': expression(args[2], reads, outputs, depth+1, package, owner), 'row_source': schema['source']}
        from blueprint_effects import array_context
        adapted = array_context(value, package, owner, reads, outputs, depth)
        if adapted is not None: return adapted
        from blueprint_objects import native_actor_context
        adapted = native_actor_context(value, package, owner, reads, outputs, depth)
        if adapted is not None: return adapted
        raise BlueprintTranslationError('Unsupported opcode: EX_Context')
    if token in ('EX_LocalVirtualFunction', 'EX_LocalFinalFunction', 'EX_FinalFunction'):
        if token == 'EX_FinalFunction' and package:
            from blueprint_objects import native_owner
            adapted = native_owner(value, package, owner)
            if adapted is not None: return adapted
        return local_call(value, package, owner, reads, outputs, depth)
    if token == 'EX_StructMemberContext':
        return {'op': 'member', 'field': field(value.get('StructMemberExpression')),
                'value': expression(value.get('StructExpression'), reads, outputs, depth+1, package, owner)}
    if token == 'EX_StructConst':
        schema = getattr(package, 'source_structs', {}).get(import_path(package, value.get('Struct'))) if package else None
        members, values = (schema or {}).get('member_order'), value.get('Value')
        if (not schema or not members or not isinstance(values, list) or len(values) != len(members)
                or type(value.get('StructSize')) is not int or value['StructSize'] <= 0):
            raise BlueprintTranslationError('Unresolved original struct constant layout')
        return {'op': 'struct_literal', 'schema': schema, 'source_struct_size': value['StructSize'],
                'fields': {name: expression(arg, reads, outputs, depth+1, package, owner) for name, arg in zip(members, values)}}
    if token == 'EX_CallMulticastDelegate' and package:
        from blueprint_effects import multicast
        return multicast(value, package, owner, reads, outputs, depth)
    if token == 'EX_CallMath':
        if package:
            from blueprint_effects import dirty_call
            adapted = dirty_call(value, package, owner)
            if adapted is not None: return adapted
        name = math_call(package, value.get('StackNode'))
        args = value.get('Parameters')
        if not isinstance(args, list) or len(args) != MATH_CALLS[name][0]:
            raise BlueprintTranslationError('Invalid native math parameter count')
        if name in ('EqualEqual_NameName', 'NotEqual_NameName'):
            for arg in args:
                if kind(arg) == 'EX_NameConst' and (not isinstance(arg.get('Value'), str)
                        or not arg['Value'] or not re.fullmatch(r'[\x01-\x7f]+', arg['Value'])):
                    raise BlueprintTranslationError('Unsupported non-ASCII FName comparison constant')
        return {'op': 'math', 'name': name, 'args': [expression(arg, reads, outputs, depth+1, package, owner) for arg in args]}
    scopes = {'EX_InstanceVariable': 'self', 'EX_LocalVariable': 'local', 'EX_LocalOutVariable': 'local'}
    if token in scopes:
        name = field(value.get('Variable'))
        reference = value.get('Variable', {}).get('New', {}).get('ResolvedOwner')
        frame = package.export(reference) if package else None
        if token != 'EX_InstanceVariable' and frame and str(frame.get('ObjectName', '')).startswith('ExecuteUbergraph_'):
            if frame.get('OuterIndex') != owner:
                raise BlueprintTranslationError('Persistent read belongs to a different source class')
            return {'op': 'get', 'scope': 'persistent', 'frame': reference, 'field': name}
        if token == 'EX_InstanceVariable': reads.add(name)
        if token == 'EX_LocalOutVariable': outputs.add(name)
        return {'op': 'get', 'scope': scopes[token], 'field': name}
    if token == 'EX_TextConst':
        text = value.get('Value', {}); literal = text.get('TextLiteralType')
        if literal == 'Empty': result = {'history': 'empty', 'text': '', 'flags': 0}
        elif literal == 'LocalizedText':
            parts = [text.get(key, {}) for key in ('LocalizedSource', 'LocalizedKey', 'LocalizedNamespace')]
            if any(kind(part) not in ('EX_StringConst', 'EX_UnicodeStringConst') or not isinstance(part.get('Value'), str) for part in parts):
                raise BlueprintTranslationError('Localized FText requires original constant strings')
            for part in parts: memory_size(part, package=package)
            result = {'history': 'base', 'text': parts[0]['Value'], 'key': parts[1]['Value'], 'namespace': parts[2]['Value'], 'flags': 0}
            if not result['text']: result = {'history': 'empty', 'text': '', 'flags': 0}
        else: raise BlueprintTranslationError('Unsupported original text literal: ' + str(literal))
        return {'op': 'typed_literal', 'schema': property_schema(package, {'SerializedType': 'TextProperty'}), 'value': result}
    if token in ('EX_VectorConst', 'EX_RotationConst'):
        memory_size(value, package=package)
        schema = native_schema(('/Script/CoreUObject', 'Vector' if token == 'EX_VectorConst' else 'Rotator'))
        try:
            if any(isinstance(value['Value'][key], bool) for key in schema['fields']): raise ValueError('Invalid native number')
            literal = {key: float(value['Value'][key]) for key in schema['fields']}
        except (KeyError, TypeError, ValueError): raise BlueprintTranslationError('Invalid source native struct constant')
        if not all(math.isfinite(v) for v in literal.values()): raise BlueprintTranslationError('Non-finite source native struct constant')
        return {'op': 'typed_literal', 'schema': schema, 'value': literal}
    if token in ('EX_True', 'EX_False', 'EX_IntZero', 'EX_IntOne', 'EX_Nothing', 'EX_NoObject'):
        return {'op': 'constant', 'value': {'EX_True': True, 'EX_False': False,
                'EX_IntZero': 0, 'EX_IntOne': 1, 'EX_Nothing': None, 'EX_NoObject': None}[token]}
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


def memory_size(value, depth=0, package=None):
    """Kismet VM offsets (64-bit pointers), not serialized package byte sizes.

    Layouts follow UAssetAPI expression Visit implementations. Unknown layouts
    are rejected so no jump is ever guessed from on-disk offsets.
    """
    if not isinstance(value, dict) or depth > 48:
        raise BlueprintTranslationError('Invalid bytecode size expression')
    token = kind(value)
    size = lambda child: memory_size(child, depth+1, package)
    if token == 'EX_SetArray':
        if value.get('ArrayInnerProp') is not None or not isinstance(value.get('Elements'), list):
            raise BlueprintTranslationError('Unverified SetArray memory layout')
        return 2 + size(value.get('AssigningProperty')) + sum(size(child) for child in value['Elements'])
    if token in ('EX_Tracepoint', 'EX_WireTracepoint', 'EX_Nothing', 'EX_EndOfScript',
                 'EX_True', 'EX_False', 'EX_IntZero', 'EX_IntOne', 'EX_Self',
                 'EX_NoObject', 'EX_PopExecutionFlow'): return 1
    if token in ('EX_InstanceVariable', 'EX_LocalVariable', 'EX_LocalOutVariable'): return 9
    if token == 'EX_StructMemberContext': return 9 + size(value.get('StructExpression'))
    if token == 'EX_LetValueOnPersistentFrame': return 9 + size(value.get('AssignmentExpression'))
    if token == 'EX_PushExecutionFlow': return 5
    if token == 'EX_ComputedJump': return 1 + size(value.get('CodeOffsetExpression'))
    if token == 'EX_PopExecutionFlowIfNot': return 1 + size(value.get('BooleanExpression'))
    if token == 'EX_Context': return 13 + size(value.get('ObjectExpression')) + size(value.get('ContextExpression'))
    if token in ('EX_DynamicCast', 'EX_ObjToInterfaceCast'): return 9 + size(value.get('Target'))
    if token == 'EX_PrimitiveCast':
        if value.get('ConversionType') == 'ObjectToInterface':
            raise BlueprintTranslationError('ObjectToInterface cast layout requires explicit version support')
        return 2 + size(value.get('Target'))
    if token == 'EX_InterfaceContext': return 1 + size(value.get('InterfaceValue'))
    if token == 'EX_ObjectConst': return 9
    if token == 'EX_SkipOffsetConst': return 5
    if token == 'EX_BitFieldConst': return 10
    if token in ('EX_VectorConst', 'EX_RotationConst'):
        # The parsed UE5 enum is checked explicitly; older/unknown package
        # versions must not silently acquire the LWC 24-byte layout.
        if not package or package.document.get('ObjectVersionUE5') != 'IMPORT_TYPE_HIERARCHIES':
            raise BlueprintTranslationError('Unverified vector constant version')
        return 25
    if token == 'EX_StructConst':
        if not isinstance(value.get('Value'), list): raise BlueprintTranslationError('Invalid struct layout')
        return 14 + sum(size(child) for child in value['Value'])
    if token == 'EX_BindDelegate': return 13 + size(value.get('Delegate')) + size(value.get('ObjectTerm'))
    if token == 'EX_AddMulticastDelegate': return 1 + size(value.get('Delegate')) + size(value.get('DelegateToAdd'))
    if token == 'EX_TextConst':
        text = value.get('Value', {}); literal = text.get('TextLiteralType')
        fields = {'Empty': (), 'LocalizedText': ('LocalizedSource', 'LocalizedKey', 'LocalizedNamespace'),
                  'InvariantText': ('InvariantLiteralString',), 'LiteralString': ('LiteralString',),
                  'StringTableEntry': ('StringTableId', 'StringTableKey')}.get(literal)
        if fields is None: raise BlueprintTranslationError('Unknown text literal layout')
        return 2 + (8 if literal == 'StringTableEntry' else 0) + sum(size(text.get(key)) for key in fields)
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
        return (9 if token == 'EX_Let' else 1) + size(left) + size(right)
    if token == 'EX_Return': return 1 + size(value.get('ReturnExpression'))
    if token == 'EX_Jump': return 5
    if token == 'EX_JumpIfNot': return 5 + size(value.get('BooleanExpression'))
    if token in ('EX_CallMath', 'EX_LocalFinalFunction', 'EX_FinalFunction', 'EX_LocalVirtualFunction', 'EX_VirtualFunction', 'EX_CallMulticastDelegate'):
        args = value.get('Parameters')
        if not isinstance(args, list): raise BlueprintTranslationError('Invalid math layout')
        return (14 if token in ('EX_LocalVirtualFunction', 'EX_VirtualFunction') else 10) + sum(size(arg) for arg in args) + (size(value.get('Delegate')) if token == 'EX_CallMulticastDelegate' else 0)
    raise BlueprintTranslationError(f'Unsupported bytecode memory layout: {token}')


def translate_function(export, package=None, entry_offset=None):
    if package: package._active_function = export
    bytecode = export.get('ScriptBytecode')
    if not isinstance(bytecode, list) or not bytecode or len(bytecode) > 100000:
        raise BlueprintTranslationError('Parsed source bytecode is required')
    reads, outputs, writes, steps = set(), set(), set(), []
    branching = entry_offset is not None or any(kind(instruction) in ('EX_Jump', 'EX_JumpIfNot', 'EX_PushExecutionFlow', 'EX_PopExecutionFlow', 'EX_PopExecutionFlowIfNot') for instruction in bytecode)
    offsets, boundaries, offset = {}, {}, 0
    reachable, prologue = None, None
    if entry_offset is not None:
        offsets, boundaries, offset, reachable, prologue = reachable_event(export, entry_offset, package, kind, memory_size, BlueprintTranslationError)
    elif branching:
        for index, instruction in enumerate(bytecode):
            offsets[index] = offset; boundaries[offset] = index
            offset += memory_size(instruction, package=package)
        if not isinstance(export.get('ScriptBytecodeSize'), int) or export['ScriptBytecodeSize'] != offset:
            raise BlueprintTranslationError('Computed Kismet memory size differs from ScriptBytecodeSize')
    returned = ended = False
    for index, instruction in enumerate(bytecode):
        token = kind(instruction)
        if reachable is not None and index not in reachable:
            continue
        if ended: raise BlueprintTranslationError('Bytecode after EndOfScript')
        if token in ('EX_Tracepoint', 'EX_WireTracepoint', 'EX_Nothing'):
            if branching: steps.append({'op': 'nop', 'source_index': index})
            continue
        if token == 'EX_EndOfScript':
            ended = True
            if branching: steps.append({'op': 'end', 'source_index': index})
            continue
        if returned and not branching: raise BlueprintTranslationError('Instructions after return require control-flow translation')
        if token == 'EX_ComputedJump' and index == prologue:
            steps.append({'op': 'jump', 'target': boundaries[entry_offset], 'target_offset': entry_offset, 'source_index': index})
            continue
        if token in ('EX_PushExecutionFlow', 'EX_PopExecutionFlow', 'EX_PopExecutionFlowIfNot'):
            step = {'op': 'push_flow' if token == 'EX_PushExecutionFlow' else 'pop_flow', 'source_index': index}
            if token == 'EX_PushExecutionFlow':
                address = instruction.get('PushingAddress')
                if type(address) is not int or address not in boundaries: raise BlueprintTranslationError('Invalid flow stack target')
                step.update(target=boundaries[address], target_offset=address)
            elif token == 'EX_PopExecutionFlowIfNot':
                step['value'] = expression(instruction.get('BooleanExpression'), reads, outputs, package=package, owner=export.get('OuterIndex'))
            steps.append(step)
            continue
        if token in ('EX_Jump', 'EX_JumpIfNot'):
            target = instruction.get('CodeOffset')
            if not isinstance(target, int) or isinstance(target, bool) or target not in boundaries:
                raise BlueprintTranslationError('Jump target is not a Kismet instruction boundary')
            entry = {'op': 'jump' if token == 'EX_Jump' else 'branch', 'target': boundaries[target],
                     'target_offset': target, 'source_index': index}
            if token == 'EX_JumpIfNot': entry['value'] = expression(instruction.get('BooleanExpression'), reads, outputs, package=package, owner=export.get('OuterIndex'))
            steps.append(entry)
            continue
        if token == 'EX_LetValueOnPersistentFrame':
            pointer = instruction.get('DestinationProperty', {})
            frame_index = pointer.get('New', {}).get('ResolvedOwner')
            frame = package.export(frame_index) if package else None
            if (not frame or not str(frame.get('ObjectName', '')).startswith('ExecuteUbergraph_')
                    or frame.get('OuterIndex') != export.get('OuterIndex')):
                raise BlueprintTranslationError('Persistent destination belongs to an unresolved source frame')
            steps.append({'op': 'set', 'scope': 'persistent', 'frame': frame_index, 'field': field(pointer),
                          'value': expression(instruction.get('AssignmentExpression'), reads, outputs, package=package, owner=export.get('OuterIndex')), 'source_index': index})
        elif token in ('EX_Let', 'EX_LetBool', 'EX_LetObj'):
            variable = instruction.get('Variable' if token == 'EX_Let' else 'VariableExpression')
            if isinstance(variable, dict) and kind(variable) == 'EX_StructMemberContext':
                pointer = variable.get('StructMemberExpression', {})
                schema = getattr(package, 'source_structs', {}).get(import_path(package, pointer.get('New', {}).get('ResolvedOwner'))) if package else None
                name = field(pointer)
                if not schema or name not in schema['fields']: raise BlueprintTranslationError('Unsupported assignment target: unresolved source struct')
                target = expression(variable.get('StructExpression'), reads, outputs, package=package, owner=export.get('OuterIndex'))
                if target.get('op') != 'get' or target.get('scope') not in ('local', 'self'):
                    raise BlueprintTranslationError('Unsupported nested/persistent struct assignment target')
                root_pointer = variable.get('StructExpression', {}).get('Variable', {}).get('New', {})
                root_owner = package.export(root_pointer.get('ResolvedOwner'))
                root_prop = next((p for p in (root_owner or {}).get('LoadedProperties', []) if p.get('Name') == target['field']), {})
                if root_owner is not (export if target['scope'] == 'local' else package.export(export.get('OuterIndex'))) or property_schema(package, root_prop) != schema:
                    raise BlueprintTranslationError('Struct assignment target type differs from source member owner')
                if target['scope'] == 'self': writes.add(target['field'])
                steps.append({'op': 'set_member', 'target': target, 'field': name, 'member_type': schema['fields'][name]['type'],
                              'value': expression(instruction.get('Expression' if token == 'EX_Let' else 'AssignmentExpression'), reads, outputs,
                                                  package=package, owner=export.get('OuterIndex')), 'source_index': index})
                continue
            if not isinstance(variable, dict) or kind(variable) not in ('EX_LocalVariable', 'EX_LocalOutVariable', 'EX_InstanceVariable'):
                raise BlueprintTranslationError('Unsupported assignment target')
            target = expression(variable, reads, outputs, package=package, owner=export.get('OuterIndex'))
            if target['scope'] == 'self': writes.add(target['field'])
            source = instruction.get('Expression' if token == 'EX_Let' else 'AssignmentExpression')
            steps.append({'op': 'set', 'field': target['field'], 'scope': target['scope'], 'value': expression(source, reads, outputs, package=package, owner=export.get('OuterIndex')),
                          'boolean': token == 'EX_LetBool', 'source_index': index})
            if target.get('frame') is not None: steps[-1]['frame'] = target['frame']
        elif token == 'EX_Return':
            steps.append({'op': 'return', 'value': expression(instruction.get('ReturnExpression'), reads, outputs, package=package, owner=export.get('OuterIndex')),
                          'source_index': index})
            returned = True
        elif token in ('EX_LocalVirtualFunction', 'EX_LocalFinalFunction', 'EX_FinalFunction', 'EX_CallMath', 'EX_Context', 'EX_CallMulticastDelegate', 'EX_SetArray'):
            steps.append({'op': 'evaluate', 'value': expression(instruction, reads, outputs, package=package, owner=export.get('OuterIndex')),
                          'source_index': index})
        else:
            raise BlueprintTranslationError(f'Unsupported opcode: {token}')
    # Mark mutations visible through nested EX_Context/array library calls.
    # This is used by source-backed reports and transitive call-state checks.
    def record_array_writes(node):
        if isinstance(node, dict):
            if node.get('op') in ('array_set', 'array_add', 'array_literal'):
                target = node.get('target', {})
                if target.get('scope') == 'self': writes.add(target['field'])
            for child in node.values(): record_array_writes(child)
        elif isinstance(node, list):
            for child in node: record_array_writes(child)
    record_array_writes(steps)
    if reachable is not None:
        ended = kind(bytecode[-1]) == 'EX_EndOfScript'
    if not returned or not ended: raise BlueprintTranslationError('Complete return and EndOfScript are required')
    if branching:
        for step in steps: step['source_offset'] = offsets[step['source_index']]
    if reachable is not None:
        compact = {step['source_index']: index for index, step in enumerate(steps)}
        for step in steps:
            if 'target' in step: step['target'] = compact[step['target']]
    return {'schema_version': 1, 'name': export['ObjectName'] + ('@' + str(entry_offset) if entry_offset is not None else ''), 'status': 'translated_control_flow' if branching else 'translated_straight_line',
            'internal_event_entry': entry_offset is not None, 'event_entry_offset': entry_offset,
            'memory_size_verified': offset if branching else None,
            'source_bytecode_sha256': digest(bytecode), 'self_reads': sorted(reads),
            'source_owner_index': export.get('OuterIndex'),
            'self_writes': sorted(writes),
            'output_fields': sorted(outputs), 'steps': steps}


def translate_package(package, structs=None, tables=None):
    functions, blocked, declarations, event_blocked = {}, [], [], []
    package._event_layouts = {}
    package.source_structs = structs or {}
    package.source_tables = tables or {}
    class_properties = {prop['Name']: prop for export in package.exports
                        if str(export.get('ObjectName', '')).endswith('_C')
                        for prop in export.get('LoadedProperties', []) if prop.get('Name')}
    defaults = {}
    for export in package.exports:
        if str(export.get('ObjectName', '')).startswith('Default__'):
            defaults.update(package.props(export))
    package.source_defaults = defaults
    pending = [(index, export, None) for index, export in enumerate(package.exports, 1)]
    requested = set()
    for index, export, entry_offset in pending:
        if not export.get('ScriptBytecode'): continue
        if str(export.get('ObjectName', '')).endswith('__DelegateSignature'):
            declarations.append(export['ObjectName'])
            continue
        try:
            program = translate_function(export, package, entry_offset)
            const_inputs = {prop['Name'] for prop in export.get('LoadedProperties', [])
                            if 'CPF_Parm' in str(prop.get('PropertyFlags')) and 'CPF_ConstParm' in str(prop.get('PropertyFlags'))}
            program['output_fields'] = [name for name in program['output_fields'] if name not in const_inputs]
            for step in program['steps']:
                if (step['op'] == 'set' and step.get('scope') == 'local' and step['field'] in const_inputs
                        or step['op'] == 'set_member' and step['target'].get('scope') == 'local' and step['target']['field'] in const_inputs):
                    raise BlueprintTranslationError('Assignment to original const input')
            used_locals = set(program['output_fields'])
            persistent, persistent_schemas = {}, {}
            for step in program['steps']:
                if step['op'] == 'set' and step.get('scope') == 'local': used_locals.add(step['field'])
                def local_reads(value):
                    if isinstance(value, dict):
                        target = value.get('target', {})
                        if (value.get('op') in ('array_get', 'array_mutate', 'array_set', 'array_add', 'array_literal', 'table_get', 'set_member') and target.get('scope') == 'local'
                                and target.get('field') in const_inputs):
                            raise BlueprintTranslationError('Write through original const input')
                        if value.get('op') == 'array_mutate' and target.get('scope') == 'self':
                            program['self_writes'] = sorted(set(program['self_writes']) | {target['field']})
                        if value.get('op') == 'call' and any(binding.get('mode') == 'output'
                                and binding.get('target', {}).get('scope') == 'local'
                                and binding['target'].get('field') in const_inputs for binding in value.get('bindings', [])):
                            raise BlueprintTranslationError('Output binding writes original const input')
                        if value.get('scope') == 'local': used_locals.add(value['field'])
                        if value.get('scope') == 'persistent':
                            frame_index, field_name = value['frame'], value['field']
                            frame = package.export(frame_index)
                            if not frame or frame.get('OuterIndex') != export.get('OuterIndex'):
                                raise BlueprintTranslationError('Persistent property belongs to another source class')
                            props = [p for p in frame.get('LoadedProperties', []) if p.get('Name') == field_name]
                            if len(props) != 1: raise BlueprintTranslationError('Unresolved persistent source property: ' + field_name)
                            type_name = property_type(props[0], package)
                            persistent.setdefault(str(frame_index), {})[field_name] = type_name
                            if type_name in ('StructProperty', 'ArrayProperty', 'ObjectProperty'):
                                schema = property_schema(package, props[0])
                                if not schema: raise BlueprintTranslationError('Unresolved persistent source schema: ' + field_name)
                                persistent_schemas.setdefault(str(frame_index), {})[field_name] = schema
                        if value.get('op') == 'call' and 'entry_offset' in value:
                            request = (value['export_index'], value['entry_offset'])
                            if request not in requested:
                                requested.add(request)
                                pending.append((request[0], package.export(request[0]), request[1]))
                        for child in value.values(): local_reads(child)
                    elif isinstance(value, list):
                        for child in value: local_reads(child)
                local_reads(step)
            program['field_types'] = {
                'self': {name: property_type(class_properties[name], package) for name in program['self_reads'] if name in class_properties},
                'local': {prop['Name']: property_type(prop, package) for prop in export.get('LoadedProperties', []) if prop.get('Name') in used_locals}}
            program['source_property_types'] = {prop['Name']: prop for prop in export.get('LoadedProperties', []) if prop.get('Name') in used_locals}
            program['schemas'] = {'local': {name: schema for name, prop in program['source_property_types'].items()
                                           if (schema := property_schema(package, prop)) and schema['type'] in ('StructProperty', 'ArrayProperty', 'ObjectProperty')},
                                  'self': {name: schema for name in program['self_reads'] if name in class_properties
                                           and (schema := property_schema(package, class_properties[name])) and schema['type'] in ('StructProperty', 'ArrayProperty', 'ObjectProperty')}}
            for scope, types in program['field_types'].items():
                if any(type_name in ('ArrayProperty', 'StructProperty') and name not in program['schemas'][scope] for name, type_name in types.items()):
                    raise BlueprintTranslationError('Unresolved source array or struct schema')
            program['persistent_types'] = persistent
            program['persistent_schemas'] = persistent_schemas
            program['input_fields'] = [prop['Name'] for prop in export.get('LoadedProperties', [])
                                       if prop.get('Name') in used_locals and 'CPF_Parm' in str(prop.get('PropertyFlags'))
                                       and ('CPF_OutParm' not in str(prop.get('PropertyFlags')) or prop['Name'] in const_inputs
                                            or 'CPF_ReferenceParm' in str(prop.get('PropertyFlags')))
                                       and 'CPF_ReturnParm' not in str(prop.get('PropertyFlags'))]
            program['parameters'] = [{'name': prop['Name'], 'schema': property_schema(package, prop)}
                                     for prop in export.get('LoadedProperties', []) if 'CPF_Parm' in str(prop.get('PropertyFlags'))
                                     and 'CPF_ReturnParm' not in str(prop.get('PropertyFlags'))
                                     and ('CPF_OutParm' not in str(prop.get('PropertyFlags')) or prop['Name'] in const_inputs)]
            program['source_defaults'] = {name: defaults[name] for name in program['self_reads'] if name in defaults}
            program['source_export_index'] = index
            if program['name'] in functions: raise BlueprintTranslationError('Duplicate function name')
            functions[program['name']] = program
        except BlueprintTranslationError as error:
            row = {'function': export.get('ObjectName'), 'source_export_index': index, 'reason': str(error)}
            if entry_offset is not None:
                row['entry_offset'] = entry_offset; event_blocked.append(row)
            else: blocked.append(row)
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
                row = {'function': name, 'source_export_index': program['source_export_index'],
                       'reason': 'Untranslated function dependency: ' + missing}
                (event_blocked if program.get('internal_event_entry') else blocked).append(row)
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
            program['field_types']['self'] = {name: property_type(class_properties[name], package) for name in reads | writes if name in class_properties}
            program['source_defaults'] = {name: defaults[name] for name in reads | writes if name in defaults}
        if not changed: break
    default_state = {}
    for name, prop in class_properties.items():
        try: type_name = property_type(prop, package)
        except BlueprintTranslationError: continue
        schema = property_schema(package, prop)
        if type_name == 'ObjectProperty':
            if schema.get('reference_kind') == 'runtime_actor':
                if type(defaults.get(name, 0)) is not int or defaults.get(name, 0) != 0:
                    raise BlueprintTranslationError('Source actor defaults require an original world-object binding: ' + name)
                default_state[name] = None
            else: default_state[name] = asset_reference(package, defaults.get(name, 0), schema['class'])
        elif schema and schema['type'] == 'StructProperty' and (name not in defaults or isinstance(defaults[name], dict)):
            default_state[name] = {**schema['default'], **defaults.get(name, {})}
        elif name in defaults: default_state[name] = defaults[name]
        elif schema and schema['type'] == 'ArrayProperty': default_state[name] = []
        elif type_name in ('BoolProperty', 'ByteProperty', 'IntProperty', 'FloatProperty', 'DoubleProperty', 'StrProperty', 'NameProperty'):
            default_state[name] = {'BoolProperty': False, 'StrProperty': '', 'NameProperty': 'None'}.get(type_name, 0)
    no_ops = sum(not program.get('internal_event_entry') and not program['self_reads'] and not program['output_fields'] and not program['self_writes']
                 and all(step['op'] == 'return' and step['value'] == {'op': 'constant', 'value': None}
                         for step in program['steps']) for program in functions.values())
    events = {name: program for name, program in functions.items() if program.get('internal_event_entry')}
    for program in functions.values():
        program['source_defaults'] = {name: default_state[name] for name in program['self_reads'] if name in default_state}
    functions = {name: program for name, program in functions.items() if not program.get('internal_event_entry')}
    empty_events = sum(any('entry_offset' in call for call in calls(program['steps'])) and not program['self_writes']
                       and not program['output_fields'] for program in functions.values())
    counts = {'translated': len(functions), 'blocked': len(blocked), 'declarations': len(declarations), 'no_op_functions': no_ops}
    if events: counts.update(event_entries=len(events), empty_event_functions=empty_events)
    from blueprint_effects import delegate_signature
    signatures = {}
    for name, prop in class_properties.items():
        if prop.get('SerializedType') != 'MulticastInlineDelegateProperty': continue
        owners = [i for i, e in enumerate(package.exports, 1) if prop in e.get('LoadedProperties', [])]
        if len(owners) != 1: continue
        try: signatures[name] = delegate_signature(package, owners[0], name)
        except BlueprintTranslationError: continue
    from blueprint_objects import class_metadata
    return {'functions': functions, 'event_programs': events, 'event_blocked': event_blocked, 'delegate_signatures': signatures, 'class_metadata': class_metadata(package),
            'blocked': blocked, 'declarations': declarations, 'default_state': default_state,
            'counts': counts}


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
            source_type_packages = {a['package'] for a in registry['assets'] if a.get('class') in ('UserDefinedStruct', 'UserDefinedEnum', 'DataTable')}
            if (name not in candidates and name not in source_type_packages) or name not in assets:
                raise BlueprintTranslationError(f'Requested parser input is not an inventoried Blueprint, source type or table: {name}')
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
    type_documents, type_inputs = {}, {}
    for row in registry['assets']:
        name = row['package']
        if row.get('class') not in ('UserDefinedStruct', 'UserDefinedEnum') or name not in assets: continue
        asset = assets[name]; path = workspace / 'artifacts/uasset-json' / (asset['sha256'] + '.json')
        if not path.is_file(): continue
        source = (project.parent / asset['path']).resolve()
        if project.parent not in source.parents or file_hash(source) != asset['sha256']:
            raise BlueprintTranslationError('Source type changed since cached inspection: ' + name)
        type_inputs[name] = {'source_sha256': asset['sha256'], 'parsed_sha256': file_hash(path)}
        type_documents[name] = read_json(path)
    structs = source_structs(type_documents, BlueprintTranslationError)
    table_documents, table_inputs = {}, {}
    for row in registry['assets']:
        name = row['package']
        if row.get('class') != 'DataTable' or name not in assets: continue
        asset = assets[name]; path = workspace / 'artifacts/uasset-json' / (asset['sha256'] + '.json')
        if not path.is_file(): continue
        source = (project.parent / asset['path']).resolve()
        if project.parent not in source.parents or file_hash(source) != asset['sha256']:
            raise BlueprintTranslationError('Source table changed since cached inspection: ' + name)
        table_inputs[name] = {'source_sha256': asset['sha256'], 'parsed_sha256': file_hash(path)}
        table_documents[name] = read_json(path)
    tables, table_blocked = source_tables(table_documents, structs)
    controls_file = output / 'character-controls.json'
    repository = Path(__file__).resolve().parents[2]
    runtime_sources = {name: file_hash(repository / name) for name in (
        'src/editor/ue2three-blueprint.mjs', 'src/editor/ue2three-native-math.mjs',
        'src/editor/ue2three-objects.mjs', 'src/editor/ue2three-blueprint-runtime.mjs',
        'src/editor/Ue2ThreeGameplay.js', 'src/editor/ue2three-live-verification.mjs',
        'src/editor/ue2three-fixtures.mjs', 'src/editor/ue2three-source-verification.mjs',
        'tools/ue2three/blueprint-audit.mjs')}
    fingerprint = digest({'project': str(project), 'inputs': key_inputs, 'missing': missing, 'types': type_inputs, 'tables': table_inputs,
                          'runtime_sources': runtime_sources,
                          'controls': file_hash(controls_file) if controls_file.is_file() else None,
                          'implementation': file_hash(Path(__file__)),
                          'events_implementation': file_hash(Path(__file__).with_name('blueprint_events.py')),
                          'effects_implementation': file_hash(Path(__file__).with_name('blueprint_effects.py')),
                          'objects_implementation': file_hash(Path(__file__).with_name('blueprint_objects.py')),
                          'values_implementation': file_hash(Path(__file__).with_name('blueprint_values.py')),
                          'types_implementation': file_hash(Path(__file__).with_name('blueprint_types.py'))})
    report_file = output / 'blueprint-programs.json'
    try:
        prior = read_json(report_file)
        if prior.get('fingerprint') == fingerprint and prior.get('content_sha256') == digest({k: v for k, v in prior.items() if k != 'content_sha256'}):
            return prior
    except (OSError, ValueError): pass
    packages, source_packages, counts = {}, {}, Counter()
    for name, cache in cached:
        source_packages[name] = Package(read_json(cache))
        packages[name] = translate_package(source_packages[name], structs, tables)
        packages[name]['source'] = key_inputs[name]
        counts.update(packages[name]['counts'])
    guards, character_source = {}, None
    if controls_file.is_file():
        controls = read_json(controls_file)
        source = controls.get('sources', {}).get('character_blueprint', {})
        if controls.get('project') == str(project) and key_inputs.get(source.get('package'), {}).get('source_sha256') == source.get('sha256'):
            character_source = source
            cache_path = dict(cached).get(source['package'])
            guards = character_guards(controls, packages, Package(read_json(cache_path)))
    from blueprint_objects import actor_graph
    report = {'schema_version': 1, 'project': str(project), 'fingerprint': fingerprint,
              'runtime_sources': runtime_sources,
              'packages': packages, 'counts': dict(counts), 'missing_cached_packages': missing,
              'source_types': [{'package': name[0], 'object': name[1], **schema} for name, schema in structs.items()], 'type_sources': type_inputs,
              'tables': tables, 'table_sources': table_inputs, 'table_blocked': table_blocked,
              'character_guards': guards, 'character_metrics': character_metrics(guards, packages),
              'character_source': character_source,
              'actor_graph': actor_graph(source_packages, key_inputs),
              'limitations': ['Locals, instance state, comparisons, static jumps and same-source-class calls with out parameters execute.',
                             'Struct member reads, typed source-struct field writes/defaults, typed Array_Get copies and ASCII FName equality execute.',
                             'Cached typed DataTable row reads retain primitive/array/native-vector fields, FText identities and data-only asset references.',
                             'Asset references do not execute or convert their referenced assets. Other FText histories, unsupported identity characters and nested writes remain blocked.',
                             'Typed source struct constants and array Get/Length/IsValidIndex/Set/Remove/Clear/Add/Append execute; other array operations and Unicode FName comparisons remain blocked.',
                             'Original property-dirty witnesses and typed multicast emissions execute locally. Explicitly registered translated handlers run transactionally; original world/UI bindings and network replication are not migrated.',
                             'Original SCS component ownership can bind to a scene actor. GetOwner and ForceNetUpdate require explicit standalone actor bindings with no game/demo net drivers; other object methods and full lifecycle remain blocked.',
                             'Constant source event entries, flow stacks and per-instance persistent primitive fields execute on fully translated reachable paths.',
                             'Event callbacks with no source effects are counted separately; animation dispatch, native effects and complete game events are not implied.',
                             'Cross-object calls, derived-class virtual overrides, arbitrary dynamic jumps, latent actions and replication remain blocked.',
                             'Translated functions are not connected to the complete game runtime yet.']}
    report['content_sha256'] = digest(report)
    atomic_json(report_file, report)
    return report
