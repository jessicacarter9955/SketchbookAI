import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateNativeMath } from '../src/editor/ue2three-native-math.mjs';
import { executeBlueprint } from '../src/editor/ue2three-blueprint.mjs';

const keySchema = {type:'StructProperty',source:'/Script/InputCore',native:'Key',
    fields:{KeyName:{type:'NameProperty',default:'None'}},
    default:{KeyName:'None'},member_order:['KeyName']};

function program(name='X') {
    return {schema_version:1,status:'translated_straight_line',
        source_owner_index:1,source_export_index:2,
        input_fields:['InputKey'],output_fields:['Matches'],
        self_reads:[],self_writes:[],
        field_types:{local:{InputKey:'StructProperty',Matches:'BoolProperty'}},
        schemas:{local:{InputKey:keySchema}},
        steps:[
            {op:'set',scope:'local',field:'Matches',
             value:{op:'math',name:'EqualEqual_KeyKey',args:[
                 {op:'get',scope:'local',field:'InputKey'},
                 {op:'struct_literal',schema:keySchema,source_struct_size:32,
                  fields:{KeyName:{op:'constant',value:name}}}
             ]}},
            {op:'return',value:{op:'constant',value:null}}
        ]};
}

test('UE FKey equality compares original input key names via FName identity',()=>{
    assert.equal(evaluateNativeMath('EqualEqual_KeyKey',[{KeyName:'X'},{KeyName:'x'}]),true);
    assert.equal(evaluateNativeMath('EqualEqual_KeyKey',[{KeyName:'X'},{KeyName:'Y'}]),false);
    assert.equal(evaluateNativeMath('EqualEqual_KeyKey',
        [{KeyName:'Gamepad_FaceButton_Left'},{KeyName:'gamepad_facebutton_left'}]),true);
    assert.equal(executeBlueprint(program(),{}, {InputKey:{KeyName:'x'}}).outputs.Matches,true);
    assert.equal(executeBlueprint(program(),{}, {InputKey:{KeyName:'Y'}}).outputs.Matches,false);
});

test('unreflected key shapes, Unicode name folding and wrong original struct layout reject',()=>{
    for(const value of [{KeyName:'X',Type:'keyboard'},{KeyName:'Tök'},{KeyName:1},'X',null])
        assert.throws(()=>evaluateNativeMath('EqualEqual_KeyKey',[{KeyName:'X'},value]),/Invalid original FKey/);
    const invalid=program();invalid.steps[0].value.args[1].source_struct_size=16;
    assert.throws(()=>executeBlueprint(invalid,{}, {InputKey:{KeyName:'X'}}),/not Key/);
    const foreign=program();foreign.steps[0].value.args[1].schema.source='/Script/Engine';
    assert.throws(()=>executeBlueprint(foreign,{}, {InputKey:{KeyName:'X'}}),/not Key/);
});
