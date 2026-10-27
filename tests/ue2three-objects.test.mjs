import test from 'node:test';
import assert from 'node:assert/strict';
import {SourceActorBindings, sourceComponentOwner, sourceNativeComponentOwner, sourceForceNetUpdate, sourceObjectValid, sourceFindComponent} from '../src/editor/ue2three-objects.mjs';
import {BlueprintActorRuntime} from '../src/editor/ue2three-blueprint-runtime.mjs';
import {executeBlueprint} from '../src/editor/ue2three-blueprint.mjs';

const c=value=>({op:'constant',value});
const owner={op:'native_get_owner',source_owner_index:2};
const end={op:'return',value:c(null)};
function fixture() {
    const meta={export_index:1,object:'Pawn_C',native_base:['/Script/Engine','Pawn'],force_net_update_override:false};
    const child={export_index:2,object:'Component_C',native_base:['/Script/Engine','ActorComponent'],force_net_update_override:false};
    const program={schema_version:1,status:'translated_straight_line',source_owner_index:2,source_export_index:3,
        input_fields:[],output_fields:[],self_reads:[],self_writes:['Count'],field_types:{self:{Count:'IntProperty'}},schemas:{},steps:[
            {op:'set',scope:'self',field:'Count',value:c(7)},
            {op:'evaluate',value:{op:'native_force_net_update',target:owner}},end]};
    const report={schema_version:1,project:'Original.uproject',packages:{
        '/Game/Pawn':{class_metadata:meta,source:{source_sha256:'pawn'},default_state:{},functions:{}},
        '/Game/Component':{class_metadata:child,source:{source_sha256:'component'},default_state:{Count:0},functions:{Write:program}}},
        actor_graph:{roots:{'/Game/Pawn':{...meta,source:{source_sha256:'pawn'},scs_export_index:4,scs_sha256:'scs',components:[{
            variable:'Inventory',package:'/Game/Component',class_object:'Component_C',class_export_index:2,
            scs_node_export_index:5,template_export_index:6,template_sha256:'template',source:{source_sha256:'component'},source_overrides:{Count:123}}]}}}};
    const runtime=new BlueprintActorRuntime(report,report.project),player={actualPlayer:true};
    return {report,runtime,player,program};
}

function queryFixture() {
    const {report,player}=fixture();
    const child=report.packages['/Game/Component'];
    child.functions.Read={schema_version:1,name:'Read',status:'translated_straight_line',source_owner_index:2,source_export_index:4,
        input_fields:[],output_fields:['Value'],self_reads:['Count'],self_writes:[],parameters:[],
        source_parameters:[{name:'Value',mode:'output',schema:{type:'IntProperty',default:0}}],
        field_types:{self:{Count:'IntProperty'},local:{Value:'IntProperty'}},schemas:{},steps:[
            {op:'set',scope:'local',field:'Value',value:{op:'get',scope:'self',field:'Count'}},end]};
    const schema={type:'ObjectProperty',class:['/Game/Component','Component_C'],reference_kind:'runtime_component',default:null};
    const call={op:'component_query',target:{op:'get',scope:'self',field:'Inventory'},package:'/Game/Component',class_object:'Component_C',function:'Read',export_index:4,
        receiver_schema:schema,class_export_index:2,dispatch:'EX_LocalVirtualFunction',context_offset:23,
        transactional_outputs_safe:true,
        bindings:[{mode:'output',parameter:'Value',schema:{type:'IntProperty',default:0},target:{op:'get',scope:'local',field:'Result'}}]};
    const program={schema_version:1,name:'Query',status:'translated_straight_line',source_owner_index:2,source_export_index:3,
        input_fields:[],output_fields:['Result'],self_reads:['Inventory'],self_writes:[],field_types:{self:{Inventory:'ObjectProperty'},local:{Result:'IntProperty'}},
        schemas:{self:{Inventory:schema}},steps:[{op:'evaluate',value:call},end]};
    const meta={export_index:2,object:'Combat_C',native_base:['/Script/Engine','ActorComponent'],force_net_update_override:false};
    report.packages['/Game/Combat']={class_metadata:meta,source:{source_sha256:'combat'},default_state:{Inventory:null},functions:{Query:program}};
    report.actor_graph.roots['/Game/Pawn'].components.push({variable:'Combat',package:'/Game/Combat',class_object:'Combat_C',class_export_index:2,
        scs_node_export_index:7,template_export_index:8,template_sha256:'combat-template',source:{source_sha256:'combat'},source_overrides:{}});
    const runtime=new BlueprintActorRuntime(report,report.project);runtime.bindSourceActor('/Game/Pawn',player);
    runtime.states['/Game/Combat'].Inventory=runtime.actorBindings.componentReference('/Game/Component');
    return {report,player,runtime,program,call,child,schema};
}

function mutationFixture() {
    const f=queryFixture(),{report,child,runtime,program,call}=f;
    const write=structuredClone(child.functions.Write);
    write.value_parameters_only=true;write.parameters=[];write.source_parameters=[];write.name='Write';
    child.functions.Write=write;
    Object.assign(call,{op:'component_call',function:'Write',export_index:3,bindings:[],value_parameters_only:true,
        transactional_outputs_safe:true});
    program.steps.push(end);
    return f;
}

