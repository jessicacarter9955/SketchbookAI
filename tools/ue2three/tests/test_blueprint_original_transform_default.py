import copy,json,math,unittest
from pathlib import Path
from types import SimpleNamespace
from blueprint_values import native_schema,serialized_value
class OriginalTransformDefaultTests(unittest.TestCase):
 def fixture(self):
  return json.loads((Path(__file__).resolve().parents[3]/'tests/fixtures/dds-character-transform-default.json').read_text(encoding='utf-8'))['property']
 def decode(self,v):
  return serialized_value(SimpleNamespace(imports=[]),{},native_schema(('/Script/CoreUObject','Transform')),v)
 def test_original_character_transform_tag_preserves_all_native_members_and_signed_zero(self):
  v=self.fixture();original=copy.deepcopy(v);out=self.decode(v)
  self.assertEqual(out,{'Rotation':{'X':0.,'Y':-0.,'Z':0.,'W':1.},
   'Translation':{'X':0.,'Y':0.,'Z':0.},'Scale3D':{'X':1.,'Y':1.,'Z':1.}})
  self.assertEqual(math.copysign(1,out['Rotation']['Y']),-1.)
  self.assertEqual(v,original)
 def test_transform_rejects_missing_duplicate_and_foreign_member_types(self):
  for mutate in [lambda v:v['Value'].pop(),lambda v:v['Value'].__setitem__(1,copy.deepcopy(v['Value'][0])),
   lambda v:v['Value'][0].__setitem__('StructType','Vector'),lambda v:v.__setitem__('StructType','Rotator')]:
   v=self.fixture();mutate(v)
   with self.assertRaises(ValueError):self.decode(v)
 def test_transform_rejects_nonfinite_and_boolean_native_components(self):
  for bad in [True,'inf','nan']:
   v=self.fixture();v['Value'][1]['Value'][0]['Value']['X']=bad
   with self.assertRaises(ValueError):self.decode(v)
