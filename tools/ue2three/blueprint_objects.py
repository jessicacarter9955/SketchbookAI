"""Source-witnessed component ownership; no construction script or network execution."""
import math
from blueprint_types import import_path, property_schema, NATIVE_COMPONENT_REFERENCES
from blueprint_values import serialized_value
from core import digest

ACTOR_BASES = {('/Script/Engine', name) for name in ('Actor', 'Pawn', 'Character')}
NATIVE_OBJECT_CALLS = {
    ('/Script/Engine', 'KismetSystemLibrary', 'MakeLiteralText'): {
        'parameter_types': ('TextProperty',), 'return_type': 'TextProperty',
        'argument_tokens': (('EX_TextConst',),),
    },
    ('/Script/Engine', 'KismetSystemLibrary', 'MakeLiteralString'): {
        'parameter_types': ('StrProperty',), 'return_type': 'StrProperty',
        'argument_tokens': (('EX_StringConst', 'EX_UnicodeStringConst'),),
    },
    ('/Script/Engine', 'KismetSystemLibrary', 'MakeLiteralDouble'): {
        'parameter_types': ('DoubleProperty',), 'return_type': 'DoubleProperty',
        'argument_tokens': (('EX_DoubleConst',),),
    },
    ('/Script/Engine', 'KismetTextLibrary', 'Conv_StringToText'): {
        'parameter_types': ('StrProperty',), 'return_type': 'TextProperty',
        'argument_tokens': (('EX_StringConst', 'EX_UnicodeStringConst'),),
    },
    ('/Script/Engine', 'KismetTextLibrary', 'Conv_NameToText'): {
        'parameter_types': ('NameProperty',), 'return_type': 'TextProperty',
        'argument_tokens': (('EX_NameConst',),),
    },
    ('/Script/Engine', 'KismetTextLibrary', 'Conv_TextToString'): {
        'parameter_types': ('TextProperty',), 'return_type': 'StrProperty',
        'argument_tokens': (('EX_TextConst',),),
    },
    ('/Script/Engine', 'KismetStringLibrary', 'Concat_StrStr'): {
        'parameter_types': ('StrProperty', 'StrProperty'), 'return_type': 'StrProperty',
        'argument_tokens': (('EX_StringConst', 'EX_UnicodeStringConst'),
                            ('EX_StringConst', 'EX_UnicodeStringConst')),
    },
    ('/Script/Engine', 'KismetStringLibrary', 'Conv_NameToString'): {
        'parameter_types': ('NameProperty',), 'return_type': 'StrProperty',
        'argument_tokens': (('EX_NameConst',),),
    },
    ('/Script/Engine', 'KismetStringLibrary', 'Conv_IntToString'): {
        'parameter_types': ('IntProperty',), 'return_type': 'StrProperty',
        'argument_tokens': (('EX_IntConst', 'EX_IntZero', 'EX_IntOne'),),
    },
    ('/Script/Engine', 'KismetStringLibrary', 'Len'): {
        'parameter_types': ('StrProperty',), 'return_type': 'IntProperty',
        'argument_tokens': (('EX_StringConst', 'EX_UnicodeStringConst'),),
    },
    ('/Script/Engine', 'KismetStringLibrary', 'Contains'): {
        'parameter_types': ('StrProperty', 'StrProperty', 'BoolProperty', 'BoolProperty'),
        'return_type': 'BoolProperty',
        'argument_tokens': (('EX_StringConst', 'EX_UnicodeStringConst'),
                            ('EX_StringConst', 'EX_UnicodeStringConst'),
                            ('EX_False',), ('EX_False',)),
    },
}


