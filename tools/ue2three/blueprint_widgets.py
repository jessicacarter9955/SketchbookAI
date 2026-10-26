"""Source-verified Unreal UMG widget context calls.

Only admits native widget operations whose receiver/property and bytecode
layout are witnessed in the original Blueprint. The Three.js runtime emits
typed UI effects only against explicitly bound original widget handles;
unbound widgets fail closed. Does not imply visual/Play 1:1 certification.
"""
from blueprint_types import import_path, property_schema

NATIVE_WIDGET_CLASSES = frozenset((
    'Widget', 'UserWidget', 'TextBlock', 'Button', 'Image', 'Border',
    'ProgressBar', 'ScrollBox', 'CheckBox', 'Slider', 'EditableText',
    'EditableTextBox', 'RichTextBlock', 'Overlay', 'CanvasPanel',
    'HorizontalBox', 'VerticalBox', 'SizeBox', 'ScaleBox', 'Spacer',
    'UniformGridPanel', 'GridPanel', 'WidgetSwitcher', 'RetainerBox',
    'TextWidget', 'ComboBoxString', 'SpinBox',
))
# Native virtual widget calls are dispatched against UMG's native base.
OPERATIONS = {
    ('EX_VirtualFunction', 'SetVisibility'): {'type': 'ByteProperty', 'classes': NATIVE_WIDGET_CLASSES},
    ('EX_FinalFunction', 'SetText'): {'type': 'TextProperty', 'classes': frozenset(('TextBlock',))},
    ('EX_VirtualFunction', 'SetText'): {'type': 'TextProperty', 'classes': frozenset(('TextBlock',))},
    ('EX_FinalFunction', 'SetColorAndOpacity'): {'type': 'StructProperty', 'native': 'LinearColor',
                                                'classes': frozenset(('TextBlock',))},
    ('EX_FinalFunction', 'SetBrushFromMaterial'): {'type': 'ObjectProperty',
                                                  'classes': frozenset(('Border',)),
                                                  'material_classes': frozenset((
                                                      'Material', 'MaterialInstance',
                                                      'MaterialInstanceConstant', 'MaterialInterface'))},
    ('EX_FinalFunction', 'SetPercent'): {'type': 'FloatProperty',
                                        'classes': frozenset(('ProgressBar',))},
    # UImage::SetBrushFromTexture(UTexture2D*, bool). The original asset
    # identity and bMatchSize value are both required; no fallback texture.
    ('EX_VirtualFunction', 'SetBrushFromTexture'): {
        'type': 'ObjectProperty', 'classes': frozenset(('Image',)),
        'texture_classes': frozenset(('Texture2D',))},
}


