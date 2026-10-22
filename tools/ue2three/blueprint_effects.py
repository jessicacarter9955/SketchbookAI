"""Strict source array adapters and synchronous local notification contracts."""
from blueprint_types import import_path, property_schema
from blueprint_values import native_schema


ENGINE, CORE, NIAGARA = '/Script/Engine', '/Script/CoreUObject', '/Script/Niagara'


def _object(identity=None):
    result = {'type': 'ObjectProperty'}
    if identity: result['class'] = list(identity)
    result['default'] = None
    return result


def _enum(identity):
    return {'type': 'ByteProperty', 'enum': list(identity), 'default': 0}


def _struct(name):
    return native_schema((CORE, name))


def _call(dispatch, parameters, receiver=None, result=None):
    return {'dispatch': dispatch, 'parameters': parameters, 'receiver': list(receiver) if receiver else None,
            'return': result}


# Only APIs in the blocked source-witness family are admitted here. Parameter
# positions and reflected types follow the source UFunction contracts; calls
# remain ordered effect records for a native/browser adapter to consume.
NATIVE_AUDIO_VFX_CALLS = {
    (ENGINE, 'GameplayStatics', 'PlaySound2D'): _call('EX_CallMath', [
        _object(), _object((ENGINE, 'SoundBase')), {'type': 'FloatProperty'}, {'type': 'FloatProperty'},
        {'type': 'FloatProperty'}, _object((ENGINE, 'SoundConcurrency')), _object((ENGINE, 'Actor')),
        {'type': 'BoolProperty'}]),
    (ENGINE, 'GameplayStatics', 'PlaySoundAtLocation'): _call('EX_CallMath', [
        _object(), _object((ENGINE, 'SoundBase')), _struct('Vector'), _struct('Rotator'),
        {'type': 'FloatProperty'}, {'type': 'FloatProperty'}, {'type': 'FloatProperty'},
        _object((ENGINE, 'SoundAttenuation')), _object((ENGINE, 'SoundConcurrency')),
        _object((ENGINE, 'Actor')), _object((ENGINE, 'InitialActiveSoundParams'))]),
    (ENGINE, 'GameplayStatics', 'SpawnSoundAtLocation'): _call('EX_CallMath', [
        _object(), _object((ENGINE, 'SoundBase')), _struct('Vector'), _struct('Rotator'),
        {'type': 'FloatProperty'}, {'type': 'FloatProperty'}, {'type': 'FloatProperty'},
        _object((ENGINE, 'SoundAttenuation')), _object((ENGINE, 'SoundConcurrency')),
        {'type': 'BoolProperty'}], result=_object((ENGINE, 'AudioComponent'))),
    (ENGINE, 'GameplayStatics', 'SpawnSoundAttached'): _call('EX_CallMath', [
        _object((ENGINE, 'SoundBase')), _object((ENGINE, 'SceneComponent')), {'type': 'NameProperty'},
        _struct('Vector'), _struct('Rotator'), _enum((ENGINE, 'EAttachLocation')),
        {'type': 'BoolProperty'}, {'type': 'FloatProperty'}, {'type': 'FloatProperty'},
        {'type': 'FloatProperty'}, _object((ENGINE, 'SoundAttenuation')),
        _object((ENGINE, 'SoundConcurrency')), {'type': 'BoolProperty'}],
        result=_object((ENGINE, 'AudioComponent'))),
    (NIAGARA, 'NiagaraFunctionLibrary', 'SpawnSystemAtLocation'): _call('EX_CallMath', [
        _object(), _object((NIAGARA, 'NiagaraSystem')), _struct('Vector'), _struct('Rotator'),
        _struct('Vector'), {'type': 'BoolProperty'}, {'type': 'BoolProperty'},
        _enum((NIAGARA, 'ENCPoolMethod')), {'type': 'BoolProperty'}],
        result=_object((NIAGARA, 'NiagaraComponent'))),
    (NIAGARA, 'NiagaraFunctionLibrary', 'SpawnSystemAttached'): _call('EX_CallMath', [
        _object((NIAGARA, 'NiagaraSystem')), _object((ENGINE, 'SceneComponent')), {'type': 'NameProperty'},
        _struct('Vector'), _struct('Rotator'), _enum((ENGINE, 'EAttachLocation')),
        {'type': 'BoolProperty'}, {'type': 'BoolProperty'}, _enum((NIAGARA, 'ENCPoolMethod')),
        {'type': 'BoolProperty'}], result=_object((NIAGARA, 'NiagaraComponent'))),
    (NIAGARA, 'NiagaraComponent', 'SetVariableLinearColor'): _call('EX_FinalFunction', [
        {'type': 'NameProperty'}, _struct('LinearColor')], receiver=(NIAGARA, 'NiagaraComponent')),
    (NIAGARA, 'NiagaraComponent', 'SetVariableVec3'): _call('EX_FinalFunction', [
        {'type': 'NameProperty'}, _struct('Vector')], receiver=(NIAGARA, 'NiagaraComponent')),
    (NIAGARA, 'NiagaraComponent', 'SetVariableFloat'): _call('EX_FinalFunction', [
        {'type': 'NameProperty'}, {'type': 'FloatProperty'}], receiver=(NIAGARA, 'NiagaraComponent')),
    (NIAGARA, 'NiagaraComponent', 'SetVariablePosition'): _call('EX_FinalFunction', [
        {'type': 'NameProperty'}, _struct('Vector')], receiver=(NIAGARA, 'NiagaraComponent')),
    (NIAGARA, 'NiagaraComponent', 'SetVariableBool'): _call('EX_FinalFunction', [
        {'type': 'NameProperty'}, {'type': 'BoolProperty'}], receiver=(NIAGARA, 'NiagaraComponent')),
    (NIAGARA, 'NiagaraComponent', 'SetVariableMaterial'): _call('EX_FinalFunction', [
        {'type': 'NameProperty'}, _object((ENGINE, 'MaterialInterface'))], receiver=(NIAGARA, 'NiagaraComponent')),
    (NIAGARA, 'NiagaraComponent', 'SetNiagaraVariablePosition'): _call('EX_FinalFunction', [
        {'type': 'StrProperty'}, _struct('Vector')], receiver=(NIAGARA, 'NiagaraComponent')),
    (ENGINE, 'AudioComponent', 'SetSound'): _call('EX_FinalFunction', [
        _object((ENGINE, 'SoundBase'))], receiver=(ENGINE, 'AudioComponent')),
    (ENGINE, 'AudioComponent', 'SetVolumeMultiplier'): _call('EX_FinalFunction', [
        {'type': 'FloatProperty'}], receiver=(ENGINE, 'AudioComponent')),
    (NIAGARA, 'NiagaraDataChannelWriter', 'WriteFloat'): _call('EX_FinalFunction', [
        {'type': 'NameProperty'}, {'type': 'IntProperty'}, {'type': 'DoubleProperty'}],
        receiver=(NIAGARA, 'NiagaraDataChannelWriter')),
    (NIAGARA, 'NiagaraDataChannelWriter', 'WriteInt'): _call('EX_FinalFunction', [
        {'type': 'NameProperty'}, {'type': 'IntProperty'}, {'type': 'IntProperty'}],
        receiver=(NIAGARA, 'NiagaraDataChannelWriter')),
    (NIAGARA, 'NiagaraDataChannelWriter', 'WritePosition'): _call('EX_FinalFunction', [
        {'type': 'NameProperty'}, {'type': 'IntProperty'}, _struct('Vector')],
        receiver=(NIAGARA, 'NiagaraDataChannelWriter')),
    (NIAGARA, 'NiagaraDataChannelWriter', 'WriteVector'): _call('EX_FinalFunction', [
        {'type': 'NameProperty'}, {'type': 'IntProperty'}, _struct('Vector')],
        receiver=(NIAGARA, 'NiagaraDataChannelWriter')),
    (NIAGARA, 'NiagaraDataChannelWriter', 'WriteLinearColor'): _call('EX_FinalFunction', [
        {'type': 'NameProperty'}, {'type': 'IntProperty'}, _struct('LinearColor')],
        receiver=(NIAGARA, 'NiagaraDataChannelWriter')),
}

