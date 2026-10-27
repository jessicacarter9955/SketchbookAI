import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceDynamicCast } from '../src/editor/ue2three-casts.mjs';
import { executeBlueprint } from '../src/editor/ue2three-blueprint.mjs';

function fixture() {
    const reference={realm:'test',actor_id:'pawn-1',declared_class:['/Script/Engine','Actor']};
    const actor={reference,source_class:'/Game/Pawn',class_object:'Pawn_C',source_owner_index:2,
        native_base:['/Script/Engine','Pawn'],force_net_update_override:false};
    const context={mode:'standalone',net_drivers:0,realm:'test',actors:{'pawn-1':actor}};
    const operation={dispatch:'EX_DynamicCast',target_class:['/Game/Pawn','Pawn_C'],
        class_lineage:[{class:['/Game/Pawn','Pawn_C'],export_index:2,super:['/Script/Engine','Pawn']},
            {class:['/Script/Engine','Pawn'],native:true},{class:['/Script/Engine','Actor'],native:true}],
        input_schema:{type:'ObjectProperty',class:['/Script/Engine','Actor'],reference_kind:'runtime_actor',default:null},
        schema:{type:'ObjectProperty',class:['/Game/Pawn','Pawn_C'],reference_kind:'runtime_actor',default:null}};
    return {reference,context,operation};
}

test('cast preserves the exact bound original UObject identity and null semantics',()=>{
    const {reference,context,operation}=fixture();
    assert.deepEqual(sourceDynamicCast(context,reference,operation),reference);
    assert.equal(sourceDynamicCast(context,null,operation),null);
});

test('ObjectToBool evaluates original cast success and null without JS truthiness coercion',()=>{
    const {reference,context,operation}=fixture();
    const value={op:'source_dynamic_cast',...operation,value:{op:'get',scope:'local',field:'Actor'}};
    const p={schema_version:1,status:'translated_straight_line',source_owner_index:2,
        input_fields:['Actor'],output_fields:[],field_types:{local:{Actor:'ObjectProperty'}},
        schemas:{local:{Actor:operation.input_schema}},steps:[{op:'return',value:{op:'source_object_bool',conversion:1,
            value,schema:operation.schema}}]};
    assert.equal(executeBlueprint(p,{}, {Actor:reference},{native:context}).value,true);
    assert.equal(executeBlueprint(p,{}, {Actor:null},{native:context}).value,false);
    const foreign={...reference,realm:'other'};
    assert.throws(()=>executeBlueprint(p,{}, {Actor:foreign},{native:context}),/foreign/);
    p.steps[0].value.value={op:'constant',value:1};
    assert.throws(()=>executeBlueprint(p,{}, {Actor:reference},{native:context}),/runtime actor reference/);
});
test('valid nonmatching bound actor returns null',()=>{
    const {reference,context,operation}=fixture();context.actors['pawn-1'].source_class='/Game/Other';
    context.actors['pawn-1'].class_object='Other_C';
    assert.equal(sourceDynamicCast(context,reference,operation),null);
});
test('native Pawn upcast succeeds and Character downcast fails for an actual Pawn',()=>{
    const {reference,context,operation}=fixture();
    operation.target_class=['/Script/Engine','Pawn'];operation.class_lineage=operation.class_lineage.slice(1);
    operation.schema.class=operation.target_class;
    assert.deepEqual(sourceDynamicCast(context,reference,operation),reference);
    operation.target_class=['/Script/Engine','Character'];operation.schema.class=operation.target_class;
    operation.class_lineage.unshift({class:operation.target_class,native:true});
    assert.equal(sourceDynamicCast(context,reference,operation),null);
    context.actors['pawn-1'].native_base=['/Script/Engine','Character'];
    assert.deepEqual(sourceDynamicCast(context,reference,operation),reference);
});
test('foreign, unbound and asset references never become successful casts',()=>{
    const {reference,context,operation}=fixture();
    for (const invalid of [{...reference,realm:'foreign'},{...reference,actor_id:'unbound'},
        {asset:'/Game/Pawn',declared_class:['/Game/Pawn','Pawn_C']}])
        assert.throws(()=>sourceDynamicCast(context,invalid,operation),/reference/);
});
test('source export witness and native hierarchy cannot be altered',()=>{
    const {reference,context,operation}=fixture();
    operation.class_lineage[0].export_index=3;
    assert.throws(()=>sourceDynamicCast(context,reference,operation),/witness/);
    operation.class_lineage[1].class=['/Script/Engine','Character'];
    assert.throws(()=>sourceDynamicCast(context,reference,operation),/inheritance/);
});
test('unsupported runtime mode and mismatched input type fail closed',()=>{
    const {reference,context,operation}=fixture();context.net_drivers=1;
    assert.throws(()=>sourceDynamicCast(context,reference,operation),/standalone/);
    context.net_drivers=0;operation.input_schema.class=['/Script/Engine','Character'];
    assert.throws(()=>sourceDynamicCast(context,reference,operation),/class differs/);
});
test('component cast preserves a bound source component and authenticates its export',()=>{
    const {context,operation}=fixture();
    const reference={realm:'test',actor_id:'pawn-1',component_variable:'Inventory',
        declared_class:['/Game/Inventory','Inventory_C']};
    context.components={Inventory:{reference,class_export_index:7}};
    operation.target_class=reference.declared_class;
    operation.class_lineage=[{class:reference.declared_class,export_index:7,super:['/Script/Engine','ActorComponent']},
        {class:['/Script/Engine','ActorComponent'],native:true}];
    operation.schema={type:'ObjectProperty',class:reference.declared_class,reference_kind:'runtime_component',default:null};
    operation.input_schema=operation.schema;
    assert.deepEqual(sourceDynamicCast(context,reference,operation),reference);
    operation.class_lineage[0].export_index=8;
    assert.throws(()=>sourceDynamicCast(context,reference,operation),/component class witness/);
});
