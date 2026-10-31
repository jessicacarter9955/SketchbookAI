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

    def test_nested_source_actor_property_context_preserves_both_original_owners(self):
        sources = self.sources()
        caller, base = sources['/Game/Caller'], sources['/Game/Base']
        base.imports.extend([
            {'ObjectName': 'Child_C', 'ClassName': 'BlueprintGeneratedClass', 'OuterIndex': -4},
            {'ObjectName': '/Game/Child', 'ClassName': 'Package'},
        ])
        base.exports[0]['LoadedProperties'].append({
            'Name': 'Friend', 'SerializedType': 'ObjectProperty', 'PropertyClass': -3,
        })
        actor = node('EX_InstanceVariable', Variable={
            'New': {'Path': ['Actor'], 'ResolvedOwner': 1},
        })
        friend_ptr = {'New': {'Path': ['Friend'], 'ResolvedOwner': -1}}
        friend_read = node('EX_InstanceVariable', Variable=friend_ptr)
        inner = node('EX_Context', ObjectExpression=actor, ContextExpression=friend_read,
                     RValuePointer=friend_ptr, Offset=memory_size(friend_read, package=caller))
        health_ptr = {'New': {'Path': ['Health'], 'ResolvedOwner': -1}}
        health_read = node('EX_InstanceVariable', Variable=health_ptr)
        outer = node('EX_Context', ObjectExpression=inner, ContextExpression=health_read,
                     RValuePointer=health_ptr, Offset=memory_size(health_read, package=caller))
        result = expression(outer, set(), set(), package=caller, owner=1)
        self.assertEqual(result['op'], 'source_actor_member')
        self.assertEqual(result['field'], 'Health')
        self.assertEqual(result['schema']['type'], 'FloatProperty')
        self.assertEqual(result['target']['op'], 'source_actor_member')
        self.assertEqual(result['target']['field'], 'Friend')
        self.assertEqual(result['target_schema']['class'], ['/Game/Child', 'Child_C'])
        invalid = deepcopy(outer)
        invalid['ObjectExpression']['Offset'] += 1
        with self.assertRaisesRegex(BlueprintTranslationError, 'context layout differs'):
            expression(invalid, set(), set(), package=caller, owner=1)

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

    def test_generated_source_class_remains_a_typed_nullable_reference_without_loaded_behavior(self):
        caller = Package({'Imports': [
            {'ObjectName': 'WBP_Tracker_C', 'ClassName': 'WidgetBlueprintGeneratedClass', 'OuterIndex': -2},
            {'ObjectName': '/Game/UncachedTracker', 'ClassName': 'Package'},
        ], 'Exports': []})
        schema = property_schema(caller, {'SerializedType': 'ObjectProperty', 'PropertyClass': -1})
        self.assertEqual(schema, {'type': 'ObjectProperty',
                                  'class': ['/Game/UncachedTracker', 'WBP_Tracker_C'],
                                  'reference_kind': 'runtime_source_object', 'default': None})

    def test_generated_widget_reference_and_context_call_keep_exact_source_contract(self):
        target = Package({'Imports': [
            {'ObjectName': 'UserWidget', 'ClassName': 'Class', 'OuterIndex': -2},
            {'ObjectName': '/Script/UMG', 'ClassName': 'Package'},
            {'ObjectName': 'Actor', 'ClassName': 'Class', 'OuterIndex': -4},
            {'ObjectName': '/Script/Engine', 'ClassName': 'Package'},
        ], 'Exports': [
            {'$type': 'UAssetAPI.ExportTypes.ClassExport, UAssetAPI', 'ObjectName': 'WBP_Tracker_C',
             'SuperStruct': -1, 'LoadedProperties': [
                 {'Name': 'QuestCount', 'SerializedType': 'IntProperty'}]},
            {'ObjectName': 'InitQuestTracker', 'OuterIndex': 1, 'LoadedProperties': [
                {'Name': 'OwnerPawn', 'SerializedType': 'ObjectProperty', 'PropertyClass': -3,
                 'PropertyFlags': 'CPF_Parm'}], 'ScriptBytecode': [
                node('EX_Return', ReturnExpression=node('EX_Nothing')), node('EX_EndOfScript')]},
        ]})
        caller = Package({'Imports': [
            {'ObjectName': 'WBP_Tracker_C', 'ClassName': 'WidgetBlueprintGeneratedClass', 'OuterIndex': -2},
            {'ObjectName': '/Game/Tracker', 'ClassName': 'Package'},
            {'ObjectName': 'Actor', 'ClassName': 'Class', 'OuterIndex': -4},
            {'ObjectName': '/Script/Engine', 'ClassName': 'Package'},
        ], 'Exports': [
            {'$type': 'UAssetAPI.ExportTypes.ClassExport, UAssetAPI', 'ObjectName': 'WBP_HUD_C',
             'LoadedProperties': [
                 {'Name': 'Tracker', 'SerializedType': 'ObjectProperty', 'PropertyClass': -1}]},
            {'ObjectName': 'InitHUDWidgets', 'OuterIndex': 1, 'LoadedProperties': [
                {'Name': 'OwnerPawn', 'SerializedType': 'ObjectProperty', 'PropertyClass': -3,
                 'PropertyFlags': 'CPF_Parm'}], 'ScriptBytecode': []},
        ]})
        sources = {'/Game/HUD': caller, '/Game/Tracker': target}
        for package in sources.values():
            package.source_packages = sources

        widget_schema = property_schema(caller, caller.exports[0]['LoadedProperties'][0])
        self.assertEqual(widget_schema, {'type': 'ObjectProperty', 'class': ['/Game/Tracker', 'WBP_Tracker_C'],
                                         'reference_kind': 'runtime_source_object', 'default': None})

        widget = node('EX_InstanceVariable', Variable={'New': {'Path': ['Tracker'], 'ResolvedOwner': 1}})
        owner = node('EX_LocalVariable', Variable={'New': {'Path': ['OwnerPawn'], 'ResolvedOwner': 2}})
        call = node('EX_LocalVirtualFunction', VirtualFunctionName='InitQuestTracker', Parameters=[owner])
        context = node('EX_Context', ObjectExpression=widget, ContextExpression=call, Offset=23,
                       PropertyType=0, RValuePointer={'New': {'Path': [], 'ResolvedOwner': 0}})
        function = caller.exports[1]
        function['ScriptBytecode'] = [context, node('EX_Return', ReturnExpression=node('EX_Nothing')),
                                      node('EX_EndOfScript')]
        program = translate_package(caller)['functions']['InitHUDWidgets']
        call_expression = program['steps'][0]['value']
        self.assertEqual(call_expression['op'], 'component_query')
        self.assertEqual(call_expression['package'], '/Game/Tracker')
        self.assertEqual(call_expression['class_object'], 'WBP_Tracker_C')
        self.assertEqual(call_expression['class_export_index'], 1)
        self.assertEqual(call_expression['dispatch'], 'EX_LocalVirtualFunction')
        self.assertEqual(call_expression['bindings'][0]['schema']['reference_kind'], 'runtime_actor')

        for key, replacement in (
            ('Offset', context['Offset'] + 1),
            ('PropertyType', 1),
            ('RValuePointer', {'New': {'Path': ['OwnerPawn'], 'ResolvedOwner': 2}}),
        ):
            bad = deepcopy(context)
            bad[key] = replacement
            with self.subTest(context_field=key), self.assertRaises(BlueprintTranslationError):
                expression(bad, set(), set(), package=caller, owner=1)

        quest_count = node('EX_InstanceVariable', Variable={'New': {'Path': ['QuestCount'], 'ResolvedOwner': -1}})
        member_context = node('EX_Context', ObjectExpression=widget, ContextExpression=quest_count,
                              Offset=memory_size(quest_count, package=caller), PropertyType=0,
                              RValuePointer=quest_count['Variable'])
        member = expression(member_context, set(), set(), package=caller, owner=1)
        self.assertEqual(member['op'], 'component_member')
        self.assertEqual(member['receiver_schema'], widget_schema)
        self.assertEqual(member['schema'], {'type': 'IntProperty', 'default': 0})
