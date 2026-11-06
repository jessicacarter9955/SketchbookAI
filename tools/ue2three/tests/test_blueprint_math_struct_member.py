import unittest
from umg_migration import Package
from blueprint_values import native_schema
from blueprint_migration import native_math_source_type,BlueprintTranslationError
from test_blueprint_migration import node
class OriginalMathStructMemberTests(unittest.TestCase):
 def package(self):
  p=Package({'Imports':[{'ObjectName':'OriginalData','ClassName':'ScriptStruct','OuterIndex':-2},
   {'ObjectName':'/Game/OriginalData','ClassName':'Package'}],
   'Exports':[{'ObjectName':'Original_C','LoadedProperties':[
    {'Name':'Data','SerializedType':'StructProperty','Struct':-1}]}]})
  p.source_structs={('/Game/OriginalData','OriginalData'):{'type':'StructProperty','source':'/Game/OriginalData',
   'fields':{'Velocity':native_schema(('/Script/CoreUObject','Vector'))},'default':{'Velocity':{'X':0,'Y':0,'Z':0}},'member_order':['Velocity']}}
  return p
 def test_member_type_is_resolved_from_exact_original_struct_declaration(self):
  p=self.package()
  value=node('EX_StructMemberContext',StructExpression=node('EX_InstanceVariable',Variable={'New':{'Path':['Data'],'ResolvedOwner':1}}),
   StructMemberExpression={'New':{'Path':['Velocity'],'ResolvedOwner':-1}})
  self.assertEqual(native_math_source_type(value,p,1),'Vector')
  value['StructMemberExpression']['New']['ResolvedOwner']=-2
  with self.assertRaisesRegex(BlueprintTranslationError,'declaration'):native_math_source_type(value,p,1)
 def test_missing_source_member_cannot_acquire_a_guessed_math_type(self):
  p=self.package()
  value=node('EX_StructMemberContext',StructExpression=node('EX_InstanceVariable',Variable={'New':{'Path':['Data'],'ResolvedOwner':1}}),
   StructMemberExpression={'New':{'Path':['Missing'],'ResolvedOwner':-1}})
  with self.assertRaisesRegex(BlueprintTranslationError,'unavailable'):native_math_source_type(value,p,1)
