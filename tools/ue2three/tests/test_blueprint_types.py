import unittest
from blueprint_types import source_structs, property_schema
from blueprint_migration import BlueprintTranslationError, translate_package, memory_size, property_type
from blueprint_values import serialized_value, native_schema, witnessed_complete_default, witnessed_enum_tag_default
from umg_migration import Package
from test_blueprint_migration import node


class SourceTypesTests(unittest.TestCase):
    def test_inherited_original_enum_tag_is_resolved_without_guessing(self):
        identity = '/Game/Fixers/Core/Blueprints/Components/Identity/Enum/E_Faction'
        tag = {'Name': 'Faction', 'ByteType': 'FName', 'EnumType': 'E_Faction',
               'EnumValue': 'E_Faction::NewEnumerator2',
               'PropertyTypeName': [{'Name': 'ByteProperty', 'InnerCount': 1},
                                    {'Name': 'E_Faction', 'InnerCount': 1},
                                    {'Name': identity, 'InnerCount': 0}]}
        enums = {(identity, 'E_Faction'): {'E_Faction::NewEnumerator2': 5}}
        self.assertEqual(witnessed_enum_tag_default(tag, enums), 5)
        package = Package({'Exports': [
            {'ObjectName': 'ReadFaction', 'OuterIndex': 2, 'ScriptBytecode': [
                node('EX_Return', ReturnExpression=node('EX_InstanceVariable',
                     Variable={'New': {'Path': ['Faction'], 'ResolvedOwner': 2}})),
                node('EX_EndOfScript')]},
            {'ObjectName': 'Child_C', 'LoadedProperties': []},
            {'ObjectName': 'Default__Child_C', 'Data': [tag]}]})
        package.source_enums = enums
        report = translate_package(package)
        self.assertEqual(report['default_state']['Faction'], 5)
        self.assertEqual(report['functions']['ReadFaction']['source_defaults']['Faction'], 5)
        self.assertEqual(report['functions']['ReadFaction']['field_types']['self']['Faction'], 'ByteProperty')
        self.assertNotIn('Faction', report['unavailable_default_fields'])
        for bad in ({}, {(identity, 'E_Faction'): {'E_Faction::Other': 5}}):
            with self.subTest(bad=bad):
                package.source_enums = bad
                report = translate_package(package)
                self.assertNotIn('ReadFaction', report['functions'])
        for changed in ('path', 'value', 'type'):
            other = dict(tag)
            other['PropertyTypeName'] = [dict(x) for x in tag['PropertyTypeName']]
            if changed == 'path': other['PropertyTypeName'][2]['Name'] = '/Game/Fake/E_Faction'
            elif changed == 'value': other['EnumValue'] = 'E_Faction::MadeUp'
            else: other['PropertyTypeName'][0]['Name'] = 'IntProperty'
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                witnessed_enum_tag_default(other, enums)

    def test_struct_without_source_constructor_is_blocked_without_crashing_replay(self):
        package = Package({'Exports': [
            {'ObjectName': 'ReadMissing', 'OuterIndex': 2, 'ScriptBytecode': [
                node('EX_Return', ReturnExpression=node('EX_InstanceVariable',
                     Variable={'New': {'Path': ['State'], 'ResolvedOwner': 2}})),
                node('EX_EndOfScript')]},
            {'ObjectName': 'Test_C', 'LoadedProperties': [
                {'Name': 'State', 'SerializedType': 'StructProperty', 'Struct': -1}]}],
            'Imports': [{'ObjectName': 'Unknown', 'OuterIndex': -2},
                        {'ObjectName': '/Game/Original', 'ClassName': 'Package'}]})
        schema = {'type': 'StructProperty', 'fields': {'Value': {'type': 'IntProperty'}}}
        result = translate_package(package, {('/Game/Original', 'Unknown'): schema})
        self.assertNotIn('State', result['default_state'])
        self.assertIn('State', result['unavailable_default_fields'])
        self.assertEqual(result['unavailable_default_evidence']['State']['source_struct'], ['/Game/Original', 'Unknown'])
        self.assertFalse(result['unavailable_default_evidence']['State']['source_cdo_present'])
        self.assertNotIn('ReadMissing', result['functions'])

    def test_complete_original_cdo_struct_unblocks_without_constructor_guessing(self):
        document = {'Exports': [
            {'ObjectName': 'ReadOriginal', 'OuterIndex': 2, 'ScriptBytecode': [
                node('EX_Return', ReturnExpression=node('EX_InstanceVariable',
                     Variable={'New': {'Path': ['State'], 'ResolvedOwner': 2}})),
                node('EX_EndOfScript')]},
            {'ObjectName': 'Test_C', 'LoadedProperties': [
                {'Name': 'State', 'SerializedType': 'StructProperty', 'Struct': -1}]},
            {'ObjectName': 'Default__Test_C', 'Data': [{'Name': 'State', 'Value': [
                {'Name': 'Amount', 'Value': 7}, {'Name': 'Enabled', 'Value': True}]}]}],
            'Imports': [{'ObjectName': 'Unknown', 'OuterIndex': -2},
                        {'ObjectName': '/Game/Original', 'ClassName': 'Package'}]}
        schema = {'type': 'StructProperty', 'fields': {
            'Amount': {'type': 'IntProperty'}, 'Enabled': {'type': 'BoolProperty'}}}
        result = translate_package(Package(document), {('/Game/Original', 'Unknown'): schema})
        self.assertEqual(result['default_state']['State'], {'Amount': 7, 'Enabled': True})
        self.assertIn('ReadOriginal', result['functions'])
        self.assertNotIn('State', result['unavailable_default_fields'])
        document['Exports'][2]['Data'][0]['Value'].pop()
        result = translate_package(Package(document), {('/Game/Original', 'Unknown'): schema})
        self.assertNotIn('ReadOriginal', result['functions'])
        self.assertEqual(result['unavailable_default_evidence']['State']['source_cdo_fields'], ['Amount'])

    def test_complete_struct_witness_rejects_invalid_or_partial_fields(self):
        schema = {'type': 'StructProperty', 'fields': {
            'Offset': {'type': 'StructProperty', 'fields': {'X': {'type': 'DoubleProperty'}, 'Y': {'type': 'DoubleProperty'}}},
            'Count': {'type': 'ByteProperty'}}}
        self.assertEqual(witnessed_complete_default(schema, {'Offset': {'X': '3.5', 'Y': 0}, 'Count': 3}),
                         {'Offset': {'X': 3.5, 'Y': 0.0}, 'Count': 3})
        for value in ({'Offset': {'X': 1}, 'Count': 3}, {'Offset': {'X': float('nan'), 'Y': 0}, 'Count': 3},
                      {'Offset': {'X': 1, 'Y': 0}, 'Count': 300}, {'Offset': {'X': 1, 'Y': 0}, 'Count': 3, 'Extra': 1}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                witnessed_complete_default(schema, value)

    def test_native_transform_schema_preserves_quaternion_translation_and_scale_types(self):
        quaternion = native_schema(('/Script/CoreUObject', 'Quat'))
        transform = native_schema(('/Script/CoreUObject', 'Transform'))
        self.assertEqual(quaternion['fields'], {name: {'type': 'DoubleProperty'} for name in ('X','Y','Z','W')})
        self.assertEqual(quaternion['default'], {'X': 0, 'Y': 0, 'Z': 0, 'W': 1})
        self.assertEqual(transform['member_order'], ['Rotation','Translation','Scale3D'])
        self.assertEqual(transform['fields']['Rotation'], quaternion)
        self.assertEqual(transform['fields']['Translation']['native'], 'Vector')
        self.assertEqual(transform['fields']['Scale3D']['native'], 'Vector')
        self.assertEqual(transform['default']['Scale3D'], {'X': 1, 'Y': 1, 'Z': 1})
        package = Package({'Imports': [{'ObjectName':'Transform','ClassName':'ScriptStruct','OuterIndex':-2},
                                        {'ObjectName':'/Script/CoreUObject','ClassName':'Package'}]})
        self.assertEqual(property_schema(package, {'SerializedType':'StructProperty','Struct':-1}), transform)

    def test_native_format_argument_schema_and_struct_member_write_use_reflected_types(self):
        schema = native_schema(('/Script/Engine', 'FormatArgumentData'))
        self.assertEqual(schema['member_order'], ['ArgumentName','ArgumentValue','ArgumentValueDouble',
            'ArgumentValueFloat','ArgumentValueGender','ArgumentValueInt','ArgumentValueType'])
        self.assertEqual(schema['fields']['ArgumentName']['type'], 'StrProperty')
        self.assertEqual(schema['fields']['ArgumentValue']['type'], 'TextProperty')
        self.assertEqual(schema['fields']['ArgumentValueGender']['enum'], ['/Script/Engine','ETextGender'])
        package = Package({'Imports': [
            {'ObjectName':'FormatArgumentData','ClassName':'ScriptStruct','OuterIndex':-2},
            {'ObjectName':'/Script/Engine','ClassName':'Package'}],
            'Exports': [
                {'ObjectName':'WriteFormatArgumentName','OuterIndex':2,'LoadedProperties':[
                    {'Name':'ArgumentData','SerializedType':'StructProperty','Struct':-1}],
                 'ScriptBytecode': [
                    node('EX_Let',Variable=node('EX_StructMemberContext',
                        StructMemberExpression={'New':{'Path':['ArgumentName'],'ResolvedOwner':-1}},
                        StructExpression=node('EX_LocalVariable',Variable={'New':{'Path':['ArgumentData'],'ResolvedOwner':1}})),
                        Expression=node('EX_StringConst',Value='CarryWeight')),
                    node('EX_Return',ReturnExpression=node('EX_Nothing')),node('EX_EndOfScript')]},
                {'ObjectName':'Test_C','LoadedProperties':[]}]})
        program = translate_package(package)['functions']['WriteFormatArgumentName']
        write = program['steps'][0]
        self.assertEqual(write['op'], 'set_member')
        self.assertEqual(write['target'], {'op':'get','scope':'local','field':'ArgumentData'})
        self.assertEqual(write['member_type'], 'StrProperty')
        package.exports[0]['ScriptBytecode'][0]['Variable']['StructMemberExpression']['New']['Path'] = ['Unknown']
        self.assertNotIn('WriteFormatArgumentName', translate_package(package)['functions'])

    def test_slate_color_schema_preserves_specified_linear_color_and_original_style_enum(self):
        schema=native_schema(('/Script/SlateCore','SlateColor'))
        self.assertEqual(schema['member_order'],['SpecifiedColor','ColorUseRule'])
        self.assertEqual(schema['fields']['SpecifiedColor']['native'],'LinearColor')
        self.assertEqual(schema['fields']['ColorUseRule']['enum'],['/Script/SlateCore','ESlateColorStylingMode'])
        package=Package({'Imports':[{'ObjectName':'SlateColor','ClassName':'ScriptStruct','OuterIndex':-2},
            {'ObjectName':'/Script/SlateCore','ClassName':'Package'}]})
        self.assertEqual(property_schema(package,{'SerializedType':'StructProperty','Struct':-1}),schema)
        source={'Value':[
            {'Name':'SpecifiedColor','Value':[{'Name':'SpecifiedColor','Value':{'R':1.0,'G':0.4,'B':0.2,'A':1.0}}]},
            {'Name':'ColorUseRule','Value':'ESlateColorStylingMode::UseColor_Specified'}]}
        self.assertEqual(serialized_value(package,{},schema,source),
            {'SpecifiedColor':{'R':1.0,'G':0.4,'B':0.2,'A':1.0},'ColorUseRule':0})
        invalid={'Value':[source['Value'][0],{'Name':'ColorUseRule','Value':'ESlateColorStylingMode::Unknown'}]}
        with self.assertRaisesRegex(ValueError,'native enum mapping'):
            serialized_value(package,{},schema,invalid)

    def test_int64_values_are_limited_to_exact_javascript_safe_integers(self):
        package = Package({})
        prop = {'Name': 'Counter', 'SerializedType': 'Int64Property'}
        schema = property_schema(package, prop)
        self.assertEqual(schema, {'type': 'Int64Property', 'default': 0})
        self.assertEqual(property_type(prop), 'Int64Property')
        for value in (0, -(2**53)+1, 2**53-1):
            self.assertEqual(serialized_value(package, prop, schema, {'Value': value}), value)
        for value in (-(2**53), 2**53, 2**63, -(2**63)-1, True, 1.0, '1'):
            with self.assertRaisesRegex(ValueError, 'exact JavaScript integer range'):
                serialized_value(package, prop, schema, {'Value': value})

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

    def test_const_reference_struct_is_an_input_and_never_an_output_or_write(self):
        package, schema = self.native_array_package()
        fn = package.exports[0]
        fn['LoadedProperties'][0]['PropertyFlags'] = 'CPF_Parm, CPF_OutParm, CPF_ReferenceParm, CPF_ConstParm'
        fn['ScriptBytecode'] = [node('EX_Return', ReturnExpression=node('EX_LocalOutVariable',
            Variable={'New': {'Path': ['Out'], 'ResolvedOwner': 1}})), node('EX_EndOfScript')]
        program = translate_package(package, schema)['functions']['ReadFirst']
        self.assertEqual(program['input_fields'], ['Out'])
        self.assertEqual(program['output_fields'], [])
        fn['ScriptBytecode'].insert(0, node('EX_Let', Variable=node('EX_LocalOutVariable',
            Variable={'New': {'Path': ['Out'], 'ResolvedOwner': 1}}), Expression=node('EX_Nothing')))
        self.assertNotIn('ReadFirst', translate_package(package, schema)['functions'])
        package, schema = self.native_array_package()
        package.exports[0]['LoadedProperties'][0]['PropertyFlags'] += ', CPF_ReferenceParm, CPF_ConstParm'
        self.assertNotIn('ReadFirst', translate_package(package, schema)['functions'])

    def test_mutable_reference_requires_initial_input_and_retains_output(self):
        package, schema = self.native_array_package()
        package.exports[0]['LoadedProperties'][0]['PropertyFlags'] += ', CPF_ReferenceParm'
        program = translate_package(package, schema)['functions']['ReadFirst']
        self.assertEqual(program['input_fields'], ['Out'])
        self.assertEqual(program['output_fields'], ['Out'])

    def test_table_read_requires_exact_library_original_row_schema_and_context(self):
        package, schemas = self.native_array_package()
        imports = package.imports
        imports[2]['ObjectName'] = 'Default__DataTableFunctionLibrary'
        imports[3]['ObjectName'] = 'GetDataTableRowFromName'; imports[4]['ObjectName'] = 'DataTableFunctionLibrary'
        imports.extend([{'ObjectName': 'DataTable', 'OuterIndex': -6},
                        {'ObjectName': 'Rows', 'OuterIndex': -9}, {'ObjectName': '/Game/Rows', 'ClassName': 'Package'}])
        package.exports[1]['LoadedProperties'] = [{'Name': 'Rows', 'SerializedType': 'ObjectProperty', 'PropertyClass': -7}]
        package.exports.append({'ObjectName': 'Default__Test_C', 'Data': [{'Name': 'Rows', 'Value': -8}]})
        context = package.exports[0]['ScriptBytecode'][0]; context['Offset'] = 41
        context['ContextExpression']['Parameters'][0]['Variable']['New']['Path'] = ['Rows']
        context['ContextExpression']['Parameters'][1] = node('EX_NameConst', Value='First')
        schema = schemas[('/Game/Slot', 'Slot')]
        tables = {'/Game/Rows.Rows': {'schema': schema, 'rows': {'First': schema['default']}}}
        self.assertEqual(translate_package(package, schemas, tables)['functions']['ReadFirst']['steps'][0]['value']['op'], 'table_get')
        context['Offset'] = 40
        self.assertNotIn('ReadFirst', translate_package(package, schemas, tables)['functions'])
        context['Offset'] = 41
        self.assertNotIn('ReadFirst', translate_package(package, schemas, {})['functions'])

    def test_table_read_accepts_a_typed_asset_constant_and_a_name_struct_member(self):
        package, schemas = self.native_array_package()
        schema = schemas[('/Game/Slot', 'Slot')]
        schema['fields']['Identity'] = {'type':'NameProperty','default':'None'}
        schema['default']['Identity'] = 'None'
        schema['member_order'].append('Identity')
        package.exports[1]['LoadedProperties'].append(
            {'Name':'Appearance','SerializedType':'StructProperty','Struct':-1})
        package.imports.extend([
            {'ObjectName':'GetDataTableRowFromName','ClassName':'Function','OuterIndex':-8},
            {'ObjectName':'DataTableFunctionLibrary','OuterIndex':-6},
            {'ObjectName':'Default__DataTableFunctionLibrary','ClassName':'DataTableFunctionLibrary','OuterIndex':-6},
            {'ObjectName':'DT_Rows','ClassName':'DataTable','ClassPackage':'/Script/Engine','OuterIndex':-11},
            {'ObjectName':'/Game/Rows','ClassName':'Package'},
        ])
        row = node('EX_StructMemberContext',
            StructExpression=node('EX_InstanceVariable',Variable={'New':{'Path':['Appearance'],'ResolvedOwner':2}}),
            StructMemberExpression={'New':{'Path':['Identity'],'ResolvedOwner':-1}})
        call = node('EX_FinalFunction',StackNode=-7,Parameters=[node('EX_ObjectConst',Value=-10),row,
            node('EX_LocalOutVariable',Variable={'New':{'Path':['Out'],'ResolvedOwner':1}})])
        context = node('EX_Context',ObjectExpression=node('EX_ObjectConst',Value=-9),
            ContextExpression=call,Offset=memory_size(call,package=package))
        package.exports[0]['ScriptBytecode'][0] = context
        tables = {'/Game/Rows.DT_Rows':{'schema':schema,'rows':{'First':schema['default']}}}
        program = translate_package(package,schemas,tables)['functions']['ReadFirst']
        translated = program['steps'][0]['value']
        self.assertEqual(translated['op'],'table_get')
        self.assertEqual(translated['table']['value']['asset'],'/Game/Rows.DT_Rows')
        self.assertEqual(translated['row_schema'],{'type':'NameProperty','default':'None'})
        self.assertEqual(translated['identity'],['/Script/Engine','DataTableFunctionLibrary','GetDataTableRowFromName'])
        self.assertEqual(translated['dispatch'],'EX_FinalFunction')

        row['StructMemberExpression']['New']['Path'] = ['Health']
        blocked = translate_package(package,schemas,tables)
        self.assertNotIn('ReadFirst',blocked['functions'])
        self.assertIn('not a NameProperty',blocked['blocked'][0]['reason'])