test('native Concat_StrStr preserves its exact identity, FString types and argument order',()=>{
    const concat={op:'native_call',identity:['/Script/Engine','KismetStringLibrary','Concat_StrStr'],
        parameter_types:['StrProperty','StrProperty'],return_type:'StrProperty',args:[
            {op:'typed_literal',schema:{type:'StrProperty',default:''},value:'prima'},
            {op:'typed_literal',schema:{type:'StrProperty',default:''},value:'—dopo'}]};
    const program={schema_version:1,status:'translated_straight_line',source_owner_index:1,source_export_index:1,
        input_fields:[],output_fields:['Joined'],self_reads:[],self_writes:[],field_types:{local:{Joined:'StrProperty'}},steps:[
            {op:'set',scope:'local',field:'Joined',value:concat},end]};
    assert.equal(executeBlueprint(program,{},{}).outputs.Joined,'prima—dopo');
    const wrongIdentity=structuredClone(program);wrongIdentity.steps[0].value.identity[2]='Join_StrStr';
    assert.throws(()=>executeBlueprint(wrongIdentity,{},{}),/Unsupported original native object call/);
    const wrongSignature=structuredClone(program);wrongSignature.steps[0].value.parameter_types[0]='NameProperty';
    assert.throws(()=>executeBlueprint(wrongSignature,{},{}),/Unsupported original native object call/);
    const wrongSourceType=structuredClone(program);wrongSourceType.input_fields=['Name'];
    wrongSourceType.field_types.local.Name='NameProperty';
    wrongSourceType.steps[0].value.args[0]={op:'get',scope:'local',field:'Name'};
    assert.throws(()=>executeBlueprint(wrongSourceType,{}, {Name:'typed as FName'}),/parameter type differs/);
    const conflictingSchema=structuredClone(wrongSourceType);conflictingSchema.schemas={local:{Name:{type:'StrProperty',default:''}}};
    assert.throws(()=>executeBlueprint(conflictingSchema,{}, {Name:'conflicting source type'}),/parameter schema differs/);
});

test('mutable component calls commit original state, persistent frames and effects under the receiver identity',()=>{
    const {runtime,child}=mutationFixture();
    const write=child.functions.Write;
    write.persistent_types={'7':{Visits:'IntProperty'}};
    write.steps.splice(1,0,{op:'set',scope:'persistent',frame:7,field:'Visits',value:c(1)},
        {op:'evaluate',value:{op:'mark_dirty',field:'Count',source_rep_index:4}});
    const result=runtime.call('/Game/Combat','Query');
    assert.equal(runtime.states['/Game/Component'].Count,7);
    assert.equal(runtime.frames['/Game/Component']['7'].Visits,1);
    assert.equal(runtime.dirty['/Game/Component'].Count,4);
    assert.equal(runtime.dirty['/Game/Combat'],undefined);
    assert.equal(runtime.nativeRequests[0].package,'/Game/Component');
    assert.ok(result.trace.some(row=>row.op==='component_call' && row.function==='Write'));
});

test('transactional component calls preserve typed out values and roll back state when a later step fails',()=>{
    const f=mutationFixture(),outputSchema={type:'IntProperty',default:0};
    const caller=f.program,callee=f.child.functions.Write;
    caller.field_types.local.Result='IntProperty';
    callee.output_fields=['Value'];callee.source_parameters=[{name:'Value',mode:'output',schema:outputSchema}];
    callee.field_types.local ||= {};
    callee.field_types.local.Value='IntProperty';
    callee.steps=[{op:'set',scope:'self',field:'Count',value:c(17)},
        {op:'set',scope:'local',field:'Value',value:c(42)},end];
    Object.assign(f.call,{bindings:[{mode:'output',parameter:'Value',schema:outputSchema,
        target:{op:'get',scope:'local',field:'Result'}}],transactional_outputs_safe:true});
    const result=f.runtime.call('/Game/Combat','Query');
    assert.equal(result.outputs.Result,42);assert.equal(f.runtime.states['/Game/Component'].Count,17);

    const failed=mutationFixture(),failedCallee=failed.child.functions.Write;
    failed.program.field_types.local.Result='IntProperty';
    failedCallee.output_fields=['Value'];failedCallee.source_parameters=[{name:'Value',mode:'output',schema:outputSchema}];
    failedCallee.field_types.local ||= {};
    failedCallee.field_types.local.Value='IntProperty';
    failedCallee.steps=[{op:'set',scope:'self',field:'Count',value:c(17)},
        {op:'set',scope:'local',field:'Value',value:c(42)},{op:'evaluate',value:{op:'unsupported'}},end];
    Object.assign(failed.call,{bindings:[{mode:'output',parameter:'Value',schema:outputSchema,
        target:{op:'get',scope:'local',field:'Result'}}],transactional_outputs_safe:true});
    const before=failed.runtime.snapshot();
    assert.throws(()=>failed.runtime.call('/Game/Combat','Query'),/Unsupported Blueprint expression/);
    assert.deepEqual(failed.runtime.snapshot(),before);
});

