import unittest
from blueprint_types import source_structs, property_schema
from blueprint_migration import BlueprintTranslationError, translate_package, memory_size
from umg_migration import Package
from test_blueprint_migration import node


class SourceTypesTests(unittest.TestCase):
    def documents(self):
        return {'/Game/Slot': {'Imports': [{'ObjectName': 'Kind', 'OuterIndex': -2},
                                          {'ObjectName': '/Game/Kind', 'ClassName': 'Package'}],
                 'Exports': [{'ObjectName': 'Slot', 'LoadedProperties': [
                     {'Name': 'Kind', 'SerializedType': 'ByteProperty', 'Enum': -1},
                     {'Name': 'Health', 'SerializedType': 'DoubleProperty'}],
                     'StructData': [{'Name': 'Kind', 'ByteType': 'FName', 'EnumValue': 'Kind::Entry17'},
                                    {'Name': 'Health', 'Value': '-1'}]}]},
                '/Game/Kind': {'Exports': [{'ObjectName': 'Kind', 'Enum': {'Names': [{'Item1': 'Kind::Entry17', 'Item2': 3}]}}]}}

    def test_source_enum_values_and_nonzero_struct_defaults_are_preserved(self):
        schema = source_structs(self.documents(), BlueprintTranslationError)[('/Game/Slot', 'Slot')]
        self.assertEqual(schema['default'], {'Kind': 3, 'Health': -1})
        package = Package({'Imports': [{'ObjectName': 'Slot', 'OuterIndex': -2}, {'ObjectName': '/Game/Slot', 'ClassName': 'Package'}]})
        package.source_structs = {('/Game/Slot', 'Slot'): schema}
        array = property_schema(package, {'SerializedType': 'ArrayProperty', 'Inner': {'SerializedType': 'StructProperty', 'Struct': -1}})
        self.assertEqual(array['element'], schema)
        self.assertEqual(array['default'], [])

    def test_missing_enum_or_unsupported_member_never_invents_a_constructor(self):
        documents = self.documents(); del documents['/Game/Kind']
        self.assertEqual(source_structs(documents, BlueprintTranslationError), {})
        documents = self.documents(); documents['/Game/Slot']['Exports'][0]['LoadedProperties'][0]['SerializedType'] = 'ObjectProperty'
        self.assertEqual(source_structs(documents, BlueprintTranslationError), {})

    def test_enum_number_is_not_parsed_from_its_display_name(self):
        documents = self.documents(); documents['/Game/Kind']['Exports'][0]['Enum']['Names'][0]['Item2'] = 7
        self.assertEqual(source_structs(documents, BlueprintTranslationError)[('/Game/Slot', 'Slot')]['default']['Kind'], 7)

    def native_array_package(self):
        schema = source_structs(self.documents(), BlueprintTranslationError)
        pointer = lambda name, owner: {'New': {'Path': [name], 'ResolvedOwner': owner}}
        props = [{'Name':'Out','SerializedType':'StructProperty','Struct':-1,'PropertyFlags':'CPF_Parm, CPF_OutParm'}]
        context = node('EX_Context', ObjectExpression=node('EX_ObjectConst',Value=-3), Offset=33,
                       ContextExpression=node('EX_FinalFunction',StackNode=-4,Parameters=[
                           node('EX_InstanceVariable',Variable=pointer('Items',2)),node('EX_IntConst',Value=0),
                           node('EX_LocalOutVariable',Variable=pointer('Out',1))]))
        function = {'ObjectName':'ReadFirst','OuterIndex':2,'LoadedProperties':props,
                    'ScriptBytecode':[context,node('EX_Return',ReturnExpression=node('EX_Nothing')),node('EX_EndOfScript')]}
        cls = {'ObjectName':'Test_C','LoadedProperties':[{'Name':'Items','SerializedType':'ArrayProperty',
                 'Inner':{'SerializedType':'StructProperty','Struct':-1}}]}
        imports = [{'ObjectName':'Slot','OuterIndex':-2},{'ObjectName':'/Game/Slot','ClassName':'Package'},
                   {'ObjectName':'Default__KismetArrayLibrary','OuterIndex':-6},
                   {'ObjectName':'Array_Get','OuterIndex':-5},{'ObjectName':'KismetArrayLibrary','OuterIndex':-6},
                   {'ObjectName':'/Script/Engine','ClassName':'Package'}]
        return Package({'Exports':[function,cls],'Imports':imports}),schema

    def test_array_get_requires_original_library_context_and_matching_output_type(self):
        package,schema = self.native_array_package()
        result = translate_package(package,schema)
        self.assertEqual(result['functions']['ReadFirst']['steps'][0]['value']['op'],'array_get')
        for change in ('library','offset','output'):
            package,schema = self.native_array_package()
            if change=='library': package.imports[5]['ObjectName']='/Game/Fake'
            elif change=='offset': package.exports[0]['ScriptBytecode'][0]['Offset']=32
            else: package.exports[0]['LoadedProperties'][0]['SerializedType']='IntProperty'
            self.assertNotIn('ReadFirst',translate_package(package,schema)['functions'])

    def test_struct_write_requires_the_matching_original_member_and_root(self):
        package,schema=self.native_array_package()
        package.exports[0]['ScriptBytecode'].insert(1,node('EX_Let',
            Variable=node('EX_StructMemberContext',StructMemberExpression={'New':{'Path':['Health'],'ResolvedOwner':-1}},
                          StructExpression=node('EX_LocalOutVariable',Variable={'New':{'Path':['Out'],'ResolvedOwner':1}})),
            Expression=node('EX_DoubleConst',Value='50')))
        result=translate_package(package,schema)
        self.assertEqual(result['functions']['ReadFirst']['steps'][1]['op'],'set_member')
        package.exports[0]['ScriptBytecode'][1]['Variable']['StructMemberExpression']['New']['Path']=['Unknown']
        self.assertNotIn('ReadFirst',translate_package(package,schema)['functions'])

    def test_array_length_preserves_the_typed_original_context(self):
        package,schema=self.native_array_package()
        package.imports[3]['ObjectName']='Array_Length'
        context=package.exports[0]['ScriptBytecode'][0]
        context['ContextExpression']['Parameters']=context['ContextExpression']['Parameters'][:1]
        context['Offset']=19
        package.exports[0]['LoadedProperties'][0]={'Name':'Out','SerializedType':'IntProperty','PropertyFlags':'CPF_Parm, CPF_OutParm'}
        package.exports[0]['ScriptBytecode'][0]=node('EX_Let',Variable=node('EX_LocalOutVariable',Variable={'New':{'Path':['Out'],'ResolvedOwner':1}}),Expression=context)
        self.assertEqual(translate_package(package,schema)['functions']['ReadFirst']['steps'][0]['value']['op'],'array_length')
        context['Offset']=18
        self.assertNotIn('ReadFirst',translate_package(package,schema)['functions'])
