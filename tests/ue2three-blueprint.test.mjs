import test from 'node:test';
import assert from 'node:assert/strict';
import { executeBlueprint } from '../src/editor/ue2three-blueprint.mjs';
import { blueprintFixtureState, blueprintFixtureMembers } from '../src/editor/ue2three-fixtures.mjs';

test('source Int64 fields preserve only exact JavaScript integer values', () => {
    const schema={type:'Int64Property',default:0};
    const program={schema_version:1,status:'translated_straight_line',input_fields:[],output_fields:[],
        field_types:{local:{QueuePoolLobbyID:'Int64Property'}},schemas:{local:{QueuePoolLobbyID:schema}},steps:[
            {op:'set',scope:'local',field:'QueuePoolLobbyID',value:{op:'constant',value:9007199254740991}},
            {op:'return',value:{op:'get',scope:'local',field:'QueuePoolLobbyID'}}]};
    assert.equal(executeBlueprint(program).value,9007199254740991);
    assert.throws(()=>executeBlueprint({...program,steps:[
        {op:'set',scope:'local',field:'QueuePoolLobbyID',value:{op:'constant',value:9007199254740992}},
        program.steps[1]]}),/invalid Int64Property/);
    assert.throws(()=>executeBlueprint({...program,steps:[{op:'return',value:{op:'typed_literal',schema,value:9007199254740992}}]}),/typed source member/);
    const defaultProgram={...program,steps:[{op:'return',value:{op:'get',scope:'local',field:'QueuePoolLobbyID'}}]};
    assert.equal(executeBlueprint(defaultProgram).value,0);
});

test('shared source fixtures reject changed packages and types and remain isolated', () => {
    const fixture={shared_states:{base:{package:'/Game/A',source_sha256:'source',types:{'/Game/Type':'type'},state:{Items:[{Count:1}],Flag:false}}}};
    const report={packages:{'/Game/A':{source:{source_sha256:'source'}}},type_sources:{'/Game/Type':{source_sha256:'type'}}};
    const test={package:'/Game/A',base_state:'base',self:{Flag:true}};
    const state=blueprintFixtureState(fixture,test,report);state.Items[0].Count=7;
    assert.equal(fixture.shared_states.base.state.Items[0].Count,1);assert.equal(state.Flag,true);
    assert.throws(()=>blueprintFixtureState(fixture,test,{...report,type_sources:{}}),/fixture type/);
    assert.throws(()=>blueprintFixtureState(fixture,test,{...report,packages:{}}),/original source package/);
    assert.throws(()=>blueprintFixtureState(fixture,{...test,base_state:'constructor'},report),/original source package/);
});

test('source table fixtures and member checks reject stale data and mismatched values', () => {
    assert.throws(() => blueprintFixtureState({}, {tables:{'/Game/Table':'hash'}}, {}), /table differs/);
    const expected={Data:{Weight:1,Title:{text:'Original',history:'base'}}};
    assert.deepEqual(blueprintFixtureMembers({Data:{Title:{history:'base',text:'Original'},Weight:1,Other:7}},expected),expected);
    assert.throws(() => blueprintFixtureMembers({Data:{Weight:true}}, {Data:{Weight:1}}), /differs/);
    assert.throws(() => blueprintFixtureMembers({}, expected), /Missing/);
});