# These source calls depend on a custom Niagara context/property or an audio
# parameter struct schema that is absent from the verified source packet.
NATIVE_AUDIO_VFX_UNSUPPORTED = {
    (NIAGARA, 'NiagaraDataChannelLibrary', 'MakeNDCAccessContextInstance'): ('EX_CallMath', 1,
        'Niagara data-channel access-context struct schema is unresolved'),
    (NIAGARA, 'NiagaraDataChannelLibrary', 'SetSinglePropertyInNDCAccessContextInstance'): ('EX_FinalFunction', 4,
        'Niagara data-channel custom property value schema is unresolved'),
    (NIAGARA, 'NiagaraDataChannelLibrary', 'WriteToNiagaraDataChannel_WithContext'): ('EX_CallMath', 8,
        'Niagara data-channel access-context struct schema is unresolved'),
    (ENGINE, 'AudioParameterConversionStatics', 'ObjectArrayToAudioParameter'): ('EX_CallMath', 2,
        'AudioParameter struct and object-array element schemas are unresolved'),
}


NATIVE_AUDIO_VFX_BASES = {
    (ENGINE, 'Character'): (ENGINE, 'Pawn'), (ENGINE, 'Pawn'): (ENGINE, 'Actor'),
    (ENGINE, 'Actor'): ('/Script/CoreUObject', 'Object'),
    (ENGINE, 'SceneComponent'): (ENGINE, 'ActorComponent'),
    (ENGINE, 'PrimitiveComponent'): (ENGINE, 'SceneComponent'),
    (ENGINE, 'MeshComponent'): (ENGINE, 'PrimitiveComponent'),
    (ENGINE, 'SkeletalMeshComponent'): (ENGINE, 'MeshComponent'),
    (ENGINE, 'StaticMeshComponent'): (ENGINE, 'MeshComponent'),
    (ENGINE, 'CapsuleComponent'): (ENGINE, 'PrimitiveComponent'),
    (ENGINE, 'CameraComponent'): (ENGINE, 'SceneComponent'),
    (ENGINE, 'SpringArmComponent'): (ENGINE, 'SceneComponent'),
    (ENGINE, 'AudioComponent'): (ENGINE, 'ActorComponent'),
    (ENGINE, 'SoundWave'): (ENGINE, 'SoundBase'), (ENGINE, 'SoundCue'): (ENGINE, 'SoundBase'),
    (ENGINE, 'Material'): (ENGINE, 'MaterialInterface'),
    (ENGINE, 'MaterialInstance'): (ENGINE, 'MaterialInterface'),
    (ENGINE, 'MaterialInstanceConstant'): (ENGINE, 'MaterialInstance'),
    (NIAGARA, 'NiagaraComponent'): (ENGINE, 'PrimitiveComponent'),
}


