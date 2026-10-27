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
        from blueprint_values import STATIC_ASSET_MODULES
        identity = schema.get('class') if schema else None
        if schema and (identity and identity[1] in STATIC_ASSET_MODULES.get(identity[0], set())
                       or schema.get('reference_kind') in
                       ('runtime_actor', 'runtime_component', 'runtime_native_component',
                        'runtime_native_object', 'runtime_native_widget')): return result
    if result == 'EnumProperty':
        result = prop.get('UnderlyingProp', {}).get('SerializedType')
    if result not in ('BoolProperty', 'ByteProperty', 'IntProperty', 'Int64Property', 'FloatProperty',
                      'DoubleProperty', 'StrProperty', 'NameProperty', 'TextProperty', 'StructProperty', 'ArrayProperty'):
        raise BlueprintTranslationError(f'Unsupported source property type: {result}')
    return result


MATH_CALLS = {'BooleanAND': (2, 'bool'), 'BooleanOR': (2, 'bool'), 'BooleanXOR': (2, 'bool'), 'Not_PreBool': (1, 'bool')}
for _type in ('ByteByte', 'IntInt', 'DoubleDouble'):
    for _operation in ('EqualEqual', 'NotEqual', 'Greater', 'GreaterEqual', 'Less', 'LessEqual'):
        MATH_CALLS[_operation + '_' + _type] = (2, _type)
for _type in ('IntInt', 'DoubleDouble'):
    for _operation in ('Add', 'Subtract', 'Multiply'):
        MATH_CALLS[_operation + '_' + _type] = (2, _type)
MATH_CALLS.update({'Divide_DoubleDouble': (2, 'DoubleDouble'), 'Divide_IntInt': (2, 'IntInt'),
                   'Square': (1, 'DoubleDouble'), 'FFloor': (1, 'DoubleDouble'),
                   'Conv_BoolToDouble': (1, 'bool'),
                   'Multiply_LinearColorLinearColor': (2, 'LinearColor'),
                   'Lerp': (3, 'DoubleDouble'), 'FMin': (2, 'DoubleDouble'), 'FMax': (2, 'DoubleDouble'),
                   'InRange_FloatFloat': (5, 'double_range'),
                   'MakeVector': (3, 'vector'),
                   'Add_VectorVector': (2, 'VectorVector'),
                   'Subtract_VectorVector': (2, 'VectorVector'),
                   'Multiply_VectorVector': (2, 'VectorVector'),
                   'Conv_DoubleToVector': (1, 'DoubleVector'),
                   'MakeRotator': (3, 'rotator'),
                   'MakeTransform': (3, 'transform'),
                   'BreakVector': (4, 'break_vector'),
                   'BreakVector2D': (3, 'break_vector2d'),
                   'BreakRotator': (4, 'break_rotator'),
                   'BreakTransform': (4, 'break_transform'),
                   'Min': (2, 'IntInt'), 'Max': (2, 'IntInt'),
                   'Conv_IntToDouble': (1, 'IntInt'), 'SelectInt': (3, 'int_select'), 'SelectFloat': (3, 'double_select'),
                   'EqualEqual_BoolBool': (2, 'bool'), 'NotEqual_BoolBool': (2, 'bool'),
                   'EqualEqual_NameName': (2, 'name'), 'NotEqual_NameName': (2, 'name'),
                   'FClamp': (3, 'DoubleDouble'), 'Clamp': (3, 'IntInt'),
                   'Round': (1, 'DoubleDouble'),
                   'FInterpTo': (4, 'DoubleDouble'),
                   'Abs': (1, 'DoubleDouble'), 'VSize': (1, 'vector'), 'VSizeXY': (1, 'vector'),
                   'Conv_IntToInt64': (1, 'IntInt'),
                   'Vector_Distance': (2, 'VectorVector'),
                   'Vector_DistanceSquared': (2, 'VectorVector'),
                   'Conv_LinearColorToVector': (1, 'LinearColor')})

NATIVE_MATH_INPUT_TYPES = {
    'Divide_IntInt': ('IntProperty', 'IntProperty'),
    'MakeVector': ('DoubleProperty', 'DoubleProperty', 'DoubleProperty'),
    'Add_VectorVector': ('Vector', 'Vector'),
    'Subtract_VectorVector': ('Vector', 'Vector'),
    'Multiply_VectorVector': ('Vector', 'Vector'),
    'Conv_DoubleToVector': ('DoubleProperty',),
    'MakeRotator': ('FloatProperty', 'FloatProperty', 'FloatProperty'),
    'MakeTransform': ('Vector', 'Rotator', 'Vector'),
    'BreakVector': ('Vector',),
    'BreakVector2D': ('Vector2D',),
    'BreakRotator': ('Rotator',),
    'BreakTransform': ('Transform',),
    'Abs': ('DoubleProperty',), 'VSize': ('Vector',), 'VSizeXY': ('Vector',),
    'FInterpTo': ('DoubleProperty', 'DoubleProperty', 'DoubleProperty', 'DoubleProperty'),
    'Conv_IntToInt64': ('IntProperty',),
    'Conv_LinearColorToVector': ('LinearColor',),
    'Square': ('DoubleProperty',), 'FFloor': ('DoubleProperty',),
    'Conv_BoolToDouble': ('BoolProperty',),
    'Multiply_LinearColorLinearColor': ('LinearColor', 'LinearColor'),
    'Vector_Distance': ('Vector', 'Vector'),
    'Vector_DistanceSquared': ('Vector', 'Vector'),
}