def native_object_call(value, package, owner, reads, outputs, depth):
    """Translate only exact typed, pure native calls witnessed for this family."""
    identity = import_path(package, value.get('StackNode'))
    signature = NATIVE_OBJECT_CALLS.get(identity)
    if signature is None: return None
    from blueprint_migration import kind, expression, memory_size, BlueprintTranslationError as Error
    reference = value.get('StackNode')
    if (type(reference) is not int or reference >= 0 or -reference > len(package.imports)
            or package.imports[-reference-1].get('ClassName') != 'Function'
            or import_path(package, package.imports[-reference-1].get('OuterIndex')) != identity[:-1]):
        raise Error('Original native object call identity differs')
    args = value.get('Parameters')
    parameter_types = signature['parameter_types']
    if not isinstance(args, list) or len(args) != len(parameter_types):
        raise Error('Original native object call arity differs')
    from blueprint_effects import variable
    translated = []
    for arg, expected, literal_tokens in zip(args, parameter_types, signature['argument_tokens']):
        token = kind(arg)
        if token in ('EX_InstanceVariable', 'EX_LocalVariable', 'EX_LocalOutVariable'):
            result, schema = variable(arg, package, owner, reads, outputs, depth)
            if schema.get('type') != expected:
                raise Error('Original native object parameter type differs')
        elif token == 'EX_CallMath' and import_path(package, arg.get('StackNode')) in NATIVE_OBJECT_CALLS:
            nested = NATIVE_OBJECT_CALLS[import_path(package, arg.get('StackNode'))]
            if nested['return_type'] != expected:
                raise Error('Original native object nested return type differs')
            result = expression(arg, reads, outputs, depth+1, package, owner)
        elif token == 'EX_TextConst' and token in literal_tokens and expected == 'TextProperty':
            result = expression(arg, reads, outputs, depth+1, package, owner)
        elif token in literal_tokens and expected in ('StrProperty', 'NameProperty', 'IntProperty', 'BoolProperty', 'DoubleProperty'):
            memory_size(arg, package=package)
            result = expression(arg, reads, outputs, depth+1, package, owner)
            literal = result.get('value')
            valid = (result.get('op') == 'constant'
                     and (type(literal) is bool if expected == 'BoolProperty'
                          else (type(literal) in (int, float) and math.isfinite(literal)) if expected == 'DoubleProperty'
                          else isinstance(literal, str) if expected != 'IntProperty'
                          else type(literal) is int and -(2**31) <= literal < 2**31))
            if not valid:
                raise Error('Original native object literal type differs')
            result = {'op': 'typed_literal', 'schema': property_schema(package, {'SerializedType': expected}),
                      'value': literal}
        else:
            raise Error('Original native object argument requires a typed source property or matching literal')
        translated.append(result)
    return {'op': 'native_call', 'identity': list(identity), 'parameter_types': list(parameter_types),
            'return_type': signature['return_type'], 'args': translated}


def native_text_format_call(value, package, owner, reads, outputs, depth):
    """Translate typed KismetTextLibrary.Format source inputs for the runtime formatter."""
    from blueprint_migration import kind, expression, BlueprintTranslationError as Error
    identity = import_path(package, value.get('StackNode'))
    if identity != ('/Script/Engine', 'KismetTextLibrary', 'Format'): return None
    reference = value.get('StackNode')
    if (type(reference) is not int or reference >= 0 or -reference > len(package.imports)
            or package.imports[-reference-1].get('ClassName') != 'Function'
            or import_path(package, package.imports[-reference-1].get('OuterIndex')) != identity[:-1]):
        raise Error('Original KismetTextLibrary.Format function identity differs')
    args = value.get('Parameters')
    if not isinstance(args, list) or len(args) != 2:
        raise Error('Original KismetTextLibrary.Format parameter count differs')
    from blueprint_effects import variable
    if kind(args[0]) == 'EX_TextConst':
        pattern = expression(args[0], reads, outputs, depth+1, package, owner)
        pattern_schema = pattern.get('schema') if isinstance(pattern, dict) else None
    elif kind(args[0]) in ('EX_InstanceVariable', 'EX_LocalVariable', 'EX_LocalOutVariable'):
        pattern, pattern_schema = variable(args[0], package, owner, reads, outputs, depth)
    else:
        raise Error('Original KismetTextLibrary.Format template is not a typed source FText')
    if not isinstance(pattern_schema, dict) or pattern_schema.get('type') != 'TextProperty':
        raise Error('Original KismetTextLibrary.Format template type differs')
    if kind(args[1]) not in ('EX_InstanceVariable', 'EX_LocalVariable', 'EX_LocalOutVariable'):
        raise Error('Original KismetTextLibrary.Format arguments are not a typed source array')
    arguments, array_schema = variable(args[1], package, owner, reads, outputs, depth)
    from blueprint_values import native_schema
    argument_schema = native_schema(('/Script/Engine', 'FormatArgumentData'))
    if (not argument_schema or array_schema != {'type': 'ArrayProperty', 'element': argument_schema, 'default': []}):
        raise Error('Original KismetTextLibrary.Format argument array is not FFormatArgumentData')
    return {'op': 'native_text_format', 'identity': list(identity), 'dispatch': 'EX_CallMath',
            'pattern': pattern, 'pattern_schema': pattern_schema, 'arguments': arguments,
            'argument_schema': argument_schema, 'source_text_locale_only': True,
            'visual_1to1_certified': False}


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