def _is_a(package, actual, expected, seen=None):
    if actual == expected: return True
    if not actual or not expected: return False
    seen = set() if seen is None else seen
    if actual in seen: return False
    seen.add(actual)
    base = NATIVE_AUDIO_VFX_BASES.get(actual)
    if base: return _is_a(package, base, expected, seen)
    source = getattr(package, 'source_packages', {}).get(actual[0])
    if source:
        from blueprint_objects import class_metadata
        meta = class_metadata(source)
        if meta and meta['object'] == actual[-1]:
            return _is_a(package, tuple(meta['native_base']), expected, seen)
    return False


def _compatible(package, actual, expected):
    if actual.get('type') != expected.get('type'): return False
    if expected['type'] == 'ObjectProperty':
        expected_class, actual_class = expected.get('class'), actual.get('class')
        if expected_class and actual_class:
            return _is_a(package, tuple(actual_class), tuple(expected_class))
        return not expected_class or expected.get('reference_kind') == 'source_self'
    if expected['type'] == 'StructProperty':
        return (actual.get('source'), actual.get('native')) == (expected.get('source'), expected.get('native'))
    if expected.get('enum') and actual.get('enum') and actual['enum'] != expected['enum']:
        return False
    return True


def _argument(value, expected, package, owner, reads, outputs, depth):
    from blueprint_migration import kind, expression, BlueprintTranslationError as Error
    token = kind(value)
    if token in ('EX_InstanceVariable', 'EX_LocalVariable', 'EX_LocalOutVariable'):
        result, schema = variable(value, package, owner, reads, outputs, depth)
        pointer = value.get('Variable', {}).get('New', {})
        container = package.export(owner) if token == 'EX_InstanceVariable' else getattr(package, '_active_function', None)
        prop = next((p for p in (container or {}).get('LoadedProperties', []) if p.get('Name') == pointer.get('Path', [None])[0]), {})
        if prop.get('Enum'):
            enum = import_path(package, prop['Enum'])
            if enum: schema['enum'] = list(enum)
    elif token == 'EX_Self':
        meta = None
        if package:
            from blueprint_objects import class_metadata
            meta = class_metadata(package)
        cls = tuple(meta['native_base']) if meta and meta.get('native_base') else None
        schema = _object(cls)
        schema.update(reference_kind='source_self', source_owner_index=owner)
        result = {'op': 'native_self', 'source_owner_index': owner,
                  'class': list(cls) if cls else None}
    elif token == 'EX_NoObject':
        if expected.get('type') != 'ObjectProperty': raise Error('Native audio/VFX null does not match its parameter type')
        schema, result = expected, {'op': 'constant', 'value': None}
    elif token in ('EX_ObjectConst', 'EX_VectorConst', 'EX_RotationConst', 'EX_StructConst'):
        result = expression(value, reads, outputs, depth+1, package, owner)
        schema = result.get('schema') if result.get('op') == 'typed_literal' else None
        if token == 'EX_StructConst':
            identity = import_path(package, value.get('Struct'))
            schema = native_schema(identity) or getattr(package, 'source_structs', {}).get(identity)
    else:
        primitive = {'EX_True': 'BoolProperty', 'EX_False': 'BoolProperty',
                     'EX_IntZero': 'IntProperty', 'EX_IntOne': 'IntProperty',
                     'EX_IntConst': 'IntProperty', 'EX_IntConstByte': 'ByteProperty',
                     'EX_ByteConst': 'ByteProperty', 'EX_FloatConst': 'FloatProperty',
                     'EX_DoubleConst': 'DoubleProperty', 'EX_NameConst': 'NameProperty',
                     'EX_StringConst': 'StrProperty', 'EX_UnicodeStringConst': 'StrProperty'}
        if token not in primitive: raise Error('Unsupported native audio/VFX parameter expression: ' + token)
        result = expression(value, reads, outputs, depth+1, package, owner)
        schema = {'type': primitive[token]}
        if primitive[token] in ('BoolProperty', 'ByteProperty', 'IntProperty', 'FloatProperty', 'DoubleProperty', 'NameProperty', 'StrProperty'):
            schema['default'] = {'BoolProperty': False, 'ByteProperty': 0, 'IntProperty': 0, 'FloatProperty': 0,
                                 'DoubleProperty': 0, 'NameProperty': 'None', 'StrProperty': ''}[primitive[token]]
    if not schema or not _compatible(package, schema, expected):
        raise Error('Original native audio/VFX parameter type differs')
    if expected.get('enum'):
        if token in ('EX_InstanceVariable', 'EX_LocalVariable', 'EX_LocalOutVariable'):
            if schema.get('enum') != expected['enum']:
                raise Error('Original native audio/VFX enum parameter type differs')
        else:
            schema['enum'] = expected['enum']
    return {'schema': schema, 'contract': expected, 'value': result}


