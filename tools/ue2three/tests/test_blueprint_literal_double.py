import unittest
from blueprint_migration import expression, BlueprintTranslationError
from umg_migration import Package
from test_blueprint_migration import node
def source():
 return Package({'Imports':[{'ObjectName':'MakeLiteralDouble','ClassName':'Function','OuterIndex':-2},
 {'ObjectName':'KismetSystemLibrary','OuterIndex':-3},{'ObjectName':'/Script/Engine','ClassName':'Package'}],
 'Exports':[{'ObjectName':'Original_C','LoadedProperties':[{'Name':'Value','SerializedType':'DoubleProperty'}]}]})
class LiteralDoubleTests(unittest.TestCase):
 def test_source_literal(self):
  p=source()
  for value in (0.2,0.16,575.0,-1.25):
   r=expression(node('EX_CallMath',StackNode=-1,Parameters=[node('EX_DoubleConst',Value=value)]),set(),set(),package=p,owner=1)
   self.assertEqual(r['identity'],['/Script/Engine','KismetSystemLibrary','MakeLiteralDouble'])
   self.assertEqual(r['return_type'],'DoubleProperty')
   self.assertEqual(r['args'][0]['value'],value)
 def test_fail_closed(self):
  p=source()
  def run(args):return expression(node('EX_CallMath',StackNode=-1,Parameters=args),set(),set(),package=p,owner=1)
  with self.assertRaises(BlueprintTranslationError):run([])
  with self.assertRaises(BlueprintTranslationError):run([node('EX_IntConst',Value=2)])
  with self.assertRaises(BlueprintTranslationError):run([node('EX_DoubleConst',Value=float('inf'))])
  p.imports[1]['ObjectName']='FakeSystemLibrary'
  with self.assertRaises(BlueprintTranslationError):run([node('EX_DoubleConst',Value=0.2)])
