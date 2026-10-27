import unittest
from copy import deepcopy
from umg_migration import Package
from test_blueprint_migration import node
from blueprint_casts import dynamic_cast, class_lineage, object_bool_cast
from blueprint_migration import BlueprintTranslationError


class SourceCastTests(unittest.TestCase):
    def package(self):
        p=Package({'Imports':[
            {'ObjectName':'Actor','ClassName':'Class','OuterIndex':-2},
            {'ObjectName':'/Script/Engine','ClassName':'Package'},
            {'ObjectName':'Pawn','ClassName':'Class','OuterIndex':-2},
            {'ObjectName':'Pawn_C','ClassName':'BlueprintGeneratedClass','OuterIndex':-5},
            {'ObjectName':'/Game/Pawn','ClassName':'Package'},
            {'ObjectName':'BlueprintGeneratedClass','ClassName':'Class','OuterIndex':-2}],
            'Exports':[{'ObjectName':'Pawn_C','ClassIndex':-6,'SuperStruct':-3,
                        'LoadedProperties':[{'Name':'ActorInput','SerializedType':'ObjectProperty','PropertyClass':-1}]}]})
        p.source_packages={'/Game/Pawn':p}
        return p

    def value(self):
        return node('EX_DynamicCast',ClassPtr=-4,Target=node('EX_InstanceVariable',
            Variable={'New':{'Path':['ActorInput'],'ResolvedOwner':1}}))

    def test_original_actor_cast_retains_typed_input_and_class_witness(self):
        p=self.package();reads=set();result=dynamic_cast(self.value(),p,1,reads,set())
        self.assertEqual(result['dispatch'],'EX_DynamicCast')
        self.assertEqual(result['input_schema']['class'],['/Script/Engine','Actor'])
        self.assertEqual(result['class_lineage'],[
            {'class':['/Game/Pawn','Pawn_C'],'export_index':1,'super':['/Script/Engine','Pawn']},
            {'class':['/Script/Engine','Pawn'],'native':True},
            {'class':['/Script/Engine','Actor'],'native':True}])
        self.assertIn('ActorInput',reads)

    def test_local_export_class_pointer_uses_original_package_identity(self):
        p=self.package();value=self.value();value['ClassPtr']=1
        self.assertEqual(dynamic_cast(value,p,1,set(),set())['target_class'],['/Game/Pawn','Pawn_C'])

    def test_null_is_a_valid_source_cast_input(self):
        p=self.package();value=self.value();value['Target']=node('EX_NoObject')
        self.assertIsNone(dynamic_cast(value,p,1,set(),set())['input_schema'])

    def test_original_object_to_bool_accepts_typed_cast_result_and_rejects_arithmetic_truthiness(self):
        from blueprint_migration import expression, native_math_source_type
        p=self.package()
        value=node('EX_PrimitiveCast',ConversionType=1,Target=self.value())
        translated=expression(value,set(),set(),package=p,owner=1)
        self.assertEqual(translated['op'],'source_object_bool')
        self.assertEqual(translated['value']['op'],'source_dynamic_cast')
        self.assertEqual(native_math_source_type(value,p,1),'BoolProperty')
        null=node('EX_PrimitiveCast',ConversionType=1,Target=node('EX_NoObject'))
        self.assertIsNone(object_bool_cast(null,p,1,set(),set())['schema'])
        with self.assertRaises(BlueprintTranslationError):
            expression(node('EX_PrimitiveCast',ConversionType=1,Target=node('EX_IntOne')),set(),set(),package=p,owner=1)

    def test_asset_identity_and_nonobject_input_are_not_live_objects(self):
        p=self.package();value=self.value();value['Target']=node('EX_ObjectConst',Value=-4)
        with self.assertRaisesRegex(BlueprintTranslationError,'typed live'):dynamic_cast(value,p,1,set(),set())
        p.exports[0]['LoadedProperties'][0]={'Name':'ActorInput','SerializedType':'IntProperty'}
        with self.assertRaisesRegex(BlueprintTranslationError,'live runtime'):dynamic_cast(self.value(),p,1,set(),set())

    def test_unknown_interface_and_nonclass_import_reject(self):
        for mode in ('unknown','interface','nonclass'):
            p=self.package()
            if mode=='unknown':p.exports[0]['SuperStruct']=-6
            if mode=='interface':p.exports[0]['ClassFlags']='CLASS_Interface'
            if mode=='nonclass':p.imports[3]['ClassName']='Object'
            with self.subTest(mode=mode),self.assertRaises(BlueprintTranslationError):dynamic_cast(self.value(),p,1,set(),set())

    def test_original_source_inheritance_is_resolved_and_cycles_reject(self):
        p=self.package();child=deepcopy(p);child.exports[0]['ObjectName']='Child_C';child.exports[0]['SuperStruct']=-4
        p.source_packages['/Game/Child']=child;child.source_packages=p.source_packages
        lineage=class_lineage(p,('/Game/Child','Child_C'))
        self.assertEqual(lineage[1]['class'],['/Game/Pawn','Pawn_C'])
        p.exports[0]['SuperStruct']=-4
        with self.assertRaisesRegex(BlueprintTranslationError,'cyclic'):class_lineage(p,('/Game/Pawn','Pawn_C'))
