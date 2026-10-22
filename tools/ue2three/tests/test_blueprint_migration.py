import unittest
import sys
import json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from blueprint_migration import BlueprintTranslationError, translate_function, translate_package, property_type, memory_size
from umg_migration import Package
from core import digest


def node(token, **values): return {'$type': 'UAssetAPI.Kismet.Bytecode.Expressions.' + token + ', UAssetAPI', **values}
def variable(token, name): return node(token, Variable={'New': {'Path': [name], 'ResolvedOwner': 1}})


class BlueprintMigrationTests(unittest.TestCase):
    def test_ue57_math_source_calls_translate_typed_literals(self):
        for name, parameters in (
            ('Abs', [node('EX_DoubleConst', Value='-2.5')]),
            ('VSize', [node('EX_VectorConst', Value={'X':3,'Y':4,'Z':12})]),
            ('Vector_Distance', [node('EX_VectorConst', Value={'X':3,'Y':4,'Z':12}),
                                 node('EX_VectorConst', Value={'X':0,'Y':0,'Z':0})]),
        ):
            with self.subTest(name=name):
                imports = [{'ObjectName':name,'ClassName':'Function','OuterIndex':-2},
                           {'ObjectName':'KismetMathLibrary','OuterIndex':-3},
                           {'ObjectName':'/Script/Engine'}]
                function = self.function()
                function['ScriptBytecode'][1]['Expression'] = node('EX_CallMath',StackNode=-1,Parameters=parameters)
                package = Package({'Imports':imports,'ObjectVersionUE5':'IMPORT_TYPE_HIERARCHIES'})
                result = translate_function(function,package)
                value = result['steps'][0]['value']
                self.assertEqual(value['op'],'math')
                self.assertEqual(value['name'],name)
                self.assertEqual(len(value['args']),len(parameters))
                if name != 'Abs':
                    self.assertEqual(value['args'][0]['value'],{'X':3.0,'Y':4.0,'Z':12.0})
                else:
                    self.assertEqual(value['args'][0],{'op':'constant','value':-2.5})

    def test_ue57_source_witnessed_abs_and_vector_length_native_signatures(self):
        from blueprint_migration import MATH_CALLS, NATIVE_MATH_INPUT_TYPES, native_math_result_type
        expected = {
            'Abs': (1, ('DoubleProperty',)),
            'VSize': (1, ('Vector',)),
            'Vector_Distance': (2, ('Vector', 'Vector')),
        }
        for name, (arity, types) in expected.items():
            with self.subTest(name=name):
                self.assertEqual(MATH_CALLS[name][0], arity)
                self.assertEqual(NATIVE_MATH_INPUT_TYPES[name], types)
                self.assertEqual(native_math_result_type(name), 'DoubleProperty')

    def test_cached_ue57_int64_source_witness_preserves_value_and_vm_offsets(self):
        witness = json.loads((Path(__file__).parent / 'fixtures' / 'dds-int64-source-witness.json').read_text(encoding='utf-8'))
        self.assertEqual(witness['engine_version'], '5.7.4')
        self.assertEqual(witness['package'], '/Game/Fixers/Core/Game/GameInstance/BP_GI_Fixers')
        self.assertEqual(witness['source_sha256'], 'b4683c7ec463524e4d0bf6d0ae381da5962c48a06d4170bb901a567dd5070235')
        self.assertEqual(witness['object_version_ue5'], 'IMPORT_TYPE_HIERARCHIES')
        self.assertEqual(witness['parsed_package_sha256'], '04fd99ba050a8f271757c921ffb3340bfd10cd024950d1ee0591e9d8bbecab4c')
        function = witness['function']
        self.assertEqual(function['ObjectName'], 'ResetRaidConfig')
        self.assertEqual(function['OuterIndex'], 2)
        self.assertEqual(property_type(witness['queue_pool_lobby_id_property']), 'Int64Property')
        bytecode = function['ScriptBytecode']
        self.assertEqual(digest(bytecode), witness['source_bytecode_sha256'])
        package = Package({'ObjectVersionUE5': witness['object_version_ue5']})
        self.assertEqual(sum(memory_size(instruction, package=package) for instruction in bytecode),
                         function['ScriptBytecodeSize'])
        result = translate_function(function, package)
        self.assertEqual(result['source_bytecode_sha256'], witness['source_bytecode_sha256'])
        queue_reset = next(step for step in result['steps'] if step.get('field') == 'QueuePoolLobbyID')
        self.assertEqual(queue_reset['scope'], 'self')
        self.assertEqual(queue_reset['value'], {'op': 'constant', 'value': 0})

    def test_int64_constants_reject_values_that_java_script_cannot_represent_exactly(self):
        from blueprint_migration import expression
        for value in (-(2**53)+1, 2**53-1):
            self.assertEqual(expression(node('EX_Int64Const', Value=value), set(), set()),
                             {'op': 'constant', 'value': value})
        for value in (-(2**53), 2**53, 2**63, -(2**63)-1, True, '0'):
            with self.assertRaisesRegex(BlueprintTranslationError, 'exact JavaScript integer range'):
                expression(node('EX_Int64Const', Value=value), set(), set())
        self.assertEqual(memory_size(node('EX_Int64Const', Value=0)), 9)

    def test_asset_constant_retains_original_import_and_rejects_runtime_objects(self):
        from blueprint_migration import expression
        imports = [{'ObjectName': 'OriginalEquip', 'OuterIndex': -2, 'ClassName': 'AnimMontage', 'ClassPackage': '/Script/Engine'},
                   {'ObjectName': '/Game/Animations/OriginalEquip', 'ClassName': 'Package'}]
        package = Package({'Imports': imports})
        result = expression(node('EX_ObjectConst', Value=-1), set(), set(), package=package)
        self.assertEqual(result['schema']['class'], ['/Script/Engine', 'AnimMontage'])
        self.assertEqual(result['value']['asset'], '/Game/Animations/OriginalEquip.OriginalEquip')
        self.assertEqual(property_type({'SerializedType': 'ObjectProperty', 'PropertyClass': -3},
            Package({'Imports': imports + [{'ObjectName': 'AnimMontage', 'OuterIndex': -4},
                                           {'ObjectName': '/Script/Engine', 'ClassName': 'Package'}]})), 'ObjectProperty')
        for reference in (0, True, 1, -3):
            with self.assertRaises(BlueprintTranslationError):
                expression(node('EX_ObjectConst', Value=reference), set(), set(), package=package)
        for name in ('Actor', 'ActorComponent', 'BlueprintGeneratedClass', 'Default__KismetMathLibrary'):
            imports[0]['ClassName'] = name
            with self.assertRaises(BlueprintTranslationError):
                expression(node('EX_ObjectConst', Value=-1), set(), set(), package=package)
        imports[0]['ClassName'] = 'AnimMontage'; imports[0]['ClassPackage'] = '/Game/Fake'
        with self.assertRaises(BlueprintTranslationError):
            expression(node('EX_ObjectConst', Value=-1), set(), set(), package=package)

    def function(self):
        return {'ObjectName': 'GetState', 'ScriptBytecode': [node('EX_Tracepoint'),
                node('EX_Let', Variable=variable('EX_LocalOutVariable', 'ReturnValue'),
                     Expression=variable('EX_InstanceVariable', 'State')),
                node('EX_Return', ReturnExpression=variable('EX_LocalOutVariable', 'ReturnValue')),
                node('EX_EndOfScript')]}

    def test_source_reads_and_output_assignments_are_preserved(self):
        result = translate_function(self.function())
        self.assertEqual(result['self_reads'], ['State'])
        self.assertEqual(result['output_fields'], ['ReturnValue'])
        self.assertEqual(result['steps'][0]['value'], {'op': 'get', 'scope': 'self', 'field': 'State'})
        self.assertEqual(result['steps'][0]['source_index'], 1)

    def test_unsupported_calls_and_jumps_block_entire_function(self):
        for token in ('EX_CallMath', 'EX_Context'):
            function = self.function(); function['ScriptBytecode'].insert(1, node(token))
            with self.assertRaises(BlueprintTranslationError): translate_function(function)

    def test_instance_assignment_preserves_scope(self):
        function = self.function(); function['ScriptBytecode'][1]['Variable'] = variable('EX_InstanceVariable', 'State')
        function['ScriptBytecode'][2] = node('EX_Return', ReturnExpression=node('EX_Nothing'))
        result = translate_function(function)
        self.assertEqual(result['steps'][0]['scope'], 'self')
        self.assertEqual(result['self_writes'], ['State'])

    def test_only_original_engine_math_library_calls_can_translate(self):
        imports = [{'ObjectName': 'Greater_DoubleDouble', 'ClassName': 'Function', 'OuterIndex': -2},
                   {'ObjectName': 'KismetMathLibrary', 'OuterIndex': -3}, {'ObjectName': '/Script/Engine'}]
        function = self.function()
        function['ScriptBytecode'][1]['Expression'] = node('EX_CallMath', StackNode=-1,
                Parameters=[node('EX_DoubleConst', Value='+0'), node('EX_DoubleConst', Value='-0')])
        result = translate_function(function, Package({'Imports': imports}))
        self.assertEqual(result['steps'][0]['value']['op'], 'math')
        imports[2]['ObjectName'] = '/Game/Fake'
        with self.assertRaises(BlueprintTranslationError): translate_function(function, Package({'Imports': imports}))

    def test_source_ratio_math_keeps_original_native_identity(self):
        imports = [{'ObjectName': 'Divide_DoubleDouble', 'ClassName': 'Function', 'OuterIndex': -2},
                   {'ObjectName': 'KismetMathLibrary', 'OuterIndex': -3}, {'ObjectName': '/Script/Engine'}]
        function = self.function()
        function['ScriptBytecode'][1]['Expression'] = node('EX_CallMath', StackNode=-1,
                Parameters=[node('EX_DoubleConst', Value='25'), node('EX_DoubleConst', Value='100')])
        result = translate_function(function, Package({'Imports': imports}))
        self.assertEqual(result['steps'][0]['value']['name'], 'Divide_DoubleDouble')

    def test_round_requires_the_original_engine_math_import_and_one_argument(self):
        imports = [{'ObjectName': 'Round', 'ClassName': 'Function', 'OuterIndex': -2},
                   {'ObjectName': 'KismetMathLibrary', 'OuterIndex': -3}, {'ObjectName': '/Script/Engine'}]
        function = self.function()
        function['LoadedProperties'] = [{'Name': 'Value', 'SerializedType': 'DoubleProperty', 'PropertyFlags': 'CPF_Parm'}]
        function['ScriptBytecode'][1]['Expression'] = node('EX_CallMath', StackNode=-1,
            Parameters=[variable('EX_LocalVariable', 'Value')])
        package = Package({'Imports': imports, 'Exports': [function]})
        result = translate_function(function, package)
        self.assertEqual(result['steps'][0]['value'], {
            'op': 'math', 'name': 'Round', 'args': [{'op': 'get', 'scope': 'local', 'field': 'Value'}]})

        bad_library = [dict(item) for item in imports]
        bad_library[1]['ObjectName'] = 'FakeMathLibrary'
        with self.assertRaisesRegex(BlueprintTranslationError, 'outside Engine.KismetMathLibrary'):
            translate_function(function, Package({'Imports': bad_library, 'Exports': [function]}))

        function['ScriptBytecode'][1]['Expression']['Parameters'].append(node('EX_DoubleConst', Value='0'))
        with self.assertRaisesRegex(BlueprintTranslationError, 'parameter count'):
            translate_function(function, Package({'Imports': imports, 'Exports': [function]}))

        function['ScriptBytecode'][1]['Expression']['Parameters'] = [node('EX_True')]
        with self.assertRaisesRegex(BlueprintTranslationError, 'original double input'):
            translate_function(function, Package({'Imports': imports, 'Exports': [function]}))

        function['ScriptBytecode'][1]['Expression']['Parameters'] = [variable('EX_LocalVariable', 'Value')]
        function['LoadedProperties'][0]['SerializedType'] = 'FloatProperty'
        with self.assertRaisesRegex(BlueprintTranslationError, 'DoubleProperty'):
            translate_function(function, Package({'Imports': imports, 'Exports': [function]}))

        function['LoadedProperties'][0]['SerializedType'] = 'DoubleProperty'
        function['ScriptBytecode'][1]['Expression']['Parameters'][0]['Variable']['New']['ResolvedOwner'] = True
        with self.assertRaisesRegex(BlueprintTranslationError, 'unresolved source owner'):
            translate_function(function, Package({'Imports': imports, 'Exports': [function]}))

    def test_make_vector_requires_the_witnessed_engine_import_and_three_arguments(self):
        imports = [{'ObjectName': 'MakeVector', 'ClassName': 'Function', 'OuterIndex': -2},
                   {'ObjectName': 'KismetMathLibrary', 'OuterIndex': -3}, {'ObjectName': '/Script/Engine'}]
        function = self.function()
        call = node('EX_CallMath', StackNode=-1, Parameters=[
            node('EX_DoubleConst', Value='1.25'), node('EX_DoubleConst', Value='-2'), node('EX_DoubleConst', Value='3')])
        function['ScriptBytecode'][1]['Expression'] = call
        result = translate_function(function, Package({'Imports': imports}))
        self.assertEqual(result['steps'][0]['value'], {
            'op': 'math', 'name': 'MakeVector', 'args': [
                {'op': 'constant', 'value': 1.25}, {'op': 'constant', 'value': -2.0}, {'op': 'constant', 'value': 3.0}]})

        for invalid in ([call['Parameters'][0], call['Parameters'][1]], call['Parameters'] + [node('EX_DoubleConst', Value='4')]):
            call['Parameters'] = invalid
            with self.assertRaisesRegex(BlueprintTranslationError, 'parameter count'):
                translate_function(function, Package({'Imports': imports}))
        call['Parameters'] = [node('EX_DoubleConst', Value='1'), node('EX_DoubleConst', Value='2'), node('EX_DoubleConst', Value='3')]

        wrong_library = [dict(item) for item in imports]
        wrong_library[1]['ObjectName'] = 'FakeMathLibrary'
        with self.assertRaisesRegex(BlueprintTranslationError, 'outside Engine.KismetMathLibrary'):
            translate_function(function, Package({'Imports': wrong_library}))
        wrong_module = [dict(item) for item in imports]
        wrong_module[2]['ObjectName'] = '/Game/Fake'
        with self.assertRaisesRegex(BlueprintTranslationError, 'outside Engine.KismetMathLibrary'):
            translate_function(function, Package({'Imports': wrong_module}))
        wrong_function = [dict(item) for item in imports]
        wrong_function[0]['ObjectName'] = 'MakeVector2D'
        with self.assertRaisesRegex(BlueprintTranslationError, 'Unsupported native math call'):
            translate_function(function, Package({'Imports': wrong_function}))

    def test_witnessed_vector_rotator_transform_calls_preserve_identity_and_arity(self):
        for name, parameters in (
            ('Add_VectorVector', [variable('EX_LocalVariable', 'A'), variable('EX_LocalVariable', 'B')]),
            ('Subtract_VectorVector', [variable('EX_LocalVariable', 'A'), variable('EX_LocalVariable', 'B')]),
            ('Multiply_VectorVector', [variable('EX_LocalVariable', 'A'), variable('EX_LocalVariable', 'B')]),
            ('Conv_DoubleToVector', [node('EX_DoubleConst', Value='2.5')]),
            ('MakeRotator', [node('EX_FloatConst', Value='10'), node('EX_FloatConst', Value='20'),
                             node('EX_FloatConst', Value='30')]),
            ('MakeTransform', [variable('EX_LocalVariable', 'Location'),
                               variable('EX_LocalVariable', 'Rotation'),
                               variable('EX_LocalVariable', 'Scale')])):
            with self.subTest(name=name):
                imports = [{'ObjectName': name, 'ClassName': 'Function', 'OuterIndex': -2},
                           {'ObjectName': 'KismetMathLibrary', 'OuterIndex': -3},
                           {'ObjectName': '/Script/Engine', 'ClassName': 'Package'},
                           {'ObjectName': 'Vector', 'ClassName': 'ScriptStruct', 'OuterIndex': -6},
                           {'ObjectName': 'Rotator', 'ClassName': 'ScriptStruct', 'OuterIndex': -6},
                           {'ObjectName': '/Script/CoreUObject', 'ClassName': 'Package'}]
                function = self.function()
                if name in ('Add_VectorVector','Subtract_VectorVector','Multiply_VectorVector'):
                    function['LoadedProperties'] = [{'Name':field,'SerializedType':'StructProperty',
                        'Struct':-4,'PropertyFlags':'CPF_None'} for field in ('A','B')]
                elif name == 'MakeTransform':
                    function['LoadedProperties'] = [
                        {'Name':'Location','SerializedType':'StructProperty','Struct':-4,'PropertyFlags':'CPF_None'},
                        {'Name':'Rotation','SerializedType':'StructProperty','Struct':-5,'PropertyFlags':'CPF_None'},
                        {'Name':'Scale','SerializedType':'StructProperty','Struct':-4,'PropertyFlags':'CPF_None'}]
                function['ScriptBytecode'][1]['Expression'] = node('EX_CallMath', StackNode=-1, Parameters=parameters)
                value = translate_function(function, Package({'Imports': imports,'Exports':[function]}))['steps'][0]['value']
                self.assertEqual((value['op'], value['name']), ('math', name))
                self.assertEqual(len(value['args']), len(parameters))
                bad = [dict(item) for item in imports]
                bad[0]['ObjectName'] = name + '_Unsupported'
                with self.assertRaisesRegex(BlueprintTranslationError, 'Unsupported native math call'):
                    translate_function(function, Package({'Imports': bad}))

    def test_witnessed_break_calls_write_only_original_float_output_fields_in_order(self):
        imports = [{'ObjectName': 'BreakVector', 'ClassName': 'Function', 'OuterIndex': -2},
                   {'ObjectName': 'KismetMathLibrary', 'OuterIndex': -3},
                   {'ObjectName': '/Script/Engine', 'ClassName': 'Package'},
                   {'ObjectName':'Vector','ClassName':'ScriptStruct','OuterIndex':-5},
                   {'ObjectName':'/Script/CoreUObject','ClassName':'Package'}]
        function = self.function()
        function['LoadedProperties'] = [{'Name': name, 'SerializedType': 'FloatProperty', 'PropertyFlags': 'CPF_None'}
                                        for name in ('X', 'Y', 'Z')]
        function['LoadedProperties'].append({'Name': 'Input', 'SerializedType': 'StructProperty', 'Struct':-4,'PropertyFlags': 'CPF_None'})
        call = node('EX_CallMath', StackNode=-1, Parameters=[variable('EX_LocalVariable', 'Input'),
            variable('EX_LocalVariable', 'X'), variable('EX_LocalVariable', 'Y'), variable('EX_LocalVariable', 'Z')])
        function['ScriptBytecode'][1]['Expression'] = call
        package = Package({'Imports': imports, 'Exports': [function]})
        value = translate_function(function, package)['steps'][0]['value']
        self.assertEqual(value, {'op': 'math_outputs', 'name': 'BreakVector',
            'args': [{'op': 'get', 'scope': 'local', 'field': 'Input'}], 'components': ['X', 'Y', 'Z'],
            'targets': [{'op': 'get', 'scope': 'local', 'field': name, 'type': 'FloatProperty'} for name in ('X','Y','Z')]})
        function['LoadedProperties'][1]['SerializedType'] = 'DoubleProperty'
        with self.assertRaisesRegex(BlueprintTranslationError, 'output property type'):
            translate_function(function, package)
        function['LoadedProperties'][1]['SerializedType'] = 'FloatProperty'
        function['ScriptBytecode'][1]['Expression']['Parameters'].pop()
        with self.assertRaisesRegex(BlueprintTranslationError, 'parameter count'):
            translate_function(function, package)

    def test_witnessed_break_rotator_uses_roll_pitch_yaw_source_output_order(self):
        imports = [{'ObjectName': 'BreakRotator', 'ClassName': 'Function', 'OuterIndex': -2},
                   {'ObjectName': 'KismetMathLibrary', 'OuterIndex': -3},
                   {'ObjectName': '/Script/Engine', 'ClassName': 'Package'},
                   {'ObjectName':'Rotator','ClassName':'ScriptStruct','OuterIndex':-5},
                   {'ObjectName':'/Script/CoreUObject','ClassName':'Package'}]
        function = self.function()
        function['LoadedProperties'] = [{'Name': name, 'SerializedType': 'FloatProperty', 'PropertyFlags': 'CPF_None'}
                                        for name in ('Roll','Pitch','Yaw')]
        function['LoadedProperties'].append({'Name':'Input','SerializedType':'StructProperty','Struct':-4,'PropertyFlags':'CPF_None'})
        function['ScriptBytecode'][1]['Expression'] = node('EX_CallMath', StackNode=-1, Parameters=[
            variable('EX_LocalVariable','Input'), variable('EX_LocalVariable','Roll'),
            variable('EX_LocalVariable','Pitch'), variable('EX_LocalVariable','Yaw')])
        value = translate_function(function, Package({'Imports':imports,'Exports':[function]}))['steps'][0]['value']
        self.assertEqual(value['components'], ['Roll','Pitch','Yaw'])
        self.assertEqual([target['field'] for target in value['targets']], ['Roll','Pitch','Yaw'])

    def test_witnessed_break_outputs_keep_the_original_event_frame_identity(self):
        imports = [{'ObjectName':'BreakVector','ClassName':'Function','OuterIndex':-2},
                   {'ObjectName':'KismetMathLibrary','OuterIndex':-3},
                   {'ObjectName':'/Script/Engine','ClassName':'Package'},
                   {'ObjectName':'Vector','ClassName':'ScriptStruct','OuterIndex':-5},
                   {'ObjectName':'/Script/CoreUObject','ClassName':'Package'}]
        event = {'ObjectName':'ExecuteUbergraph_Test','OuterIndex':2,'LoadedProperties':[
            *[{'Name':name,'SerializedType':'FloatProperty','PropertyFlags':'CPF_None'} for name in ('X','Y','Z')],
            {'Name':'Input','SerializedType':'StructProperty','Struct':-4,'PropertyFlags':'CPF_None'}],
            'ScriptBytecode':[node('EX_Tracepoint'),node('EX_CallMath',StackNode=-1,Parameters=[
                variable('EX_LocalVariable','Input'),variable('EX_LocalVariable','X'),
                variable('EX_LocalVariable','Y'),variable('EX_LocalVariable','Z')]),
                node('EX_Return',ReturnExpression=node('EX_Nothing')),node('EX_EndOfScript')]}
        owner = {'ObjectName':'Test_C','LoadedProperties':[]}
        package=Package({'Imports':imports,'Exports':[event,owner]})
        report=translate_package(package)
        program=report['functions']['ExecuteUbergraph_Test']
        self.assertEqual(program['persistent_types'],{'1':{'Input':'StructProperty','X':'FloatProperty',
            'Y':'FloatProperty','Z':'FloatProperty'}})
        call=program['steps'][0]['value']
        self.assertEqual([target['frame'] for target in call['targets']],[1,1,1])

    def test_int_selection_and_conversion_require_original_native_and_arity(self):
        for name, arity in [('Min', 2), ('Max', 2), ('Conv_IntToDouble', 1), ('SelectInt', 3),
                            ('Lerp', 3), ('FMin', 2), ('FMax', 2), ('InRange_FloatFloat', 5)]:
            imports = [{'ObjectName': name, 'ClassName': 'Function', 'OuterIndex': -2},
                       {'ObjectName': 'KismetMathLibrary', 'OuterIndex': -3}, {'ObjectName': '/Script/Engine'}]
            function = self.function()
            call = node('EX_CallMath', StackNode=-1, Parameters=[node('EX_IntOne') for _ in range(arity)])
            if name == 'SelectInt': call['Parameters'][-1] = node('EX_True')
            if name == 'InRange_FloatFloat': call['Parameters'][-2:] = [node('EX_True'), node('EX_True')]
            function['ScriptBytecode'][1]['Expression'] = call
            self.assertEqual(translate_function(function, Package({'Imports': imports}))['steps'][0]['value']['name'], name)
            call['Parameters'].pop()
            with self.assertRaisesRegex(BlueprintTranslationError, 'parameter count'):
                translate_function(function, Package({'Imports': imports}))

    def test_unsupported_unicode_name_constant_blocks_the_source_comparison(self):
        imports = [{'ObjectName': 'EqualEqual_NameName', 'ClassName': 'Function', 'OuterIndex': -2},
                   {'ObjectName': 'KismetMathLibrary', 'OuterIndex': -3}, {'ObjectName': '/Script/Engine'}]
        function = self.function()
        function['ScriptBytecode'][1]['Expression'] = node('EX_CallMath', StackNode=-1,
                Parameters=[node('EX_NameConst', Value='café'), node('EX_NameConst', Value='CAFÉ')])
        with self.assertRaisesRegex(BlueprintTranslationError, 'non-ASCII'):
            translate_function(function, Package({'Imports': imports}))

    def test_incomplete_scripts_and_unsafe_fields_are_rejected(self):
        function = self.function(); function['ScriptBytecode'].pop()
        with self.assertRaises(BlueprintTranslationError): translate_function(function)
        for name in ('__proto__', 'constructor', 'prototype'):
            function = self.function(); function['ScriptBytecode'][1]['Expression'] = variable('EX_InstanceVariable', name)
            with self.assertRaises(BlueprintTranslationError): translate_function(function)

    def test_delegate_signatures_are_not_counted_as_translated_gameplay(self):
        function = self.function(); declaration = self.function(); declaration['ObjectName'] = 'Event__DelegateSignature'
        result = translate_package(Package({'Exports': [function, declaration]}))
        self.assertEqual(result['counts'], {'translated': 1, 'blocked': 0, 'declarations': 1, 'no_op_functions': 0})

    def test_enum_uses_original_underlying_type_and_unknown_types_are_blocked(self):
        self.assertEqual(property_type({'SerializedType': 'EnumProperty', 'UnderlyingProp': {'SerializedType': 'ByteProperty'}}), 'ByteProperty')
        with self.assertRaises(BlueprintTranslationError): property_type({'SerializedType': 'EnumProperty'})
        with self.assertRaises(BlueprintTranslationError): property_type({'SerializedType': 'ObjectProperty'})

    def test_control_flow_targets_use_exact_vm_memory_boundaries(self):
        bytecode = [node('EX_JumpIfNot', CodeOffset=23, BooleanExpression=variable('EX_LocalVariable', 'Condition')),
                    node('EX_Return', ReturnExpression=variable('EX_LocalVariable', 'Value')),
                    node('EX_Return', ReturnExpression=node('EX_IntZero')), node('EX_EndOfScript')]
        # Branch: 5 + 9; first return: 1 + 9. Target 24, not 23.
        bytecode[0]['CodeOffset'] = 24
        size = sum(memory_size(instruction) for instruction in bytecode)
        function = {'ObjectName': 'Conditional', 'ScriptBytecode': bytecode, 'ScriptBytecodeSize': size}
        result = translate_function(function)
        self.assertEqual(result['steps'][0]['target'], 2)
        self.assertEqual(result['memory_size_verified'], 27)
        bytecode[0]['CodeOffset'] = 23
        with self.assertRaisesRegex(BlueprintTranslationError, 'boundary'): translate_function(function)
        bytecode[0]['CodeOffset'] = 24; function['ScriptBytecodeSize'] = size - 1
        with self.assertRaisesRegex(BlueprintTranslationError, 'memory size'): translate_function(function)

    def test_unsupported_memory_layout_is_never_guessed(self):
        with self.assertRaises(BlueprintTranslationError): memory_size(node('EX_Context'))
        self.assertEqual(memory_size(node('EX_NameConst', Value='Socket')), 13)
        self.assertEqual(memory_size(node('EX_UnicodeStringConst', Value='😀')), 7)

    def test_struct_member_reads_preserve_fields_and_vm_layout_without_writes(self):
        member = node('EX_StructMemberContext', StructMemberExpression={'New': {'Path': ['Quantity']}},
                      StructExpression=variable('EX_LocalVariable', 'InputData'))
        function = self.function(); function['ScriptBytecode'][1]['Expression'] = member
        function['LoadedProperties'] = [{'Name': 'InputData', 'SerializedType': 'StructProperty', 'Struct': -1, 'PropertyFlags': 'CPF_Parm'},
                                        {'Name': 'ReturnValue', 'SerializedType': 'IntProperty', 'PropertyFlags': 'CPF_Parm, CPF_OutParm'}]
        package = Package({'Exports': [function], 'Imports': [{'ObjectName': 'Original', 'OuterIndex': -2},
                          {'ObjectName': '/Game/Struct', 'ClassName': 'Package'}]})
        schema = {'type': 'StructProperty', 'source': '/Game/Struct', 'fields': {'Quantity': {'type':'IntProperty','default':0}}, 'default': {'Quantity':0}}
        result = translate_package(package, {('/Game/Struct', 'Original'): schema})['functions']['GetState']
        self.assertEqual(result['steps'][0]['value']['field'], 'Quantity')
        self.assertEqual(result['input_fields'], ['InputData'])
        self.assertEqual(result['field_types']['local']['InputData'], 'StructProperty')
        self.assertEqual(memory_size(member), 18)
        function['ScriptBytecode'][1]['Variable'] = member
        with self.assertRaisesRegex(BlueprintTranslationError, 'assignment target'): translate_function(function)


    def test_source_array_set_requires_real_engine_context_and_class_array_schema(self):
        imports = [
            {'ObjectName': 'Array_Set', 'ClassName': 'Function', 'OuterIndex': -2},
            {'ObjectName': 'KismetArrayLibrary', 'OuterIndex': -3},
            {'ObjectName': '/Script/Engine', 'ClassName': 'Package'},
            {'ObjectName': 'Default__KismetArrayLibrary', 'OuterIndex': -3},
        ]
        call = node('EX_FinalFunction', StackNode=-1, Parameters=[
            variable('EX_InstanceVariable', 'Items'),
            variable('EX_LocalVariable', 'Index'),
            variable('EX_LocalVariable', 'Item'),
            variable('EX_LocalVariable', 'Fit')])
        call['Parameters'][0]['Variable']['New']['ResolvedOwner'] = 2
        context = node('EX_Context', ObjectExpression=node('EX_ObjectConst', Value=-4),
                       ContextExpression=call, Offset=memory_size(call))
        function = {'ObjectName': 'WriteSlot', 'OuterIndex': 2,
                    'LoadedProperties': [
                        {'Name': 'Index', 'SerializedType': 'IntProperty', 'PropertyFlags': 'CPF_Parm'},
                        {'Name': 'Item', 'SerializedType': 'NameProperty', 'PropertyFlags': 'CPF_Parm'},
                        {'Name': 'Fit', 'SerializedType': 'BoolProperty', 'PropertyFlags': 'CPF_Parm'}],
                    'ScriptBytecode': [context, node('EX_Return', ReturnExpression=node('EX_Nothing')), node('EX_EndOfScript')]}
        cls = {'ObjectName': 'Inventory_C', 'LoadedProperties': [
            {'Name': 'Items', 'SerializedType': 'ArrayProperty', 'Inner': {'SerializedType': 'NameProperty'}}]}
        def package(imports=imports):
            return Package({'Exports': [function, cls], 'Imports': imports})
        result = translate_package(package())
        program = result['functions']['WriteSlot']
        self.assertEqual(result['counts']['translated'], 1)
        self.assertEqual(program['self_writes'], ['Items'])
        expr = program['steps'][0]['value']
        self.assertEqual(expr['op'], 'array_set')
        self.assertEqual(expr['element']['default'], 'None')
        self.assertEqual(program['schemas']['self']['Items']['element']['type'], 'NameProperty')
        for violation in ('bad_library', 'wrong_offset', 'wrong_owner', 'no_type'):
            if violation == 'bad_library':
                alt = [dict(i) for i in imports]; alt[3]['ObjectName'] = 'FakeDefaultArrayLibrary'
                self.assertEqual(translate_package(package(alt))['counts']['translated'], 0)
            elif violation == 'wrong_offset':
                context['Offset'] += 1
                self.assertEqual(translate_package(package())['counts']['translated'], 0)
                context['Offset'] -= 1
            elif violation == 'wrong_owner':
                call['Parameters'][0]['Variable']['New']['ResolvedOwner'] = 1
                self.assertEqual(translate_package(package())['counts']['translated'], 0)
                call['Parameters'][0]['Variable']['New']['ResolvedOwner'] = 2
            else:
                cls['LoadedProperties'][0]['Inner'] = {'SerializedType': 'UnsupportedProperty'}
                self.assertEqual(translate_package(package())['counts']['translated'], 0)
                cls['LoadedProperties'][0]['Inner'] = {'SerializedType': 'NameProperty'}


    def test_source_array_add_preserves_returned_index_and_original_array_owner(self):
        imports = [
            {'ObjectName': 'Array_Add', 'ClassName': 'Function', 'OuterIndex': -2},
            {'ObjectName': 'KismetArrayLibrary', 'OuterIndex': -3},
            {'ObjectName': '/Script/Engine', 'ClassName': 'Package'},
            {'ObjectName': 'Default__KismetArrayLibrary', 'OuterIndex': -3},
        ]
        args = [variable('EX_InstanceVariable', 'Items'), variable('EX_LocalVariable', 'Item')]
        args[0]['Variable']['New']['ResolvedOwner'] = 2
        call = node('EX_FinalFunction', StackNode=-1, Parameters=args)
        context = node('EX_Context', ObjectExpression=node('EX_ObjectConst', Value=-4),
                       ContextExpression=call, Offset=memory_size(call))
        function = {'ObjectName': 'AddSlot', 'OuterIndex': 2,
                    'LoadedProperties': [{'Name': 'Item', 'SerializedType': 'NameProperty', 'PropertyFlags': 'CPF_Parm'},
                                         {'Name': 'Result', 'SerializedType': 'IntProperty', 'PropertyFlags': 'CPF_Parm, CPF_OutParm'}],
                    'ScriptBytecode': [
                        node('EX_Let', Variable=variable('EX_LocalOutVariable', 'Result'), Expression=context),
                        node('EX_Return', ReturnExpression=variable('EX_LocalOutVariable', 'Result')),
                        node('EX_EndOfScript')]}
        cls = {'ObjectName': 'Inventory_C', 'LoadedProperties': [{
            'Name': 'Items', 'SerializedType': 'ArrayProperty', 'Inner': {'SerializedType': 'NameProperty'}}]}
        def translate(imps=imports):
            return translate_package(Package({'Exports': [function, cls], 'Imports': imps}))
        result = translate()
        self.assertEqual(result['counts']['translated'], 1)
        program = result['functions']['AddSlot']
        self.assertEqual(program['self_writes'], ['Items'])
        self.assertEqual(program['steps'][0]['value']['op'], 'array_add')
        self.assertEqual(program['output_fields'], ['Result'])
        self.assertEqual(program['steps'][0]['value']['element']['default'], 'None')
        bad_imports = [dict(i) for i in imports]
        bad_imports[1]['ObjectName'] = 'CustomArrayLibrary'
        self.assertEqual(translate(bad_imports)['counts']['translated'], 0)
        context['Offset'] += 1
        self.assertEqual(translate()['counts']['translated'], 0)
        context['Offset'] -= 1
        cls['LoadedProperties'][0]['Inner'] = {'SerializedType': 'UnresolvedProperty'}
        self.assertEqual(translate()['counts']['translated'], 0)

    def call_package(self):
        caller = {'ObjectName': 'Caller', 'OuterIndex': 3, 'LoadedProperties': [
            {'Name': 'Result', 'SerializedType': 'BoolProperty', 'PropertyFlags': 'CPF_None'}],
            'ScriptBytecode': [node('EX_LocalVirtualFunction', VirtualFunctionName='Predicate', Parameters=[
                node('EX_True'), variable('EX_LocalVariable', 'Result')]),
                node('EX_Return', ReturnExpression=variable('EX_LocalVariable', 'Result')), node('EX_EndOfScript')]}
        callee = {'ObjectName': 'Predicate', 'OuterIndex': 3, 'LoadedProperties': [
            {'Name': 'Input', 'SerializedType': 'BoolProperty', 'PropertyFlags': 'CPF_Parm'},
            {'Name': 'Allowed', 'SerializedType': 'BoolProperty', 'PropertyFlags': 'CPF_Parm, CPF_OutParm'}],
            'ScriptBytecode': [node('EX_LetBool', VariableExpression=variable('EX_LocalOutVariable', 'Allowed'),
                                    AssignmentExpression=variable('EX_LocalVariable', 'Input')),
                               node('EX_Return', ReturnExpression=node('EX_Nothing')), node('EX_EndOfScript')]}
        return Package({'Exports': [caller, callee, {'ObjectName': 'Test_C', 'LoadedProperties': []}]})

    def test_local_call_preserves_signature_and_output_reference(self):
        result = translate_package(self.call_package())
        self.assertEqual(result['counts']['translated'], 2)
        call = result['functions']['Caller']['steps'][0]['value']
        self.assertEqual(call['export_index'], 2)
        self.assertEqual(call['bindings'][1]['target']['field'], 'Result')
        self.assertEqual(call['bindings'][1]['parameter'], 'Allowed')

    def test_untranslated_callee_and_foreign_owner_block_whole_caller(self):
        package = self.call_package(); package.exports[1]['ScriptBytecode'][0] = node('EX_Context')
        result = translate_package(package)
        self.assertFalse(result['functions'])
        self.assertTrue(any('dependency' in item['reason'] for item in result['blocked']))
        package = self.call_package(); package.exports[1]['OuterIndex'] = 4
        self.assertNotIn('Caller', translate_package(package)['functions'])
