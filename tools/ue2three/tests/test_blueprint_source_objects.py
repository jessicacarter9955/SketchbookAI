import unittest
from copy import deepcopy
from umg_migration import Package
from blueprint_types import property_schema
from blueprint_migration import expression, memory_size, translate_package, BlueprintTranslationError
from blueprint_source_objects import source_class_hierarchy
from test_blueprint_migration import node


class SourceActorMemberTests(unittest.TestCase):
    def sources(self):
        base=Package({'Imports':[{'ObjectName':'Actor','ClassName':'Class','OuterIndex':-2},
            {'ObjectName':'/Script/Engine','ClassName':'Package'}],
            'Exports':[{'$type':'UAssetAPI.ExportTypes.ClassExport, UAssetAPI','ObjectName':'Base_C','SuperStruct':-1,
                'LoadedProperties':[{'Name':'Health','SerializedType':'FloatProperty'}]}]})
        child=Package({'Imports':[{'ObjectName':'Base_C','ClassName':'BlueprintGeneratedClass','OuterIndex':-2},
            {'ObjectName':'/Game/Base','ClassName':'Package'}],
            'Exports':[{'$type':'UAssetAPI.ExportTypes.ClassExport, UAssetAPI','ObjectName':'Child_C','SuperStruct':-1,
                'LoadedProperties':[]}]})
        caller=Package({'Imports':[{'ObjectName':'Base_C','ClassName':'BlueprintGeneratedClass','OuterIndex':-2},
            {'ObjectName':'/Game/Base','ClassName':'Package'},{'ObjectName':'Child_C','ClassName':'BlueprintGeneratedClass','OuterIndex':-4},
            {'ObjectName':'/Game/Child','ClassName':'Package'}],
            'Exports':[{'ObjectName':'Caller_C','LoadedProperties':[{'Name':'Actor','SerializedType':'ObjectProperty','PropertyClass':-1}]}]})
        pool={'/Game/Base':base,'/Game/Child':child,'/Game/Caller':caller}
        for package in pool.values():package.source_packages=pool
        return pool

    def test_original_source_actor_inheritance_resolves_without_constructing_an_actor(self):
        sources=self.sources();caller=sources['/Game/Caller']
        schema=property_schema(caller,{'SerializedType':'ObjectProperty','PropertyClass':-3})
        self.assertEqual(schema,{'type':'ObjectProperty','class':['/Game/Child','Child_C'],'reference_kind':'runtime_actor','default':None})
        ancestry=source_class_hierarchy(caller,('/Game/Child','Child_C'))
        self.assertEqual(ancestry['native_base'],['/Script/Engine','Actor'])
        self.assertEqual([row['package'] for row in ancestry['source_hierarchy']],['/Game/Child','/Game/Base'])
        sources['/Game/Base'].imports[0]={'ObjectName':'Child_C','ClassName':'BlueprintGeneratedClass','OuterIndex':-3}
        sources['/Game/Base'].imports.append({'ObjectName':'/Game/Child','ClassName':'Package'})
        self.assertIsNone(source_class_hierarchy(caller,('/Game/Child','Child_C')))

    def test_source_actor_member_keeps_reflected_owner_and_context_boundary(self):
        sources=self.sources();p=sources['/Game/Caller']
        field={'New':{'Path':['Health'],'ResolvedOwner':-1}}
        read=node('EX_InstanceVariable',Variable=field)
        ctx=node('EX_Context',ObjectExpression=node('EX_InstanceVariable',Variable={'New':{'Path':['Actor'],'ResolvedOwner':1}}),
            ContextExpression=read,RValuePointer=field,Offset=memory_size(read,package=p))
        result=expression(ctx,set(),set(),package=p,owner=1)
        self.assertEqual(result['op'],'source_actor_member')
        self.assertEqual(result['schema']['type'],'FloatProperty')
        self.assertEqual(result['declaring_package'],'/Game/Base')
        invalid=deepcopy(ctx);invalid['Offset']+=1
        with self.assertRaises(BlueprintTranslationError):expression(invalid,set(),set(),package=p,owner=1)
        function={'ObjectName':'WriteHealth','OuterIndex':1,'LoadedProperties':[],'ScriptBytecode':[
            node('EX_Let',Variable=ctx,Expression=node('EX_FloatConst',Value=75)),
            node('EX_Return',ReturnExpression=node('EX_Nothing')),node('EX_EndOfScript')]}
        p.exports.append(function)
        program=translate_package(p)['functions']['WriteHealth']
        self.assertEqual(program['steps'][0]['op'],'set_actor_member')
        self.assertEqual(program['steps'][0]['target']['schema']['type'],'FloatProperty')

    def test_foreign_actor_struct_member_write_keeps_reflected_struct_identity(self):
        sources=self.sources();p=sources['/Game/Caller'];base=sources['/Game/Base']
        base.imports.extend([{'ObjectName':'Vector','ClassName':'ScriptStruct','OuterIndex':-4},
            {'ObjectName':'/Script/CoreUObject','ClassName':'Package'}])
        base.exports[0]['LoadedProperties'].append({'Name':'Offset','SerializedType':'StructProperty','Struct':-3})
        p.imports.extend([{'ObjectName':'Vector','ClassName':'ScriptStruct','OuterIndex':-6},
            {'ObjectName':'/Script/CoreUObject','ClassName':'Package'}])
        field={'New':{'Path':['Offset'],'ResolvedOwner':-1}}
        read=node('EX_InstanceVariable',Variable=field)
        ctx=node('EX_Context',ObjectExpression=node('EX_InstanceVariable',Variable={'New':{'Path':['Actor'],'ResolvedOwner':1}}),
            ContextExpression=read,RValuePointer=field,Offset=memory_size(read,package=p))
        member=node('EX_StructMemberContext',StructMemberExpression={'New':{'Path':['X'],'ResolvedOwner':-5}},StructExpression=ctx)
        p.exports.append({'ObjectName':'WriteOffset','OuterIndex':1,'LoadedProperties':[],'ScriptBytecode':[
            node('EX_Let',Variable=member,Expression=node('EX_DoubleConst',Value=12)),
            node('EX_Return',ReturnExpression=node('EX_Nothing')),node('EX_EndOfScript')]})
        step=translate_package(p)['functions']['WriteOffset']['steps'][0]
        self.assertEqual(step['op'],'set_actor_member')
        self.assertEqual(step['member_field'],'X')
        self.assertEqual(step['target']['schema']['native'],'Vector')