test('any failure after a nested component mutation rolls back both components, frames, bindings and effects',()=>{
    for (const corrupt of [
        f=>f.program.steps.splice(1,0,{op:'evaluate',value:{op:'unknown_operation'}}),
        f=>f.child.functions.Write.steps.splice(2,0,{op:'evaluate',value:{op:'unknown_operation'}}),
        f=>f.call.export_index=999,
        f=>f.call.transactional_outputs_safe=false,
        f=>f.child.functions.Write.source_parameters=null,
        f=>f.runtime.states['/Game/Combat'].Inventory.realm='other',
        f=>f.runtime.states['/Game/Combat'].Inventory.actor_id='other',
        f=>f.report.packages['/Game/Component'].source.source_sha256='changed',
    ]) {
        const f=mutationFixture();corrupt(f);const saved=f.runtime.snapshot();
        assert.throws(()=>f.runtime.call('/Game/Combat','Query'));assert.deepEqual(f.runtime.snapshot(),saved);
    }
    const f=mutationFixture();f.runtime.states['/Game/Combat'].Inventory=null;
    const saved=f.runtime.states['/Game/Component'].Count;
    assert.ok(f.runtime.call('/Game/Combat','Query').trace.some(t=>t.message?.includes('Accessed None')));
    assert.equal(f.runtime.states['/Game/Component'].Count,saved);
});

test('cross-component callbacks see active caller writes and their changes survive returning through local calls',()=>{
    const {runtime,report,program,child}=mutationFixture();
    const combat=report.packages['/Game/Combat'];
    const countSchema={type:'IntProperty',default:0};
    combat.default_state.Count=0;combat.field_schemas={Count:countSchema};runtime.states['/Game/Combat'].Count=0;
    const combatReference=runtime.actorBindings.componentReference('/Game/Combat');
    child.field_schemas={Count:countSchema};
    runtime.states['/Game/Component'].Combat=combatReference;
    const get=(scope,field)=>({op:'get',scope,field});
    const member={op:'component_member',target:get('self','Combat'),package:'/Game/Combat',class_object:'Combat_C',class_export_index:2,field:'Count',schema:countSchema};
    const combatReferenceSchema={type:'ObjectProperty',class:['/Game/Combat','Combat_C'],reference_kind:'runtime_component',default:null};
    child.field_schemas.Combat=combatReferenceSchema;
    const callback=structuredClone(child.functions.Write);
    callback.source_export_index=8;callback.source_owner_index=2;callback.steps=[{op:'set',scope:'self',field:'Count',value:c(88)},end];
    combat.functions.Callback=callback;
    child.functions.Write.steps=[{op:'set',scope:'self',field:'Count',value:member},
        {op:'evaluate',value:{op:'component_call',target:get('self','Combat'),package:'/Game/Combat',class_object:'Combat_C',
            receiver_schema:combatReferenceSchema,class_export_index:2,function:'Callback',export_index:8,
            bindings:[],transactional_outputs_safe:true}},end];
    child.functions.Impl={...child.functions.Write,source_export_index:9};
    child.functions.Write.steps=[{op:'evaluate',value:{op:'call',function:'Impl',export_index:9,bindings:[]}},end];
    program.field_types.self.Count='IntProperty';
    program.steps.unshift({op:'set',scope:'self',field:'Count',value:c(21)});
    const result=runtime.call('/Game/Combat','Query');
    assert.equal(runtime.states['/Game/Component'].Count,21);
    assert.equal(runtime.states['/Game/Combat'].Count,88);
    assert.equal(result.state.Count,88);
});

test('mutable calls share the original instruction budget and depth limit across receiver boundaries',()=>{
    const f=mutationFixture();
    f.runtime.states['/Game/Component'].Inventory=f.runtime.actorBindings.componentReference('/Game/Component');
    f.child.functions.Write.steps=[{op:'evaluate',value:f.call},end];
    const saved=f.runtime.snapshot();
    assert.throws(()=>f.runtime.call('/Game/Combat','Query'),/depth exceeded/);assert.deepEqual(f.runtime.snapshot(),saved);
    const loop=mutationFixture();loop.program.status='translated_control_flow';
    loop.program.steps=[{op:'evaluate',value:loop.call},{op:'jump',target:0}];
    const before=loop.runtime.snapshot();
    assert.throws(()=>loop.runtime.call('/Game/Combat','Query'),/budget/);assert.deepEqual(loop.runtime.snapshot(),before);
});

test('read-only queries after mutations read staged peer state and preserve original out-parameter copying',()=>{
    const f=mutationFixture();
    f.program.steps.splice(1,0,{op:'evaluate',value:{...f.call,op:'component_query',function:'Read',export_index:4,
        bindings:[{mode:'output',parameter:'Value',schema:{type:'IntProperty',default:0},
            target:{op:'get',scope:'local',field:'Result'}}]}});
    assert.equal(f.runtime.call('/Game/Combat','Query').outputs.Result,7);
});

