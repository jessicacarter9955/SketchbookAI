import test from 'node:test';
import assert from 'node:assert/strict';
import {executeBlueprint} from '../src/editor/ue2three-blueprint.mjs';

const emptyText={history:'empty',text:'',flags:0};
const textSchema={type:'TextProperty',default:emptyText};
const formatSchema={type:'StructProperty',source:'/Script/Engine',native:'FormatArgumentData',
  fields:{ArgumentName:{type:'StrProperty',default:''},ArgumentValue:{type:'TextProperty',default:emptyText},
    ArgumentValueDouble:{type:'DoubleProperty',default:0},ArgumentValueFloat:{type:'FloatProperty',default:0},
    ArgumentValueGender:{type:'ByteProperty',enum:['/Script/Engine','ETextGender'],default:0},
    ArgumentValueInt:{type:'Int64Property',default:0},ArgumentValueType:{type:'ByteProperty',enum:['/Script/Engine','EFormatArgumentType'],default:0}},
  default:{ArgumentName:'',ArgumentValue:emptyText,ArgumentValueDouble:0,ArgumentValueFloat:0,
    ArgumentValueGender:0,ArgumentValueInt:0,ArgumentValueType:0},
  member_order:['ArgumentName','ArgumentValue','ArgumentValueDouble','ArgumentValueFloat','ArgumentValueGender','ArgumentValueInt','ArgumentValueType']};
const arraySchema={type:'ArrayProperty',element:formatSchema,default:[]};
const arg=(name,type,field,value)=>({...{ArgumentName:name,ArgumentValueType:type,ArgumentValue:emptyText,
  ArgumentValueDouble:0,ArgumentValueFloat:0,ArgumentValueGender:0,ArgumentValueInt:0},[field]:value});
function format(pattern,args) {
  const input={op:'native_text_format',identity:['/Script/Engine','KismetTextLibrary','Format'],dispatch:'EX_CallMath',
    pattern:{op:'get',scope:'local',field:'Pattern'},pattern_schema:textSchema,
    arguments:{op:'get',scope:'local',field:'Arguments'},argument_schema:formatSchema,
    source_text_locale_only:true,visual_1to1_certified:false};
  const p={schema_version:1,status:'translated_straight_line',source_owner_index:1,source_export_index:1,
    input_fields:['Pattern','Arguments'],output_fields:[],field_types:{local:{}},
    schemas:{local:{Pattern:textSchema,Arguments:arraySchema}},steps:[{op:'evaluate',value:input},{op:'return',value:input}]};
  return executeBlueprint(p,{}, {Pattern:pattern,Arguments:args});
}

test('source FText.Format handles source-witnessed text, int, float and double placeholders',()=>{
  const values=[arg('Item',4,'ArgumentValue',{history:'invariant',text:'Rifle',flags:2}),
    arg('0',0,'ArgumentValueInt',7),arg('Weight',3,'ArgumentValueDouble',2.5),arg('Speed',2,'ArgumentValueFloat',1.25)];
  const result=format({history:'invariant',text:'{Item} x{0}: {Weight} kg, {Speed} m/s',flags:2},values);
  assert.deepEqual(result.value,{history:'invariant',text:'Rifle x7: 2.5 kg, 1.25 m/s',flags:2});
  assert.ok(result.trace.some(item=>item.op==='native_text_format'&&item.source_text_locale_only===true
    &&item.visual_1to1_certified===false));
});

test('source FText.Format fails closed on missing, duplicate, malformed or unsupported inputs',()=>{
  const pattern={history:'invariant',text:'{0}',flags:2};
  assert.throws(()=>format(pattern,[]),/Unbound placeholder/);
  assert.throws(()=>format({history:'invariant',text:'{Missing}',flags:2},
    [arg('Other',0,'ArgumentValueInt',2)]),/Unbound placeholder/);
  const duplicate=[arg('0',0,'ArgumentValueInt',1),arg('0',0,'ArgumentValueInt',2)];
  assert.throws(()=>format(pattern,duplicate),/duplicate/);
  assert.throws(()=>format({history:'invariant',text:'{0',flags:2},[arg('0',0,'ArgumentValueInt',1)]),/Unmatched brace/);
  assert.throws(()=>format(pattern,[arg('0',5,'ArgumentValueInt',1)]),/Unsupported original FText.Format argument kind/);
});
