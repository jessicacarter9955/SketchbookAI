import unittest,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from umg_migration import Package
from blueprint_migration import expression,BlueprintTranslationError,MATH_CALLS,NATIVE_MATH_INPUT_TYPES
from blueprint_values import native_schema
def node(t,**v):return {'$type':'UAssetAPI.Kismet.Bytecode.Expressions.'+t+', UAssetAPI',**v}
def local(n):return node('EX_LocalVariable',Variable={'New':{'Path':[n],'ResolvedOwner':1}})
class Vector2DTests(unittest.TestCase):
 def test_source_double_outputs(self):
  self.assertEqual(MATH_CALLS['BreakVector2D'][0],3)
  self.assertEqual(NATIVE_MATH_INPUT_TYPES['BreakVector2D'],('Vector2D',))
  self.assertEqual(native_schema(('/Script/CoreUObject','Vector2D'))['fields'],
                   {'X':{'type':'DoubleProperty'},'Y':{'type':'DoubleProperty'}})
  imports=[
   {'ObjectName':'BreakVector2D','ClassName':'Function','OuterIndex':-2},
   {'ObjectName':'KismetMathLibrary','OuterIndex':-3},
   {'ObjectName':'/Script/Engine','ClassName':'Package'},
   {'ObjectName':'Vector2D','ClassName':'ScriptStruct','OuterIndex':-5},
   {'ObjectName':'/Script/CoreUObject','ClassName':'Package'}]
  props=[{'Name':'Vec','SerializedType':'StructProperty','Struct':-4},
         {'Name':'X','SerializedType':'DoubleProperty'},
         {'Name':'Y','SerializedType':'DoubleProperty'}]
  fn={'ObjectName':'Fn','LoadedProperties':props,'OuterIndex':2}
  pkg=Package({'Imports':imports,'Exports':[fn,{'ObjectName':'Demo_C'}]})
  pkg._active_function=fn
  call=node('EX_CallMath',StackNode=-1,Parameters=[local('Vec'),local('X'),local('Y')])
  program=expression(call,set(),set(),package=pkg,owner=2)
  self.assertEqual(program['op'],'math_outputs')
  self.assertEqual(program['components'],['X','Y'])
  self.assertEqual([x['type'] for x in program['targets']],['DoubleProperty']*2)
  props[1]['SerializedType']='FloatProperty'
  with self.assertRaises(BlueprintTranslationError):
   expression(call,set(),set(),package=pkg,owner=2)