test('original table lookup preserves missing-row output and copies typed rich source data', () => {
    const object={type:'ObjectProperty',class:['/Script/Engine','DataTable'],default:null};
    const text={type:'TextProperty',default:{history:'empty',text:'',flags:0}};
    const schema={type:'StructProperty',source:'/Game/Row',fields:{Title:text,Weight:{type:'DoubleProperty'}},
        default:{Title:text.default,Weight:-1}};
    const tables={'/Game/Table.Table':{schema,rows:{First:{Title:{history:'base',text:'Original',namespace:'NS',key:'Key',flags:0},Weight:2}}}};
    const program={schema_version:1,status:'translated_straight_line',input_fields:['Row'],output_fields:['Out'],
        field_types:{self:{Table:'ObjectProperty'},local:{Out:'StructProperty',Row:'NameProperty'}},
        schemas:{self:{Table:object},local:{Out:schema}},steps:[{op:'evaluate',value:{op:'table_get',table:{op:'get',scope:'self',field:'Table'},
            row:{op:'get',scope:'local',field:'Row'},target:{op:'get',scope:'local',field:'Out'},row_source:'/Game/Row'}},
            {op:'return',value:{op:'constant',value:null}}]};
    const self={Table:{asset:'/Game/Table.Table',declared_class:object.class}};
    const found=executeBlueprint(program,self,{Row:'FIRST'},{tables});
    assert.equal(found.outputs.Out.Weight,2); assert.equal(found.trace[0].found,true);
    found.outputs.Out.Title.text='changed';assert.equal(tables['/Game/Table.Table'].rows.First.Title.text,'Original');
    assert.equal(executeBlueprint(program,self,{Row:'Missing'},{tables}).outputs.Out.Weight,-1);
    assert.throws(()=>executeBlueprint(program,self,{Row:'First'}),/Unmigrated/);
    assert.throws(()=>executeBlueprint(program,{Table:null},{Row:'First'},{tables}),/Unmigrated/);
    assert.throws(()=>executeBlueprint(program,{Table:{...self.Table,declared_class:['Other']}},{Row:'First'},{tables}),/asset identity/);
});

test('typed array copies and struct writes retain original nonzero defaults without aliasing', () => {
    const schema = {type: 'StructProperty', fields: {Item: {type:'NameProperty'}, Health: {type:'DoubleProperty'}}, default: {Item:'None', Health:-1}};
    const get = {schema_version:1, status:'translated_straight_line', output_fields:['Item'], input_fields:['Index'],
        field_types:{self:{Items:'ArrayProperty'},local:{Index:'IntProperty',Item:'StructProperty'}},
        schemas:{self:{Items:{type:'ArrayProperty',element:schema}},local:{Item:schema}}, steps:[
            {op:'evaluate',value:{op:'array_get',array:{op:'get',scope:'self',field:'Items'},index:{op:'get',scope:'local',field:'Index'},
                target:{op:'get',scope:'local',field:'Item'},element:schema}},
            {op:'set_member',target:{op:'get',scope:'local',field:'Item'},field:'Health',member_type:'DoubleProperty',value:{op:'constant',value:50}},
            {op:'return',value:{op:'constant',value:null}}]};
    const state={Items:[{Item:'Source_Item',Health:90}]};
    const length={...get,output_fields:[],steps:[{op:'return',value:{op:'array_length',array:{op:'get',scope:'self',field:'Items'}}}]};
    assert.equal(executeBlueprint(length,state,{Index:0}).value,1);
    assert.equal(executeBlueprint(length,{Items:[]},{Index:0}).value,0);
    const valid=executeBlueprint(get,state,{Index:0});
    assert.deepEqual(valid.outputs.Item,{Item:'Source_Item',Health:50});
    assert.equal(state.Items[0].Health,90); assert.equal(valid.state.Items[0].Health,90);
    const outOfBounds={...get,steps:[get.steps[0],get.steps[2]]};
    for(const Index of [-1,1,2147483647]) {
        const result=executeBlueprint(outOfBounds,state,{Index});
        assert.deepEqual(result.outputs.Item,{Item:'None',Health:-1});
        assert.equal(result.trace.some(step=>step.op==='warning'),true);
    }
    assert.throws(()=>executeBlueprint(get,state,{Index:0.5}),/IntProperty/);
    assert.throws(()=>executeBlueprint(get,{Items:[{Item:'Bad'}]},{Index:0}),/Missing typed/);
    assert.throws(()=>executeBlueprint({...get,steps:[{...get.steps[1],member_type:'IntProperty'},get.steps[2]]},state,{Index:0}),/assignment type/);
    assert.throws(()=>executeBlueprint({...get,steps:[{...get.steps[1],value:{op:'constant',value:true}},get.steps[2]]},state,{Index:0}),/typed source member/);
});

