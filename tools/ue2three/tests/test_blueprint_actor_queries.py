import unittest
from blueprint_migration import expression, memory_size, BlueprintTranslationError
from umg_migration import Package


def node(token, **fields): return {'$type':'UAssetAPI.Kismet.Bytecode.Expressions.'+token+', UAssetAPI',**fields}


class ActorRoleQueryTests(unittest.TestCase):
    def test_role_queries_preserve_native_identity_and_require_live_actor_type(self):
        for method,result_type in [('HasAuthority','BoolProperty'),('GetLocalRole','ByteProperty'),('GetRemoteRole','ByteProperty')]:
            package=Package({'Imports':[
                {'ObjectName':method,'ClassName':'Function','OuterIndex':-2},
                {'ObjectName':'Actor','ClassName':'Class','OuterIndex':-3},
                {'ObjectName':'/Script/Engine','ClassName':'Package'}],
                'Exports':[{'ObjectName':'Combat_C','LoadedProperties':[
                    {'Name':'Owner','SerializedType':'ObjectProperty','PropertyClass':-2}]}]})
            receiver=node('EX_InstanceVariable',Variable={'New':{'Path':['Owner'],'ResolvedOwner':1}})
            call=node('EX_FinalFunction',StackNode=-1,Parameters=[])
            context=node('EX_Context',ObjectExpression=receiver,ContextExpression=call,Offset=memory_size(call,package=package))
            result=expression(context,set(),set(),package=package,owner=1)
            self.assertEqual(result['op'],'native_actor_role')
            self.assertEqual(result['identity'],['/Script/Engine','Actor',method])
            self.assertEqual(result['return_type'],result_type)
            context['Offset']+=1
            with self.assertRaises(BlueprintTranslationError): expression(context,set(),set(),package=package,owner=1)
            context['Offset']-=1
            package.exports[0]['LoadedProperties'][0]['SerializedType']='IntProperty'
            with self.assertRaises(BlueprintTranslationError): expression(context,set(),set(),package=package,owner=1)