def widget_context(value, package, owner, reads, outputs, depth):
    from blueprint_migration import kind, field, expression, memory_size, BlueprintTranslationError as Error
    from blueprint_effects import variable
    call = value.get('ContextExpression', {})
    dispatch = kind(call)
    identity = import_path(package, call.get('StackNode')) if dispatch == 'EX_FinalFunction' else None
    name = call.get('VirtualFunctionName') if dispatch == 'EX_VirtualFunction' else (identity or (None,))[-1]
    contract = OPERATIONS.get((dispatch, name))
    if contract is None:
        return None
    native_class = ('Widget' if name == 'SetVisibility' else
                    'Image' if name == 'SetBrushFromTexture' else
                    identity[1] if identity else 'TextBlock')
    if (dispatch == 'EX_FinalFunction' and identity != ('/Script/UMG', native_class, name)):
        return None
    obj = value.get('ObjectExpression', {})
    if kind(obj) != 'EX_InstanceVariable':
        return None
    pointer = value.get('RValuePointer', {})
    source_pointer = pointer.get('New') if isinstance(pointer, dict) else None
    if (value.get('PropertyType') != 0 or source_pointer is None
            or source_pointer.get('Path') != [] or source_pointer.get('ResolvedOwner') != 0
            or value.get('Offset') != memory_size(call, package=package)):
        raise Error('Original UMG context layout or offset differs')
    receiver, schema = variable(obj, package, owner, reads, outputs, depth)
    widget_class = schema.get('class')
    if (schema.get('type') != 'ObjectProperty'
            or not isinstance(widget_class, list) or len(widget_class) != 2
            or widget_class[0] != '/Script/UMG'
            or widget_class[1] not in contract['classes']):
        raise Error('Original native UMG widget receiver class differs')
    args = call.get('Parameters')
    arity = 2 if name == 'SetBrushFromTexture' else 1
    if not isinstance(args, list) or len(args) != arity:
        raise Error('Original UMG call parameter count differs')
    argument = args[0]
    token = kind(argument)
    if token in ('EX_InstanceVariable', 'EX_LocalVariable', 'EX_LocalOutVariable'):
        arg, arg_schema = variable(argument, package, owner, reads, outputs, depth)
    elif name == 'SetVisibility' and token == 'EX_ByteConst':
        arg = expression(argument, reads, outputs, depth + 1, package, owner)
        arg_schema = {'type': 'ByteProperty', 'default': 0}
    elif name == 'SetText' and token == 'EX_TextConst':
        arg = expression(argument, reads, outputs, depth + 1, package, owner)
        arg_schema = {'type': 'TextProperty', 'default': {'history': 'empty', 'text': '', 'flags': 0}}
    elif name == 'SetBrushFromMaterial' and token == 'EX_ObjectConst':
        arg = expression(argument, reads, outputs, depth + 1, package, owner)
        arg_schema = arg.get('schema') if isinstance(arg, dict) else None
        material_class = arg_schema.get('class') if isinstance(arg_schema, dict) else None
        if (not isinstance(arg, dict) or arg.get('op') != 'typed_literal'
                or not isinstance(arg_schema, dict) or arg_schema.get('type') != 'ObjectProperty'
                or not isinstance(material_class, list) or len(material_class) != 2
                or material_class[0] != '/Script/Engine'
                or material_class[1] not in contract['material_classes']):
            raise Error('Original UMG brush input is not a typed source material asset')
    elif name == 'SetPercent' and token == 'EX_FloatConst':
        arg = expression(argument, reads, outputs, depth + 1, package, owner)
        arg_schema = {'type': 'FloatProperty', 'default': 0}
    elif name == 'SetBrushFromTexture' and token == 'EX_ObjectConst':
        arg = expression(argument, reads, outputs, depth + 1, package, owner)
        arg_schema = arg.get('schema') if isinstance(arg, dict) else None
    elif name == 'SetBrushFromTexture' and token == 'EX_StructMemberContext':
        from blueprint_effects import array_item_schema
        arg_schema = array_item_schema(argument, package, owner, reads, outputs, depth)
        if arg_schema is not None:
            arg = expression(argument, reads, outputs, depth + 1, package, owner)
    else:
        raise Error('Original UMG call requires source-typed parameter')
    if not isinstance(arg_schema, dict) or not isinstance(arg, dict):
        raise Error('Original UMG parameter schema is unavailable')
    if (arg_schema.get('type') != contract['type']
            or contract.get('native') and arg_schema.get('native') != contract['native']):
        raise Error('Original UMG argument schema differs')
    options = {}
    if name == 'SetBrushFromTexture':
        texture_class = arg_schema.get('class') if isinstance(arg_schema, dict) else None
        if (not isinstance(texture_class, list) or len(texture_class) != 2
                or texture_class[0] != '/Script/Engine'
                or texture_class[1] not in contract['texture_classes']):
            raise Error('Original image brush requires a typed Texture2D source asset')
        match = args[1]
        match_token = kind(match)
        if match_token in ('EX_True', 'EX_False'):
            match_value = expression(match, reads, outputs, depth + 1, package, owner)
        elif match_token in ('EX_InstanceVariable', 'EX_LocalVariable', 'EX_LocalOutVariable'):
            match_value, match_schema = variable(match, package, owner, reads, outputs, depth)
            if match_schema.get('type') != 'BoolProperty':
                raise Error('Original bMatchSize Boolean property differs')
        else:
            raise Error('Original bMatchSize Boolean input is unsupported')
        options = {'bMatchSize': {'schema': {'type': 'BoolProperty'}, 'value': match_value}}
    if name == 'SetVisibility' and arg.get('op') == 'constant':
        if type(arg.get('value')) is not int or not 0 <= arg['value'] <= 4:
            raise Error('Unknown original ESlateVisibility value')
    return {'op': 'native_widget_effect', 'identity': list(identity) if identity else
            ['/Script/UMG', native_class, name],
            'dispatch': dispatch, 'method': name, 'source_owner_index': owner,
            'receiver': receiver, 'receiver_field': field(obj.get('Variable')),
            'receiver_schema': schema,
            'parameter': {'schema': arg_schema, 'value': arg},
            **({'options': options} if options else {}),
            'source_binding_required': True, 'visual_1to1_certified': False}