test('persistent source struct writes retain frame identity and reacquire storage after nested RHS calls',()=>{
    const schema={type:'StructProperty',fields:{Count:{type:'IntProperty',default:-1},Other:{type:'IntProperty',default:0}},default:{Count:-1,Other:0}};
    const storage={persistent_types:{'2':{Item:'StructProperty'}},persistent_schemas:{'2':{Item:schema}}};
    const target={op:'get',scope:'persistent',frame:2,field:'Item'};
    const child={...storage,schema_version:1,status:'translated_straight_line',source_export_index:8,source_owner_index:3,
        input_fields:[],output_fields:[],steps:[{op:'set',scope:'persistent',frame:2,field:'Item',
            value:{op:'typed_literal',schema,value:{Count:10,Other:5}}},{op:'return',value:{op:'constant',value:9}}]};
    const program={...storage,schema_version:1,status:'translated_straight_line',source_export_index:2,source_owner_index:3,
        input_fields:[],output_fields:[],steps:[{op:'set_member',target,field:'Count',member_type:'IntProperty',
            value:{op:'call',function:'Change',export_index:8,bindings:[]}},{op:'return',value:{op:'constant',value:null}}]};
    const frames={'2':{Item:{Count:1,Other:2}}},before=structuredClone(frames);
    const result=executeBlueprint(program,{}, {},{frames,functions:{Change:child}});
    assert.deepEqual(result.frames['2'].Item,{Count:9,Other:5});assert.deepEqual(frames,before);
    assert.deepEqual(executeBlueprint({...program,steps:[{...program.steps[0],value:{op:'constant',value:4}},program.steps[1]]}).frames['2'].Item,{Count:4,Other:0});
    assert.throws(()=>executeBlueprint({...program,persistent_schemas:{}},{},{},{frames,functions:{Change:child}}),/assignment type/);
    assert.deepEqual(frames,before);
});


test('source Array_Set writes typed instance arrays with source defaults and no aliasing', () => {
    const item={type:'StructProperty',source:'/Game/Item',fields:{
        ID:{type:'NameProperty',default:'None'}, Quantity:{type:'IntProperty',default:0}},
        default:{ID:'None',Quantity:0}};
    const array={type:'ArrayProperty',element:item,default:[]};
    const expr={op:'array_set',target:{op:'get',scope:'self',field:'Items'},
        index:{op:'get',scope:'local',field:'Index'},
        item:{op:'get',scope:'local',field:'Item'},
        size_to_fit:{op:'get',scope:'local',field:'Fit'},element:item};
    const program={schema_version:1,status:'translated_straight_line',output_fields:[],
        input_fields:['Index','Item','Fit'],field_types:{self:{Items:'ArrayProperty'},
            local:{Index:'IntProperty',Item:'StructProperty',Fit:'BoolProperty'}},
        schemas:{self:{Items:array},local:{Item:item}},steps:[
            {op:'evaluate',source_index:4,value:expr},
            {op:'return',source_index:5,value:{op:'constant',value:null}}]};
    const original={Items:[{ID:'Original',Quantity:7}]};
    const newItem={ID:'New',Quantity:3};
    const update=(Index,Fit,Item=newItem)=>executeBlueprint(program,original,{Index,Fit,Item});
    const valid=update(0,false);
    assert.deepEqual(valid.state.Items,[newItem]);
    assert.deepEqual(original.Items,[{ID:'Original',Quantity:7}]);
    valid.state.Items[0].Quantity=99;
    assert.equal(newItem.Quantity,3);
    assert.equal(valid.trace[0].source_index,4);
    assert.equal(valid.trace[0].applied,true);
    assert.deepEqual(update(3,true).state.Items,[
        {ID:'Original',Quantity:7},{ID:'None',Quantity:0},{ID:'None',Quantity:0},newItem]);
    for (const Index of [-1,1,2147483647]) {
        const result=update(Index,false);
        assert.deepEqual(result.state,original);
        assert.equal(result.trace[0].applied,false);
    }
    assert.throws(()=>update(100001,true),/maximum verified/);
    assert.throws(()=>update(0,false,{ID:'Broken'}),/Missing typed source/);
    assert.throws(()=>update(0,false,{ID:'Broken',Quantity:NaN}),/Invalid typed/);
    assert.throws(()=>executeBlueprint(program,original,{Index:0,Fit:1,Item:newItem}),/BoolProperty|flag/);
    assert.throws(()=>executeBlueprint(program,original,{Index:1.5,Fit:false,Item:newItem}),/IntProperty/);
    assert.throws(()=>executeBlueprint({...program,steps:[{op:'evaluate',value:{...expr,element:{...item,source:'/Game/Foreign'}}},
        program.steps[1]]},original,{Index:0,Fit:false,Item:newItem}),/element schema/);
});

