import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from blueprint_migration import BlueprintTranslationError,translate_function
from umg_migration import Package
from test_blueprint_migration import BlueprintMigrationTests,node

class HalfDivisionTests(unittest.TestCase):
 def test_witnessed_division(self):
  imports=[{'ObjectName':'Divide_IntInt','ClassName':'Function','OuterIndex':-2},
           {'ObjectName':'KismetMathLibrary','OuterIndex':-3},{'ObjectName':'/Script/Engine'}]
  for a in (-2147483648,-7,-1,0,1,7,2147483647):
   f=BlueprintMigrationTests().function()
   f['ScriptBytecode'][1]['Expression']=node('EX_CallMath',StackNode=-1,Parameters=[node('EX_IntConst',Value=a),node('EX_IntConst',Value=2)])
   self.assertEqual(translate_function(f,Package({'Imports':imports}))['steps'][0]['value']['name'],'Divide_IntInt')
  for d in (0,-2,3):
   f=BlueprintMigrationTests().function()
   f['ScriptBytecode'][1]['Expression']=node('EX_CallMath',StackNode=-1,Parameters=[node('EX_IntConst',Value=7),node('EX_IntConst',Value=d)])
   with self.assertRaisesRegex(BlueprintTranslationError,'Unwitnessed original int division denominator'):
    translate_function(f,Package({'Imports':imports}))