def native_math_result_type(name):
    if name in ('MakeVector', 'Add_VectorVector', 'Subtract_VectorVector', 'Multiply_VectorVector',
                'Conv_DoubleToVector', 'Conv_LinearColorToVector'): return 'Vector'
    if name == 'Multiply_LinearColorLinearColor': return 'LinearColor'
    if name == 'MakeRotator': return 'Rotator'
    if name == 'MakeTransform': return 'Transform'
    if name == 'Conv_IntToInt64': return 'Int64Property'
    if name.startswith(('Boolean', 'Not_PreBool', 'EqualEqual_BoolBool', 'NotEqual_BoolBool')):
        return 'BoolProperty'
    suffix = name.rsplit('_', 1)[-1]
    if suffix in ('ByteByte', 'IntInt', 'DoubleDouble'):
        operation = name.split('_', 1)[0]
        if operation in ('EqualEqual', 'NotEqual', 'Greater', 'GreaterEqual', 'Less', 'LessEqual'):
            return 'BoolProperty'
        return {'ByteByte':'ByteProperty','IntInt':'IntProperty','DoubleDouble':'DoubleProperty'}[suffix]
    if name in ('Min', 'Max', 'Clamp', 'SelectInt'): return 'IntProperty'
    if name in ('Conv_IntToDouble', 'Conv_BoolToDouble', 'Square', 'Lerp', 'FMin', 'FMax', 'FClamp', 'SelectFloat',
                'Abs', 'VSize', 'VSizeXY', 'Vector_Distance', 'Vector_DistanceSquared', 'FInterpTo'):
        return 'DoubleProperty'
    if name == 'InRange_FloatFloat': return 'BoolProperty'
    if name in ('Round', 'FFloor'): return 'IntProperty'
    return None


def native_math_source_type(value, package, owner):
    token = kind(value)
    constants = {'EX_True':'BoolProperty','EX_False':'BoolProperty',
                 'EX_IntZero':'IntProperty','EX_IntOne':'IntProperty',
                 'EX_IntConst':'IntProperty','EX_IntConstByte':'ByteProperty','EX_ByteConst':'ByteProperty',
                 'EX_FloatConst':'FloatProperty','EX_DoubleConst':'DoubleProperty'}
    if token in constants: return constants[token]
    if token == 'EX_VectorConst': return 'Vector'
    if token == 'EX_RotationConst': return 'Rotator'
    if token == 'EX_PrimitiveCast':
        conversion = value.get('ConversionType')
        types = {3: ('DoubleProperty', 'FloatProperty'), 4: ('FloatProperty', 'DoubleProperty')}
        if type(conversion) is not int or conversion not in types:
            raise BlueprintTranslationError('Unsupported original primitive cast conversion')
        source, result = types[conversion]
        if native_math_source_type(value.get('Target'), package, owner) != source:
            raise BlueprintTranslationError('Original primitive cast source type differs')
        return result
    if token == 'EX_Context': return native_math_source_type(value.get('ContextExpression'), package, owner)
    if token == 'EX_CallMath':
        from blueprint_objects import NATIVE_OBJECT_CALLS
        native = NATIVE_OBJECT_CALLS.get(import_path(package, value.get('StackNode')))
        if native is not None: return native['return_type']
        return native_math_result_type(math_call(package, value.get('StackNode')))
    if token in ('EX_InstanceVariable','EX_LocalVariable','EX_LocalOutVariable') and package:
        pointer = value.get('Variable', {})
        name = field(pointer)
        reference = pointer.get('New', {}).get('ResolvedOwner')
        target_owner = package.export(reference) if type(reference) is int and reference > 0 else None
        if token == 'EX_InstanceVariable':
            if not target_owner or target_owner is not package.export(owner):
                raise BlueprintTranslationError('Native math instance input belongs to another source class')
        elif not target_owner or (target_owner is not getattr(package, '_active_function', None)
              and not (str(target_owner.get('ObjectName', '')).startswith('ExecuteUbergraph_')
                       and target_owner.get('OuterIndex') == owner)):
            raise BlueprintTranslationError('Native math local input belongs to another source function')
        properties = [prop for prop in target_owner.get('LoadedProperties', []) if prop.get('Name') == name]
        if len(properties) != 1: raise BlueprintTranslationError('Unresolved native math source parameter type')
        schema = property_schema(package, properties[0])
        return schema.get('native') if schema and schema.get('type') == 'StructProperty' else property_type(properties[0], package)
    if token == 'EX_StructConst' and package:
        # UAssetAPI EX_StructConst records the reflected UScriptStruct in `Struct`;
        # `StructType` is not its serialized field (unlike some property tags).
        identity = import_path(package, value.get('Struct'))
        schema = native_schema(identity) or getattr(package, 'source_structs', {}).get(identity)
        return schema.get('native') if schema else None
    return None


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


def validate_round_input(value, package, owner):
    token = kind(value)
    if token == 'EX_DoubleConst': return
    if token not in ('EX_InstanceVariable', 'EX_LocalVariable', 'EX_LocalOutVariable'):
        raise BlueprintTranslationError('Round requires an original double input')
    pointer = value.get('Variable', {})
    name = field(pointer)
    reference = pointer.get('New', {}).get('ResolvedOwner')
    active = getattr(package, '_active_function', None)
    if token == 'EX_InstanceVariable':
        if type(owner) is not int or owner <= 0:
            raise BlueprintTranslationError('Round instance input has no resolved source owner')
        expected = package.export(owner)
    else:
        expected = active
    if (type(reference) is not int or reference <= 0 or not expected
            or package.export(reference) is not expected):
        raise BlueprintTranslationError('Round input belongs to an unresolved source owner')
    prop = next((item for item in expected.get('LoadedProperties', []) if item.get('Name') == name), None)
    if not prop or prop.get('SerializedType') != 'DoubleProperty':
        raise BlueprintTranslationError('Round requires an original DoubleProperty input')