test('mutating component input signatures reject type, order and reference mismatches atomically',()=>{
    for (const corrupt of [f=>{},f=>f.call.bindings[0].parameter='Other',f=>f.call.bindings[0].schema={type:'BoolProperty',default:false},
        f=>f.call.bindings[0].value=c('bad'),f=>f.call.bindings[0].mode='output']) {
        const f=mutationFixture(),schema={type:'IntProperty',default:0};
        f.child.functions.Write.parameters=[{name:'Value',schema}];
        f.child.functions.Write.source_parameters=[{name:'Value',mode:'input',schema}];
        f.child.functions.Write.input_fields=['Value'];f.child.functions.Write.field_types.local={Value:'IntProperty'};
        f.child.functions.Write.steps[0].value={op:'get',scope:'local',field:'Value'};
        f.call.bindings=[{mode:'input',parameter:'Value',schema,value:c(32)}];
        corrupt(f);const before=f.runtime.snapshot();
        if (f.call.bindings[0].parameter==='Value' && f.call.bindings[0].schema.type==='IntProperty'
            && f.call.bindings[0].value.value===32 && f.call.bindings[0].mode==='input') {
            f.runtime.call('/Game/Combat','Query');assert.equal(f.runtime.states['/Game/Component'].Count,32);
        } else { assert.throws(()=>f.runtime.call('/Game/Combat','Query'));assert.deepEqual(f.runtime.snapshot(),before); }
    }
});

test('cross-component broadcasts invoke same-instance source handlers and keep notifications on that component',()=>{
    const f=mutationFixture();
    const handler={...f.child.functions.Write,source_export_index:10,parameters:[],steps:[{op:'set',scope:'self',field:'Count',value:c(66)},end]};
    f.child.functions.Handler=handler;
    f.child.delegate_signatures={Changed:{export_index:12,parameters:[]}};
    f.runtime.subscribe('/Game/Component','Changed','Handler');
    f.child.functions.Write.steps.push({op:'evaluate',value:{op:'broadcast',delegate:'Changed',export_index:12,parameters:[],args:[]}});
    // Broadcast must execute before Return, preserving source order.
    f.child.functions.Write.steps.splice(-2,1);f.child.functions.Write.steps.push(end);
    f.runtime.call('/Game/Combat','Query');assert.equal(f.runtime.states['/Game/Component'].Count,66);
    assert.equal(f.runtime.notifications[0].package,'/Game/Component');assert.equal(f.runtime.notifications[0].listeners,1);
});

test('pure component guards do not stage/copy the whole actor transaction',()=>{
    const f=queryFixture();
    assert.equal(f.runtime.call('/Game/Combat','Query').receivers,undefined);
});

test('original component lookup rejects incomplete class sets, unavailable matching templates and foreign owners',()=>{
    const {report,runtime,player}=fixture();
    report.actor_graph.roots['/Game/Pawn'].component_lookup_complete=true;
    runtime.bindSourceActor('/Game/Pawn',player);
    const context=runtime.nativeContext('/Game/Component'),schema={type:'ObjectProperty',class:['/Script/Engine','Pawn'],reference_kind:'runtime_actor',default:null};
    const find=(ctx=context,reference=context.owner)=>sourceFindComponent(ctx,reference,schema,'/Game/Component','Component_C',2);
    assert.deepEqual(find(),runtime.actorBindings.componentReference('/Game/Component'));
    context.actors['actor-1'].component_lookup_complete=false;
    assert.throws(()=>find(),/unresolved/);
    context.actors['actor-1'].component_lookup_complete=true;
    context.actors['actor-1'].unbound_component_classes=[['/Game/Other','Other_C']];
    assert.ok(find());
    context.actors['actor-1'].unbound_component_classes.push(['/Game/Component','Component_C']);
    assert.throws(()=>find(),/unavailable template/);
    context.actors['actor-1'].unbound_component_classes=[];
    assert.throws(()=>find(context,{...context.owner,actor_id:'foreign'}),/foreign/);
    context.components.Duplicate=structuredClone(context.components.Inventory);
    assert.throws(()=>find(),/lookup order/);
});

test('original component member reads use current state, typed source schema and copied values',()=>{
    const {runtime,report}=queryFixture();
    const schema={type:'IntProperty',default:0};
    report.packages['/Game/Component'].field_schemas={Count:schema};
    const program=report.packages['/Game/Combat'].functions.Query;
    program.steps[0]={op:'set',scope:'local',field:'Result',value:{op:'component_member',target:{op:'get',scope:'self',field:'Inventory'},
        package:'/Game/Component',class_object:'Component_C',class_export_index:2,field:'Count',schema}};
    assert.equal(runtime.call('/Game/Combat','Query').outputs.Result,123);
    runtime.states['/Game/Component'].Count=44;
    assert.equal(runtime.call('/Game/Combat','Query').outputs.Result,44);
    const saved=runtime.snapshot();program.steps[0].value.schema={type:'BoolProperty',default:false};
    assert.throws(()=>runtime.call('/Game/Combat','Query'),/schema or source/);assert.deepEqual(runtime.snapshot(),saved);
    program.steps[0].value.schema=schema;runtime.states['/Game/Combat'].Inventory=null;
    const skipped=runtime.call('/Game/Combat','Query');assert.equal(skipped.outputs.Result,0);
    assert.ok(skipped.trace.some(row=>row.message?.includes('Accessed None')));
    program.steps[0].value.schema={type:'StructProperty',fields:{Count:schema},default:{Count:123}};
    assert.throws(()=>runtime.call('/Game/Combat','Query'),/struct ClearValue/);
});