test('source Array_Add appends a typed copy and returns the original new index', () => {
    const element={type:'StructProperty',source:'/Game/InventoryItem',fields:{
        ItemID:{type:'NameProperty',default:'None'},Quantity:{type:'IntProperty',default:0}},
        default:{ItemID:'None',Quantity:0}};
    const array={type:'ArrayProperty',element,default:[]};
    const expr={op:'array_add',target:{op:'get',scope:'self',field:'Items'},
        item:{op:'get',scope:'local',field:'NewItem'},element};
    const program={schema_version:1,status:'translated_straight_line',input_fields:['NewItem'],
        output_fields:['Result'],field_types:{self:{Items:'ArrayProperty'},
            local:{NewItem:'StructProperty',Result:'IntProperty'}},
        schemas:{self:{Items:array},local:{NewItem:element}},steps:[
            {op:'set',scope:'local',field:'Result',source_index:8,value:expr},
            {op:'return',source_index:9,value:{op:'get',scope:'local',field:'Result'}}]};
    const initial={Items:[{ItemID:'Existing',Quantity:2}]};
    const added={ItemID:'SourceNew',Quantity:1};
    const result=executeBlueprint(program,initial,{NewItem:added});
    assert.equal(result.value,1);
    assert.equal(result.outputs.Result,1);
    assert.equal(result.trace[0].index,1);
    assert.deepEqual(result.state.Items,[initial.Items[0],added]);
    assert.equal(initial.Items.length,1);
    result.state.Items[1].Quantity=77;
    assert.equal(added.Quantity,1);
    const empty=executeBlueprint(program,{Items:[]},{NewItem:added});
    assert.equal(empty.value,0);
    assert.deepEqual(empty.state.Items,[added]);
    assert.throws(()=>executeBlueprint(program,initial,{NewItem:{ItemID:'Broken'}}),/Missing typed/);
    assert.throws(()=>executeBlueprint(program,initial,{NewItem:{ItemID:'Broken',Quantity:true}}),/Invalid typed/);
    assert.throws(()=>executeBlueprint({...program,steps:[
        {...program.steps[0],value:{...expr,element:{...element,source:'/Game/Foreign'}}},
        program.steps[1]]},initial,{NewItem:added}),/element schema/);
});

