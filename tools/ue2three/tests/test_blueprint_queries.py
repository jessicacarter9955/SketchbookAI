import copy
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from umg_migration import Package
from blueprint_migration import translate_package
from blueprint_queries import prune_queries


def node(token, **data): return {'$type': 'UAssetAPI.Kismet.Bytecode.Expressions.'+token+', UAssetAPI', **data}
def var(token, field, owner): return node(token, Variable={'New': {'Path': [field], 'ResolvedOwner': owner}})


class ComponentQueryTests(unittest.TestCase):
    def packages(self):
        imports = [{'ObjectName': 'ActorComponent', 'OuterIndex': -2}, {'ObjectName': '/Script/Engine', 'ClassName': 'Package'},
                   {'ObjectName': 'Inventory_C', 'OuterIndex': -4}, {'ObjectName': '/Game/Inventory', 'ClassName': 'Package'}]
        source = Package({'Imports': copy.deepcopy(imports), 'Exports': [
            {'ObjectName': 'Inventory_C', 'SuperStruct': -1, 'LoadedProperties': [{'Name': 'Count', 'SerializedType': 'IntProperty'}]},
            {'ObjectName': 'ReadCount', 'OuterIndex': 1, 'LoadedProperties': [
                {'Name': 'CountOut', 'SerializedType': 'IntProperty', 'PropertyFlags': 'CPF_Parm, CPF_OutParm'}],
             'ScriptBytecode': [node('EX_Let', Variable=var('EX_LocalOutVariable', 'CountOut', 2), Expression=var('EX_InstanceVariable', 'Count', 1)),
                                node('EX_Return', ReturnExpression=node('EX_Nothing')), node('EX_EndOfScript')]}]})
        caller = Package({'Imports': copy.deepcopy(imports), 'Exports': [
            {'ObjectName': 'Combat_C', 'SuperStruct': -1, 'LoadedProperties': [{'Name': 'Inventory', 'SerializedType': 'ObjectProperty', 'PropertyClass': -3}]},
            {'ObjectName': 'ReadInventory', 'OuterIndex': 1, 'LoadedProperties': [
                {'Name': 'Value', 'SerializedType': 'IntProperty', 'PropertyFlags': 'CPF_Parm, CPF_OutParm'}],
             'ScriptBytecode': [node('EX_Context', ObjectExpression=var('EX_InstanceVariable', 'Inventory', 1), Offset=23,
                    ContextExpression=node('EX_LocalVirtualFunction', VirtualFunctionName='ReadCount', Parameters=[var('EX_LocalOutVariable', 'Value', 2)])),
                                node('EX_Return', ReturnExpression=node('EX_Nothing')), node('EX_EndOfScript')]}]})
        pool = {'/Game/Inventory': source, '/Game/Combat': caller}
        for package in pool.values(): package.source_packages = pool; package.source_structs = {}
        return pool

    def test_exact_original_component_query_and_schemas_translate(self):
        pool = self.packages(); result = {name: translate_package(package) for name, package in pool.items()}
        prune_queries(result)
        program = result['/Game/Combat']['functions']['ReadInventory']
        call = program['steps'][0]['value']
        self.assertEqual(call['op'], 'component_query'); self.assertEqual(call['package'], '/Game/Inventory')
        self.assertEqual(call['export_index'], 2)
        self.assertEqual(program['schemas']['self']['Inventory']['reference_kind'], 'runtime_component')
        self.assertIsNone(result['/Game/Combat']['default_state']['Inventory'])

    def test_wrong_output_type_context_offset_or_class_reject_whole_function(self):
        for change in ('type', 'offset', 'class'):
            pool = self.packages(); caller = pool['/Game/Combat']; call = caller.exports[1]['ScriptBytecode'][0]
            if change == 'type': caller.exports[1]['LoadedProperties'][0]['SerializedType'] = 'BoolProperty'
            elif change == 'offset': call['Offset'] = 24
            else: caller.imports[2]['ObjectName'] = 'Unrelated_C'
            result = translate_package(caller)
            self.assertNotIn('ReadInventory', result['functions'])

    def test_missing_mutating_or_effectful_original_receiver_blocks_caller(self):
        for change in ('missing', 'write', 'effect', 'persistent'):
            result = {name: translate_package(package) for name, package in self.packages().items()}
            callee = result['/Game/Inventory']['functions']['ReadCount']
            if change == 'missing': del result['/Game/Inventory']['functions']['ReadCount']
            elif change == 'write': callee['self_writes'] = ['Count']
            elif change == 'effect': callee['steps'].insert(0, {'op': 'evaluate', 'value': {'op': 'broadcast'}})
            else: callee['persistent_types'] = {'3': {'Count': 'IntProperty'}}
            prune_queries(result)
            self.assertNotIn('ReadInventory', result['/Game/Combat']['functions'])
            self.assertEqual(result['/Game/Combat']['counts']['translated'], 0)

    def test_query_outputs_cannot_write_const_reference_inputs(self):
        pool = self.packages()
        pool['/Game/Combat'].exports[1]['LoadedProperties'][0]['PropertyFlags'] = 'CPF_Parm, CPF_OutParm, CPF_ConstParm'
        result = translate_package(pool['/Game/Combat'])
        self.assertNotIn('ReadInventory', result['functions'])

    def test_class_enum_defaults_use_original_names_and_never_become_null_or_guessed_zero(self):
        package = self.packages()['/Game/Inventory']
        package.imports.extend([{'ObjectName': 'SlotType', 'OuterIndex': -6}, {'ObjectName': '/Game/SlotType', 'ClassName': 'Package'}])
        package.exports[0]['LoadedProperties'].append({'Name': 'Slot', 'SerializedType': 'ByteProperty', 'Enum': -5})
        package.exports.append({'ObjectName': 'Default__Inventory_C', 'Data': [
            {'Name': 'Slot', 'ByteType': 'FName', 'EnumValue': 'SlotType::NewEnumerator36'}]})
        package.source_enums = {('/Game/SlotType', 'SlotType'): {'SlotType::NewEnumerator36': 27}}
        result = translate_package(package)
        self.assertEqual(result['default_state']['Slot'], 27)
        package.source_enums = {}
        result = translate_package(package)
        self.assertNotIn('Slot', result['default_state'])
        self.assertIn('Slot', result['unavailable_default_fields'])

    def test_cross_component_cycles_cannot_read_an_outdated_caller_snapshot(self):
        result = {name: translate_package(package) for name, package in self.packages().items()}
        original = result['/Game/Inventory']['functions']['ReadCount']
        original['steps'].insert(0, {'op': 'evaluate', 'value': {'op': 'component_query', 'package': '/Game/Combat',
            'function': 'ReadInventory', 'export_index': 2}})
        prune_queries(result)
        self.assertNotIn('ReadInventory', result['/Game/Combat']['functions'])


if __name__ == '__main__': unittest.main()