test('source world clock uses simulation steps, preserves pause and validates snapshots before changing state',()=>{
    const {report,runtime,player}=fixture();runtime.bindSourceActor('/Game/Pawn',player);
    const program={schema_version:1,status:'translated_straight_line',source_owner_index:2,source_export_index:8,
        input_fields:[],output_fields:['Time'],self_reads:[],self_writes:[],field_types:{local:{Time:'DoubleProperty'}},steps:[
            {op:'set',scope:'local',field:'Time',value:{op:'native_game_time',source_owner_index:2}},end]};
    report.packages['/Game/Component'].functions.Clock=program;
    assert.equal(runtime.call('/Game/Component','Clock').outputs.Time,0);
    runtime.advanceWorldTime(.125);runtime.advanceWorldTime(0);runtime.advanceWorldTime(.25);
    assert.equal(runtime.call('/Game/Component','Clock').outputs.Time,.375);
    const saved=runtime.snapshot();
    for(const delta of [-1,NaN,Infinity,'1']) assert.throws(()=>runtime.advanceWorldTime(delta),/time step/);
    assert.throws(()=>runtime.restore({...saved,states:{bad:true},gameTimeSeconds:-1}),/time snapshot/);
    assert.deepEqual(runtime.snapshot(),saved);
    assert.throws(()=>executeBlueprint(program,{},{}),/game time/);
    const context=runtime.nativeContext('/Game/Component');context.source_owner_index=99;
    assert.throws(()=>executeBlueprint(program,{},{},{native:context}),/game time/);
    context.source_owner_index=2;context.world_context_bound=false;
    assert.throws(()=>executeBlueprint(program,{},{},{native:context}),/game time/);
});

test('component queries read the actual bound other component state and copy original out parameters',()=>{
    const {runtime}=queryFixture(),initial=runtime.snapshot();
    const result=runtime.call('/Game/Combat','Query');
    assert.equal(result.outputs.Result,123);assert.deepEqual(result.effects,[]);
    assert.equal(runtime.states['/Game/Component'].Count,123);
    runtime.states['/Game/Component'].Count=456;
    assert.equal(runtime.call('/Game/Combat','Query').outputs.Result,456);
    assert.equal(result.trace.find(t=>t.op==='component_query').package,'/Game/Component');
    runtime.restore(initial);assert.equal(runtime.call('/Game/Combat','Query').outputs.Result,123);
});

test('null component contexts retain caller out storage; unknown and foreign instances fail atomically',()=>{
    const {runtime}=queryFixture();runtime.states['/Game/Combat'].Inventory=null;
    const result=runtime.call('/Game/Combat','Query');
    assert.equal(result.outputs.Result,0);assert.match(result.trace[0].message,/Accessed None/);
    for(const patch of [{realm:'foreign'},{component_variable:'Unknown'},{actor_id:'other-actor'}]) {
        runtime.states['/Game/Combat'].Inventory={...runtime.actorBindings.componentReference('/Game/Component'),...patch};
        const before=runtime.snapshot();assert.throws(()=>runtime.call('/Game/Combat','Query'));assert.deepEqual(runtime.snapshot(),before);
    }
});

test('component queries reject state writes, effects, wrong exports and receiver classes',()=>{
    for(const corrupt of [
        x=>x.child.functions.Read.self_writes.push('Count'),
        x=>x.child.functions.Read.steps.unshift({op:'set',scope:'self',field:'Count',value:c(999)}),
        x=>x.child.functions.Read.steps.unshift({op:'evaluate',value:{op:'mark_dirty',field:'Count',source_rep_index:1}}),
        x=>x.call.export_index=999,
        x=>x.call.class_object='Different_C',
        x=>x.child.functions.Read.persistent_types={'3':{Value:'IntProperty'}}]) {
        const f=queryFixture();corrupt(f);const before=f.runtime.snapshot();
        assert.throws(()=>f.runtime.call('/Game/Combat','Query'));assert.deepEqual(f.runtime.snapshot(),before);
    }
});

test('original IsValid distinguishes null and explicit bound objects without accepting arbitrary JS identities',()=>{
    const {runtime,schema}=queryFixture(),context=runtime.actorBindings.context('/Game/Combat');
    assert.equal(sourceObjectValid(undefined,null,schema),false);
    assert.equal(sourceObjectValid(context,runtime.actorBindings.componentReference('/Game/Component'),schema),true);
    assert.equal(sourceObjectValid(context,context.actors['actor-1'].reference,{reference_kind:'runtime_actor',class:['/Script/Engine','Pawn']}),true);
    assert.throws(()=>sourceObjectValid(context,{},schema),/receiver/);
    assert.throws(()=>sourceObjectValid(context,context.actors['actor-1'].reference,{reference_kind:'runtime_actor',class:['/Script/Engine','Character']}),/class differs/);
});

