import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from blueprint_migration import BlueprintTranslationError, translate_function, translate_package, property_type, memory_size
from umg_migration import Package


def node(token, **values): return {'$type': 'UAssetAPI.Kismet.Bytecode.Expressions.' + token + ', UAssetAPI', **values}
def variable(token, name): return node(token, Variable={'New': {'Path': [name], 'ResolvedOwner': 1}})


class BlueprintMigrationTests(unittest.TestCase):
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
        function['LoadedProperties'] = [{'Name': 'InputData', 'SerializedType': 'StructProperty', 'PropertyFlags': 'CPF_Parm'},
                                        {'Name': 'ReturnValue', 'SerializedType': 'IntProperty', 'PropertyFlags': 'CPF_Parm, CPF_OutParm'}]
        result = translate_package(Package({'Exports': [function]}))['functions']['GetState']
        self.assertEqual(result['steps'][0]['value']['field'], 'Quantity')
        self.assertEqual(result['input_fields'], ['InputData'])
        self.assertEqual(result['field_types']['local']['InputData'], 'StructProperty')
        self.assertEqual(memory_size(member), 18)
        function['ScriptBytecode'][1]['Variable'] = member
        with self.assertRaisesRegex(BlueprintTranslationError, 'assignment target'): translate_function(function)

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