test('event calls retain typed per-instance frames and execute the original flow stack', () => {
    const event = {schema_version: 1, status: 'translated_control_flow', source_export_index: 2, source_owner_index: 3,
        input_fields: [], output_fields: [], persistent_types: {'2': {Value: 'BoolProperty'}},
        field_types: {self: {Enabled: 'BoolProperty'}}, steps: [
            {op: 'push_flow', target: 4}, {op: 'jump', target: 2},
            {op: 'set', scope: 'self', field: 'Enabled', value: {op: 'get', scope: 'persistent', frame: 2, field: 'Value'}},
            {op: 'pop_flow'}, {op: 'return', value: {op: 'constant', value: null}}]};
    const wrapper = {schema_version: 1, status: 'translated_straight_line', source_owner_index: 3, output_fields: [],
        input_fields: ['Input'], field_types: {local: {Input: 'BoolProperty'}}, persistent_types: event.persistent_types,
        steps: [{op: 'set', scope: 'persistent', frame: 2, field: 'Value', value: {op: 'get', scope: 'local', field: 'Input'}},
            {op: 'evaluate', value: {op: 'call', function: 'Graph@15', export_index: 2, bindings: []}},
            {op: 'return', value: {op: 'constant', value: null}}]};
    const actor = {Enabled: false}, frames = {};
    const result = executeBlueprint(wrapper, actor, {Input: true}, {functions: {'Graph@15': event}, frames});
    assert.equal(result.state.Enabled, true); assert.equal(result.frames['2'].Value, true);
    assert.deepEqual(actor, {Enabled: false}); assert.deepEqual(frames, {});
    assert.equal(executeBlueprint(event, actor, {}, {frames: result.frames}).state.Enabled, true);
    assert.equal(executeBlueprint(event, actor).state.Enabled, false);
    assert.throws(() => executeBlueprint(wrapper, actor, {Input: 1}, {functions: {'Graph@15': event}, frames}), /BoolProperty/);
    assert.deepEqual(frames, {});
    assert.throws(() => executeBlueprint({...event, steps: [{op: 'pop_flow'}]}, actor), /empty flow stack/);
    const conditional = {...event, steps: [{op: 'push_flow', target: 3},
        {op: 'pop_flow', value: {op: 'constant', value: false}}, {op: 'invalid'}, event.steps[4]]};
    assert.equal(executeBlueprint(conditional, actor).value, null);
    assert.throws(() => executeBlueprint({...conditional, steps: [conditional.steps[0],
        {...conditional.steps[1], value: {op: 'constant', value: 0}}, ...conditional.steps.slice(2)]}, actor), /Boolean/);
});

