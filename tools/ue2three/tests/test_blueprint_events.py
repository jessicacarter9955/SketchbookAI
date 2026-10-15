import unittest
from test_blueprint_migration import node, variable
from blueprint_migration import translate_package, translate_function, memory_size, BlueprintTranslationError
from umg_migration import Package


class BlueprintEventsTests(unittest.TestCase):
    def package(self):
        # 0 push(5), 5 computed(10), 15 let(19), 34 pop(1),
        # 35 unsupported-context(24), 59 return(2), 61 end(1).
        graph = {'ObjectName': 'ExecuteUbergraph_Test', 'OuterIndex': 3,
                 'LoadedProperties': [{'Name': 'EntryPoint', 'SerializedType': 'IntProperty', 'PropertyFlags': 'CPF_Parm'},
                                      {'Name': 'Value', 'SerializedType': 'BoolProperty'}],
                 'ScriptBytecode': [node('EX_PushExecutionFlow', PushingAddress=61),
                    node('EX_ComputedJump', CodeOffsetExpression=node('EX_LocalVariable', Variable={'New': {'Path': ['EntryPoint'], 'ResolvedOwner': 2}})),
                    node('EX_LetBool', VariableExpression=variable('EX_InstanceVariable', 'Enabled'), AssignmentExpression=node('EX_LocalVariable', Variable={'New': {'Path': ['Value'], 'ResolvedOwner': 2}})),
                    node('EX_PopExecutionFlow'),
                    node('EX_Context', ObjectExpression=node('EX_Self'), ContextExpression=node('EX_FinalFunction', StackNode=-1, Parameters=[])),
                    node('EX_Return', ReturnExpression=node('EX_Nothing')), node('EX_EndOfScript')],
                 'ScriptBytecodeSize': 61}
        graph['ScriptBytecode'][0]['PushingAddress'] = 59
        graph['ScriptBytecodeSize'] = 62
        wrapper = {'ObjectName': 'SetEnabled', 'OuterIndex': 3,
                   'LoadedProperties': [{'Name': 'Input', 'SerializedType': 'BoolProperty', 'PropertyFlags': 'CPF_Parm'}],
                   'ScriptBytecode': [node('EX_LetValueOnPersistentFrame', DestinationProperty={'New': {'Path': ['Value'], 'ResolvedOwner': 2}},
                                           AssignmentExpression=variable('EX_LocalVariable', 'Input')),
                       node('EX_LocalFinalFunction', StackNode=2, Parameters=[node('EX_IntConst', Value=15)]),
                       node('EX_Return', ReturnExpression=node('EX_Nothing')), node('EX_EndOfScript')]}
        cls = {'ObjectName': 'Test_C', 'LoadedProperties': [{'Name': 'Enabled', 'SerializedType': 'BoolProperty'}]}
        return Package({'Exports': [wrapper, graph, cls]})

    def test_source_entry_translates_despite_unreachable_native_effect(self):
        package = self.package(); result = translate_package(package)
        self.assertIn('SetEnabled', result['functions'])
        event = result['event_programs']['ExecuteUbergraph_Test@15']
        self.assertEqual(event['memory_size_verified'], 62)
        self.assertNotIn(4, [step['source_index'] for step in event['steps']])
        self.assertEqual(event['steps'][0]['target'], 4)
        self.assertEqual(event['self_writes'], ['Enabled'])
        self.assertEqual(event['persistent_types'], {'2': {'Value': 'BoolProperty'}})
        self.assertEqual(result['counts']['translated'], 1)  # Internal helper not double-counted.

    def test_unsupported_reachable_effect_blocks_wrapper_and_entry(self):
        package = self.package(); package.exports[0]['ScriptBytecode'][1]['Parameters'][0]['Value'] = 35
        result = translate_package(package)
        self.assertNotIn('SetEnabled', result['functions'])
        self.assertTrue(result['event_blocked'])

    def test_misaligned_event_and_mismatched_graph_size_are_rejected(self):
        for change in ('offset', 'size'):
            package = self.package()
            if change == 'offset': package.exports[0]['ScriptBytecode'][1]['Parameters'][0]['Value'] = 16
            else: package.exports[1]['ScriptBytecodeSize'] += 1
            self.assertFalse(translate_package(package)['functions'])

    def test_event_destination_must_be_the_original_owner_and_declared_field(self):
        for name, owner in [('Missing', 2), ('Value', 3)]:
            package = self.package()
            package.exports[0]['ScriptBytecode'][0]['DestinationProperty']['New'].update(Path=[name], ResolvedOwner=owner)
            self.assertNotIn('SetEnabled', translate_package(package)['functions'])

    def test_computed_entry_is_not_guessed_from_a_runtime_argument(self):
        package = self.package()
        package.exports[0]['ScriptBytecode'][1]['Parameters'] = [variable('EX_LocalVariable', 'Offset')]
        self.assertNotIn('SetEnabled', translate_package(package)['functions'])

    def test_pop_underflow_and_unknown_layout_fail_closed(self):
        package = self.package(); graph = package.exports[1]
        graph['ScriptBytecode'][0] = node('EX_PopExecutionFlow')
        with self.assertRaises(BlueprintTranslationError): translate_function(graph, package, 15)
        with self.assertRaises(BlueprintTranslationError): memory_size(node('EX_NewUnknown'))
        with self.assertRaises(BlueprintTranslationError): memory_size(node('EX_VectorConst'))


if __name__ == '__main__': unittest.main()