test('original IsValid accepts only explicitly bound source UMG widgets',()=>{
    const widgetClass=['/Script/UMG','Button'],sourcePackage='/Game/UI/WBP_Menu',reference={kind:'source_native_widget',
        source_package:sourcePackage,source_owner_index:4,source_field:'Btn_Start',widget_id:'btn-start',declared_class:widgetClass};
    const schema={type:'ObjectProperty',class:widgetClass,reference_kind:'runtime_native_widget',default:null};
    const context={source_package:sourcePackage,source_owner_index:4,widgets:{Btn_Start:{reference,source_field:'Btn_Start',
        source_owner_index:4,declared_class:widgetClass,binding_complete:true}}};
    assert.equal(sourceObjectValid(context,null,schema),false);
    assert.equal(sourceObjectValid(context,reference,schema),true);
    assert.throws(()=>sourceObjectValid(context,{...reference,source_package:'/Game/Foreign/WBP_Menu'},schema),/foreign/);
    const program={schema_version:1,status:'translated_straight_line',source_owner_index:4,source_export_index:5,
        input_fields:[],output_fields:[],self_reads:['Btn_Start'],self_writes:[],field_types:{self:{Btn_Start:'ObjectProperty'}},
        schemas:{self:{Btn_Start:schema}},steps:[{op:'return',value:{op:'native_object_valid',
            target:{op:'get',scope:'self',field:'Btn_Start'},schema}}]};
    assert.equal(executeBlueprint(program,{Btn_Start:reference},{},{native:context}).value,true);
});

test('original IsValid binds only native components present in the source SCS graph',()=>{
    const report=fixture().report;
    const schema={type:'ObjectProperty',class:['/Script/HairStrandsCore','GroomComponent'],
        reference_kind:'runtime_native_component',default:null};
    report.packages['/Game/Pawn'].default_state.Beard=null;
    report.packages['/Game/Pawn'].field_schemas={Beard:schema};
    const graph=report.actor_graph.roots['/Game/Pawn'];
    graph.native_components=[{variable:'Beard',package:'/Script/HairStrandsCore',class_object:'GroomComponent',
        scs_node_export_index:8,template_export_index:9,template_sha256:'a'.repeat(64)}];
    graph.native_component_bindings_complete=true;
    const runtime=new BlueprintActorRuntime(report,report.project),player={actualPlayer:true};
    runtime.bindSourceActor('/Game/Pawn',player);
    const reference=runtime.states['/Game/Pawn'].Beard;
    const context=runtime.nativeContext('/Game/Pawn');
    assert.equal(reference.kind,'source_native_component');
    assert.equal(sourceObjectValid(context,reference,schema),true);
    assert.equal(sourceObjectValid(context,null,schema),false);
    assert.throws(()=>sourceObjectValid(context,{...reference,realm:'foreign'},schema),/native component/);
    const incomplete={...context,actors:{...context.actors,'actor-1':{...context.actors['actor-1'],native_component_bindings_complete:false}}};
    assert.throws(()=>sourceObjectValid(incomplete,reference,schema),/owner binding/);
    const program={schema_version:1,status:'translated_straight_line',source_owner_index:1,source_export_index:1,
        input_fields:[],output_fields:[],self_reads:['Beard'],self_writes:[],field_types:{self:{Beard:'ObjectProperty'}},
        schemas:{self:{Beard:schema}},steps:[{op:'return',value:{op:'native_object_valid',target:{op:'get',scope:'self',field:'Beard'},schema}}]};
    assert.equal(executeBlueprint(program,runtime.states['/Game/Pawn'],{},{native:context}).value,true);
});

test('ActorComponent.GetOwner resolves only a bound source native component to its source actor',()=>{
    const report=fixture().report,schema={type:'ObjectProperty',class:['/Script/Engine','SkeletalMeshComponent'],
        reference_kind:'runtime_native_component',default:null};
    report.packages['/Game/Pawn'].default_state.Mesh=null;
    report.packages['/Game/Pawn'].field_schemas={Mesh:schema};
    const graph=report.actor_graph.roots['/Game/Pawn'];
    graph.native_components=[{variable:'Mesh',package:'/Script/Engine',class_object:'SkeletalMeshComponent',
        scs_node_export_index:10,template_export_index:11,template_sha256:'b'.repeat(64)}];
    graph.native_component_bindings_complete=true;
    const runtime=new BlueprintActorRuntime(report,report.project),player={actualPlayer:true};
    runtime.bindSourceActor('/Game/Pawn',player);
    const context=runtime.nativeContext('/Game/Pawn'),reference=runtime.states['/Game/Pawn'].Mesh;
    assert.deepEqual(sourceNativeComponentOwner(context,reference,schema),context.actors['actor-1'].reference);
    const program={schema_version:1,status:'translated_straight_line',source_owner_index:1,source_export_index:12,
        input_fields:[],output_fields:[],self_reads:['Mesh'],self_writes:[],field_types:{self:{Mesh:'ObjectProperty'}},
        schemas:{self:{Mesh:schema}},steps:[{op:'return',value:{op:'native_component_get_owner',
            identity:['/Script/Engine','ActorComponent','GetOwner'],dispatch:'EX_FinalFunction',
            target:{op:'get',scope:'self',field:'Mesh'},component_schema:schema}}]};
    assert.deepEqual(executeBlueprint(program,runtime.states['/Game/Pawn'],{},{native:context}).value,context.actors['actor-1'].reference);
    assert.throws(()=>sourceNativeComponentOwner({...context,native_components:{}},reference,schema),/native component/);
});