def native_component_owner_context(value, package, owner, reads, outputs, depth):
    """Resolve ActorComponent.GetOwner only for an explicitly typed live component."""
    from blueprint_migration import kind, memory_size, BlueprintTranslationError as Error
    call=value.get('ContextExpression',{})
    identity=import_path(package,call.get('StackNode')) if kind(call)=='EX_FinalFunction' else None
    if identity != ('/Script/Engine','ActorComponent','GetOwner'): return None
    reference=call.get('StackNode')
    if (type(reference) is not int or reference >= 0 or -reference > len(package.imports)
            or package.imports[-reference-1].get('ClassName') != 'Function'
            or import_path(package,package.imports[-reference-1].get('OuterIndex')) != identity[:-1]):
        raise Error('Original ActorComponent.GetOwner function identity differs')
    from blueprint_effects import variable
    target,schema=variable(value.get('ObjectExpression',{}),package,owner,reads,outputs,depth)
    from blueprint_types import NATIVE_COMPONENT_REFERENCES
    component_class=tuple(schema.get('class',()))
    if (schema.get('type') != 'ObjectProperty' or schema.get('reference_kind') != 'runtime_native_component'
            or component_class not in NATIVE_COMPONENT_REFERENCES
            or call.get('Parameters') != [] or value.get('Offset') != memory_size(call,package=package)):
        raise Error('GetOwner requires a typed live original ActorComponent and no arguments')
    return {'op':'native_component_get_owner','identity':list(identity),'dispatch':'EX_FinalFunction',
            'target':target,'component_schema':schema}


