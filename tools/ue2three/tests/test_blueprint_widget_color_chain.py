import unittest
from umg_migration import Package
from blueprint_migration import expression,memory_size,BlueprintTranslationError
from test_blueprint_migration import node
def package(cls='Image',method='SetColorAndOpacity'):
 p=Package({'ObjectVersionUE5':'IMPORT_TYPE_HIERARCHIES','Imports':[
  {'ObjectName':method,'ClassName':'Function','OuterIndex':-2},
  {'ObjectName':cls,'ClassName':'Class','OuterIndex':-3},
  {'ObjectName':'/Script/UMG','ClassName':'Package'},
  {'ObjectName':'LinearColor','ClassName':'ScriptStruct','OuterIndex':-5},
  {'ObjectName':'/Script/CoreUObject','ClassName':'Package'}],
 'Exports':[{'ObjectName':'Original_C','LoadedProperties':[
  {'Name':'Widget','SerializedType':'ObjectProperty','PropertyClass':-2}]},
 {'ObjectName':'SetColor','OuterIndex':1,'LoadedProperties':[
  {'Name':'Color','SerializedType':'StructProperty','Struct':-4,'PropertyFlags':'CPF_Parm'}]}]})
 p._active_function=p.exports[1]
 return p
def call(p,arg):
 ctx=node('EX_FinalFunction',StackNode=-1,Parameters=[arg])
 return node('EX_Context',ObjectExpression=node('EX_InstanceVariable',Variable={'New':{'Path':['Widget'],'ResolvedOwner':1}}),
  ContextExpression=ctx,Offset=memory_size(ctx,package=p),PropertyType=0,RValuePointer={'New':{'Path':[],'ResolvedOwner':0}})
class SourceWidgetColorChainTests(unittest.TestCase):
 def test_image_original_local_linear_color_and_exact_layout(self):
  p=package();arg=node('EX_LocalVariable',Variable={'New':{'Path':['Color'],'ResolvedOwner':2}})
  value=call(p,arg);out=expression(value,set(),set(),package=p,owner=1)
  self.assertEqual(out['identity'],['/Script/UMG','Image','SetColorAndOpacity'])
  self.assertEqual(out['parameter']['schema']['native'],'LinearColor')
  value['Offset']+=1
  with self.assertRaisesRegex(BlueprintTranslationError,'layout|offset'):expression(value,set(),set(),package=p,owner=1)
 def test_border_source_linear_color_literal(self):
  p=package('Border','SetBrushColor')
  arg=node('EX_StructConst',Struct=-4,StructSize=16,Value=[node('EX_FloatConst',Value=x) for x in [0.,0.,0.,0.8]])
  out=expression(call(p,arg),set(),set(),package=p,owner=1)
  self.assertEqual(out['identity'],['/Script/UMG','Border','SetBrushColor'])
  self.assertEqual(out['parameter']['schema']['native'],'LinearColor')
 def test_textblock_signature_is_not_silently_replaced_by_image_signature(self):
  p=package('TextBlock');arg=node('EX_LocalVariable',Variable={'New':{'Path':['Color'],'ResolvedOwner':2}})
  with self.assertRaisesRegex(BlueprintTranslationError,'schema'):expression(call(p,arg),set(),set(),package=p,owner=1)