test('skeletal mesh contexts emit typed native requests, short-circuit null and roll requests back on failure',()=>{
    const report=fixture().report,root=report.packages['/Game/Pawn'];
    const receiverSchema={type:'ObjectProperty',class:['/Script/Engine','SkeletalMeshComponent'],
        reference_kind:'runtime_native_component',default:null};
    const materialSchema={type:'ObjectProperty',class:['/Script/Engine','MaterialInterface'],default:null};
    const meshAssetSchema={type:'ObjectProperty',class:['/Script/Engine','SkeletalMesh'],default:null};
    root.default_state.SkeletalMesh=null;root.default_state.PlayerMaterial=null;root.default_state.WeaponMeshAsset=null;
    root.field_schemas={SkeletalMesh:receiverSchema,PlayerMaterial:materialSchema,WeaponMeshAsset:meshAssetSchema};
    const graph=report.actor_graph.roots['/Game/Pawn'];
    graph.native_components=[{variable:'SkeletalMesh',package:'/Script/Engine',class_object:'SkeletalMeshComponent',
        scs_node_export_index:8,template_export_index:9,template_sha256:'a'.repeat(64)}];
    graph.native_component_bindings_complete=true;
    const runtime=new BlueprintActorRuntime(report,report.project),player={actualPlayer:true};
    runtime.bindSourceActor('/Game/Pawn',player);
    const call={op:'native_context_call',identity:['/Script/Engine','SkeletalMeshComponent','SetMaterial'],
        dispatch:'EX_VirtualFunction',context_offset:28,receiver:{op:'get',scope:'self',field:'SkeletalMesh'},
        receiver_schema:receiverSchema,parameter_schemas:[{type:'IntProperty',default:0},materialSchema],
        parameters:[c(0),{op:'get',scope:'self',field:'PlayerMaterial'}],adapter_family_present:false};
    root.functions.OnRep_PlayerMaterial={schema_version:1,name:'OnRep_PlayerMaterial',status:'translated_straight_line',
        source_owner_index:1,source_export_index:10,input_fields:[],output_fields:[],self_reads:['SkeletalMesh','PlayerMaterial'],
        self_writes:[],field_types:{self:{SkeletalMesh:'ObjectProperty',PlayerMaterial:'ObjectProperty'}},
        schemas:{self:{SkeletalMesh:receiverSchema,PlayerMaterial:materialSchema}},steps:[{op:'evaluate',value:call},end]};
    const result=runtime.call('/Game/Pawn','OnRep_PlayerMaterial');
    assert.equal(result.effects[0].op,'native_context_call');
    assert.deepEqual(result.effects[0].identity,['/Script/Engine','SkeletalMeshComponent','SetMaterial']);
    assert.deepEqual(result.effects[0].arguments,[0,null]);
    assert.equal(result.effects[0].adapter_required,true);

    const setAsset={...call,identity:['/Script/Engine','SkeletalMeshComponent','SetSkeletalMeshAsset'],
        dispatch:'EX_FinalFunction',context_offset:19,parameter_schemas:[meshAssetSchema],
        parameters:[{op:'get',scope:'self',field:'WeaponMeshAsset'}]};
    root.functions.OnRep_WeaponMeshAsset={...root.functions.OnRep_PlayerMaterial,name:'OnRep_WeaponMeshAsset',
        source_export_index:11,self_reads:['SkeletalMesh','WeaponMeshAsset'],
        field_types:{self:{SkeletalMesh:'ObjectProperty',WeaponMeshAsset:'ObjectProperty'}},
        schemas:{self:{SkeletalMesh:receiverSchema,WeaponMeshAsset:meshAssetSchema}},
        steps:[{op:'evaluate',value:setAsset},end]};
    const assetResult=runtime.call('/Game/Pawn','OnRep_WeaponMeshAsset');
    assert.deepEqual(assetResult.effects[0].identity,['/Script/Engine','SkeletalMeshComponent','SetSkeletalMeshAsset']);
    assert.equal(assetResult.effects[0].dispatch,'EX_FinalFunction');

    const requestCount=runtime.nativeRequests.length;
    runtime.states['/Game/Pawn'].SkeletalMesh=null;
    call.parameters[1]={op:'unsupported'};
    const skipped=runtime.call('/Game/Pawn','OnRep_PlayerMaterial');
    assert.equal(runtime.nativeRequests.length,requestCount);
    assert.ok(skipped.trace.some(entry=>entry.message?.includes('Accessed None')));

    runtime.states['/Game/Pawn'].SkeletalMesh=runtime.actorBindings.nativeComponentReference('SkeletalMesh');
    call.parameters[1]={op:'get',scope:'self',field:'PlayerMaterial'};
    root.functions.OnRep_PlayerMaterial.steps.splice(-1,0,{op:'evaluate',value:{op:'unsupported'}});
    const before=runtime.snapshot();
    assert.throws(()=>runtime.call('/Game/Pawn','OnRep_PlayerMaterial'),/Unsupported Blueprint expression/);
    assert.deepEqual(runtime.snapshot(),before);
});

