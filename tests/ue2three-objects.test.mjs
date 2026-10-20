import test from 'node:test';
import assert from 'node:assert/strict';
import {SourceActorBindings, sourceComponentOwner, sourceForceNetUpdate, sourceObjectValid, sourceFindComponent} from '../src/editor/ue2three-objects.mjs';
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
        input_fields:[],output_fields:['Value'],self_reads:['Count'],self_writes:[],field_types:{self:{Count:'IntProperty'},local:{Value:'IntProperty'}},schemas:{},steps:[
            {op:'set',scope:'local',field:'Value',value:{op:'get',scope:'self',field:'Count'}},end]};
    const schema={type:'ObjectProperty',class:['/Game/Component','Component_C'],reference_kind:'runtime_component',default:null};
    const call={op:'component_query',target:{op:'get',scope:'self',field:'Inventory'},package:'/Game/Component',class_object:'Component_C',function:'Read',export_index:4,
        bindings:[{mode:'output',parameter:'Value',target:{op:'get',scope:'local',field:'Result'}}]};
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
