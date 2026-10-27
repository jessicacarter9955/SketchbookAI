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
        self.assertTrue(root['component_lookup_complete'])

    def test_unresolved_class_and_unavailable_template_are_distinct_lookup_blockers(self):
        packages=self.packages();packages.pop('/Game/Component')
        root=actor_graph(packages,self.sources())['roots']['/Game/Pawn']
        self.assertFalse(root['component_lookup_complete'])
        self.assertEqual(root['unresolved_component_classes'],[['/Game/Component','Component_C']])
        packages=self.packages();packages['/Game/Pawn'].exports[3]['Data']=data(Count=True)
        root=actor_graph(packages,self.sources())['roots']['/Game/Pawn']
        self.assertTrue(root['component_lookup_complete'])
        self.assertEqual(root['component_blocked'][0]['package'],'/Game/Component')

    def test_nontrivial_original_construction_prevents_claiming_a_complete_component_lookup(self):
        packages=self.packages();packages['/Game/Pawn'].exports.append({'ObjectName':'UserConstructionScript','OuterIndex':1,
            'ScriptBytecode':[node('EX_FinalFunction',StackNode=-1,Parameters=[])]})
        root=actor_graph(packages,self.sources())['roots']['/Game/Pawn']
        self.assertFalse(root['component_lookup_complete']);self.assertTrue(root['unresolved_construction_script'])

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

    def test_native_scs_components_keep_their_source_field_class_and_template_identity(self):
        root=self.packages()['/Game/Pawn']; root.imports.append({'ObjectName':'SceneComponent','OuterIndex':-2})
        root.exports[0]['LoadedProperties'].append({'Name':'NativeRoot','SerializedType':'ObjectProperty','PropertyClass':-7})
        root.exports[1]['Data']=data(RootNodes=[3,5],AllNodes=[3,5])
        root.exports.extend([
            {'ObjectName':'NativeNode','OuterIndex':2,'ClassIndex':-4,
             'Data':data(ComponentClass=-7,ComponentTemplate=6,InternalVariableName='NativeRoot')},
            {'ObjectName':'NativeRoot_GEN_VARIABLE','OuterIndex':1,'ClassIndex':-7,'Data':[]},
        ])
        graph=actor_graph({'/Game/Pawn':root,'/Game/Component':self.packages()['/Game/Component']},self.sources())
        actor=graph['roots']['/Game/Pawn']
        self.assertEqual({key:actor['native_components'][0][key] for key in ('variable','package','class_object',
            'scs_node_export_index','template_export_index')},{'variable':'NativeRoot','package':'/Script/Engine',
            'class_object':'SceneComponent','scs_node_export_index':5,'template_export_index':6})
        self.assertEqual(len(actor['native_components'][0]['template_sha256']),64)
        self.assertTrue(actor['native_component_bindings_complete'])

    def test_groom_component_property_schema_is_source_native_component(self):
        package=Package({'Imports':[{'ObjectName':'GroomComponent','OuterIndex':-2},
            {'ObjectName':'/Script/HairStrandsCore','ClassName':'Package'}], 'Exports':[]})
        self.assertEqual(property_schema(package,{'SerializedType':'ObjectProperty','PropertyClass':-1}),
            {'type':'ObjectProperty','class':['/Script/HairStrandsCore','GroomComponent'],
             'reference_kind':'runtime_native_component','default':None})

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

    def test_witnessed_skeletal_mesh_contexts_keep_typed_receiver_and_native_dependency(self):
        package=Package({'Imports':[
            {'ObjectName':'SkeletalMeshComponent','OuterIndex':-2,'ClassName':'Class'},
            {'ObjectName':'/Script/Engine','ClassName':'Package'},
            {'ObjectName':'MaterialInterface','OuterIndex':-2},
            {'ObjectName':'SkeletalMesh','OuterIndex':-2},
            {'ObjectName':'SetSkeletalMeshAsset','ClassName':'Function','OuterIndex':-1}],
            'Exports':[{'ObjectName':'Mover_C','LoadedProperties':[
                {'Name':'SkeletalMesh','SerializedType':'ObjectProperty','PropertyClass':-1},
                {'Name':'PlayerMaterial','SerializedType':'ObjectProperty','PropertyClass':-3},
                {'Name':'WeaponMesh','SerializedType':'ObjectProperty','PropertyClass':-1},
                {'Name':'WeaponMeshAsset','SerializedType':'ObjectProperty','PropertyClass':-4}]}]})
        package._active_function={'ObjectName':'OnRep','OuterIndex':1,'LoadedProperties':[]}
        receiver=lambda name:node('EX_InstanceVariable',Variable={'New':{'Path':[name],'ResolvedOwner':1}})
        material=node('EX_VirtualFunction',VirtualFunctionName='SetMaterial',Parameters=[
            node('EX_IntConst',Value=0),receiver('PlayerMaterial')])
        context=node('EX_Context',ObjectExpression=receiver('SkeletalMesh'),ContextExpression=material,
                     Offset=memory_size(material,package=package),PropertyType=0,
                     RValuePointer={'New':{'Path':[],'ResolvedOwner':0}})
        translated=expression(context,set(),set(),package=package,owner=1)
        self.assertEqual(translated['op'],'native_context_call')
        self.assertEqual(translated['identity'],['/Script/Engine','SkeletalMeshComponent','SetMaterial'])
        self.assertEqual(translated['receiver_schema'],property_schema(package,package.exports[0]['LoadedProperties'][0]))
        self.assertEqual(translated['parameter_schemas'][1]['class'],['/Script/Engine','MaterialInterface'])
        self.assertFalse(translated['adapter_family_present'])

        direct=node('EX_FinalFunction',StackNode=-5,Parameters=[receiver('WeaponMeshAsset')])
        direct_context=node('EX_Context',ObjectExpression=receiver('WeaponMesh'),ContextExpression=direct,
                            Offset=memory_size(direct,package=package),PropertyType=0,
                            RValuePointer={'New':{'Path':[],'ResolvedOwner':0}})
        self.assertEqual(expression(direct_context,set(),set(),package=package,owner=1)['identity'],
                         ['/Script/Engine','SkeletalMeshComponent','SetSkeletalMeshAsset'])
        for index,broken in enumerate((deepcopy(context),deepcopy(context))):
            if index == 0:
                broken['Offset']+=1
            else:
                broken['ContextExpression']['Parameters'][1]=receiver('WeaponMeshAsset')
            with self.assertRaises(BlueprintTranslationError):
                expression(broken,set(),set(),package=package,owner=1)

    def test_native_concat_preserves_exact_identity_order_and_fstring_types(self):
        package=Package({'Imports':[{'ObjectName':'Concat_StrStr','ClassName':'Function','OuterIndex':-2},
            {'ObjectName':'KismetStringLibrary','OuterIndex':-3}, {'ObjectName':'/Script/Engine','ClassName':'Package'}],
            'Exports':[{'ObjectName':'Test_C','LoadedProperties':[
                {'Name':'Left','SerializedType':'StrProperty'}, {'Name':'Right','SerializedType':'StrProperty'}]}]})
        package._active_function={'ObjectName':'Join','OuterIndex':1,'LoadedProperties':[]}
        left=node('EX_InstanceVariable',Variable={'New':{'Path':['Left'],'ResolvedOwner':1}})
        right=node('EX_UnicodeStringConst',Value='—')
        call=node('EX_CallMath',StackNode=-1,Parameters=[left,right])
        result=expression(call,set(),set(),package=package,owner=1)
        self.assertEqual(result,{'op':'native_call','identity':['/Script/Engine','KismetStringLibrary','Concat_StrStr'],
            'parameter_types':['StrProperty','StrProperty'],'return_type':'StrProperty','args':[
                {'op':'get','scope':'self','field':'Left'},
                {'op':'typed_literal','schema':{'type':'StrProperty','default':''},'value':'—'}]})
        package.exports[0]['LoadedProperties'][0]['SerializedType']='NameProperty'
        with self.assertRaisesRegex(BlueprintTranslationError,'parameter type'):
            expression(call,set(),set(),package=package,owner=1)
        package.exports[0]['LoadedProperties'][0]['SerializedType']='StrProperty'
        with self.assertRaisesRegex(BlueprintTranslationError,'arity'):
            expression(node('EX_CallMath',StackNode=-1,Parameters=[left]),set(),set(),package=package,owner=1)
        with self.assertRaisesRegex(BlueprintTranslationError,'outside Engine.KismetMathLibrary'):
            package.imports[0]['ObjectName']='Join_StrStr'
            expression(call,set(),set(),package=package,owner=1)
        package.imports[0]['ObjectName']='Concat_StrStr'
        narrow_unicode=node('EX_StringConst',Value='é')
        with self.assertRaisesRegex(BlueprintTranslationError,'non-ASCII narrow string layout'):
            expression(node('EX_CallMath',StackNode=-1,Parameters=[narrow_unicode,right]),set(),set(),package=package,owner=1)


if __name__ == '__main__': unittest.main()
