import unittest
from copy import deepcopy
from test_blueprint_migration import node
from blueprint_migration import expression, translate_package, memory_size, property_type, BlueprintTranslationError
from umg_migration import Package
from blueprint_types import property_schema
from blueprint_values import serialized_value, native_schema


def var(name, owner=1, local=False):
    return node('EX_LocalVariable' if local else 'EX_InstanceVariable', Variable={'New': {'Path': [name], 'ResolvedOwner': owner}})


class SourceEffectsTests(unittest.TestCase):
    def test_witnessed_spawn_sound_at_location_retains_identity_argument_order_and_types(self):
        imports = [
            {'ObjectName':'SpawnSoundAtLocation','ClassName':'Function','OuterIndex':-2},
            {'ObjectName':'GameplayStatics','OuterIndex':-3}, {'ObjectName':'/Script/Engine','ClassName':'Package'},
            {'ObjectName':'Pawn','ClassName':'Class','OuterIndex':-5}, {'ObjectName':'/Script/Engine','ClassName':'Package'},
            {'ObjectName':'Vector','ClassName':'ScriptStruct','OuterIndex':-7}, {'ObjectName':'/Script/CoreUObject','ClassName':'Package'},
            {'ObjectName':'SoundBase','ClassName':'Class','OuterIndex':-9}, {'ObjectName':'/Script/Engine','ClassName':'Package'},
        ]
        klass={'ObjectName':'BP_Test_C','SuperStruct':-4,'LoadedProperties':[]}
        function={'ObjectName':'Run','OuterIndex':1,'LoadedProperties':[
            {'Name':'Sound','SerializedType':'ObjectProperty','PropertyClass':-8},
            {'Name':'Location','SerializedType':'StructProperty','Struct':-6}],}
        package=Package({'ObjectVersionUE5':'IMPORT_TYPE_HIERARCHIES','Imports':imports,'Exports':[klass,function]})
        package._active_function=function
        sound=node('EX_LocalVariable',Variable={'New':{'Path':['Sound'],'ResolvedOwner':2}})
        location=node('EX_LocalVariable',Variable={'New':{'Path':['Location'],'ResolvedOwner':2}})
        call=node('EX_CallMath',StackNode=-1,Parameters=[node('EX_Self'),sound,location,
            node('EX_RotationConst',Value={'Pitch':0,'Yaw':0,'Roll':0}),node('EX_FloatConst',Value=1.0),
            node('EX_FloatConst',Value=1.0),node('EX_FloatConst',Value=0.0),node('EX_NoObject'),
            node('EX_NoObject'),node('EX_True')])
        result=expression(call,set(),set(),package=package,owner=1)
        self.assertEqual(result['op'],'native_audio_vfx')
        self.assertEqual(result['identity'],['/Script/Engine','GameplayStatics','SpawnSoundAtLocation'])
        self.assertEqual(result['dispatch'],'EX_CallMath')
        self.assertEqual([item['contract']['type'] for item in result['parameters']],
            ['ObjectProperty','ObjectProperty','StructProperty','StructProperty','FloatProperty','FloatProperty',
             'FloatProperty','ObjectProperty','ObjectProperty','BoolProperty'])
        self.assertEqual(result['parameters'][0]['value']['op'],'native_self')
        self.assertEqual(result['parameters'][2]['schema']['native'],'Vector')
        self.assertEqual(result['return_schema']['class'],['/Script/Engine','AudioComponent'])

        wrong_arity=dict(call,Parameters=call['Parameters'][:-1])
        with self.assertRaisesRegex(BlueprintTranslationError,'parameter count'):
            expression(wrong_arity,set(),set(),package=package,owner=1)
        function['LoadedProperties'][0]['PropertyClass']=-6
        with self.assertRaisesRegex(BlueprintTranslationError,'parameter type'):
            expression(call,set(),set(),package=package,owner=1)

    def test_witnessed_niagara_receiver_uses_exact_class_and_final_function_dispatch(self):
        imports=[{'ObjectName':'SetVariableFloat','ClassName':'Function','OuterIndex':-2},
            {'ObjectName':'NiagaraComponent','ClassName':'Class','OuterIndex':-3},
            {'ObjectName':'/Script/Niagara','ClassName':'Package'},
            {'ObjectName':'AudioComponent','ClassName':'Class','OuterIndex':-5},
            {'ObjectName':'/Script/Engine','ClassName':'Package'}]
        klass={'ObjectName':'BP_FX_C','LoadedProperties':[
            {'Name':'FX','SerializedType':'ObjectProperty','PropertyClass':-2}]}
        function={'ObjectName':'Run','OuterIndex':1,'LoadedProperties':[]}
        package=Package({'Imports':imports,'Exports':[klass,function]});package._active_function=function
        target=node('EX_InstanceVariable',Variable={'New':{'Path':['FX'],'ResolvedOwner':1}})
        call=node('EX_FinalFunction',StackNode=-1,Parameters=[node('EX_NameConst',Value='Rate'),node('EX_FloatConst',Value=2.0)])
        context=node('EX_Context',ObjectExpression=target,ContextExpression=call,Offset=memory_size(call,package=package))
        translated=expression(context,set(),set(),package=package,owner=1)
        self.assertEqual(translated['identity'],['/Script/Niagara','NiagaraComponent','SetVariableFloat'])
        self.assertEqual(translated['receiver_schema']['class'],['/Script/Niagara','NiagaraComponent'])
        self.assertEqual(translated['parameters'][0]['contract']['type'],'NameProperty')
        self.assertEqual(translated['parameters'][1]['contract']['type'],'FloatProperty')
        klass['LoadedProperties'][0]['PropertyClass']=-4
        with self.assertRaisesRegex(BlueprintTranslationError,'receiver class'):
            expression(context,set(),set(),package=package,owner=1)

    def test_witnessed_niagara_data_channel_writer_preserves_reflected_value_types(self):
        imports=[{'ObjectName':'WriteFloat','ClassName':'Function','OuterIndex':-2},
            {'ObjectName':'NiagaraDataChannelWriter','ClassName':'Class','OuterIndex':-3},
            {'ObjectName':'/Script/Niagara','ClassName':'Package'}]
        klass={'ObjectName':'BP_NDC_C','LoadedProperties':[
            {'Name':'Writer','SerializedType':'ObjectProperty','PropertyClass':-2}]}
        function={'ObjectName':'Run','OuterIndex':1,'LoadedProperties':[]}
        package=Package({'Imports':imports,'Exports':[klass,function]});package._active_function=function
        target=node('EX_InstanceVariable',Variable={'New':{'Path':['Writer'],'ResolvedOwner':1}})
        call=node('EX_FinalFunction',StackNode=-1,Parameters=[node('EX_NameConst',Value='Impact'),
            node('EX_IntZero'),node('EX_DoubleConst',Value=1.25)])
        context=node('EX_Context',ObjectExpression=target,ContextExpression=call,Offset=memory_size(call,package=package))
        translated=expression(context,set(),set(),package=package,owner=1)
        self.assertEqual(translated['identity'],['/Script/Niagara','NiagaraDataChannelWriter','WriteFloat'])
        self.assertEqual([value['schema']['type'] for value in translated['parameters']],
            ['NameProperty','IntProperty','DoubleProperty'])
        self.assertEqual(translated['receiver_schema']['reference_kind'],'runtime_native_object')

    def test_unresolved_niagara_access_context_and_audio_parameter_calls_block_explicitly(self):
        def unsupported_call(identity, arity):
            imports=[{'ObjectName':identity[2],'ClassName':'Function','OuterIndex':-2},
                {'ObjectName':identity[1],'ClassName':'Class','OuterIndex':-3},
                {'ObjectName':identity[0],'ClassName':'Package'}]
            package=Package({'Imports':imports,'Exports':[{'ObjectName':'BP_Test_C'}]})
            call=node('EX_CallMath',StackNode=-1,Parameters=[node('EX_IntZero') for _ in range(arity)])
            with self.assertRaisesRegex(BlueprintTranslationError,'Unsupported reachable native audio/VFX effect'):
                expression(call,set(),set(),package=package,owner=1)
        unsupported_call(('/Script/Niagara','NiagaraDataChannelLibrary','MakeNDCAccessContextInstance'),1)
        unsupported_call(('/Script/Engine','AudioParameterConversionStatics','ObjectArrayToAudioParameter'),2)

    def test_linear_color_and_native_receiver_schemas_keep_source_class_identity(self):
        color=native_schema(('/Script/CoreUObject','LinearColor'))
        self.assertEqual(color['member_order'],['R','G','B','A'])
        self.assertTrue(all(schema['type']=='FloatProperty' for schema in color['fields'].values()))
        imports=[{'ObjectName':'AudioComponent','ClassName':'Class','OuterIndex':-2},
            {'ObjectName':'/Script/Engine','ClassName':'Package'}]
        package=Package({'Imports':imports})
        schema=property_schema(package,{'SerializedType':'ObjectProperty','PropertyClass':-1})
        self.assertEqual(schema['reference_kind'],'runtime_native_component')
        self.assertIsNone(serialized_value(package,{'SerializedType':'ObjectProperty','PropertyClass':-1},schema,{'Value':0}))
        with self.assertRaisesRegex(ValueError,'native-object adapter'):
            serialized_value(package,{'SerializedType':'ObjectProperty','PropertyClass':-1},schema,{'Value':-1})

    def test_niagara_asset_references_keep_their_module_and_property_type(self):
        from blueprint_values import asset_constant
        package=Package({'Imports':[{'ObjectName':'SmokeSystem','ClassName':'NiagaraSystem',
            'ClassPackage':'/Script/Niagara','OuterIndex':-2},
            {'ObjectName':'/Script/Niagara','ClassName':'Package'},
            {'ObjectName':'NiagaraSystem','ClassName':'Class','OuterIndex':-4},
            {'ObjectName':'/Script/Niagara','ClassName':'Package'}]})
        prop={'SerializedType':'ObjectProperty','PropertyClass':-3}
        self.assertEqual(property_type(prop,package),'ObjectProperty')
        self.assertEqual(asset_constant(package,-1),{'op':'typed_literal',
            'schema':{'type':'ObjectProperty','class':['/Script/Niagara','NiagaraSystem'],'default':None},
            'value':{'asset':'/Script/Niagara.SmokeSystem','declared_class':['/Script/Niagara','NiagaraSystem']}})

    def test_set_array_retains_original_destination_schema_and_writes(self):
        p = self.package()
        literal = node('EX_SetArray', AssigningProperty=var('Items'), ArrayInnerProp=None, Elements=[node('EX_IntOne')])
        self.assertEqual(memory_size(literal,package=p),12)
        p.exports[1]['ScriptBytecode'].insert(0,literal)
        result=translate_package(p)['functions']['Change']
        self.assertEqual(result['self_writes'],['Items'])
        self.assertEqual(result['steps'][0]['value']['element']['type'],'IntProperty')
        self.assertEqual(result['steps'][0]['value']['elements'],[{'op':'constant','value':1}])

    def test_set_array_rejects_const_wrong_owner_and_legacy_layout(self):
        for failure in ['const','owner','legacy','not_array']:
            p=self.package(); literal=node('EX_SetArray',AssigningProperty=var('Items'),ArrayInnerProp=None,Elements=[])
            if failure=='const':
                p.exports[1]['LoadedProperties']=[dict(p.exports[0]['LoadedProperties'][0],Name='Input',PropertyFlags='CPF_Parm | CPF_ConstParm')]
                literal['AssigningProperty']=var('Input',2,True)
            if failure=='owner':literal['AssigningProperty']['Variable']['New']['ResolvedOwner']=2
            if failure=='legacy':literal['ArrayInnerProp']=-1
            if failure=='not_array':p.exports[0]['LoadedProperties'][0]['SerializedType']='IntProperty'
            p.exports[1]['ScriptBytecode'].insert(0,literal)
            with self.subTest(failure=failure): self.assertFalse(translate_package(p)['functions'])
        with self.assertRaises(BlueprintTranslationError):memory_size(dict(literal,ArrayInnerProp=-1))

    def test_localized_text_preserves_original_identity_and_utf16_layout(self):
        value=node('EX_TextConst',Value={'TextLiteralType':'LocalizedText',
            'LocalizedSource':node('EX_UnicodeStringConst',Value='Slot già in uso 🔒'),
            'LocalizedKey':node('EX_StringConst',Value='original-key'),
            'LocalizedNamespace':node('EX_StringConst',Value='source')})
        result=expression(value,set(),set())
        self.assertEqual(result['value'],{'history':'base','text':'Slot già in uso 🔒','key':'original-key','namespace':'source','flags':0})
        self.assertEqual(memory_size(value),2+3+len('Slot già in uso 🔒'.encode('utf-16-le'))+14+8)
        value['Value']['LocalizedSource']['Value']=''
        self.assertEqual(expression(value,set(),set())['value'],{'history':'empty','text':'','flags':0})
        value['Value']['LocalizedKey']=node('EX_IntOne')
        with self.assertRaisesRegex(BlueprintTranslationError,'constant strings'):expression(value,set(),set())
        value['Value']['TextLiteralType']='StringTableEntry'
        with self.assertRaises(BlueprintTranslationError):expression(value,set(),set())

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

    def test_source_array_get_can_copy_into_the_original_typed_event_frame(self):
        p=self.package();function=p.exports[1];function['ObjectName']='ExecuteUbergraph_Original'
        function['LoadedProperties']=[dict(p.exports[0]['LoadedProperties'][0]),{'Name':'Result','SerializedType':'IntProperty'}]
        p._active_function=function;p.imports[0]['ObjectName']='Array_Get'
        call=node('EX_FinalFunction',StackNode=-1,Parameters=[var('Items',2,True),node('EX_IntZero'),var('Result',2,True)])
        context=node('EX_Context',ObjectExpression=node('EX_ObjectConst',Value=-4),ContextExpression=call,Offset=memory_size(call))
        result=expression(context,set(),set(),package=p,owner=1)
        self.assertEqual(result['array'],{'op':'get','scope':'persistent','frame':2,'field':'Items'})
        self.assertEqual(result['target'],{'op':'get','scope':'persistent','frame':2,'field':'Result'})
        call['Parameters'][2]['Variable']['New']['ResolvedOwner']=1
        with self.assertRaisesRegex(BlueprintTranslationError,'another owner'): expression(context,set(),set(),package=p,owner=1)

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