def native_audio_vfx_call(value, package, owner, reads, outputs, depth, dispatch, receiver_value=None):
    """Translate an exact witnessed audio/VFX call, retaining its typed ABI."""
    from blueprint_migration import kind, expression, memory_size, BlueprintTranslationError as Error
    identity = import_path(package, value.get('StackNode'))
    contract = NATIVE_AUDIO_VFX_CALLS.get(identity)
    unsupported = NATIVE_AUDIO_VFX_UNSUPPORTED.get(identity)
    if contract is None and unsupported is None: return None
    reference = value.get('StackNode')
    if (type(reference) is not int or reference >= 0 or -reference > len(package.imports)
            or package.imports[-reference-1].get('ClassName') != 'Function'
            or not identity or len(identity) != 3
            or import_path(package, package.imports[-reference-1].get('OuterIndex')) != identity[:-1]):
        raise Error('Original native audio/VFX call identity differs')
    if unsupported:
        expected_dispatch, expected_arity, reason = unsupported
        if dispatch != expected_dispatch: raise Error('Original native audio/VFX dispatch differs')
        if not isinstance(value.get('Parameters'), list) or len(value['Parameters']) != expected_arity:
            raise Error('Original native audio/VFX parameter count differs')
        raise Error('Unsupported reachable native audio/VFX effect: ' + reason)
    if dispatch != contract['dispatch']:
        raise Error('Original native audio/VFX dispatch differs')
    args = value.get('Parameters')
    if not isinstance(args, list) or len(args) != len(contract['parameters']):
        raise Error('Original native audio/VFX parameter count differs')
    receiver, receiver_schema = None, None
    if contract['receiver']:
        if receiver_value is None:
            raise Error('Native audio/VFX receiver is unresolved')
        if kind(receiver_value) == 'EX_Self':
            typed = _argument(receiver_value, _object(), package, owner, reads, outputs, depth)
        else:
            receiver, receiver_schema = variable(receiver_value, package, owner, reads, outputs, depth)
            if receiver_schema.get('type') != 'ObjectProperty' or not _compatible(
                    package, receiver_schema, _object(contract['receiver'])):
                raise Error('Original native audio/VFX receiver class differs')
            typed = {'schema': receiver_schema, 'contract': _object(contract['receiver']), 'value': receiver}
        if not _compatible(package, typed['schema'], _object(contract['receiver'])):
            raise Error('Original native audio/VFX receiver class differs')
        receiver, receiver_schema = typed['value'], typed['schema']
    elif receiver_value is not None:
        raise Error('Static native audio/VFX call has an unexpected receiver')
    parameters = [_argument(arg, expected, package, owner, reads, outputs, depth)
                  for arg, expected in zip(args, contract['parameters'])]
    return {'op': 'native_audio_vfx', 'identity': list(identity), 'dispatch': dispatch,
            'receiver': receiver, 'receiver_schema': receiver_schema,
            'parameter_schemas': contract['parameters'], 'parameters': parameters,
            'return_schema': contract['return']}


