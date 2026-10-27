import copy
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from umg_migration import Package
from blueprint_migration import translate_package, expression, BlueprintTranslationError, memory_size
from blueprint_queries import prune_queries


def node(token, **data): return {'$type': 'UAssetAPI.Kismet.Bytecode.Expressions.'+token+', UAssetAPI', **data}
def var(token, field, owner): return node(token, Variable={'New': {'Path': [field], 'ResolvedOwner': owner}})


class ComponentQueryTests(unittest.TestCase):
    def packages(self):
        imports = [{'ObjectName': 'ActorComponent', 'OuterIndex': -2}, {'ObjectName': '/Script/Engine', 'ClassName': 'Package'},
                   {'ObjectName': 'Inventory_C', 'OuterIndex': -4, 'ClassName':'Class'},
                   {'ObjectName': '/Game/Inventory', 'ClassName': 'Package'}]
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

    def test_source_component_lookup_checks_actor_class_identity_and_context_memory(self):
        pool = self.packages(); caller = pool['/Game/Combat']; caller._active_function = caller.exports[1]
        caller.imports.extend([{'ObjectName': 'Actor', 'OuterIndex': -2},
                              {'ObjectName': 'GetComponentByClass', 'ClassName': 'Function', 'OuterIndex': -5}])
        caller.exports[0]['LoadedProperties'].append({'Name': 'Owner', 'SerializedType': 'ObjectProperty', 'PropertyClass': -5})
        call = node('EX_Context', ObjectExpression=var('EX_InstanceVariable','Owner',1),Offset=19,
                    ContextExpression=node('EX_FinalFunction',StackNode=-6,Parameters=[node('EX_ObjectConst',Value=-3)]))
        result = expression(call,set(),set(),package=caller,owner=1)
        self.assertEqual(result['op'],'native_find_component'); self.assertEqual(result['package'],'/Game/Inventory')
        call['Offset'] += 1
        with self.assertRaisesRegex(BlueprintTranslationError,'layout'): expression(call,set(),set(),package=caller,owner=1)
        call['Offset'] = 19; caller.imports[2]['ObjectName'] = 'Foreign_C'
        with self.assertRaisesRegex(BlueprintTranslationError,'component class'): expression(call,set(),set(),package=caller,owner=1)

    def test_component_member_requires_original_field_owner_and_schema(self):
        pool=self.packages();caller=pool['/Game/Combat'];caller._active_function=caller.exports[1]
        pointer={'New':{'Path':['Count'],'ResolvedOwner':-3}}
        call=node('EX_Context',ObjectExpression=var('EX_InstanceVariable','Inventory',1),Offset=9,RValuePointer=pointer,
                  ContextExpression=node('EX_InstanceVariable',Variable=pointer))
        result=expression(call,set(),set(),package=caller,owner=1)
        self.assertEqual(result['op'],'component_member');self.assertEqual(result['schema']['type'],'IntProperty')
        call['ContextExpression']['Variable']={'New':{'Path':['Count'],'ResolvedOwner':-1}}
        with self.assertRaisesRegex(BlueprintTranslationError,'owner'): expression(call,set(),set(),package=caller,owner=1)

    def test_original_clock_requires_exact_native_function_and_self_world_context(self):
        caller=self.packages()['/Game/Combat']
        caller.imports.extend([{'ObjectName':'KismetSystemLibrary','OuterIndex':-2},
                              {'ObjectName':'GetGameTimeInSeconds','ClassName':'Function','OuterIndex':-5}])
        call=node('EX_CallMath',StackNode=-6,Parameters=[node('EX_Self')])
        self.assertEqual(expression(call,set(),set(),package=caller,owner=1),{'op':'native_game_time','source_owner_index':1})
        call['Parameters']=[node('EX_NoObject')]
        with self.assertRaisesRegex(BlueprintTranslationError,'world context'): expression(call,set(),set(),package=caller,owner=1)

    def test_is_valid_preserves_a_native_component_receiver_schema(self):
        package=Package({'Imports':[{'ObjectName':'GroomComponent','OuterIndex':-2},
            {'ObjectName':'/Script/HairStrandsCore','ClassName':'Package'},
            {'ObjectName':'/Script/Engine','ClassName':'Package'},
            {'ObjectName':'KismetSystemLibrary','OuterIndex':-3},
            {'ObjectName':'IsValid','ClassName':'Function','OuterIndex':-4}], 'Exports':[
                {'ObjectName':'BP_Manny_C','LoadedProperties':[
                    {'Name':'Beard','SerializedType':'ObjectProperty','PropertyClass':-1}]}]})
        call=node('EX_CallMath',StackNode=-5,Parameters=[var('EX_InstanceVariable','Beard',1)])
        result=expression(call,set(),set(),package=package,owner=1)
        self.assertEqual(result['op'],'native_object_valid')
        self.assertEqual(result['schema'],{'type':'ObjectProperty','class':['/Script/HairStrandsCore','GroomComponent'],
            'reference_kind':'runtime_native_component','default':None})

    def test_exact_original_component_query_and_schemas_translate(self):
        pool = self.packages(); result = {name: translate_package(package) for name, package in pool.items()}
        prune_queries(result)
        program = result['/Game/Combat']['functions']['ReadInventory']
        call = program['steps'][0]['value']
        self.assertEqual(call['op'], 'component_query'); self.assertEqual(call['package'], '/Game/Inventory')
        self.assertEqual(call['export_index'], 2)
        self.assertEqual(call['dispatch'],'EX_LocalVirtualFunction')
        self.assertEqual(call['receiver_schema'],program['schemas']['self']['Inventory'])
        self.assertEqual(call['bindings'][0]['schema'],{'type':'IntProperty','default':0})
        self.assertEqual(program['output_fields'],['Value'])
        self.assertEqual(result['/Game/Inventory']['functions']['ReadCount']['source_parameters'],[
            {'name':'CountOut','mode':'output','schema':{'type':'IntProperty','default':0}}])
        self.assertEqual(program['schemas']['self']['Inventory']['reference_kind'], 'runtime_component')
        self.assertIsNone(result['/Game/Combat']['default_state']['Inventory'])

    def test_source_component_final_calls_resolve_exact_imported_class_and_output_type(self):
        pool=self.packages();caller=pool['/Game/Combat'];caller._active_function=caller.exports[1]
        caller.imports.append({'ObjectName':'ReadCount','ClassName':'Function','OuterIndex':-3})
        call=node('EX_FinalFunction',StackNode=-5,Parameters=[var('EX_LocalOutVariable','Value',2)])
        context=node('EX_Context',ObjectExpression=var('EX_InstanceVariable','Inventory',1),
                     ContextExpression=call,Offset=memory_size(call,package=caller))
        caller.exports[1]['ScriptBytecode'][0]=context
        program=translate_package(caller)['functions']['ReadInventory']
        result=program['steps'][0]['value']
        self.assertEqual(result['op'],'component_query')
        self.assertEqual(result['dispatch'],'EX_FinalFunction')
        self.assertEqual(result['function'],'ReadCount')
        self.assertEqual(result['bindings'][0]['mode'],'output')
        self.assertEqual(result['context_offset'],memory_size(call,package=caller))
        self.assertEqual(program['output_fields'],['Value'])

        caller.imports[4]['ObjectName']='OtherFunction'
        blocked=translate_package(caller)
        self.assertNotIn('ReadInventory',blocked['functions'])

    def test_original_mutating_by_value_component_call_is_retained_transactionally(self):
        pool=self.packages()
        source=pool['/Game/Inventory'].exports[1]
        source['LoadedProperties']=[]
        source['ScriptBytecode'][0]=node('EX_Let',Variable=var('EX_InstanceVariable','Count',1),Expression=node('EX_IntConst',Value=7))
        call=pool['/Game/Combat'].exports[1]['ScriptBytecode'][0]
        call['ContextExpression']['Parameters']=[];call['Offset']=14
        result={name:translate_package(package) for name,package in pool.items()};prune_queries(result)
        adapted=result['/Game/Combat']['functions']['ReadInventory']['steps'][0]['value']
        self.assertEqual(adapted['op'],'component_call')
        self.assertTrue(result['/Game/Inventory']['functions']['ReadCount']['value_parameters_only'])
        del result['/Game/Inventory']['functions']['ReadCount'];prune_queries(result)
        self.assertNotIn('ReadInventory',result['/Game/Combat']['functions'])

    def test_wrong_output_type_context_offset_or_class_reject_whole_function(self):
        for change in ('type', 'offset', 'class'):
            pool = self.packages(); caller = pool['/Game/Combat']; call = caller.exports[1]['ScriptBytecode'][0]
            if change == 'type': caller.exports[1]['LoadedProperties'][0]['SerializedType'] = 'BoolProperty'
            elif change == 'offset': call['Offset'] = 24
            else: caller.imports[2]['ObjectName'] = 'Unrelated_C'
            result = translate_package(caller)
            self.assertNotIn('ReadInventory', result['functions'])

    def test_missing_receivers_block_and_effectful_out_calls_are_transactional(self):
        for change in ('missing', 'write', 'effect', 'persistent'):
            result = {name: translate_package(package) for name, package in self.packages().items()}
            callee = result['/Game/Inventory']['functions']['ReadCount']
            if change == 'missing': del result['/Game/Inventory']['functions']['ReadCount']
            elif change == 'write': callee['self_writes'] = ['Count']
            elif change == 'effect': callee['steps'].insert(0, {'op': 'evaluate', 'value': {'op': 'broadcast'}})
            else: callee['persistent_types'] = {'3': {'Count': 'IntProperty'}}
            prune_queries(result)
            if change == 'missing':
                self.assertNotIn('ReadInventory', result['/Game/Combat']['functions'])
                self.assertEqual(result['/Game/Combat']['counts']['translated'], 0)
            else:
                call=result['/Game/Combat']['functions']['ReadInventory']['steps'][0]['value']
                self.assertEqual(call['op'],'component_call')
                self.assertTrue(call['transactional_outputs_safe'])

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