def native_component_context(value, package, owner, reads, outputs, depth):
    """Retain exact native component dependencies for explicitly bound receivers.

    These calls are requests to a runtime adapter. This compiler does not
    synthesize native component behavior when no adapter is installed.
    """
    from blueprint_migration import kind, expression, memory_size, BlueprintTranslationError as Error
    from blueprint_effects import variable

    call = value.get('ContextExpression', {})
    receiver_expression = value.get('ObjectExpression', {})
    if kind(receiver_expression) not in ('EX_InstanceVariable', 'EX_LocalVariable', 'EX_LocalOutVariable'):
        return None
    target, receiver_schema = variable(value.get('ObjectExpression', {}), package, owner,
                                       reads, outputs, depth)
    if receiver_schema.get('reference_kind') != 'runtime_native_component': return None
    receiver_class = tuple(receiver_schema.get('class', ()))
    dispatch = kind(call)
    if dispatch == 'EX_VirtualFunction':
        method = call.get('VirtualFunctionName')
        identity = (*receiver_class, method) if isinstance(method, str) else None
    elif dispatch == 'EX_FinalFunction':
        identity = import_path(package, call.get('StackNode'))
        reference = call.get('StackNode')
        imported = package.imports[-reference-1] if type(reference) is int and reference < 0 and -reference <= len(package.imports) else {}
        outer = imported.get('OuterIndex')
        if (type(reference) is not int or reference >= 0 or -reference > len(package.imports)
                or imported.get('ClassName') != 'Function' or type(outer) is not int or outer >= 0
                or -outer > len(package.imports) or package.imports[-outer-1].get('ClassName') != 'Class'
                or identity is None or len(identity) != 3):
            raise Error('Original native context function import is unresolved')
    else:
        return None

    # Only complete source-witnessed calls are admitted. The request records
    # observed signatures and exact Unreal identity for a native adapter.
    contracts = {
        ('/Script/Engine', 'SceneCaptureComponent2D', 'CaptureScene'): {
            'dispatch': 'EX_FinalFunction',
            'receiver': ('/Script/Engine', 'SceneCaptureComponent2D'),
            'receiver_classes': [('/Script/Engine', 'SceneCaptureComponent2D')],
            'parameters': [],
        },
        ('/Script/Engine', 'SkeletalMeshComponent', 'SetMaterial'): {
            'dispatch': 'EX_VirtualFunction',
            'receiver': ('/Script/Engine', 'SkeletalMeshComponent'),
            'parameters': [
                {'type': 'IntProperty', 'default': 0},
                {'type': 'ObjectProperty', 'class': ['/Script/Engine', 'MaterialInterface'], 'default': None},
            ],
        },
        ('/Script/Engine', 'SkeletalMeshComponent', 'SetSkeletalMeshAsset'): {
            'dispatch': 'EX_FinalFunction',
            'receiver': ('/Script/Engine', 'SkeletalMeshComponent'),
            'parameters': [
                {'type': 'ObjectProperty', 'class': ['/Script/Engine', 'SkeletalMesh'], 'default': None},
            ],
        },
        # BP_PickUp uses a StaticMeshComponent receiver but imports the
        # declaring SceneComponent method. Preserve that exact UE identity.
        ('/Script/Engine', 'SceneComponent', 'SetVisibility'): {
            'dispatch': 'EX_FinalFunction',
            'receiver_classes': [
                ('/Script/Engine', 'StaticMeshComponent'),
                ('/Script/Engine', 'TextRenderComponent'),
            ],
            'parameters': [
                {'type': 'BoolProperty', 'default': False},
                {'type': 'BoolProperty', 'default': False},
            ],
        },
        ('/Script/Engine', 'TextRenderComponent', 'K2_SetText'): {
            'dispatch': 'EX_FinalFunction',
            'receiver_classes': [('/Script/Engine', 'TextRenderComponent')],
            'parameters': [
                {'type': 'TextProperty', 'default': {'history': 'empty', 'text': '', 'flags': 0}},
            ],
        },
        ('/Script/Niagara', 'NiagaraComponent', 'Activate'): {
            'dispatch': 'EX_VirtualFunction',
            'receiver_classes': [('/Script/Niagara', 'NiagaraComponent')],
            'parameters': [{'type': 'BoolProperty', 'default': False}],
        },
        ('/Script/Niagara', 'NiagaraComponent', 'Deactivate'): {
            'dispatch': 'EX_VirtualFunction',
            'receiver_classes': [('/Script/Niagara', 'NiagaraComponent')],
            'parameters': [],
        },
    }
    contract = contracts.get(identity)
    if contract is None: return None
    allowed_receivers = contract.get('receiver_classes', [('/Script/Engine', 'SkeletalMeshComponent')])
    if (contract['dispatch'] != dispatch or value.get('Offset') != memory_size(call, package=package)
            or receiver_class not in allowed_receivers):
        raise Error('Original native component context identity or layout differs')
    rvalue = value.get('RValuePointer', {}).get('New', {})
    if (value.get('PropertyType') != 0 or rvalue.get('Path') != []
            or rvalue.get('ResolvedOwner') != 0):
        raise Error('Original native skeletal mesh context return storage is unsupported')
    args = call.get('Parameters')
    if not isinstance(args, list) or len(args) != len(contract['parameters']):
        raise Error('Original native skeletal mesh context arity differs')

    translated, schemas = [], []
    for argument, expected in zip(args, contract['parameters']):
        token = kind(argument)
        if token in ('EX_InstanceVariable', 'EX_LocalVariable', 'EX_LocalOutVariable'):
            from blueprint_effects import variable as resolve_variable
            _, schema = resolve_variable(argument, package, owner, reads, outputs, depth)
        elif token == 'EX_ObjectConst':
            literal = expression(argument, reads, outputs, depth+1, package, owner)
            schema = literal.get('schema') if literal.get('op') == 'typed_literal' else None
        else:
            primitive = {
                'EX_IntZero': 'IntProperty', 'EX_IntOne': 'IntProperty', 'EX_IntConst': 'IntProperty',
                'EX_True': 'BoolProperty', 'EX_False': 'BoolProperty',
            }.get(token)
            schema = {'type': primitive, 'default': False if primitive == 'BoolProperty' else 0} if primitive else None
        if schema != expected:
            raise Error('Original native skeletal mesh parameter type differs')
        schemas.append(schema)
        translated.append(expression(argument, reads, outputs, depth+1, package, owner))
    return {'op': 'native_context_call', 'identity': list(identity), 'dispatch': dispatch,
            'receiver': target, 'receiver_schema': receiver_schema,
            'context_offset': value.get('Offset'),
            'parameter_schemas': schemas, 'parameters': translated,
            'adapter_family_present': False}


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
            from blueprint_migration import kind
            constructors = [e for e in package.exports if e.get('OuterIndex') == meta['export_index']
                            and e.get('ObjectName') == 'UserConstructionScript' and e.get('ScriptBytecode')]
            construction_effects = any(kind(step) not in ('EX_Tracepoint', 'EX_WireTracepoint', 'EX_Nothing', 'EX_EndOfScript')
                                       and not (kind(step) == 'EX_Return' and kind(step.get('ReturnExpression', {})) == 'EX_Nothing')
                                       for constructor in constructors for step in constructor['ScriptBytecode'])
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
            components, native_components, component_blocked, used, unresolved_classes = [], [], [], set(), []
            unresolved_native_components = False
            for index in sorted(reachable):
                data = package.props(package.export(index)); identity = import_path(package, data.get('ComponentClass'))
                if not identity: raise ValueError('Unresolved original construction component class')
                if identity[0].startswith('/Script/'):
                    if tuple(identity) not in NATIVE_COMPONENT_REFERENCES:
                        unresolved_classes.append(list(identity)); unresolved_native_components = True; continue
                    variable_name = data.get('InternalVariableName'); template = package.export(data.get('ComponentTemplate'))
                    prop = fields.get(variable_name, {})
                    schema = property_schema(package, prop)
                    if (not isinstance(variable_name, str) or variable_name in ('__proto__', 'constructor', 'prototype')
                            or variable_name in used or not schema or schema.get('reference_kind') != 'runtime_native_component'
                            or schema.get('class') != list(identity) or not template
                            or template.get('OuterIndex') != meta['export_index']
                            or template.get('ClassIndex') != data['ComponentClass']):
                        raise ValueError('Original native component field, template or class differs')
                    used.add(variable_name)
                    native_components.append({'variable': variable_name, 'package': identity[0], 'class_object': identity[1],
                        'scs_node_export_index': index, 'template_export_index': data['ComponentTemplate'],
                        'template_sha256': digest(template)})
                    continue
                if identity[0] not in packages:
                    unresolved_classes.append(list(identity))
                    continue
                source = packages[identity[0]]; source_meta = class_metadata(source)
                if not source_meta or source_meta['native_base'] != ['/Script/Engine', 'ActorComponent']:
                    unresolved_classes.append(list(identity)); continue
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
                    component_blocked.append({'variable': variable_name, 'package': identity[0],
                                              'class_object': identity[-1], 'reason': str(error)}); continue
                components.append({'variable': variable_name, 'package': identity[0], 'class_object': identity[-1],
                    'class_export_index': source_meta['export_index'], 'scs_node_export_index': index,
                    'template_export_index': data['ComponentTemplate'], 'template_sha256': digest(template),
                    'source_overrides': overrides, 'native_template_fields': native_fields, 'source': sources[identity[0]]})
            roots[name] = {**meta, 'source': sources[name], 'scs_export_index': script_index,
                           'scs_sha256': digest(script), 'components': components, 'native_components': native_components,
                           'native_component_bindings_complete': not unresolved_native_components and not construction_effects,
                           'component_blocked': component_blocked,
                           'component_lookup_complete': not unresolved_classes and not construction_effects,
                           'unresolved_construction_script': construction_effects,
                           'unresolved_component_classes': unresolved_classes}
        except (ValueError, TypeError, KeyError) as error: blocked.append({'package': name, 'reason': str(error)})
    return {'schema_version': 1, 'roots': roots, 'blocked': blocked,
            'scope': 'Original SCS component ownership only; native template behavior, construction scripts and BeginPlay are not executed'}