def native_audio_vfx_context(value, package, owner, reads, outputs, depth):
    from blueprint_migration import kind, memory_size, BlueprintTranslationError as Error
    call = value.get('ContextExpression', {})
    if kind(call) != 'EX_FinalFunction': return None
    identity = import_path(package, call.get('StackNode'))
    if identity not in NATIVE_AUDIO_VFX_CALLS and identity not in NATIVE_AUDIO_VFX_UNSUPPORTED: return None
    if value.get('Offset') != memory_size(call, package=package):
        raise Error('Original native audio/VFX context offset differs')
    return native_audio_vfx_call(call, package, owner, reads, outputs, depth,
                                 'EX_FinalFunction', value.get('ObjectExpression'))


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
    if target['scope'] not in ('self', 'local', 'persistent'): raise Error('Unresolved source property storage')
    return target, schema


def array_item_schema(value, package, owner, reads, outputs, depth):
    """Resolve the exact reflected type of a simple source value expression."""
    from blueprint_migration import kind, field, BlueprintTranslationError as Error
    if depth > 48: return None
    token = kind(value)
    if token in ('EX_InstanceVariable', 'EX_LocalVariable', 'EX_LocalOutVariable'):
        return variable(value, package, owner, reads, outputs, depth)[1]
    constants = {
        'EX_True': ('BoolProperty', False), 'EX_False': ('BoolProperty', False),
        'EX_IntZero': ('IntProperty', 0), 'EX_IntOne': ('IntProperty', 0), 'EX_IntConst': ('IntProperty', 0),
        'EX_Int64Const': ('Int64Property', 0), 'EX_ByteConst': ('ByteProperty', 0),
        'EX_FloatConst': ('FloatProperty', 0), 'EX_DoubleConst': ('DoubleProperty', 0),
        'EX_StringConst': ('StrProperty', ''), 'EX_NameConst': ('NameProperty', 'None'),
    }
    if token in constants:
        type_name, default = constants[token]
        return {'type': type_name, 'default': default}
    if token == 'EX_StructConst':
        from blueprint_types import import_path
        from blueprint_values import native_schema
        identity = import_path(package, value.get('Struct'))
        return (getattr(package, 'source_structs', {}).get(identity)
                or native_schema(identity)) if identity else None
    if token == 'EX_StructMemberContext':
        structure = array_item_schema(value.get('StructExpression'), package, owner, reads, outputs, depth + 1)
        member = field(value.get('StructMemberExpression'))
        if structure and structure.get('type') == 'StructProperty':
            return structure.get('fields', {}).get(member)
    # Calls and object expressions need their reflected return or reference
    # contract. Do not infer a wildcard element type from the opcode alone.
    return None


