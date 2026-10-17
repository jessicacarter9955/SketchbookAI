import unittest
from copy import deepcopy
from test_blueprint_migration import node
from blueprint_migration import expression, translate_package, memory_size, BlueprintTranslationError
from umg_migration import Package
from blueprint_types import property_schema
from blueprint_values import serialized_value


def var(name, owner=1, local=False):
    return node('EX_LocalVariable' if local else 'EX_InstanceVariable', Variable={'New': {'Path': [name], 'ResolvedOwner': owner}})


class SourceEffectsTests(unittest.TestCase):
    def test_class_values_keep_original_meta_class_and_require_an_imported_class(self):
        p=Package({'Imports': [{'ObjectName':'Class','OuterIndex':-2,'ClassName':'Class'},
            {'ObjectName':'/Script/CoreUObject','ClassName':'Package'},
            {'ObjectName':'CameraShakeBase','OuterIndex':-4,'ClassName':'Class'},
            {'ObjectName':'/Script/Engine','ClassName':'Package'},
            {'ObjectName':'CS_Original_C','OuterIndex':-6,'ClassName':'BlueprintGeneratedClass'},
            {'ObjectName':'/Game/Camera/CS_Original','ClassName':'Package'}]})
        prop={'SerializedType':'ClassProperty','PropertyClass':-1,'MetaClass':-3}
        schema=property_schema(p,prop)
        self.assertEqual(serialized_value(p,prop,schema,{'Value':-5}),{'asset':'/Game/Camera/CS_Original.CS_Original_C',
            'declared_class':['/Script/CoreUObject','Class'],'meta_class':['/Script/Engine','CameraShakeBase']})
        self.assertIsNone(serialized_value(p,prop,schema,{'Value':0}))
        self.assertIsNone(property_schema(p,{**prop,'MetaClass':0}))
        p.imports[4]['ClassName']='Object'
        with self.assertRaisesRegex(ValueError,'class import'):serialized_value(p,prop,schema,{'Value':-5})

    def package(self):
        props = [{'Name': 'Items', 'SerializedType': 'ArrayProperty', 'Inner': {'SerializedType': 'IntProperty'}, 'PropertyFlags': 'CPF_Net'},
                 {'Name': 'Changed', 'SerializedType': 'MulticastInlineDelegateProperty', 'SignatureFunction': 3}]
        function = {'ObjectName': 'Change', 'OuterIndex': 1, 'LoadedProperties': [],
                    'ScriptBytecode': [node('EX_Return', ReturnExpression=node('EX_Nothing')), node('EX_EndOfScript')]}
        return Package({'Imports': [
            {'ObjectName': 'Array_Set', 'ClassName': 'Function', 'OuterIndex': -2},
            {'ObjectName': 'KismetArrayLibrary', 'OuterIndex': -3}, {'ObjectName': '/Script/Engine', 'ClassName': 'Package'},
            {'ObjectName': 'Default__KismetArrayLibrary', 'OuterIndex': -3},
            {'ObjectName': 'MarkPropertyDirtyFromRepIndex', 'ClassName': 'Function', 'OuterIndex': -6},
            {'ObjectName': 'NetPushModelHelpers', 'OuterIndex': -3}],
            'Exports': [{'ObjectName': 'Original_C', 'LoadedProperties': props}, function,
                        {'ObjectName': 'Changed__DelegateSignature', 'OuterIndex': 1, 'LoadedProperties': [
                            {'Name': 'Value', 'SerializedType': 'IntProperty', 'PropertyFlags': 'CPF_Parm'}]}]})

    def array_call(self, package):
        call = node('EX_FinalFunction', StackNode=-1, Parameters=[var('Items'), node('EX_IntZero'), node('EX_IntOne'), node('EX_False')])
        return node('EX_Context', ObjectExpression=node('EX_ObjectConst', Value=-4), ContextExpression=call, Offset=memory_size(call, package=package))

    def test_original_array_adapter_retains_schema_and_self_write(self):
        p = self.package(); e = self.array_call(p)
        p.exports[1]['ScriptBytecode'].insert(0, e)
        r = translate_package(p)['functions']['Change']
        self.assertEqual(r['self_writes'], ['Items']); self.assertEqual(r['steps'][0]['value']['op'], 'array_set')
        self.assertEqual(r['schemas']['self']['Items']['element']['type'], 'IntProperty')

    def test_persistent_array_schema_is_retained_and_unresolved_struct_frames_block(self):
        p=self.package();frame={'ObjectName':'ExecuteUbergraph_Original','OuterIndex':1,'LoadedProperties':[
            {'Name':'Stored','SerializedType':'ArrayProperty','Inner':{'SerializedType':'IntProperty'}}]}
        p.exports.append(frame)
        p.exports[1]['ScriptBytecode'].insert(0,node('EX_LetValueOnPersistentFrame',
            DestinationProperty={'New':{'Path':['Stored'],'ResolvedOwner':4}},AssignmentExpression=var('Items')))
        result=translate_package(p)['functions']['Change']
        self.assertEqual(result['persistent_schemas']['4']['Stored']['element']['type'],'IntProperty')
        frame['LoadedProperties'][0]={'Name':'Stored','SerializedType':'StructProperty','Struct':-3}
        result=translate_package(p);self.assertFalse(result['functions']);self.assertIn('persistent source schema',result['blocked'][0]['reason'])

    def test_array_adapter_rejects_wrong_owner_offset_arity_or_native_library(self):
        for change in ('owner', 'offset', 'arity', 'library'):
            p = self.package(); e = self.array_call(p)
            if change == 'owner': e['ContextExpression']['Parameters'][0]['Variable']['New']['ResolvedOwner'] = 2
            if change == 'offset': e['Offset'] += 1
            if change == 'arity': e['ContextExpression']['Parameters'].pop()
            if change == 'library': p.imports[2]['ObjectName'] = '/Game/Fake'
            with self.subTest(change=change), self.assertRaises(BlueprintTranslationError): expression(e, set(), set(), package=p, owner=1)

    def test_const_source_array_cannot_be_modified(self):
        p = self.package(); p.exports[1]['LoadedProperties'] = [dict(p.exports[0]['LoadedProperties'][0], Name='Input', PropertyFlags='CPF_Parm | CPF_ConstParm | CPF_OutParm | CPF_ReferenceParm')]
        e = self.array_call(p); e['ContextExpression']['Parameters'][0] = var('Input', 2, True)
        p.exports[1]['ScriptBytecode'].insert(0,e)
        result = translate_package(p)
        self.assertFalse(result['functions']); self.assertIn('const input', result['blocked'][0]['reason'])

    def test_dirty_marker_preserves_actual_source_index_and_requires_replicated_property(self):
        p = self.package(); e = node('EX_CallMath', StackNode=-5, Parameters=[node('EX_Self'),node('EX_IntConst',Value=11),node('EX_NameConst',Value='Items')])
        self.assertEqual(expression(e,set(),set(),package=p,owner=1),{'op':'mark_dirty','field':'Items','source_rep_index':11})
        p.exports[0]['LoadedProperties'][0]['PropertyFlags']='CPF_Edit'
        with self.assertRaises(BlueprintTranslationError): expression(e,set(),set(),package=p,owner=1)

    def test_multicast_requires_exact_original_signature_and_own_instance(self):
        p = self.package(); e = node('EX_CallMulticastDelegate',Delegate=var('Changed'),StackNode=3,Parameters=[node('EX_IntOne')])
        r = expression(e,set(),set(),package=p,owner=1)
        self.assertEqual(r['delegate'],'Changed');self.assertEqual(r['parameters'][0]['name'],'Value')
        for change in ('owner','signature','arity','out_parameter'):
            q = deepcopy(p); v = deepcopy(e)
            if change=='owner':v['Delegate']['Variable']['New']['ResolvedOwner']=2
            if change=='signature':v['StackNode']=2
            if change=='arity':v['Parameters']=[]
            if change=='out_parameter':q.exports[2]['LoadedProperties'][0]['PropertyFlags']='CPF_Parm | CPF_OutParm'
            with self.subTest(change=change), self.assertRaises(BlueprintTranslationError):expression(v,set(),set(),package=q,owner=1)

    def test_struct_member_access_without_source_schema_blocks_whole_function(self):
        p=self.package();p.exports[0]['LoadedProperties'].append({'Name':'Unknown','SerializedType':'StructProperty','Struct':-3})
        p.exports[1]['ScriptBytecode'].insert(0,node('EX_Return',ReturnExpression=node('EX_StructMemberContext',
            StructExpression=var('Unknown'),StructMemberExpression={'New':{'Path':['Value']}})))
        # Remove the original return so this specifically exercises schema validation.
        del p.exports[1]['ScriptBytecode'][1]
        result=translate_package(p);self.assertFalse(result['functions']);self.assertIn('schema',result['blocked'][0]['reason'])


if __name__ == '__main__': unittest.main()