def native_math_output_target(value, package, owner, expected_type):
    """Resolve a Kismet out parameter to its original writable source field."""
    token = kind(value)
    if token not in ('EX_InstanceVariable', 'EX_LocalVariable', 'EX_LocalOutVariable'):
        raise BlueprintTranslationError('Native math output requires a direct source variable')
    pointer = value.get('Variable', {})
    name = field(pointer)
    reference = pointer.get('New', {}).get('ResolvedOwner')
    if type(reference) is not int or reference <= 0:
        raise BlueprintTranslationError('Native math output has no resolved source owner')
    target_owner = package.export(reference) if package else None
    active = getattr(package, '_active_function', None)
    frame = None
    if token == 'EX_InstanceVariable':
        class_owner = package.export(owner) if package and type(owner) is int else None
        if not target_owner or target_owner is not class_owner:
            raise BlueprintTranslationError('Native math instance output belongs to another source class')
        scope = 'self'
    elif target_owner and str(target_owner.get('ObjectName', '')).startswith('ExecuteUbergraph_'):
        if target_owner.get('OuterIndex') != owner:
            raise BlueprintTranslationError('Native math persistent output belongs to another source class')
        scope, frame = 'persistent', reference
    elif target_owner is active:
        scope = 'local'
    else:
        raise BlueprintTranslationError('Native math local output belongs to another source function')
    properties = [prop for prop in (target_owner or {}).get('LoadedProperties', []) if prop.get('Name') == name]
    if len(properties) != 1 or property_type(properties[0], package) != expected_type:
        raise BlueprintTranslationError('Native math output property type differs from its original parameter')
    prop = properties[0]
    if 'CPF_ConstParm' in str(prop.get('PropertyFlags')):
        raise BlueprintTranslationError('Native math output writes an original const input')
    target = {'op': 'get', 'scope': scope, 'field': name}
    if frame is not None: target['frame'] = frame
    return target, prop


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
    if token == 'EX_PrimitiveCast':
        # UE5.7 ScriptCore.cpp execDoubleToFloatCast/execFloatToDoubleCast:
        # preserve the explicit float32 rounding at the cast boundary.
        result_type = native_math_source_type(value, package, owner)
        conversion = value['ConversionType']
        return {'op': 'primitive_cast', 'conversion': conversion,
                'source_type': 'DoubleProperty' if conversion == 3 else 'FloatProperty',
                'return_type': result_type,
                'value': expression(value['Target'], reads, outputs, depth+1, package, owner)}
    if token == 'EX_SwitchValue':
        # UE's select node stores absolute VM offsets for every next-case
        # boundary. memory_size verifies all of them against the serialized
        # expression before admitting source-authored selection.
        memory_size(value, package=package)
        if native_math_source_type(value.get('IndexTerm'), package, owner) != 'ByteProperty':
            raise BlueprintTranslationError('Source switch index is not a verified byte property')
        cases = value['Cases']
        if any(kind(row['CaseIndexValueTerm']) != 'EX_ByteConst' for row in cases):
            raise BlueprintTranslationError('Source switch requires constant byte case values')
        labels = [row['CaseIndexValueTerm'].get('Value') for row in cases]
        if (any(type(label) is not int or not 0 <= label <= 255 for label in labels)
                or len(labels) != len(set(labels))):
            raise BlueprintTranslationError('Source switch labels are invalid or duplicated')
        return {'op': 'switch_value', 'index_type': 'ByteProperty',
                'index': expression(value['IndexTerm'], reads, outputs, depth+1, package, owner),
                'cases': [{'match': label,
                           'value': expression(row['CaseTerm'], reads, outputs, depth+1, package, owner),
                           'next_offset': row['NextOffset']}
                          for label, row in zip(labels, cases)],
                'default': expression(value['DefaultTerm'], reads, outputs, depth+1, package, owner),
                'source_end_offset': value['EndGotoOffset']}
    if token == 'EX_ObjectConst' and package:
        from blueprint_values import asset_constant
        try: return asset_constant(package, value.get('Value'))
        except ValueError as error: raise BlueprintTranslationError(str(error))
    if token == 'EX_SetArray' and package:
        from blueprint_effects import array_literal
        return array_literal(value, package, owner, reads, outputs, depth)
    if token == 'EX_Context' and package:
        obj, call = value.get('ObjectExpression', {}), value.get('ContextExpression', {})
        math_identity = import_path(package, call.get('StackNode')) if kind(call) == 'EX_FinalFunction' else None
        if math_identity and math_identity[:2] == ('/Script/Engine', 'KismetMathLibrary'):
            if (kind(obj) != 'EX_ObjectConst'
                    or import_path(package, obj.get('Value')) != ('/Script/Engine', 'Default__KismetMathLibrary')
                    or value.get('Offset') != memory_size(call, package=package)):
                raise BlueprintTranslationError('Original KismetMathLibrary context receiver or offset differs')
            # Some UE5.7 packages serialize a static math library call as a
            # context-bound final call instead of EX_CallMath. Preserve the
            # exact imported function, parameters and existing math signature
            # checks; only normalize the opcode after validating its CDO and
            # Kismet bytecode offset.
            promoted = {**call, '$type': 'UAssetAPI.Kismet.Bytecode.Expressions.EX_CallMath, UAssetAPI'}
            return expression(promoted, reads, outputs, depth+1, package, owner)
        if (kind(obj) == 'EX_ObjectConst' and import_path(package, obj.get('Value')) == ('/Script/Engine', 'Default__DataTableFunctionLibrary')
                and kind(call) == 'EX_CallMath'
                and import_path(package, call.get('StackNode')) == ('/Script/Engine', 'DataTableFunctionLibrary', 'GetDataTableRowNames')):
            raise BlueprintTranslationError('Unsupported original GetDataTableRowNames: source row-name ordering is not verified')
        if (kind(obj) == 'EX_ObjectConst' and import_path(package, obj.get('Value')) == ('/Script/Engine', 'Default__DataTableFunctionLibrary')
                and kind(call) == 'EX_FinalFunction'
                and import_path(package, call.get('StackNode')) == ('/Script/Engine', 'DataTableFunctionLibrary', 'GetDataTableRowFromName')):
            args = call.get('Parameters', [])
            if (len(args) != 3 or kind(args[0]) not in ('EX_InstanceVariable', 'EX_ObjectConst')
                    or kind(args[2]) not in ('EX_LocalVariable', 'EX_LocalOutVariable')):
                raise BlueprintTranslationError('Unsupported original table lookup arguments')
            from blueprint_effects import array_item_schema, variable
            row_schema = array_item_schema(args[1], package, owner, reads, outputs, depth)
            if row_schema != {'type': 'NameProperty', 'default': 'None'}:
                raise BlueprintTranslationError('Original table lookup row argument is not a NameProperty')
            function = getattr(package, '_active_function', {})
            target, schema = variable(args[2], package, owner, reads, outputs, depth)
            if target.get('scope') != 'local':
                raise BlueprintTranslationError('Original table lookup output is not a local out parameter')
            if kind(args[0]) == 'EX_ObjectConst':
                table_reference = expression(args[0], reads, outputs, depth+1, package, owner)
                source_reference = table_reference.get('value')
            else:
                table_name = field(args[0].get('Variable'))
                cls = package.export(owner)
                prop = next((p for p in (cls or {}).get('LoadedProperties', []) if p.get('Name') == table_name), {})
                if (import_path(package, prop.get('PropertyClass')) != ('/Script/Engine', 'DataTable')
                        or args[0].get('Variable', {}).get('New', {}).get('ResolvedOwner') != owner):
                    raise BlueprintTranslationError('Original table lookup receiver is not an owned DataTable property')
                try:
                    default = asset_reference(package, getattr(package, 'source_defaults', {}).get(table_name),
                                              ('/Script/Engine', 'DataTable'))
                except ValueError as error:
                    raise BlueprintTranslationError(str(error))
                table_reference = expression(args[0], reads, outputs, depth+1, package, owner)
                source_reference = default
            table = getattr(package, 'source_tables', {}).get((source_reference or {}).get('asset'))
            if (not schema or not table or table['schema'] != schema
                    or package.export(args[2].get('Variable', {}).get('New', {}).get('ResolvedOwner')) is not function
                    or value.get('Offset') != memory_size(call, package=package)):
                raise BlueprintTranslationError('Unresolved original table, row type, owner or context offset')
            return {'op': 'table_get', 'table': table_reference,
                    'row': expression(args[1], reads, outputs, depth+1, package, owner),
                    'target': target, 'row_source': schema['source'], 'row_schema': row_schema,
                    'identity': list(import_path(package, call.get('StackNode'))), 'dispatch': 'EX_FinalFunction'}
        from blueprint_effects import array_context
        adapted = array_context(value, package, owner, reads, outputs, depth)
        if adapted is not None: return adapted
        from blueprint_effects import native_audio_vfx_context
        adapted = native_audio_vfx_context(value, package, owner, reads, outputs, depth)
        if adapted is not None: return adapted
        from blueprint_objects import native_actor_context
        adapted = native_actor_context(value, package, owner, reads, outputs, depth)
        if adapted is not None: return adapted
        from blueprint_queries import component_access
        adapted = component_access(value, package, owner, reads, outputs, depth)
        if adapted is not None: return adapted
        from blueprint_queries import component_query
        adapted = component_query(value, package, owner, reads, outputs, depth)
        if adapted is not None: return adapted
        from blueprint_widgets import widget_context
        adapted = widget_context(value, package, owner, reads, outputs, depth)
        if adapted is not None: return adapted
        from blueprint_objects import native_component_context
        adapted = native_component_context(value, package, owner, reads, outputs, depth)
        if adapted is not None: return adapted
        raise BlueprintTranslationError('Unsupported opcode: EX_Context')
    if token in ('EX_VirtualFunction', 'EX_LocalVirtualFunction', 'EX_LocalFinalFunction', 'EX_FinalFunction'):
        # A source-owned EX_VirtualFunction can use the existing original
        # method-dispatch/arity checks. Native/foreign methods remain blocked:
        # local_call resolves only a unique function on this exact source class.
        if token == 'EX_FinalFunction' and package:
            from blueprint_objects import native_owner
            adapted = native_owner(value, package, owner)
            if adapted is not None: return adapted
            from blueprint_effects import native_audio_vfx_call
            adapted = native_audio_vfx_call(value, package, owner, reads, outputs, depth,
                                            'EX_FinalFunction', {'$type': 'EX_Self'})
            if adapted is not None: return adapted
        return local_call(value, package, owner, reads, outputs, depth)
    if token == 'EX_StructMemberContext':
        return {'op': 'member', 'field': field(value.get('StructMemberExpression')),
                'value': expression(value.get('StructExpression'), reads, outputs, depth+1, package, owner)}
    if token == 'EX_StructConst':
        identity = import_path(package, value.get('Struct')) if package else None
        schema = (native_schema(identity) or getattr(package, 'source_structs', {}).get(identity)) if package else None
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
            if import_path(package, value.get('StackNode')) == ('/Script/Engine', 'DataTableFunctionLibrary', 'GetDataTableRowNames'):
                raise BlueprintTranslationError('Unsupported original GetDataTableRowNames: source row-name ordering is not verified')
            from blueprint_effects import native_audio_vfx_call
            adapted = native_audio_vfx_call(value, package, owner, reads, outputs, depth, 'EX_CallMath')
            if adapted is not None: return adapted
            from blueprint_objects import native_object_call
            adapted = native_object_call(value, package, owner, reads, outputs, depth)
            if adapted is not None: return adapted
            from blueprint_queries import game_time
            adapted = game_time(value, package, owner)
            if adapted is not None: return adapted
            from blueprint_queries import object_validity
            adapted = object_validity(value, package, owner, reads, outputs, depth)
            if adapted is not None: return adapted
            from blueprint_effects import dirty_call
            adapted = dirty_call(value, package, owner)
            if adapted is not None: return adapted
        name = math_call(package, value.get('StackNode'))
        args = value.get('Parameters')
        if not isinstance(args, list) or len(args) != MATH_CALLS[name][0]:
            raise BlueprintTranslationError('Invalid native math parameter count')
        for index, expected_type in enumerate(NATIVE_MATH_INPUT_TYPES.get(name, ())):
            if native_math_source_type(args[index], package, owner) != expected_type:
                raise BlueprintTranslationError('Original native math parameter type differs')
        if name in ('BreakVector', 'BreakVector2D', 'BreakRotator', 'BreakTransform'):
            components = (('X','Y','Z') if name == 'BreakVector' else
                          ('X','Y') if name == 'BreakVector2D' else
                          ('Roll','Pitch','Yaw') if name == 'BreakRotator' else
                          ('Location','Rotation','Scale'))
            natives = ('Vector','Rotator','Vector') if name == 'BreakTransform' else (None,)*(len(args)-1)
            targets = []
            for argument, native in zip(args[1:], natives):
                typ = 'StructProperty' if native else 'DoubleProperty' if name == 'BreakVector2D' else 'FloatProperty'
                target, prop = native_math_output_target(argument, package, owner, typ)
                if native and property_schema(package, prop).get('native') != native:
                    raise BlueprintTranslationError('BreakTransform original native output differs')
                if target['scope'] == 'local' and 'CPF_OutParm' in str(prop.get('PropertyFlags')):
                    outputs.add(target['field'])
                targets.append({**target,'type':typ,**({'native':native} if native else {})})
            return {'op':'math_outputs','name':name,
                    'args':[expression(args[0], reads, outputs, depth+1, package, owner)],
                    'components':list(components),'targets':targets}
        if name == 'Divide_IntInt' and (kind(args[1]) != 'EX_IntConst' or args[1].get('Value') != 2):
            raise BlueprintTranslationError('Unwitnessed original int division denominator')
        if name == 'Round': validate_round_input(args[0], package, owner)
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
            if frame is getattr(package, '_active_function', None) and name == 'EntryPoint':
                props = [prop for prop in frame.get('LoadedProperties', []) if prop.get('Name') == name]
                if (len(props) == 1 and property_type(props[0], package) == 'IntProperty'
                        and 'CPF_Parm' in str(props[0].get('PropertyFlags'))
                        and 'CPF_OutParm' not in str(props[0].get('PropertyFlags'))):
                    return {'op': 'get', 'scope': 'local', 'field': name}
            return {'op': 'get', 'scope': 'persistent', 'frame': reference, 'field': name}
        if token == 'EX_InstanceVariable': reads.add(name)
        if token == 'EX_LocalOutVariable': outputs.add(name)
        return {'op': 'get', 'scope': scopes[token], 'field': name}
    if token == 'EX_TextConst':
        text = value.get('Value', {}); literal = text.get('TextLiteralType')
        if literal == 'Empty': result = {'history': 'empty', 'text': '', 'flags': 0}
        elif literal == 'InvariantText':
            part = text.get('InvariantLiteralString', {})
            if kind(part) not in ('EX_StringConst', 'EX_UnicodeStringConst') or not isinstance(part.get('Value'), str):
                raise BlueprintTranslationError('Invariant FText requires an original constant string')
            memory_size(part, package=package)
            result = {'history': 'invariant' if part['Value'] else 'empty', 'text': part['Value'], 'flags': 2}
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
    if token == 'EX_Int64Const':
        result = value.get('Value')
        # The runtime IR is JSON/JavaScript. Preserve only the subset of signed
        # 64-bit values that JavaScript Number represents without rounding.
        if type(result) is not int or not -(2**53) < result < 2**53:
            raise BlueprintTranslationError('Int64 constant is outside the exact JavaScript integer range')
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
    if token == 'EX_SwitchValue':
        cases, end = value.get('Cases'), value.get('EndGotoOffset')
        if (not isinstance(cases, list) or not 1 <= len(cases) <= 64
                or type(end) is not int or end <= 0):
            raise BlueprintTranslationError('Invalid original switch case count or final offset')
        index_size = size(value.get('IndexTerm'))
        default_size = size(value.get('DefaultTerm'))
        widths = []
        for row in cases:
            if not isinstance(row, dict) or type(row.get('NextOffset')) is not int:
                raise BlueprintTranslationError('Invalid original switch case offset')
            widths.append(size(row.get('CaseIndexValueTerm')) + 4 + size(row.get('CaseTerm')))
        total = 7 + index_size + sum(widths) + default_size
        start, cursor = end - total, end - total + 7 + index_size
        if start < 0:
            raise BlueprintTranslationError('Original switch extends before function bytecode')
        for row, width in zip(cases, widths):
            cursor += width
            if row['NextOffset'] != cursor:
                raise BlueprintTranslationError('Original switch next-case VM offset is inconsistent')
        if cursor + default_size != end:
            raise BlueprintTranslationError('Original switch final VM offset is inconsistent')
        return total
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
    if token == 'EX_Int64Const': return 9
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
    branching = entry_offset is not None or any(kind(instruction) in ('EX_Jump', 'EX_JumpIfNot', 'EX_ComputedJump', 'EX_PushExecutionFlow', 'EX_PopExecutionFlow', 'EX_PopExecutionFlowIfNot') for instruction in bytecode)
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
        if token == 'EX_ComputedJump':
            if entry_offset is not None:
                if index != prologue:
                    raise BlueprintTranslationError('Unsupported computed jump inside event path')
                steps.append({'op': 'jump', 'target': boundaries[entry_offset],
                              'target_offset': entry_offset, 'source_index': index})
            else:
                operand = instruction.get('CodeOffsetExpression')
                # The UE Kismet ExecuteUbergraph entry dispatcher reads an
                # original Int32 EntryPoint parameter containing a *bytecode*
                # offset. Retain that dynamic target, but only at the witnessed
                # prologue and only with a complete source boundary table.
                if (package and str(export.get('ObjectName', '')).startswith('ExecuteUbergraph_')
                        and all(kind(prior) in ('EX_Tracepoint', 'EX_WireTracepoint', 'EX_Nothing',
                                                'EX_PushExecutionFlow')
                                for prior in bytecode[:index])
                        and kind(operand) == 'EX_LocalVariable'
                        and field(operand.get('Variable')) == 'EntryPoint'
                        and native_math_source_type(operand, package, export.get('OuterIndex')) == 'IntProperty'):
                    pointer = operand['Variable'].get('New', {})
                    props = [prop for prop in export.get('LoadedProperties', []) if prop.get('Name') == 'EntryPoint']
                    if (package.export(pointer.get('ResolvedOwner')) is not export or len(props) != 1
                            or 'CPF_Parm' not in str(props[0].get('PropertyFlags'))
                            or 'CPF_OutParm' in str(props[0].get('PropertyFlags'))):
                        raise BlueprintTranslationError('Unverified original event EntryPoint parameter')
                    steps.append({'op': 'jump_dynamic', 'value': expression(operand, reads, outputs,
                                   package=package, owner=export.get('OuterIndex')), 'source_index': index})
                    continue
                # All other data-dependent computed jumps remain unsupported.
                # A runtime target is never guessed from parsed disk offsets.
                if not isinstance(operand, dict) or kind(operand) not in ('EX_IntConst', 'EX_IntZero', 'EX_IntOne'):
                    raise BlueprintTranslationError('Dynamic computed jump has no verified original constant target')
                literal = expression(operand, reads, outputs, package=package, owner=export.get('OuterIndex'))
                target_offset = literal['value']
                if type(target_offset) is not int or target_offset not in boundaries:
                    raise BlueprintTranslationError('Computed jump target is not a Kismet instruction boundary')
                steps.append({'op': 'jump', 'target': boundaries[target_offset],
                              'target_offset': target_offset, 'source_index': index})
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
                if target.get('op') != 'get' or target.get('scope') not in ('local', 'self', 'persistent'):
                    raise BlueprintTranslationError('Unsupported nested struct assignment target')
                root_pointer = variable.get('StructExpression', {}).get('Variable', {}).get('New', {})
                root_owner = package.export(root_pointer.get('ResolvedOwner'))
                root_prop = next((p for p in (root_owner or {}).get('LoadedProperties', []) if p.get('Name') == target['field']), {})
                expected_owner = export if target['scope'] in ('local', 'persistent') else package.export(export.get('OuterIndex'))
                if (root_owner is not expected_owner or property_schema(package, root_prop) != schema
                        or target['scope'] == 'persistent' and package.export(target.get('frame')) is not export):
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
        elif token in ('EX_VirtualFunction', 'EX_LocalVirtualFunction', 'EX_LocalFinalFunction', 'EX_FinalFunction', 'EX_CallMath', 'EX_Context', 'EX_CallMulticastDelegate', 'EX_SetArray'):
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
            if step['op'] in ('jump', 'branch', 'push_flow'): step['target'] = compact[step['target']]
    return {'schema_version': 1, 'name': export['ObjectName'] + ('@' + str(entry_offset) if entry_offset is not None else ''), 'status': 'translated_control_flow' if branching else 'translated_straight_line',
            'internal_event_entry': entry_offset is not None, 'event_entry_offset': entry_offset,
            'memory_size_verified': offset if branching else None,
            **({'source_offset_targets': [[vm_offset, source_index] for vm_offset, source_index in sorted(boundaries.items())]}
               if any(step['op'] == 'jump_dynamic' for step in steps) else {}),
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
    defaults, unavailable_defaults, inherited_enums = {}, {}, {}
    for export in package.exports:
        if str(export.get('ObjectName', '')).startswith('Default__'):
            defaults.update(package.props(export))
            for value in export.get('Data', []):
                if value.get('ByteType') != 'FName': continue
                name = value.get('Name'); prop = class_properties.get(name)
                schema = property_schema(package, prop) if prop else None
                try:
                    from blueprint_values import serialized_value, witnessed_enum_tag_default
                    if schema:
                        defaults[name] = serialized_value(package, prop, schema, value)
                    elif prop is None:
                        # Inherited FName-backed enums are absent from the
                        # child's LoadedProperties, but the CDO retains their
                        # complete enum identity and original tagged value.
                        defaults[name] = witnessed_enum_tag_default(
                            value, getattr(package, 'source_enums', {}))
                        inherited_enums[name] = 'ByteProperty'
                    else:
                        raise ValueError('Original enum property schema is unavailable')
                except ValueError as error:
                    defaults.pop(name, None); unavailable_defaults[name] = str(error)
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
            output_parameters = [prop['Name'] for prop in export.get('LoadedProperties', [])
                                 if 'CPF_Parm' in str(prop.get('PropertyFlags'))
                                 and 'CPF_OutParm' in str(prop.get('PropertyFlags'))
                                 and 'CPF_ConstParm' not in str(prop.get('PropertyFlags'))
                                 and 'CPF_ReturnParm' not in str(prop.get('PropertyFlags'))]
            program['output_fields'] = sorted(set(program['output_fields']) | set(output_parameters))
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
                        if value.get('op') == 'math_outputs' and any(target.get('scope') == 'local'
                                and target.get('field') in const_inputs for target in value.get('targets', [])):
                            raise BlueprintTranslationError('Native math output writes original const input')
                        if value.get('op') == 'math_outputs':
                            program['self_writes'] = sorted(set(program['self_writes']) | {
                                target['field'] for target in value.get('targets', [])
                                if target.get('scope') == 'self'})
                        if value.get('op') == 'array_mutate' and target.get('scope') == 'self':
                            program['self_writes'] = sorted(set(program['self_writes']) | {target['field']})
                        if value.get('op') in ('call', 'component_query', 'component_call') and any(binding.get('mode') == 'output'
                                and binding.get('target', {}).get('scope') == 'local'
                                and binding['target'].get('field') in const_inputs for binding in value.get('bindings', [])):
                            raise BlueprintTranslationError('Output binding writes original const input')
                        if value.get('op') in ('component_query', 'component_call'):
                            program['self_writes'] = sorted(set(program['self_writes']) | {
                                binding['target']['field'] for binding in value['bindings']
                                if binding['mode'] == 'output' and binding['target']['scope'] == 'self'})
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
                            if type_name in ('StructProperty', 'ArrayProperty', 'ObjectProperty', 'TextProperty'):
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
                'self': {name: property_type(class_properties[name], package) if name in class_properties else inherited_enums[name]
                         for name in program['self_reads'] if name in class_properties or name in inherited_enums},
                'local': {prop['Name']: property_type(prop, package) for prop in export.get('LoadedProperties', []) if prop.get('Name') in used_locals}}
            program['source_property_types'] = {prop['Name']: prop for prop in export.get('LoadedProperties', []) if prop.get('Name') in used_locals}
            program['schemas'] = {'local': {name: schema for name, prop in program['source_property_types'].items()
                                           if (schema := property_schema(package, prop)) and schema['type'] in ('StructProperty', 'ArrayProperty', 'ObjectProperty', 'TextProperty')},
                                  'self': {name: schema for name in program['self_reads'] if name in class_properties
                                           and (schema := property_schema(package, class_properties[name])) and schema['type'] in ('StructProperty', 'ArrayProperty', 'ObjectProperty', 'TextProperty')}}
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
            program['source_parameters'] = [
                {'name': prop['Name'],
                 'mode': 'output' if ('CPF_OutParm' in str(prop.get('PropertyFlags'))
                                      and 'CPF_ConstParm' not in str(prop.get('PropertyFlags')))
                         else 'input',
                 'schema': property_schema(package, prop)}
                for prop in export.get('LoadedProperties', [])
                if 'CPF_Parm' in str(prop.get('PropertyFlags'))
                and 'CPF_ReturnParm' not in str(prop.get('PropertyFlags'))]
            program['value_parameters_only'] = all(
                'CPF_OutParm' not in str(prop.get('PropertyFlags')) and 'CPF_ReferenceParm' not in str(prop.get('PropertyFlags'))
                for prop in export.get('LoadedProperties', [])
                if 'CPF_Parm' in str(prop.get('PropertyFlags')) and 'CPF_ReturnParm' not in str(prop.get('PropertyFlags')))
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
            program['field_types']['self'] = {
                name: property_type(class_properties[name], package) if name in class_properties else inherited_enums[name]
                for name in reads | writes if name in class_properties or name in inherited_enums}
            program['source_defaults'] = {name: defaults[name] for name in reads | writes if name in defaults}
        if not changed: break
    default_state = {}
    for name in inherited_enums:
        if name in defaults and name not in unavailable_defaults and name not in class_properties:
            default_state[name] = defaults[name]
    for name, prop in class_properties.items():
        if name in unavailable_defaults: continue
        try: type_name = property_type(prop, package)
        except BlueprintTranslationError: continue
        schema = property_schema(package, prop)
        if type_name == 'ObjectProperty':
            if schema.get('reference_kind') in ('runtime_actor', 'runtime_component'):
                if type(defaults.get(name, 0)) is not int or defaults.get(name, 0) != 0:
                    raise BlueprintTranslationError('Source actor defaults require an original world-object binding: ' + name)
                default_state[name] = None
            else: default_state[name] = asset_reference(package, defaults.get(name, 0), schema['class'])
        elif schema and schema['type'] == 'StructProperty':
            # A source struct may deserialize with known field types but no
            # witnessed constructor (for example, a native plugin struct).
            # Do not invent an empty constructor, and never abort the entire
            # multi-package replay with KeyError: 'default'.
            if not isinstance(schema.get('default'), dict):
                from blueprint_values import witnessed_complete_default
                try:
                    default_state[name] = witnessed_complete_default(schema, defaults.get(name))
                except ValueError as error:
                    identity = import_path(package, prop.get('Struct'))
                    unavailable_defaults[name] = ('Original struct constructor unavailable for '
                                                  + '/'.join(identity or ('unknown',)) + ': ' + str(error))
                continue
            if name in defaults and not isinstance(defaults[name], dict):
                unavailable_defaults[name] = 'Original CDO struct override is not a field map'
                continue
            default_state[name] = {**schema['default'], **defaults.get(name, {})}
        elif type_name == 'TextProperty':
            from blueprint_values import text_value
            tagged = [tag for export in package.exports
                      if str(export.get('ObjectName', '')).startswith('Default__')
                      for tag in export.get('Data', []) if tag.get('Name') == name]
            try:
                if len(tagged) > 1: raise ValueError('Duplicate original FText default')
                default_state[name] = text_value(tagged[0]) if tagged else schema['default']
            except ValueError as error: unavailable_defaults[name] = str(error)
        elif name in defaults: default_state[name] = defaults[name]
        elif schema and schema['type'] == 'ArrayProperty': default_state[name] = []
        elif type_name in ('BoolProperty', 'ByteProperty', 'IntProperty', 'Int64Property', 'FloatProperty', 'DoubleProperty', 'StrProperty', 'NameProperty'):
            default_state[name] = {'BoolProperty': False, 'StrProperty': '', 'NameProperty': 'None'}.get(type_name, 0)
    # These programs cannot be instantiated faithfully; also remove their
    # transitive callers. A missing original default is never a translated
    # gameplay path just because the bytecode itself parsed successfully.
    while True:
        to_remove = []
        for name, program in functions.items():
            unresolved = (set(program['self_reads']) | set(program['self_writes'])) & set(unavailable_defaults)
            missing_callee = next((call['function'] for call in calls(program['steps'])
                                   if call['function'] not in functions), None)
            if unresolved or missing_callee:
                reason = ('Unresolved original source default: ' + ', '.join(sorted(unresolved))
                          if unresolved else 'Untranslated function dependency: ' + missing_callee)
                (event_blocked if program.get('internal_event_entry') else blocked).append({
                    'function': name, 'source_export_index': program['source_export_index'], 'reason': reason})
                to_remove.append(name)
        if not to_remove:
            break
        for name in to_remove:
            del functions[name]
    # Recalculate the counts after fail-closed pruning rather than treating
    # rejected functions as translated.
    no_ops = sum(not program.get('internal_event_entry') and not program['self_reads']
                 and not program['output_fields'] and not program['self_writes']
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
            'field_schemas': {name: schema for name, prop in class_properties.items()
                              if (schema := property_schema(package, prop)) is not None},
            'unavailable_default_fields': unavailable_defaults,
            'unavailable_default_evidence': {
                name: {'source_struct': list(import_path(package, class_properties[name].get('Struct')) or []),
                       'source_cdo_present': name in defaults,
                       'source_cdo_fields': sorted(defaults[name]) if isinstance(defaults.get(name), dict) else [],
                       'source_schema_fields': sorted((property_schema(package, class_properties[name]) or {}).get('fields', {}))}
                for name in unavailable_defaults if name in class_properties},
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
    type_caches, type_inputs = {}, {}
    for row in registry['assets']:
        name = row['package']
        if row.get('class') not in ('UserDefinedStruct', 'UserDefinedEnum') or name not in assets: continue
        asset = assets[name]; path = workspace / 'artifacts/uasset-json' / (asset['sha256'] + '.json')
        if not path.is_file(): continue
        source = (project.parent / asset['path']).resolve()
        if project.parent not in source.parents or file_hash(source) != asset['sha256']:
            raise BlueprintTranslationError('Source type changed since cached inspection: ' + name)
        type_inputs[name] = {'source_sha256': asset['sha256'], 'parsed_sha256': file_hash(path)}
        type_caches[name] = path
    table_caches, table_inputs = {}, {}
    for row in registry['assets']:
        name = row['package']
        if row.get('class') != 'DataTable' or name not in assets: continue
        asset = assets[name]; path = workspace / 'artifacts/uasset-json' / (asset['sha256'] + '.json')
        if not path.is_file(): continue
        source = (project.parent / asset['path']).resolve()
        if project.parent not in source.parents or file_hash(source) != asset['sha256']:
            raise BlueprintTranslationError('Source table changed since cached inspection: ' + name)
        table_inputs[name] = {'source_sha256': asset['sha256'], 'parsed_sha256': file_hash(path)}
        table_caches[name] = path
    controls_file = output / 'character-controls.json'
    repository = Path(__file__).resolve().parents[2]
    runtime_sources = {name: file_hash(repository / name) for name in (
        'src/editor/ue2three-blueprint.mjs', 'src/editor/ue2three-native-math.mjs',
        'src/editor/ue2three-objects.mjs', 'src/editor/ue2three-blueprint-runtime.mjs',
        'src/editor/Ue2ThreeGameplay.js', 'src/editor/ue2three-live-verification.mjs',
        'src/editor/ue2three-fixtures.mjs', 'src/editor/ue2three-source-verification.mjs',
        'tools/ue2three/blueprint-audit.mjs')}
    from blueprint_cache import BlueprintCompileCache, bind_runtime
    compiler_key = digest({'project': str(project), 'inputs': key_inputs, 'missing': missing, 'types': type_inputs, 'tables': table_inputs,
                          'controls': file_hash(controls_file) if controls_file.is_file() else None,
                          'implementation': file_hash(Path(__file__)),
                          'core_implementation': file_hash(Path(__file__).with_name('core.py')),
                          'package_implementation': file_hash(Path(__file__).with_name('umg_migration.py')),
                          'cache_implementation': file_hash(Path(__file__).with_name('blueprint_cache.py')),
                          'events_implementation': file_hash(Path(__file__).with_name('blueprint_events.py')),
                          'effects_implementation': file_hash(Path(__file__).with_name('blueprint_effects.py')),
                          'widgets_implementation': file_hash(Path(__file__).with_name('blueprint_widgets.py')),
                          'objects_implementation': file_hash(Path(__file__).with_name('blueprint_objects.py')),
                          'queries_implementation': file_hash(Path(__file__).with_name('blueprint_queries.py')),
                          'values_implementation': file_hash(Path(__file__).with_name('blueprint_values.py')),
                          'types_implementation': file_hash(Path(__file__).with_name('blueprint_types.py'))})
    fingerprint = digest({'compiler': compiler_key, 'runtime_sources': runtime_sources})
    report_file = output / 'blueprint-programs.json'
    try:
        prior = read_json(report_file)
        if prior.get('fingerprint') == fingerprint and prior.get('content_sha256') == digest({k: v for k, v in prior.items() if k != 'content_sha256'}):
            return prior
    except (OSError, ValueError): pass
    compiled_cache = BlueprintCompileCache(workspace / 'artifacts/blueprint-compiled', project)
    payload = compiled_cache.load(compiler_key)
    if payload is not None:
        report = bind_runtime(payload, compiler_key, runtime_sources)
        atomic_json(report_file, report)
        return report
    type_documents = {name: read_json(path) for name, path in type_caches.items()}
    structs = source_structs(type_documents, BlueprintTranslationError)
    from blueprint_values import source_enums
    enums = source_enums(type_documents)
    table_documents = {name: read_json(path) for name, path in table_caches.items()}
    tables, table_blocked = source_tables(table_documents, structs)
    packages, source_packages, counts = {}, {}, Counter()
    source_packages = {name: Package(read_json(cache)) for name, cache in cached}
    for source in source_packages.values():
        source.source_packages = source_packages
        source.source_structs = structs
        source.source_enums = enums
    for name, cache in cached:
        packages[name] = translate_package(source_packages[name], structs, tables)
        packages[name]['source'] = key_inputs[name]
    from blueprint_queries import prune_queries
    prune_queries(packages)
    for package in packages.values(): counts.update(package['counts'])
    guards, character_source = {}, None
    if controls_file.is_file():
        controls = read_json(controls_file)
        source = controls.get('sources', {}).get('character_blueprint', {})
        if controls.get('project') == str(project) and key_inputs.get(source.get('package'), {}).get('source_sha256') == source.get('sha256'):
            character_source = source
            cache_path = dict(cached).get(source['package'])
            guards = character_guards(controls, packages, Package(read_json(cache_path)))
    from blueprint_objects import actor_graph
    payload = {'schema_version': 1, 'project': str(project),
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
                              'Typed source arrays support Get, Length, IsValidIndex, Set, Remove, Clear, Add and Append; IsNotEmpty, LastIndex, AddUnique, Contains, Find, RemoveItem, Insert and Reverse also execute when exact source parameter and equality schemas are available. Random, Shuffle, GetDataTableRowNames, other array operations and Unicode FName comparisons remain blocked.',
                             'Original property-dirty witnesses and typed multicast emissions execute locally. Explicitly registered translated handlers run transactionally; original world/UI bindings and network replication are not migrated.',
                             'Original SCS component ownership can bind to a scene actor. GetOwner and ForceNetUpdate require explicit standalone actor bindings with no game/demo net drivers; other object methods and full lifecycle remain blocked.',
                             'Original direct-class SCS component lookup, typed component field reads and explicit standalone double world game time execute. Unknown construction scripts/class hierarchies, unavailable matching templates and ambiguous component order reject.',
                             'Constant source event entries, flow stacks and per-instance persistent primitive fields execute on fully translated reachable paths.',
                             'Event callbacks with no source effects are counted separately; animation dispatch, native effects and complete game events are not implied.',
                             'Read-only original queries between explicitly bound source SCS components execute transactionally. Cross-object mutation, reentrant component aliases, derived-class virtual overrides, arbitrary dynamic jumps, latent actions and replication remain blocked.',
                             'Original named enum class defaults resolve through cached source enum identities; unresolved native enum defaults are listed as unavailable and never guessed.',
                             'Translated functions are not connected to the complete game runtime yet.']}
    compiled_cache.save(compiler_key, payload)
    report = bind_runtime(payload, compiler_key, runtime_sources)
    atomic_json(report_file, report)
    return report
