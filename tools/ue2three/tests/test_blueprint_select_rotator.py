import copy
import unittest
from umg_migration import Package
from blueprint_migration import expression, BlueprintTranslationError, native_math_result_type
def n(token, **data):return {'$type':'UAssetAPI.Kismet.Bytecode.Expressions.'+token+', UAssetAPI',**data}
class SelectRotatorTests(unittest.TestCase):
 def test_original_typed_call_and_invalid_boolean(self):
  p=Package({'ObjectVersionUE5':'IMPORT_TYPE_HIERARCHIES','Imports':[{'ObjectName':'/Script/Engine','ClassName':'Package'},{'ObjectName':'KismetMathLibrary','ClassName':'Class','OuterIndex':-1},{'ObjectName':'SelectRotator','ClassName':'Function','OuterIndex':-2}],'Exports':[]})
  a=n('EX_RotationConst',Value={'Pitch':0,'Yaw':90,'Roll':90})
  b=n('EX_RotationConst',Value={'Pitch':0,'Yaw':-90,'Roll':90})
  call=n('EX_CallMath',StackNode=-3,Parameters=[a,b,n('EX_True')])
  out=expression(call,set(),set(),package=p,owner=1)
  self.assertEqual(out['op'],'math');self.assertEqual(out['name'],'SelectRotator')
  self.assertEqual(native_math_result_type('SelectRotator'),'Rotator')
  bad=copy.deepcopy(call);bad['Parameters'][2]=n('EX_IntOne')
  with self.assertRaisesRegex(BlueprintTranslationError,'parameter type'):expression(bad,set(),set(),package=p,owner=1)