test('original component graph binds the actual actor and applies source template overrides once',()=>{
    const {runtime,player}=fixture();
    assert.equal(runtime.bindSourceActor('/Game/Pawn',player).components,1);
    assert.equal(runtime.actorBindings.ownerTarget('/Game/Component'),player);
    assert.equal(runtime.states['/Game/Component'].Count,123);
    const context=runtime.actorBindings.context('/Game/Component');
    assert.deepEqual(sourceComponentOwner(context,2),context.owner);
    assert.equal(runtime.actorBindings.witness('/Game/Component').scs_sha256,'scs');
    runtime.states['/Game/Component'].Count=10;runtime.bindSourceActor('/Game/Pawn',player);
    assert.equal(runtime.states['/Game/Component'].Count,10);
    assert.throws(()=>runtime.bindSourceActor('/Game/Pawn',{}),/different source actor/);
});

test('mismatched graph sources, component classes, multiplicity and overrides reject binding atomically',()=>{
    for(const corrupt of [
        r=>r.actor_graph.roots['/Game/Pawn'].source.source_sha256='foreign',
        r=>r.actor_graph.roots['/Game/Pawn'].force_net_update_override=true,
        r=>r.packages['/Game/Component'].class_metadata.native_base=['/Script/Engine','Actor'],
        r=>r.actor_graph.roots['/Game/Pawn'].components.push(structuredClone(r.actor_graph.roots['/Game/Pawn'].components[0])),
        r=>r.actor_graph.roots['/Game/Pawn'].components[0].source_overrides.Unknown=1]) {
        const {report,player}=fixture();corrupt(report);const bindings=new SourceActorBindings(report);
        assert.throws(()=>bindings.bind('/Game/Pawn',player));assert.equal(bindings.root,null);assert.equal(bindings.components.size,0);
    }
});

test('native owner calls require the witnessed component, realm and an explicit no-driver standalone context',()=>{
    const {runtime,player}=fixture();runtime.bindSourceActor('/Game/Pawn',player);
    const context=runtime.actorBindings.context('/Game/Component');
    assert.throws(()=>sourceComponentOwner(undefined,2),/standalone/);
    assert.throws(()=>sourceComponentOwner(context,3),/owner binding/);
    for(const bad of [{...context,net_drivers:1},{...context,mode:'client'}])
        assert.throws(()=>sourceForceNetUpdate(bad,context.owner),/standalone/);
    assert.throws(()=>sourceForceNetUpdate(context,{...context.owner,realm:'foreign'}),/foreign/);
    assert.throws(()=>sourceForceNetUpdate(context,{asset:'/Game/Pawn',declared_class:['/Script/Engine','Actor']}),/foreign/);
    assert.equal(sourceComponentOwner({...context,owner:null},2),null);
});

test('source native requests and state commit together; failed execution leaves no receipts or changes',()=>{
    const {runtime,player,program}=fixture();runtime.bindSourceActor('/Game/Pawn',player);
    const saved=runtime.snapshot(),result=runtime.call('/Game/Component','Write');
    assert.equal(result.state.Count,7);assert.equal(runtime.nativeRequests.length,1);
    assert.deepEqual(result.effects,[{op:'force_net_update',actor_id:'actor-1',actor_class:'/Game/Pawn',scope:'standalone_no_drivers'}]);
    runtime.restore(saved);assert.equal(runtime.nativeRequests.length,0);assert.equal(runtime.actorBindings.ownerTarget('/Game/Component'),player);
    program.steps.splice(2,0,{op:'evaluate',value:{op:'unsupported_native'}});
    assert.throws(()=>runtime.call('/Game/Component','Write'),/Unsupported Blueprint/);assert.deepEqual(runtime.snapshot(),saved);
});

test('null Actor context preserves Accessed None skip while wrong component source and asset proxies fail',()=>{
    const {runtime,player,program}=fixture();runtime.bindSourceActor('/Game/Pawn',player);
    const context=runtime.actorBindings.context('/Game/Component');
    program.steps[1].value.target=c(null);
    const skipped=executeBlueprint(program,{Count:0}, {},{native:context});assert.deepEqual(skipped.effects,[]);
    assert.ok(skipped.trace.some(entry=>entry.message?.includes('Accessed None')));
    program.steps[1].value.target={...owner,source_owner_index:99};
    assert.throws(()=>executeBlueprint(program,{Count:0}, {},{native:context}),/component class/);
    program.steps[1].value.target={op:'typed_literal',schema:{type:'ObjectProperty',class:['/Script/Engine','Actor']},
        value:{asset:'/Game/Pawn',declared_class:['/Script/Engine','Actor']}};
    assert.throws(()=>executeBlueprint(program,{Count:0}, {},{native:context}),/foreign/);
});
