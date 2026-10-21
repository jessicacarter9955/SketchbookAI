import unittest
from copy import deepcopy
from test_blueprint_migration import node
from blueprint_migration import expression, BlueprintTranslationError, memory_size
from blueprint_objects import actor_graph
from blueprint_types import property_schema
from blueprint_values import serialized_value
from umg_migration import Package


def data(**values): return [{'Name': name, 'Value': value} for name, value in values.items()]


class SourceObjectTests(unittest.TestCase):
    def packages(self):
        root = Package({'Imports': [{'ObjectName':'Pawn','OuterIndex':-2}, {'ObjectName':'/Script/Engine','ClassName':'Package'},
            {'ObjectName':'SimpleConstructionScript','OuterIndex':-2}, {'ObjectName':'SCS_Node','OuterIndex':-2},
            {'ObjectName':'Component_C','OuterIndex':-6}, {'ObjectName':'/Game/Component','ClassName':'Package'}], 'Exports': [
            {'ObjectName':'Pawn_C','SuperStruct':-1,'LoadedProperties':[{'Name':'Component','SerializedType':'ObjectProperty','PropertyClass':-5}], 'Data':data(SimpleConstructionScript=2)},
            {'ObjectName':'SCS','OuterIndex':1,'ClassIndex':-3,'Data':data(RootNodes=[3],AllNodes=[3])},
            {'ObjectName':'Node','OuterIndex':2,'ClassIndex':-4,'Data':data(ComponentClass=-5,ComponentTemplate=4,InternalVariableName='Component')},
            {'ObjectName':'Component_GEN_VARIABLE','OuterIndex':1,'ClassIndex':-5,'Data':data(Count=123,bReplicates=True)}]})
        component = Package({'Imports':[{'ObjectName':'ActorComponent','OuterIndex':-2}, {'ObjectName':'/Script/Engine','ClassName':'Package'},
            {'ObjectName':'GetOwner','ClassName':'Function','OuterIndex':-1}, {'ObjectName':'Actor','OuterIndex':-2}], 'Exports':[
            {'ObjectName':'Component_C','SuperStruct':-1,'LoadedProperties':[{'Name':'Count','SerializedType':'IntProperty'}]}]})
        return {'/Game/Pawn':root,'/Game/Component':component}

    def sources(self): return {'/Game/Pawn':{'source_sha256':'pawn'},'/Game/Component':{'source_sha256':'component'}}

    def test_source_construction_field_template_and_component_override_are_witnessed(self):
        graph=actor_graph(self.packages(),self.sources());root=graph['roots']['/Game/Pawn']
        self.assertFalse(graph['blocked']);self.assertEqual(root['scs_export_index'],2)
        component=root['components'][0];self.assertEqual(component['scs_node_export_index'],3)
        self.assertEqual(component['source_overrides'],{'Count':123});self.assertEqual(component['native_template_fields'],['bReplicates'])
        self.assertEqual(len(component['template_sha256']),64)

    def test_corrupt_ownership_cycles_and_mismatched_templates_reject_the_graph(self):
        for failure in ['node_owner','template_owner','template_class','property_class','property_type','cycle','all_nodes']:
            packages=self.packages();root=packages['/Game/Pawn']
            if failure=='node_owner':root.exports[2]['OuterIndex']=1
            if failure=='template_owner':root.exports[3]['OuterIndex']=2
            if failure=='template_class':root.exports[3]['ClassIndex']=-4
            if failure=='property_class':root.exports[0]['LoadedProperties'][0]['PropertyClass']=-1
            if failure=='property_type':root.exports[0]['LoadedProperties'][0]['SerializedType']='ClassProperty'
            if failure=='cycle':root.exports[2]['Data']+=data(ChildNodes=[3])
            if failure=='all_nodes':root.exports[1]['Data']=data(RootNodes=[3],AllNodes=[])
            graph=actor_graph(packages,self.sources())
            with self.subTest(failure=failure):self.assertFalse(graph['roots']);self.assertTrue(graph['blocked'])

    def test_native_override_and_unresolved_script_override_are_not_silently_bound(self):
        packages=self.packages();packages['/Game/Pawn'].exports.append({'ObjectName':'ForceNetUpdate','OuterIndex':1})
        self.assertFalse(actor_graph(packages,self.sources())['roots'])
        packages=self.packages();packages['/Game/Pawn'].exports[3]['Data']=data(Count=True)
        root=actor_graph(packages,self.sources())['roots']['/Game/Pawn'];self.assertFalse(root['components']);self.assertTrue(root['component_blocked'])

    def test_runtime_actor_defaults_are_null_and_cannot_be_asset_identity_shortcuts(self):
        package=self.packages()['/Game/Component'];prop={'SerializedType':'ObjectProperty','PropertyClass':-4};schema=property_schema(package,prop)
        self.assertEqual(schema['reference_kind'],'runtime_actor');self.assertIsNone(serialized_value(package,prop,schema,{'Value':0}))
        with self.assertRaisesRegex(ValueError,'world-object'):serialized_value(package,prop,schema,{'Value':-4})

    def test_get_owner_requires_exact_native_and_component_source_parent(self):
        package=self.packages()['/Game/Component'];call=node('EX_FinalFunction',StackNode=-3,Parameters=[])
        self.assertEqual(expression(call,set(),set(),package=package,owner=1),{'op':'native_get_owner','source_owner_index':1})
        package.exports[0]['SuperStruct']=-4
        with self.assertRaisesRegex(BlueprintTranslationError,'ActorComponent'):expression(call,set(),set(),package=package,owner=1)

    def test_is_valid_requires_native_source_identity_single_actor_property_and_owner(self):
        package = self.packages()['/Game/Component']
        package.imports.extend([
            {'ObjectName': 'KismetSystemLibrary', 'OuterIndex': -2},
            {'ObjectName': 'IsValid', 'ClassName': 'Function', 'OuterIndex': -5}])
        method = {'ObjectName': 'Probe', 'OuterIndex': 1,
                  'LoadedProperties': [{'Name': 'TargetActor', 'SerializedType': 'ObjectProperty',
                                        'PropertyClass': -4}]}
        package.exports.append(method)
        package._active_function = method
        target = node('EX_LocalVariable', Variable={'New': {'Path': ['TargetActor'], 'ResolvedOwner': 2}})
        for opcode in ('EX_CallMath', 'EX_FinalFunction'):
            call = node(opcode, StackNode=-6, Parameters=[target])
            self.assertEqual(expression(call, set(), set(), package=package, owner=1),
                             {'op': 'native_is_valid', 'target': {'op': 'get', 'scope': 'local', 'field': 'TargetActor'}})
            with self.subTest(opcode=opcode):
                malformed = deepcopy(call); malformed['Parameters'].append(target)
                with self.assertRaisesRegex(BlueprintTranslationError, 'exactly one'):
                    expression(malformed, set(), set(), package=package, owner=1)
        call = node('EX_CallMath', StackNode=-6, Parameters=[target])
        wrong = deepcopy(call); wrong['Parameters'][0]['Variable']['New']['ResolvedOwner'] = 1
        with self.assertRaises(BlueprintTranslationError):
            expression(wrong, set(), set(), package=package, owner=1)
        wrong = deepcopy(call); package.exports[1]['LoadedProperties'][0]['PropertyClass'] = -1
        with self.assertRaisesRegex(BlueprintTranslationError, 'object class'):
            expression(wrong, set(), set(), package=package, owner=1)

    def test_actor_context_requires_original_typed_receiver_and_exact_offset(self):
        package=self.packages()['/Game/Component'];function={'ObjectName':'Write','OuterIndex':1,'LoadedProperties':[
            {'Name':'OwningActor','SerializedType':'ObjectProperty','PropertyClass':-4}]}
        package.exports.append(function);package._active_function=function
        target=node('EX_LocalVariable',Variable={'New':{'Path':['OwningActor'],'ResolvedOwner':2}})
        call=node('EX_VirtualFunction',VirtualFunctionName='ForceNetUpdate',Parameters=[])
        context=node('EX_Context',ObjectExpression=target,ContextExpression=call,Offset=memory_size(call))
        result=expression(context,set(),set(),package=package,owner=1);self.assertEqual(result['op'],'native_force_net_update')
        for failure in ['offset','class','owner','args']:
            p=deepcopy(package);value=deepcopy(context);p._active_function=p.exports[1]
            if failure=='offset':value['Offset']+=1
            if failure=='class':p.exports[1]['LoadedProperties'][0]['PropertyClass']=-1
            if failure=='owner':value['ObjectExpression']['Variable']['New']['ResolvedOwner']=1
            if failure=='args':value['ContextExpression']['Parameters']=[node('EX_IntOne')]
            with self.subTest(failure=failure),self.assertRaises(BlueprintTranslationError):expression(value,set(),set(),package=p,owner=1)


if __name__ == '__main__': unittest.main()