const program = {schema_version: 1, status: 'translated_straight_line', output_fields: ['State'], steps: [
    {op: 'set', field: 'State', value: {op: 'get', scope: 'self', field: 'WeaponState'}, source_index: 3},
    {op: 'return', value: {op: 'get', scope: 'local', field: 'State'}, source_index: 5}
]};
test('translated source getter preserves its actual input and outputs without modifying the actor', () => {
    for (const value of [false, true, 0, 1, 2, {Magazine: 17, Kind: 'source fixture'}]) {
        const self = {WeaponState: value};
        const result = executeBlueprint(program, self);
        assert.deepEqual(result.value, value); assert.deepEqual(result.outputs.State, value);
        assert.equal(result.trace[0].source_index, 3);
        if (typeof value === 'object') { result.value.Magazine = 0; assert.equal(value.Magazine, 17); }
    }
});
test('missing state and unsupported instructions fail instead of pretending to execute', () => {
    assert.throws(() => executeBlueprint(program), /Missing self/);
    assert.throws(() => executeBlueprint({...program, steps: [{op: 'nativeCall'}]}), /Unsupported Blueprint instruction/);
    assert.throws(() => executeBlueprint({...program, steps: []}), /no result/);
});
test('Boolean outputs cannot silently coerce source values', () => {
    const booleanProgram = {...program, steps: [{...program.steps[0], boolean: true}, program.steps[1]]};
    assert.throws(() => executeBlueprint(booleanProgram, {WeaponState: 1}), /Expected Boolean/);
    assert.equal(executeBlueprint(booleanProgram, {WeaponState: true}).value, true);
});
test('unsafe property paths and nonfinite constants are rejected', () => {
    assert.throws(() => executeBlueprint({...program, output_fields: ['__proto__']}), /Unsupported Blueprint/);
    assert.throws(() => executeBlueprint({...program, steps: [{op: 'return', value: {op: 'constant', value: NaN}}]}), /Invalid Blueprint constant/);
});
test('original property types distinguish byte enums, Boolean values and struct data', () => {
    const typed = {...program, field_types: {self: {WeaponState: 'ByteProperty'}, local: {State: 'ByteProperty'}}};
    assert.equal(executeBlueprint(typed, {WeaponState: 2}).value, 2);
    assert.throws(() => executeBlueprint(typed, {WeaponState: 256}), /invalid Byte/);
    assert.throws(() => executeBlueprint(typed, {WeaponState: true}), /invalid Byte/);
    typed.field_types.self.WeaponState = typed.field_types.local.State = 'StructProperty';
    assert.deepEqual(executeBlueprint(typed, {WeaponState: {}}).value, {});
    assert.throws(() => executeBlueprint(typed, {WeaponState: 2}), /invalid Struct/);
});
test('source state updates are explicit and do not leak on a failed execution', () => {
    const mutation = {...program, output_fields: [], steps: [
        {op: 'set', scope: 'self', field: 'WeaponState', boolean: true, value: {op: 'constant', value: false}},
        {op: 'return', value: {op: 'constant', value: null}}
    ]};
    const actor = {WeaponState: true};
    assert.equal(executeBlueprint(mutation, actor).state.WeaponState, false);
    assert.equal(actor.WeaponState, true);
    assert.throws(() => executeBlueprint({...mutation, steps: [mutation.steps[0], {op: 'nativeCall'}]}, actor), /Unsupported/);
    assert.equal(actor.WeaponState, true);
});
test('original comparison and Boolean math do not coerce their arguments', () => {
    const evaluate = (name, values) => executeBlueprint({...program, output_fields: [], steps: [
        {op: 'return', value: {op: 'math', name, args: values.map(value => ({op: 'constant', value}))}}
    ]}).value;
    assert.equal(evaluate('Greater_DoubleDouble', [0, 0]), false);
    assert.equal(evaluate('Greater_DoubleDouble', [0.001, 0]), true);
    assert.equal(evaluate('GreaterEqual_DoubleDouble', [25, 25]), true);
    assert.equal(evaluate('EqualEqual_ByteByte', [1, 2]), false);
    assert.equal(evaluate('BooleanAND', [true, false]), false);
    assert.throws(() => evaluate('BooleanAND', [1, true]), /Invalid native math/);
    assert.throws(() => evaluate('Greater_DoubleDouble', ['1', 0]), /Invalid native math/);
    assert.equal(evaluate('Divide_DoubleDouble', [1, 0]), 0);
    assert.throws(() => evaluate('Divide_IntInt', [1, 0]), /Unsupported native math/);
});
test('Blueprint Round expressions execute with original tie behavior and reject overflow', () => {
    const round = input => executeBlueprint({...program, output_fields: [], steps: [
        {op: 'return', value: {op: 'math', name: 'Round', args: [{op: 'constant', value: input}]}}
    ]}).value;
    assert.equal(round(2.5), 3);
    assert.equal(round(-2.5), -2);
    assert.throws(() => round(2147483648), /outside the verified int32 range/);
    assert.throws(() => executeBlueprint({...program, output_fields: [], steps: [
        {op: 'return', value: {op: 'math', name: 'Round64', args: [{op: 'constant', value: 1}]}}
    ]}), /Unsupported native math/);
});
test('conditional jumps take the original false branch and keep output defaults', () => {
    const conditional = {schema_version: 1, status: 'translated_control_flow', output_fields: ['Result'],
        input_fields: ['Condition'], field_types: {local: {Condition: 'BoolProperty', Result: 'NameProperty'}},
        steps: [
            {op: 'branch', value: {op: 'get', scope: 'local', field: 'Condition'}, target: 2},
            {op: 'set', field: 'Result', value: {op: 'constant', value: 'Holster_Back_R'}},
            {op: 'return', value: {op: 'get', scope: 'local', field: 'Result'}}
        ]};
    assert.equal(executeBlueprint(conditional, {}, {Condition: true}).value, 'Holster_Back_R');
    assert.equal(executeBlueprint(conditional, {}, {Condition: false}).value, 'None');
    assert.throws(() => executeBlueprint(conditional), /Missing Blueprint input/);
    assert.throws(() => executeBlueprint(conditional, {}, {Condition: 1}), /BoolProperty/);
});
test('invalid jump destinations and loops stop without mutating caller state', () => {
    const flow = {schema_version: 1, status: 'translated_control_flow', output_fields: [], steps: [{op: 'jump', target: 0}]};
    assert.throws(() => executeBlueprint(flow), /budget exceeded/);
    flow.steps[0].target = 1;
    assert.throws(() => executeBlueprint(flow), /Invalid Blueprint jump target/);
    flow.steps = [{op: 'end'}];
    assert.throws(() => executeBlueprint(flow), /without return/);
});
test('nested source calls return out parameters through the original local reference', () => {
    const callee = {schema_version: 1, status: 'translated_straight_line', source_export_index: 2, source_owner_index: 3,
        input_fields: ['Input'], output_fields: ['Allowed'], field_types: {local: {Input: 'BoolProperty', Allowed: 'BoolProperty'}},
        steps: [{op: 'set', field: 'Allowed', value: {op: 'get', scope: 'local', field: 'Input'}},
            {op: 'return', value: {op: 'constant', value: null}}]};
    const caller = {...callee, input_fields: [], output_fields: [], source_export_index: 1,
        field_types: {local: {Result: 'BoolProperty'}}, steps: [
            {op: 'evaluate', value: {op: 'call', function: 'Predicate', export_index: 2, bindings: [
                {mode: 'input', parameter: 'Input', value: {op: 'constant', value: true}},
                {mode: 'output', parameter: 'Allowed', target: {op: 'get', scope: 'local', field: 'Result'}}]}},
            {op: 'return', value: {op: 'get', scope: 'local', field: 'Result'}}]};
    caller.steps[0].source_index = 12;
    const result = executeBlueprint(caller, {}, {}, {functions: {Predicate: callee}});
    assert.equal(result.value, true);
    assert.equal(result.trace[0].source_index, 12);
    assert.throws(() => executeBlueprint(caller), /dependency/);
    assert.throws(() => executeBlueprint(caller, {}, {}, {functions: {Predicate: {...callee, source_owner_index: 4}}}), /dependency/);
});
test('recursive source calls are bounded and cannot leak state after failure', () => {
    const recursive = {schema_version: 1, status: 'translated_straight_line', source_export_index: 1, source_owner_index: 3,
        output_fields: [], steps: [{op: 'evaluate', value: {op: 'call', function: 'Recursive', export_index: 1, bindings: []}}]};
    const state = {Flag: true};
    assert.throws(() => executeBlueprint(recursive, state, {}, {functions: {Recursive: recursive}}), /depth exceeded/);
    assert.equal(state.Flag, true);
});
test('nested source struct reads require existing members and preserve caller data', () => {
    const read = {schema_version: 1, status: 'translated_straight_line', input_fields: ['Data'], output_fields: [],
        field_types: {local: {Data: 'StructProperty'}}, steps: [{op: 'return', value: {op: 'member', field: 'Inner',
            value: {op: 'get', scope: 'local', field: 'Data'}}}]};
    const input = {Data: {Inner: {Quantity: 4}}};
    const result = executeBlueprint(read, {}, input); result.value.Quantity = 1;
    assert.equal(input.Data.Inner.Quantity, 4);
    assert.throws(() => executeBlueprint(read, {}, {Data: {}}), /Missing source struct member/);
    read.steps[0].value.field = '__proto__';
    assert.throws(() => executeBlueprint(read, {}, input), /Unsupported/);
});