def array_equality_supported(schema, depth=0):
    """Only admit source value types whose equality can be reproduced exactly."""
    if not isinstance(schema, dict) or depth > 16:
        return False
    type_name = schema.get('type')
    if type_name in ('BoolProperty', 'ByteProperty', 'IntProperty', 'Int64Property',
                     'FloatProperty', 'DoubleProperty', 'StrProperty', 'NameProperty'):
        return True
    if type_name == 'ArrayProperty':
        return array_equality_supported(schema.get('element'), depth + 1)
    if type_name == 'StructProperty' and str(schema.get('source', '')).startswith('/Game/'):
        fields = schema.get('fields')
        return isinstance(fields, dict) and bool(fields) and all(
            array_equality_supported(field, depth + 1) for field in fields.values())
    return False


def array_context(value, package, owner, reads, outputs, depth):
    from blueprint_migration import kind, expression, memory_size, BlueprintTranslationError as Error
    obj, call = value.get('ObjectExpression', {}), value.get('ContextExpression', {})
    path = import_path(package, call.get('StackNode'))
    if (kind(obj) != 'EX_ObjectConst' or import_path(package, obj.get('Value')) != ('/Script/Engine', 'Default__KismetArrayLibrary')
            or kind(call) != 'EX_FinalFunction' or not path or path[:2] != ('/Script/Engine', 'KismetArrayLibrary')):
        return None
    name = path[-1]
    counts = {'Array_Length': 1, 'Array_IsValidIndex': 2, 'Array_Get': 3,
              'Array_Set': 4, 'Array_Remove': 2, 'Array_Clear': 1, 'Array_Add': 2, 'Array_Append': 2,
              'Array_AddUnique': 2, 'Array_Contains': 2, 'Array_IsNotEmpty': 1, 'Array_LastIndex': 1,
              'Array_RemoveItem': 2, 'Array_Find': 2, 'Array_Insert': 3, 'Array_Reverse': 1,
              'Array_Random': 3, 'Array_Shuffle': 1}
    if name not in counts: raise Error('Unsupported original array call: ' + name)
    args = call.get('Parameters', [])
    if len(args) != counts[name] or value.get('Offset') != memory_size(call, package=package):
        raise Error('Original array arity or source context offset differs')
    if name in ('Array_Random', 'Array_Shuffle'):
        raise Error('Unsupported original array call: ' + name + ' requires the original random state')
    target, schema = variable(args[0], package, owner, reads, outputs, depth)
    if schema['type'] != 'ArrayProperty': raise Error('Original adapter target is not a typed array')
    expr = lambda arg: expression(arg, reads, outputs, depth+1, package, owner)
    identity = list(path)
    if name == 'Array_Length': return {'op': 'array_length', 'array': target, 'identity': identity, 'dispatch': 'EX_FinalFunction'}
    if name == 'Array_IsNotEmpty': return {'op': 'array_is_not_empty', 'array': target, 'identity': identity, 'dispatch': 'EX_FinalFunction'}
    if name == 'Array_LastIndex': return {'op': 'array_last_index', 'array': target, 'identity': identity, 'dispatch': 'EX_FinalFunction'}
    if name == 'Array_IsValidIndex': return {'op': 'array_valid', 'array': target, 'index': expr(args[1]), 'identity': identity, 'dispatch': 'EX_FinalFunction'}
    if name == 'Array_Get':
        output, output_schema = variable(args[2], package, owner, reads, outputs, depth)
        if output['scope'] not in ('local', 'persistent') or output_schema != schema['element']:
            raise Error('Array_Get output type or source owner differs')
        return {'op': 'array_get', 'array': target, 'index': expr(args[1]), 'target': output,
                'element': schema['element'], 'identity': identity, 'dispatch': 'EX_FinalFunction'}
    if name in ('Array_Contains', 'Array_Find', 'Array_AddUnique', 'Array_RemoveItem'):
        item_schema = array_item_schema(args[1], package, owner, reads, outputs, depth)
        if item_schema != schema['element']:
            raise Error(name + ' item type differs from the original array element')
        if not array_equality_supported(schema['element']):
            raise Error(name + ' element equality is not supported for the original source type')
        item = expr(args[1])
        if name == 'Array_Contains':
            return {'op': 'array_contains', 'array': target, 'item': item, 'element': schema['element'],
                    'identity': identity, 'dispatch': 'EX_FinalFunction'}
        if name == 'Array_Find':
            return {'op': 'array_find', 'array': target, 'item': item, 'element': schema['element'],
                    'identity': identity, 'dispatch': 'EX_FinalFunction'}
        result = {'op': 'array_mutate', 'operation': name, 'target': target,
                  'element': schema['element'], 'value': item, 'identity': identity, 'dispatch': 'EX_FinalFunction'}
        return result
    if name == 'Array_Insert':
        item_schema = array_item_schema(args[1], package, owner, reads, outputs, depth)
        index_schema = array_item_schema(args[2], package, owner, reads, outputs, depth)
        if item_schema != schema['element'] or index_schema != {'type': 'IntProperty', 'default': 0}:
            raise Error('Array_Insert item or index type differs from the original signature')
        return {'op': 'array_mutate', 'operation': name, 'target': target, 'element': schema['element'],
                'value': expr(args[1]), 'index': expr(args[2]), 'identity': identity, 'dispatch': 'EX_FinalFunction'}
    # Preserve the already published Set/Add IR for source instance arrays.
    # The general mutation adapter also accepts source local arrays.
    if target['scope'] == 'self' and name == 'Array_Set':
        return {'op': 'array_set', 'target': target, 'element': schema['element'],
                'index': expr(args[1]), 'item': expr(args[2]), 'size_to_fit': expr(args[3]),
                'identity': identity, 'dispatch': 'EX_FinalFunction'}
    if target['scope'] == 'self' and name == 'Array_Add':
        return {'op': 'array_add', 'target': target, 'element': schema['element'], 'item': expr(args[1]),
                'identity': identity, 'dispatch': 'EX_FinalFunction'}
    result = {'op': 'array_mutate', 'operation': name, 'target': target, 'element': schema['element'],
              'identity': identity, 'dispatch': 'EX_FinalFunction'}
    if name in ('Array_Set', 'Array_Remove'): result['index'] = expr(args[1])
    if name == 'Array_Set': result.update(value=expr(args[2]), resize=expr(args[3]))
    if name == 'Array_Add': result['value'] = expr(args[1])
    if name == 'Array_Append':
        other, other_schema = variable(args[1], package, owner, reads, outputs, depth)
        if other_schema != schema: raise Error('Array_Append element type differs')
        result['value'] = other
    if name == 'Array_Reverse':
        return result
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
