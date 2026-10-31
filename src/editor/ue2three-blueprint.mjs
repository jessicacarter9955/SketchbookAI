// Executes normalized source-derived instructions; never evaluates generated JS.
import { evaluateNativeMath } from './ue2three-native-math.mjs';
import { sourceDynamicCast } from './ue2three-casts.mjs';
import { readSourceActorMember, writeSourceActorMember } from './ue2three-source-objects.mjs';
import { validActorReference, validComponentReference, sourceComponentOwner, sourceForceNetUpdate,
    sourceQueryReceiver, sourceObjectValid, sourceFindComponent, sourceNativeComponentOwner, sourceActorRole } from './ue2three-objects.mjs';
const owns = (object, key) => object != null && Object.hasOwn(object, key);
const safeField = key => typeof key === 'string' && key.length > 0 && !['__proto__', 'constructor', 'prototype'].includes(key);
const nativeContextContracts = new Map([
    [JSON.stringify(['/Script/Engine','SceneCaptureComponent2D','CaptureScene']), {
        identity:['/Script/Engine','SceneCaptureComponent2D','CaptureScene'], dispatch:'EX_FinalFunction',
        receiver:['/Script/Engine','SceneCaptureComponent2D'],
        receiver_schema:{type:'ObjectProperty',class:['/Script/Engine','SceneCaptureComponent2D'],
            reference_kind:'runtime_native_component',default:null},
        parameters:[],
    }],
    [JSON.stringify(['/Script/Engine','SkeletalMeshComponent','SetMaterial']), {
        identity:['/Script/Engine','SkeletalMeshComponent','SetMaterial'], dispatch:'EX_VirtualFunction',
        receiver:['/Script/Engine','SkeletalMeshComponent'],
        receiver_schema:{type:'ObjectProperty',class:['/Script/Engine','SkeletalMeshComponent'],
            reference_kind:'runtime_native_component',default:null},
        parameters:[{type:'IntProperty',default:0},
            {type:'ObjectProperty',class:['/Script/Engine','MaterialInterface'],default:null}],
    }],
    [JSON.stringify(['/Script/Engine','SkeletalMeshComponent','SetSkeletalMeshAsset']), {
        identity:['/Script/Engine','SkeletalMeshComponent','SetSkeletalMeshAsset'], dispatch:'EX_FinalFunction',
        receiver:['/Script/Engine','SkeletalMeshComponent'],
        receiver_schema:{type:'ObjectProperty',class:['/Script/Engine','SkeletalMeshComponent'],
            reference_kind:'runtime_native_component',default:null},
        parameters:[{type:'ObjectProperty',class:['/Script/Engine','SkeletalMesh'],default:null}],
    }],
    [JSON.stringify(['/Script/Engine','SceneComponent','SetVisibility']), {
        identity:['/Script/Engine','SceneComponent','SetVisibility'], dispatch:'EX_FinalFunction',
        // The source final function belongs to SceneComponent; receiver
        // classes retain the exact reflected concrete SCS component type.
        receiver:['/Script/Engine','StaticMeshComponent'],
        receivers:[['/Script/Engine','StaticMeshComponent'],['/Script/Engine','TextRenderComponent']],
        parameters:[{type:'BoolProperty',default:false},{type:'BoolProperty',default:false}],
    }],
    [JSON.stringify(['/Script/Engine','TextRenderComponent','K2_SetText']), {
        identity:['/Script/Engine','TextRenderComponent','K2_SetText'], dispatch:'EX_FinalFunction',
        receiver:['/Script/Engine','TextRenderComponent'],
        parameters:[{type:'TextProperty',default:{history:'empty',text:'',flags:0}}],
    }],
    [JSON.stringify(['/Script/Niagara','NiagaraComponent','Activate']), {
        identity:['/Script/Niagara','NiagaraComponent','Activate'], dispatch:'EX_VirtualFunction',
        receiver:['/Script/Niagara','NiagaraComponent'],
        parameters:[{type:'BoolProperty',default:false}],
    }],
    [JSON.stringify(['/Script/Niagara','NiagaraComponent','Deactivate']), {
        identity:['/Script/Niagara','NiagaraComponent','Deactivate'], dispatch:'EX_VirtualFunction',
        receiver:['/Script/Niagara','NiagaraComponent'],parameters:[],
    }],
]);
const validPrimitive = (type, value) => type === 'BoolProperty' && typeof value === 'boolean'
    || type === 'ByteProperty' && Number.isInteger(value) && value >= 0 && value <= 255
    || type === 'IntProperty' && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647
    || type === 'Int64Property' && Number.isSafeInteger(value)
    || ['FloatProperty', 'DoubleProperty'].includes(type) && typeof value === 'number' && Number.isFinite(value)
    || ['StrProperty', 'NameProperty'].includes(type) && typeof value === 'string';
function validateSchema(schema, value, depth = 0) {
    if (!schema || depth > 16) throw new Error('Invalid source value schema');
    if (schema.type === 'ArrayProperty') {
        if (!Array.isArray(value) || value.length > 100000) throw new Error('Invalid typed source array');
        for (const item of value) validateSchema(schema.element, item, depth+1);
    } else if (schema.type === 'StructProperty') {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid typed source struct');
        for (const [field, child] of Object.entries(schema.fields || {})) {
            if (!safeField(field) || !owns(value, field)) throw new Error('Missing typed source struct field: ' + field);
            validateSchema(child, value[field], depth+1);
        }
    } else if (schema.type === 'ObjectProperty' || schema.type === 'ClassProperty') {
        if (schema.reference_kind === 'source_self') {
            if (value !== null && (value?.kind !== 'source_self' || value.source_owner_index !== schema.source_owner_index
                || typeof value.source_package !== 'string' || !/^\/Game\/[A-Za-z0-9_/.]+$/.test(value.source_package)
                || JSON.stringify(value.declared_class || null) !== JSON.stringify(schema.class || null)))
                throw new Error('Invalid original Blueprint self reference');
            return;
        }
        if (schema.reference_kind === 'runtime_actor') {
            if (value !== null && !validActorReference(value)) throw new Error('Invalid source runtime actor reference');
            return;
        }
        if (schema.reference_kind === 'runtime_component') {
            if (value !== null && (!validComponentReference(value)
                || JSON.stringify(value.declared_class) !== JSON.stringify(schema.class))) throw new Error('Invalid original component reference');
            return;
        }
        if (schema.reference_kind === 'runtime_native_widget') {
            if (value !== null && (value?.kind !== 'source_native_widget'
                || typeof value.source_package !== 'string'
                || !/^\/Game\/[A-Za-z0-9_/.]+$/.test(value.source_package)
                || !Number.isSafeInteger(value.source_owner_index) || value.source_owner_index < 1
                || !safeField(value.source_field)
                || typeof value.widget_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.widget_id)
                || JSON.stringify(value.declared_class) !== JSON.stringify(schema.class)))
                throw new Error('Unverified original native UMG widget reference');
            return;
        }
        if (schema.reference_kind === 'runtime_native_component' || schema.reference_kind === 'runtime_native_object') {
            const expectedKind = schema.reference_kind === 'runtime_native_component'
                ? 'source_native_component' : 'source_native_object';
            if (value !== null && (value?.kind !== expectedKind || typeof value.source_package !== 'string'
                || !/^\/Game\/[A-Za-z0-9_/.]+$/.test(value.source_package)
                || !Number.isSafeInteger(value.source_owner_index) || value.source_owner_index <= 0
                || !safeField(value.source_field)
                || schema.reference_kind === 'runtime_native_component'
                    && (typeof value.realm !== 'string' || !value.realm
                        || typeof value.actor_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.actor_id))
                || JSON.stringify(value.declared_class) !== JSON.stringify(schema.class)))
                throw new Error('Invalid original native object reference');
            return;
        }
        if (value !== null && (!value || typeof value !== 'object' || typeof value.asset !== 'string'
            || !/^\/(Game|Engine|Script|ControlRig)\/[A-Za-z0-9_\/.]+$/.test(value.asset)
            || JSON.stringify(value.declared_class) !== JSON.stringify(schema.class)
            || schema.type === 'ClassProperty' && JSON.stringify(value.meta_class) !== JSON.stringify(schema.meta_class))) throw new Error('Invalid source asset identity');
    } else if (schema.type === 'TextProperty') {
        if (!value || typeof value.text !== 'string' || !Number.isInteger(value.flags) || value.flags < 0 || value.flags > 4294967295
            || !(value.history === 'empty' && value.text === '' || value.history === 'base' && typeof value.namespace === 'string'
                && typeof value.key === 'string' || value.history === 'invariant' && value.flags === 2))
            throw new Error('Unsupported original FText');
    } else if (!validPrimitive(schema.type, value)) throw new Error('Invalid typed source member: ' + schema.type);
}

function sourceFormatText(pattern, arguments_) {
    validateSchema({type:'TextProperty'},pattern);
    if (!['base','invariant','empty'].includes(pattern.history) || !Array.isArray(arguments_) || arguments_.length > 256)
        throw new Error('Unsupported original FText.Format source template or argument array');
    const named=new Map();
    const rendered=arguments_.map(argument=>{
        if (!argument || typeof argument !== 'object' || Array.isArray(argument)
            || typeof argument.ArgumentName !== 'string' || !argument.ArgumentName
            || named.has(argument.ArgumentName)) throw new Error('Invalid or duplicate original FText.Format argument name');
        let value;
        switch (argument.ArgumentValueType) {
        case 0:
            if (!Number.isSafeInteger(argument.ArgumentValueInt)) throw new Error('Invalid original FText.Format Int argument');
            value=String(argument.ArgumentValueInt); break;
        case 2:
            if (typeof argument.ArgumentValueFloat !== 'number' || !Number.isFinite(argument.ArgumentValueFloat))
                throw new Error('Invalid original FText.Format Float argument');
            value=String(argument.ArgumentValueFloat); break;
        case 3:
            if (typeof argument.ArgumentValueDouble !== 'number' || !Number.isFinite(argument.ArgumentValueDouble))
                throw new Error('Invalid original FText.Format Double argument');
            value=String(argument.ArgumentValueDouble); break;
        case 4:
            validateSchema({type:'TextProperty'},argument.ArgumentValue);
            value=argument.ArgumentValue.text; break;
        default: throw new Error('Unsupported original FText.Format argument kind');
        }
        named.set(argument.ArgumentName,value);
        return value;
    });
    const text=pattern.text; let result='';
    for (let index=0; index<text.length;) {
        if (text[index] === '}') throw new Error('Unmatched brace in original FText.Format source');
        if (text[index] !== '{') { result+=text[index++]; continue; }
        const end=text.indexOf('}',index+1);
        if (end < 0) throw new Error('Unmatched brace in original FText.Format source');
        const key=text.slice(index+1,end);
        if (!key || key.includes('{') || key.trim() !== key || !/^[A-Za-z0-9_ ]+$/.test(key))
            throw new Error('Unsupported placeholder in original FText.Format source');
        const value=named.get(key);
        if (value === undefined) throw new Error('Unbound placeholder in original FText.Format source: ' + key);
        result+=value; index=end+1;
    }
    return {history:'invariant',text:result,flags:2};
}

const nativeFormatArgumentSchema = () => ({type:'StructProperty',source:'/Script/Engine',native:'FormatArgumentData',
    fields:{ArgumentName:{type:'StrProperty',default:''},ArgumentValue:{type:'TextProperty',default:{history:'empty',text:'',flags:0}},
        ArgumentValueDouble:{type:'DoubleProperty',default:0},ArgumentValueFloat:{type:'FloatProperty',default:0},
        ArgumentValueGender:{type:'ByteProperty',enum:['/Script/Engine','ETextGender'],default:0},
        ArgumentValueInt:{type:'Int64Property',default:0},ArgumentValueType:{type:'ByteProperty',enum:['/Script/Engine','EFormatArgumentType'],default:0}},
    default:{ArgumentName:'',ArgumentValue:{history:'empty',text:'',flags:0},ArgumentValueDouble:0,ArgumentValueFloat:0,
        ArgumentValueGender:0,ArgumentValueInt:0,ArgumentValueType:0},
    member_order:['ArgumentName','ArgumentValue','ArgumentValueDouble','ArgumentValueFloat','ArgumentValueGender','ArgumentValueInt','ArgumentValueType']});
const nativeSlateColorSchema = () => ({type:'StructProperty',source:'/Script/SlateCore',native:'SlateColor',
    fields:{SpecifiedColor:{type:'StructProperty',source:'/Script/CoreUObject',native:'LinearColor',
        fields:{R:{type:'FloatProperty'},G:{type:'FloatProperty'},B:{type:'FloatProperty'},A:{type:'FloatProperty'}},
        default:{R:0,G:0,B:0,A:0},member_order:['R','G','B','A']},
        ColorUseRule:{type:'ByteProperty',enum:['/Script/SlateCore','ESlateColorStylingMode'],
            enum_values:{'ESlateColorStylingMode::UseColor_Specified':0,'ESlateColorStylingMode::UseColor_ColorTable':1,
                'ESlateColorStylingMode::UseColor_Foreground':2,'ESlateColorStylingMode::UseColor_Foreground_Subdued':3,
                'ESlateColorStylingMode::UseColor_UseStyle':4},default:0}},
    default:{SpecifiedColor:{R:1,G:0,B:1,A:1},ColorUseRule:0},member_order:['SpecifiedColor','ColorUseRule']});

function requireArrayIdentity(expression, name, required = true) {
    const identity = ['/Script/Engine', 'KismetArrayLibrary', name];
    if (expression.identity === undefined && !required) return;
    if (JSON.stringify(expression.identity) !== JSON.stringify(identity) || expression.dispatch !== 'EX_FinalFunction')
        throw new Error('Original array call identity or dispatch differs');
}

function sourceArrayValueEqual(schema, left, right, depth = 0) {
    if (!schema || depth > 16) throw new Error('Invalid original array equality schema');
    validateSchema(schema, left); validateSchema(schema, right);
    switch (schema.type) {
    case 'BoolProperty': case 'ByteProperty': case 'IntProperty': case 'Int64Property':
    case 'DoubleProperty': case 'StrProperty': return left === right;
    case 'FloatProperty': return Math.fround(left) === Math.fround(right);
    case 'NameProperty':
        if (/[^\x01-\x7f]/.test(left) || /[^\x01-\x7f]/.test(right))
            throw new Error('Unsupported Unicode FName array comparison');
        return left.toUpperCase() === right.toUpperCase();
    case 'ArrayProperty':
        return left.length === right.length && left.every((value, index) =>
            sourceArrayValueEqual(schema.element, value, right[index], depth+1));
    case 'StructProperty':
        if (!String(schema.source || '').startsWith('/Game/') || !schema.fields || !Object.keys(schema.fields).length)
            throw new Error('Unsupported original native struct array comparison');
        return Object.entries(schema.fields).every(([field, child]) =>
            sourceArrayValueEqual(child, left[field], right[field], depth+1));
    default: throw new Error('Unsupported original array element equality: ' + schema.type);
    }
}

const nativeObject = identity => ({type:'ObjectProperty', ...(identity ? {class:identity} : {}), default:null});
const nativeStruct = name => {
    if (name === 'Key') return {type:'StructProperty',source:'/Script/InputCore',native:name,
        fields:{KeyName:{type:'NameProperty',default:'None'}},default:{KeyName:'None'},member_order:['KeyName']};
    if (name === 'Quat') return {type:'StructProperty',source:'/Script/CoreUObject',native:name,
        fields:Object.fromEntries(['X','Y','Z','W'].map(field=>[field,{type:'DoubleProperty'}])),
        default:{X:0,Y:0,Z:0,W:1},member_order:['X','Y','Z','W']};
    if (name === 'Transform') {
        const rotation=nativeStruct('Quat'), vector=nativeStruct('Vector');
        return {type:'StructProperty',source:'/Script/CoreUObject',native:name,
            fields:{Rotation:rotation,Translation:vector,Scale3D:vector},
            default:{Rotation:rotation.default,Translation:vector.default,Scale3D:{X:1,Y:1,Z:1}},
            member_order:['Rotation','Translation','Scale3D']};
    }
    const fields = name === 'Vector2D' ? ['X','Y'] : name === 'Vector' ? ['X','Y','Z'] : name === 'Rotator' ? ['Pitch','Yaw','Roll'] : ['R','G','B','A'];
    const fieldType = name === 'LinearColor' ? 'FloatProperty' : 'DoubleProperty';
    return {type:'StructProperty',source:'/Script/CoreUObject',native:name,
        fields:Object.fromEntries(fields.map(field=>[field,{type:fieldType}])),
        default:Object.fromEntries(fields.map(field=>[field,0])),member_order:fields};
};
const nativeEnum = identity => ({type:'ByteProperty',enum:identity,default:0});
const nativeAudioVfxContracts = new Map();
const addNativeAudioVfx = (module, owner, name, dispatch, parameters, receiver = null, result = null) =>
    nativeAudioVfxContracts.set(JSON.stringify([module,owner,name]), {dispatch,parameters,receiver,result});
const O = nativeObject, S = nativeStruct, E = nativeEnum;
const B = {type:'BoolProperty'}, F = {type:'FloatProperty'}, D = {type:'DoubleProperty'},
    I = {type:'IntProperty'}, N = {type:'NameProperty'}, T = {type:'StrProperty'};
addNativeAudioVfx('/Script/Engine','GameplayStatics','PlaySound2D','EX_CallMath',[
    O(),O(['/Script/Engine','SoundBase']),F,F,F,O(['/Script/Engine','SoundConcurrency']),O(['/Script/Engine','Actor']),B]);
addNativeAudioVfx('/Script/Engine','GameplayStatics','PlaySoundAtLocation','EX_CallMath',[
    O(),O(['/Script/Engine','SoundBase']),S('Vector'),S('Rotator'),F,F,F,O(['/Script/Engine','SoundAttenuation']),
    O(['/Script/Engine','SoundConcurrency']),O(['/Script/Engine','Actor']),O(['/Script/Engine','InitialActiveSoundParams'])]);
addNativeAudioVfx('/Script/Engine','GameplayStatics','SpawnSoundAtLocation','EX_CallMath',[
    O(),O(['/Script/Engine','SoundBase']),S('Vector'),S('Rotator'),F,F,F,O(['/Script/Engine','SoundAttenuation']),
    O(['/Script/Engine','SoundConcurrency']),B],null,O(['/Script/Engine','AudioComponent']));
addNativeAudioVfx('/Script/Engine','GameplayStatics','SpawnSoundAttached','EX_CallMath',[
    O(['/Script/Engine','SoundBase']),O(['/Script/Engine','SceneComponent']),N,S('Vector'),S('Rotator'),
    E(['/Script/Engine','EAttachLocation']),B,F,F,F,O(['/Script/Engine','SoundAttenuation']),
    O(['/Script/Engine','SoundConcurrency']),B],null,O(['/Script/Engine','AudioComponent']));
addNativeAudioVfx('/Script/Niagara','NiagaraFunctionLibrary','SpawnSystemAtLocation','EX_CallMath',[
    O(),O(['/Script/Niagara','NiagaraSystem']),S('Vector'),S('Rotator'),S('Vector'),B,B,
    E(['/Script/Niagara','ENCPoolMethod']),B],null,O(['/Script/Niagara','NiagaraComponent']));
addNativeAudioVfx('/Script/Niagara','NiagaraFunctionLibrary','SpawnSystemAttached','EX_CallMath',[
    O(['/Script/Niagara','NiagaraSystem']),O(['/Script/Engine','SceneComponent']),N,S('Vector'),S('Rotator'),
    E(['/Script/Engine','EAttachLocation']),B,B,E(['/Script/Niagara','ENCPoolMethod']),B],null,
    O(['/Script/Niagara','NiagaraComponent']));
addNativeAudioVfx('/Script/Niagara','NiagaraComponent','SetVariableLinearColor','EX_FinalFunction',
    [N,S('LinearColor')],['/Script/Niagara','NiagaraComponent']);
addNativeAudioVfx('/Script/Niagara','NiagaraComponent','SetVariableVec3','EX_FinalFunction',
    [N,S('Vector')],['/Script/Niagara','NiagaraComponent']);
addNativeAudioVfx('/Script/Niagara','NiagaraComponent','SetVariableFloat','EX_FinalFunction',
    [N,F],['/Script/Niagara','NiagaraComponent']);
addNativeAudioVfx('/Script/Niagara','NiagaraComponent','SetVariablePosition','EX_FinalFunction',
    [N,S('Vector')],['/Script/Niagara','NiagaraComponent']);
addNativeAudioVfx('/Script/Niagara','NiagaraComponent','SetVariableBool','EX_FinalFunction',
    [N,B],['/Script/Niagara','NiagaraComponent']);
addNativeAudioVfx('/Script/Niagara','NiagaraComponent','SetVariableMaterial','EX_FinalFunction',
    [N,O(['/Script/Engine','MaterialInterface'])],['/Script/Niagara','NiagaraComponent']);
addNativeAudioVfx('/Script/Niagara','NiagaraComponent','SetNiagaraVariablePosition','EX_FinalFunction',
    [T,S('Vector')],['/Script/Niagara','NiagaraComponent']);
addNativeAudioVfx('/Script/Engine','AudioComponent','SetSound','EX_FinalFunction',
    [O(['/Script/Engine','SoundBase'])],['/Script/Engine','AudioComponent']);
addNativeAudioVfx('/Script/Engine','AudioComponent','SetVolumeMultiplier','EX_FinalFunction',
    [F],['/Script/Engine','AudioComponent']);
for (const [name, value] of [['WriteFloat',D],['WriteInt',I],['WritePosition',S('Vector')],
    ['WriteVector',S('Vector')],['WriteLinearColor',S('LinearColor')]])
    addNativeAudioVfx('/Script/Niagara','NiagaraDataChannelWriter',name,'EX_FinalFunction',
        [N,I,value],['/Script/Niagara','NiagaraDataChannelWriter']);

const nativeAudioVfxBases = new Map([
    ['/Script/Engine.Character',['/Script/Engine','Pawn']], ['/Script/Engine.Pawn',['/Script/Engine','Actor']],
    ['/Script/Engine.Actor',['/Script/CoreUObject','Object']], ['/Script/Engine.SceneComponent',['/Script/Engine','ActorComponent']],
    ['/Script/Engine.PrimitiveComponent',['/Script/Engine','SceneComponent']], ['/Script/Engine.MeshComponent',['/Script/Engine','PrimitiveComponent']],
    ['/Script/Engine.SkeletalMeshComponent',['/Script/Engine','MeshComponent']], ['/Script/Engine.StaticMeshComponent',['/Script/Engine','MeshComponent']],
    ['/Script/Engine.CapsuleComponent',['/Script/Engine','PrimitiveComponent']], ['/Script/Engine.AudioComponent',['/Script/Engine','ActorComponent']],
    ['/Script/Engine.CameraComponent',['/Script/Engine','SceneComponent']], ['/Script/Engine.SpringArmComponent',['/Script/Engine','SceneComponent']],
    ['/Script/Niagara.NiagaraComponent',['/Script/Engine','PrimitiveComponent']],
    ['/Script/Engine.SoundWave',['/Script/Engine','SoundBase']], ['/Script/Engine.SoundCue',['/Script/Engine','SoundBase']],
    ['/Script/Engine.Material',['/Script/Engine','MaterialInterface']], ['/Script/Engine.MaterialInstance',['/Script/Engine','MaterialInterface']],
    ['/Script/Engine.MaterialInstanceConstant',['/Script/Engine','MaterialInstance']],
]);
function nativeAudioVfxIsA(actual, expected) {
    let current=actual;const seen=new Set();
    while(Array.isArray(current)&&current.length===2&&!seen.has(JSON.stringify(current))) {
        if(JSON.stringify(current)===JSON.stringify(expected))return true;
        seen.add(JSON.stringify(current));current=nativeAudioVfxBases.get(current.join('.'));
    }
    return false;
}
function validateNativeAudioVfxArgument(sourceSchema, contractSchema, value, program, notifications) {
    validateSchema(sourceSchema,value);
    if (!sourceSchema || sourceSchema.type !== contractSchema?.type) throw new Error('Original native audio/VFX parameter type differs');
    if (contractSchema.type === 'ObjectProperty') {
        if (value === null) return;
        if (sourceSchema.reference_kind === 'source_self') {
            if (value?.kind !== 'source_self' || value.source_owner_index !== program.source_owner_index
                || value.source_package !== notifications.native?.source_package
                || JSON.stringify(value.declared_class || null) !== JSON.stringify(sourceSchema.class || null))
                throw new Error('Original native audio/VFX world context differs');
        } else {
            const actual=sourceSchema.class || value?.declared_class;
            if (contractSchema.class && !nativeAudioVfxIsA(actual,contractSchema.class))
                throw new Error('Original native audio/VFX object class differs');
            if (!contractSchema.class && !(value?.asset || validActorReference(value) || validComponentReference(value)
                || value?.kind === 'source_native_component' || value?.kind === 'source_native_object'))
                throw new Error('Unresolved original native audio/VFX object argument');
        }
        if (contractSchema.class && !nativeAudioVfxIsA(sourceSchema.class,contractSchema.class))
            throw new Error('Original native audio/VFX object class differs');
        return;
    }
    if (contractSchema.type === 'StructProperty'
        && (sourceSchema.source !== contractSchema.source || sourceSchema.native !== contractSchema.native))
        throw new Error('Original native audio/VFX struct type differs');
    if (contractSchema.enum && JSON.stringify(sourceSchema.enum) !== JSON.stringify(contractSchema.enum))
        throw new Error('Original native audio/VFX enum type differs');
    validateSchema(contractSchema,value);
}

export function executeBlueprint(program, self = {}, inputs = {}, { functions = {}, frames = {}, tables = {}, bindings = {}, signatures = {}, native, queries = {}, receivers } = {}) {
    // All participating components are staged once. Callbacks observe their
    // active storage; callers commit the entire transaction only after success.
    const world = receivers && Object.fromEntries(Object.entries(receivers).map(([name, receiver]) => [name, {
        ...receiver, state:structuredClone(receiver.state), frames:structuredClone(receiver.frames || {}),
        bindings:structuredClone(receiver.bindings || {}), native:structuredClone(receiver.native)}]));
    const root = world?.[native?.source_package];
    if (world && (!root || JSON.stringify(root.state) !== JSON.stringify(self)
        || root.native?.source_owner_index !== program.source_owner_index)) throw new Error('Source transaction root differs');
    const result = runBlueprint(program, root?.state || self, inputs, functions, { remaining: 10000 }, 0,
        root?.frames || structuredClone(frames), tables,
        {bindings:root?.bindings || structuredClone(bindings), signatures, native:root?.native || structuredClone(native), queries, world, readWorld:world,
            rootPackage:native?.source_package,queryStack:native?.source_package ? [native.source_package] : [], effects: []});
    if (world) result.receivers = Object.fromEntries(Object.entries(world).map(([name, receiver]) => [name,
        {state:receiver.state, frames:receiver.frames, bindings:receiver.bindings}]));
    return result;
}

function runBlueprint(program, self, inputs, functions, budget, depth, frames, tables, notifications) {
    if (depth > 32) throw new Error('Blueprint call depth exceeded');
    if (program?.schema_version !== 1 || !['translated_straight_line', 'translated_control_flow'].includes(program.status)
        || !Array.isArray(program.steps) || program.steps.length > 10000
        || !Array.isArray(program.output_fields) || program.output_fields.some(name => !safeField(name)))
        throw new Error('Unsupported Blueprint program');
    const locals = Object.assign(Object.create(null), structuredClone(inputs));
    for (const field of program.input_fields || []) {
        if (!safeField(field) || !owns(locals, field)) throw new Error(`Missing Blueprint input: ${field}`);
    }
    // Unreal initializes primitive local/out property storage before executing
    // a UFunction. Struct constructors need their source type/defaults and are
    // deliberately not invented here.
    const primitiveDefaults = {BoolProperty: false, ByteProperty: 0, IntProperty: 0, Int64Property: 0,
        FloatProperty: 0, DoubleProperty: 0, StrProperty: '', NameProperty: 'None'};
    for (const [field, type] of Object.entries(program.field_types?.local || {})) {
        if (!safeField(field)) throw new Error('Invalid local field');
        if (!owns(locals, field) && owns(primitiveDefaults, type)) locals[field] = primitiveDefaults[type];
    }
    for (const [field, schema] of Object.entries(program.schemas?.local || {})) {
        if (!safeField(field)) throw new Error('Invalid local schema field');
        if (!owns(locals, field)) { validateSchema(schema, schema.default); locals[field] = structuredClone(schema.default); }
    }
    for (const [frame, types] of Object.entries(program.persistent_types || {})) {
        if (!/^[1-9][0-9]*$/.test(frame)) throw new Error('Invalid persistent frame identity');
        if (!owns(frames, frame)) frames[frame] = Object.create(null);
        for (const [field, type] of Object.entries(types)) {
            if (!safeField(field)) throw new Error('Invalid persistent frame field');
            if (!owns(frames[frame], field) && owns(primitiveDefaults, type)) frames[frame][field] = primitiveDefaults[type];
            const schema = program.persistent_schemas?.[frame]?.[field];
            if (!owns(frames[frame], field) && schema) {
                validateSchema(schema, schema.default); frames[frame][field] = structuredClone(schema.default);
            }
        }
    }
    const receiver = notifications.world?.[notifications.native?.source_package];
    const instance = receiver ? receiver.state : structuredClone(self);
    if (receiver && receiver.state !== self) throw new Error('Source transaction lost active instance storage');
    if (Object.keys(instance).some(field => !safeField(field))) throw new Error('Invalid instance property');
    const trace = [];
    let sourceIndex;
    const emit = effect => notifications.effects.push(notifications.world && notifications.native.source_package !== notifications.rootPackage
        ? {...effect, package:notifications.native.source_package} : effect);
    const checkType = (scope, field, value, frame) => {
        const type = scope === 'persistent' ? program.persistent_types?.[frame]?.[field] : program.field_types?.[scope]?.[field];
        if (scope === 'persistent' && !type) throw new Error('Unresolved persistent property type');
        const valid = !type
            || type === 'BoolProperty' && typeof value === 'boolean'
            || type === 'ByteProperty' && Number.isInteger(value) && value >= 0 && value <= 255
            || type === 'IntProperty' && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647
            || type === 'Int64Property' && Number.isSafeInteger(value)
            || ['FloatProperty', 'DoubleProperty'].includes(type) && typeof value === 'number' && Number.isFinite(value)
            || ['StrProperty', 'NameProperty'].includes(type) && typeof value === 'string'
            || type === 'TextProperty' && value !== null && typeof value === 'object' && !Array.isArray(value)
            || type === 'ArrayProperty' && Array.isArray(value)
            || type === 'ObjectProperty' && (value === null || typeof value === 'object')
            || type === 'StructProperty' && value !== null && typeof value === 'object' && !Array.isArray(value);
        if (!valid) throw new Error(`Unsupported or invalid ${type}: ${scope}.${field}`);
        const schema = scope === 'persistent' ? program.persistent_schemas?.[frame]?.[field] : program.schemas?.[scope]?.[field];
        if (schema) validateSchema(schema, value);
    };
    const schemaFor = target => target?.scope === 'persistent' ? program.persistent_schemas?.[target.frame]?.[target.field]
        : program.schemas?.[target?.scope]?.[target?.field];
    const nativeMathStructType = value => {
        if (value?.op === 'typed_literal' || value?.op === 'get' || value?.op === 'struct_literal') {
            const schema=value.op === 'typed_literal' || value.op === 'struct_literal' ? value.schema : schemaFor(value);
            if (value.op === 'struct_literal' && schema?.native === 'Key' && value.source_struct_size !== 32) return null;
            if (!['Vector2D','Vector','Rotator','Quat','Transform','Key'].includes(schema?.native)
                || JSON.stringify(schema) !== JSON.stringify(nativeStruct(schema.native))) return null;
            return schema.native;
        }
        if (value?.op === 'math') return ({MakeVector:'Vector',Conv_DoubleToVector:'Vector',
            Add_VectorVector:'Vector',Subtract_VectorVector:'Vector',Multiply_VectorVector:'Vector',
            MakeRotator:'Rotator',MakeTransform:'Transform',MakeVector2D:'Vector2D',
            Conv_RotatorToVector:'Vector',Conv_VectorToRotator:'Rotator',GreaterGreater_VectorRotator:'Vector',
            GetUpVector:'Vector',ProjectPointOnToPlane:'Vector',SelectTransform:'Transform',RInterpTo:'Rotator'})[value.name] || null;
        return null;
    };
    const requireNativeMathStruct = (value, expected) => {
        if (nativeMathStructType(value) !== expected) throw new Error(`Original native math parameter is not ${expected}`);
    };
    const evaluate = (expression, depth = 0) => {
        if (!expression || depth > 48) throw new Error('Invalid Blueprint expression');
        if (expression.op==='source_object_bool') {
            if (expression.conversion!==1) throw new Error('Original ObjectToBool conversion differs');
            const value=evaluate(expression.value,depth+1);
            if (value===null) return false;
            if (expression.schema?.type!=='ObjectProperty' || !['runtime_actor','runtime_component',
                'runtime_native_component','runtime_native_widget'].includes(expression.schema.reference_kind))
                throw new Error('Original ObjectToBool live-object schema is unavailable');
            validateSchema(expression.schema,value);
            return sourceObjectValid(notifications.native,value,expression.schema);
        }
        if (expression.op === 'source_dynamic_cast') {
            const reference=evaluate(expression.value,depth+1);
            if (expression.input_schema) validateSchema(expression.input_schema,reference);
            const result=sourceDynamicCast(notifications.native,reference,expression);
            validateSchema(expression.schema,result);
            return result;
        }
        if (expression.op === 'switch_value') {
            const cases = expression.cases;
            if (expression.index_type !== 'ByteProperty' || !Array.isArray(cases)
                || cases.length < 1 || cases.length > 64
                || !Number.isSafeInteger(expression.source_end_offset) || expression.source_end_offset <= 0)
                throw new Error('Unverified original switch-value bytecode');
            const labels = new Set();
            let previousOffset = 0;
            for (const candidate of cases) {
                if (!Number.isInteger(candidate?.match) || candidate.match < 0 || candidate.match > 255
                    || labels.has(candidate.match) || !Number.isSafeInteger(candidate.next_offset)
                    || candidate.next_offset <= previousOffset
                    || candidate.next_offset >= expression.source_end_offset || !candidate.value)
                    throw new Error('Unverified original switch-value case or VM offset');
                labels.add(candidate.match);
                previousOffset = candidate.next_offset;
            }
            const index = evaluate(expression.index, depth+1);
            if (!Number.isInteger(index) || index < 0 || index > 255)
                throw new Error('Original switch-value index is not a source byte');
            const selected = cases.find(candidate => candidate.match === index);
            return evaluate(selected ? selected.value : expression.default, depth+1);
        }
        if (expression.op === 'native_game_time') {
            const context = notifications.native;
            if (!context || context.mode !== 'standalone' || context.net_drivers !== 0
                || context.world_context_bound !== true
                || expression.source_owner_index !== program.source_owner_index
                || context.source_owner_index !== program.source_owner_index
                || typeof context.game_time_seconds !== 'number' || !Number.isFinite(context.game_time_seconds)
                || context.game_time_seconds < 0)
                throw new Error('Original world game time is unavailable');
            return context.game_time_seconds;
        }
        if (expression.op === 'native_find_component') {
            const reference = evaluate(expression.target,depth+1);
            validateSchema(expression.actor_schema,reference);
            if (reference === null) {
                trace.push({source_index:sourceIndex,op:'warning',message:'Accessed None: GetComponentByClass context skipped'});
                return null;
            }
            return sourceFindComponent(notifications.native,reference,expression.actor_schema,
                expression.package,expression.class_object,expression.class_export_index);
        }
        if (expression.op === 'component_member') {
            const reference = evaluate(expression.target,depth+1);
            if (reference === null) {
                if (expression.schema?.type === 'StructProperty')
                    throw new Error('Unverified original struct ClearValue for a null component context');
                validateSchema(expression.schema,expression.schema?.default);
                trace.push({source_index:sourceIndex,op:'warning',message:'Accessed None: original component property default'});
                return structuredClone(expression.schema.default);
            }
            const descriptor = sourceQueryReceiver(notifications.native,reference,expression.package,expression.class_object);
            const query = owns(notifications.queries,expression.package) ? notifications.queries[expression.package] : null;
            if (!safeField(expression.field) || !query || query.source_sha256 !== descriptor.source_sha256
                || expression.class_export_index !== descriptor.class_export_index
                || JSON.stringify(query.field_schemas?.[expression.field]) !== JSON.stringify(expression.schema))
                throw new Error('Original component property schema or source differs');
            const ownReceiver = expression.package === notifications.native?.source_package;
            if (!notifications.readWorld && !ownReceiver && notifications.queryStack.includes(expression.package))
                throw new Error('Reentrant component property access requires shared active storage');
            const storage = ownReceiver ? instance : (notifications.readWorld?.[expression.package]?.state || query.state);
            if (!owns(storage,expression.field)) throw new Error('Original component property storage is unavailable');
            validateSchema(expression.schema,storage[expression.field]);
            return structuredClone(storage[expression.field]);
        }
        if (expression.op==='source_actor_member') {
            const reference=evaluate(expression.target,depth+1);
            validateSchema(expression.target_schema,reference);
            if (reference===null) {
                if (expression.schema?.type==='StructProperty')
                    throw Error('Unverified original struct ClearValue for a null Actor context');
                validateSchema(expression.schema,expression.schema?.default);
                trace.push({source_index:sourceIndex,op:'warning',message:'Accessed None: original Actor property default'});
                return structuredClone(expression.schema.default);
            }
            const value=readSourceActorMember(notifications.native,reference,expression,
                {instance,queries:notifications.queries,world:notifications.readWorld});
            validateSchema(expression.schema,value);
            return value;
        }
        if (expression.op === 'native_object_valid') {
            const reference=evaluate(expression.target,depth+1);
            validateSchema(expression.schema,reference);
            return sourceObjectValid(notifications.native,reference,expression.schema);
        }
        if (expression.op === 'native_text_format') {
            const identity=['/Script/Engine','KismetTextLibrary','Format'];
            const argumentSchema=nativeFormatArgumentSchema();
            if (JSON.stringify(expression.identity)!==JSON.stringify(identity) || expression.dispatch!=='EX_CallMath'
                || expression.source_text_locale_only!==true || expression.visual_1to1_certified!==false
                || JSON.stringify(expression.argument_schema)!==JSON.stringify(argumentSchema)
                || JSON.stringify(expression.pattern_schema)!==JSON.stringify({type:'TextProperty',default:{history:'empty',text:'',flags:0}}))
                throw new Error('Unsupported original KismetTextLibrary.Format source contract');
            const pattern=evaluate(expression.pattern,depth+1), arguments_=evaluate(expression.arguments,depth+1);
            validateSchema(expression.pattern_schema,pattern);
            validateSchema({type:'ArrayProperty',element:argumentSchema,default:[]},arguments_);
            const value=sourceFormatText(pattern,arguments_);
            trace.push({source_index:sourceIndex,op:'native_text_format',source_text_locale_only:true,
                visual_1to1_certified:false,argument_count:arguments_.length});
            return value;
        }
        if (expression.op === 'component_call') {
            const target=notifications.world?.[expression.package],callee=target?.functions?.[expression.function];
            if (!target || !callee || target.native?.source_package !== expression.package
                || target.native.world_context_bound !== true
                || callee.source_owner_index !== target.native.source_owner_index
                || callee.source_export_index !== expression.export_index
                || expression.class_export_index !== target.native.source_owner_index
                || !expression.receiver_schema || expression.receiver_schema.type !== 'ObjectProperty'
                || expression.receiver_schema.reference_kind !== 'runtime_component'
                || JSON.stringify(expression.receiver_schema.class) !== JSON.stringify([expression.package,expression.class_object])
                || expression.transactional_outputs_safe !== true
                || !Array.isArray(expression.bindings) || !Array.isArray(callee.parameters)
                || !Array.isArray(callee.source_parameters)
                || expression.bindings.length !== callee.source_parameters.length)
                throw new Error('Original component mutation requires a bound transactional receiver and source signature');
            const reference = evaluate(expression.target,depth+1);
            if (reference === null) {
                trace.push({source_index:sourceIndex,op:'warning',message:'Accessed None: original component call skipped'});
                return null;
            }
            validateSchema(expression.receiver_schema,reference);
            const descriptor=sourceQueryReceiver(notifications.native,reference,expression.package,expression.class_object);
            if (target.source_sha256 !== descriptor.source_sha256
                || target.native.source_owner_index !== descriptor.class_export_index
                || callee.source_owner_index !== descriptor.class_export_index)
                throw new Error('Original component mutation source owner differs');
            sourceQueryReceiver(target.native,reference,expression.package,expression.class_object);
            const args = Object.create(null), targets=[], seenTargets=new Set();
            for (const [index,binding] of expression.bindings.entries()) {
                const parameter=callee.source_parameters[index];
                if (!safeField(binding.parameter) || owns(args,binding.parameter)
                    || parameter.name !== binding.parameter || parameter.mode !== binding.mode
                    || JSON.stringify(parameter.schema) !== JSON.stringify(binding.schema))
                    throw new Error('Original component mutation parameter schema differs');
                if (binding.mode === 'input') {
                    const declared=callee.parameters.find(item=>item.name === binding.parameter);
                    if (!declared || JSON.stringify(declared.schema) !== JSON.stringify(binding.schema))
                        throw new Error('Original component mutation input signature differs');
                    const value=evaluate(binding.value,depth+1);validateSchema(binding.schema,value);
                    args[binding.parameter]=structuredClone(value);
                } else if (binding.mode === 'output' && binding.target?.op === 'get'
                    && safeField(binding.target.field) && ['self','local','persistent'].includes(binding.target.scope)) {
                    const targetOwner=ownerFor(binding.target.scope,binding.target.frame);
                    const key=JSON.stringify([binding.target.scope,binding.target.frame ?? null,binding.target.field]);
                    if (seenTargets.has(key)) throw new Error('Aliased original component output targets are unsupported');
                    seenTargets.add(key);
                    if (!owns(targetOwner,binding.target.field)) throw new Error('Missing original component output storage');
                    const targetSchema=schemaFor(binding.target);
                    const targetType=binding.target.scope === 'persistent'
                        ? program.persistent_types?.[binding.target.frame]?.[binding.target.field]
                        : program.field_types?.[binding.target.scope]?.[binding.target.field];
                    if (targetSchema ? JSON.stringify(targetSchema) !== JSON.stringify(binding.schema)
                        : targetType !== binding.schema.type)
                        throw new Error('Original component output target type differs');
                    const initial=structuredClone(targetOwner[binding.target.field]);
                    validateSchema(binding.schema,initial);args[binding.parameter]=initial;targets.push(binding);
                } else throw new Error('Unsupported transactional component argument');
            }
            const nested = runBlueprint(callee,target.state,args,target.functions,budget,callDepth+1,target.frames,tables,
                {...notifications,bindings:target.bindings,signatures:target.signatures || {},native:target.native,
                    queryStack:[...notifications.queryStack,expression.package]});
            for (const binding of targets) {
                if (!owns(nested.outputs,binding.parameter)) throw new Error(`Missing component call output: ${binding.parameter}`);
                validateSchema(binding.schema,nested.outputs[binding.parameter]);
                checkType(binding.target.scope,binding.target.field,nested.outputs[binding.parameter],binding.target.frame);
            }
            for (const binding of targets)
                ownerFor(binding.target.scope,binding.target.frame)[binding.target.field]=structuredClone(nested.outputs[binding.parameter]);
            trace.push({source_index:sourceIndex,op:'component_call',package:expression.package,function:expression.function,
                outputs:structuredClone(nested.outputs),trace:nested.trace});
            return nested.value;
        }
        if (expression.op === 'component_query') {
            const query=owns(notifications.queries,expression.package) ? notifications.queries[expression.package] : null;
            const callee=query?.functions?.[expression.function];
            if (!query || !callee || callee.source_owner_index !== expression.class_export_index
                || callee.source_export_index !== expression.export_index
                || !['EX_VirtualFunction','EX_LocalVirtualFunction','EX_FinalFunction','EX_LocalFinalFunction'].includes(expression.dispatch)
                || !Number.isSafeInteger(expression.context_offset) || expression.context_offset <= 0
                || !expression.receiver_schema || expression.receiver_schema.type !== 'ObjectProperty'
                || expression.receiver_schema.reference_kind !== 'runtime_component'
                || JSON.stringify(expression.receiver_schema.class) !== JSON.stringify([expression.package,expression.class_object])
                || !Array.isArray(callee.self_writes) || callee.self_writes.length
                || Object.keys(callee.persistent_types || {}).length
                || !Array.isArray(callee.source_parameters) || !Array.isArray(expression.bindings)
                || expression.bindings.length !== callee.source_parameters.length)
                throw new Error('Untranslated or effectful original component query');
            const reference=evaluate(expression.target,depth+1);
            if (reference === null) {
                // These admitted calls have out parameters and no return value:
                // UE skips the call and leaves caller-owned out storage intact.
                trace.push({source_index:sourceIndex,op:'warning',message:'Accessed None: original component query skipped'});
                return null;
            }
            validateSchema(expression.receiver_schema,reference);
            const descriptor=sourceQueryReceiver(notifications.native,reference,expression.package,expression.class_object);
            if (notifications.queryStack.includes(expression.package)) throw new Error('Reentrant original component queries require shared active storage');
            if (query.source_sha256 !== descriptor.source_sha256
                || callee.source_owner_index !== descriptor.class_export_index)
                throw new Error('Original component query source owner differs');
            const args=Object.create(null),targets=[],seenTargets=new Set();
            for (const [index,binding] of expression.bindings.entries()) {
                const parameter=callee.source_parameters[index];
                if (!safeField(binding.parameter) || owns(args,binding.parameter)
                    || parameter.name !== binding.parameter || parameter.mode !== binding.mode
                    || JSON.stringify(parameter.schema) !== JSON.stringify(binding.schema))
                    throw new Error('Invalid component query parameter signature');
                if (binding.mode === 'input') {
                    const declared=callee.parameters?.find(item=>item.name === binding.parameter);
                    if (!declared || JSON.stringify(declared.schema) !== JSON.stringify(binding.schema))
                        throw new Error('Original component query input schema differs');
                    const value=evaluate(binding.value,depth+1);validateSchema(binding.schema,value);
                    args[binding.parameter]=structuredClone(value);
                } else if (binding.mode === 'output' && binding.target?.op === 'get' && safeField(binding.target.field)
                    && ['local','self','persistent'].includes(binding.target.scope)) {
                    const owner=ownerFor(binding.target.scope,binding.target.frame);
                    const targetSchema=schemaFor(binding.target);
                    const targetType=binding.target.scope === 'persistent'
                        ? program.persistent_types?.[binding.target.frame]?.[binding.target.field]
                        : program.field_types?.[binding.target.scope]?.[binding.target.field];
                    if (targetSchema ? JSON.stringify(targetSchema) !== JSON.stringify(binding.schema)
                        : targetType !== binding.schema.type)
                        throw new Error('Original component query output target type differs');
                    const key=JSON.stringify([binding.target.scope,binding.target.frame ?? null,binding.target.field]);
                    if (seenTargets.has(key)) throw new Error('Aliased original component query outputs are unsupported');
                    seenTargets.add(key);
                    if (!owns(owner,binding.target.field)) throw new Error('Missing original component query output storage');
                    validateSchema(binding.schema,owner[binding.target.field]);
                    args[binding.parameter]=structuredClone(owner[binding.target.field]);
                    targets.push(binding);
                } else throw new Error('Unsupported original component query binding');
            }
            const queryState = notifications.readWorld?.[expression.package]?.state || query.state;
            const nested=runBlueprint(callee,queryState,args,query.functions,budget,callDepth+1,{},tables,
                {bindings:{},signatures:query.signatures || {},native:structuredClone(query.native),queries:notifications.queries,readWorld:notifications.readWorld,
                    queryStack:[...notifications.queryStack,expression.package],effects:[]});
            if (nested.effects.length || Object.keys(nested.frames).length || JSON.stringify(nested.state) !== JSON.stringify(queryState))
                throw new Error('Original component query attempted a state change or effect');
            for (const binding of targets) {
                if (!owns(nested.outputs,binding.parameter)) throw new Error('Missing original component query output');
                validateSchema(binding.schema,nested.outputs[binding.parameter]);
                checkType(binding.target.scope,binding.target.field,nested.outputs[binding.parameter],binding.target.frame);
            }
            for (const binding of targets) ownerFor(binding.target.scope,binding.target.frame)[binding.target.field]=structuredClone(nested.outputs[binding.parameter]);
            trace.push({source_index:sourceIndex,op:'component_query',package:expression.package,function:expression.function,
                outputs:structuredClone(nested.outputs),trace:nested.trace});
            return nested.value;
        }
        if (expression.op === 'native_get_owner') {
            if (expression.source_owner_index !== program.source_owner_index) throw new Error('Original component class differs');
            return sourceComponentOwner(notifications.native, expression.source_owner_index);
        }
        if (expression.op === 'native_actor_role') {
            const method=expression.identity?.[2];
            const expected=method==='HasAuthority' ? 'BoolProperty' : 'ByteProperty';
            if (!['HasAuthority','GetLocalRole','GetRemoteRole'].includes(method)
                || JSON.stringify(expression.identity)!==JSON.stringify(['/Script/Engine','Actor',method])
                || expression.dispatch!=='EX_FinalFunction' || expression.return_type!==expected
                || expression.actor_schema?.reference_kind!=='runtime_actor')
                throw new Error('Unsupported original Actor role query contract');
            const reference=evaluate(expression.target,depth+1);
            validateSchema(expression.actor_schema,reference);
            if (reference===null) {
                trace.push({source_index:sourceIndex,op:'warning',message:'Accessed None: Actor role query context skipped'});
                return method==='HasAuthority' ? false : 0;
            }
            return sourceActorRole(notifications.native,reference,expression.actor_schema,method);
        }
        if (expression.op === 'native_component_get_owner') {
            const identity=['/Script/Engine','ActorComponent','GetOwner'];
            if (JSON.stringify(expression.identity)!==JSON.stringify(identity) || expression.dispatch!=='EX_FinalFunction'
                || expression.component_schema?.type!=='ObjectProperty'
                || expression.component_schema?.reference_kind!=='runtime_native_component'
                || !Array.isArray(expression.component_schema.class))
                throw new Error('Unsupported original ActorComponent.GetOwner contract');
            const reference=evaluate(expression.target,depth+1);
            validateSchema(expression.component_schema,reference);
            if (reference === null) {
                trace.push({source_index:sourceIndex,op:'warning',message:'Accessed None: ActorComponent.GetOwner context skipped'});
                return null;
            }
            const owner=sourceNativeComponentOwner(notifications.native,reference,expression.component_schema);
            trace.push({source_index:sourceIndex,op:'native_component_get_owner',actor_id:owner.actor_id});
            return owner;
        }
        if (expression.op === 'native_force_net_update') {
            const reference = evaluate(expression.target, depth+1);
            if (reference === null) {
                trace.push({source_index:sourceIndex,op:'warning',message:'Accessed None: Actor.ForceNetUpdate context skipped'});
                return null;
            }
            emit(sourceForceNetUpdate(notifications.native, reference));
            return null;
        }
        if (expression.op === 'native_context_call') {
            const contract=nativeContextContracts.get(JSON.stringify(expression.identity));
            if (!contract || expression.dispatch !== contract.dispatch
                || !(contract.receivers || [contract.receiver]).some(receiver =>
                    JSON.stringify(expression.receiver_schema?.class) === JSON.stringify(receiver))
                || expression.receiver_schema?.type !== 'ObjectProperty'
                || expression.receiver_schema?.reference_kind !== 'runtime_native_component'
                || expression.receiver_schema?.default !== null
                || expression.adapter_family_present !== false
                || !Number.isSafeInteger(expression.context_offset) || expression.context_offset <= 0
                || !Array.isArray(expression.parameter_schemas)
                || JSON.stringify(expression.parameter_schemas) !== JSON.stringify(contract.parameters)
                || !Array.isArray(expression.parameters) || expression.parameters.length !== contract.parameters.length)
                throw new Error('Unsupported original native context call contract');
            const reference=evaluate(expression.receiver,depth+1);
            validateSchema(expression.receiver_schema,reference);
            if (reference === null) {
                trace.push({source_index:sourceIndex,op:'warning',message:'Accessed None: original native component call skipped'});
                return null;
            }
            sourceObjectValid(notifications.native,reference,expression.receiver_schema);
            const arguments_=[];
            for (const [index,parameter] of expression.parameters.entries()) {
                const schema=contract.parameters[index];
                const declared=parameter?.op === 'get' ? schemaFor(parameter)
                    : parameter?.op === 'typed_literal' ? parameter.schema : null;
                if (declared && JSON.stringify(declared) !== JSON.stringify(schema)
                    || !declared && parameter?.op !== 'constant'
                    || parameter?.op === 'constant' && !validPrimitive(schema.type,parameter.value))
                    throw new Error('Original native context parameter schema differs');
                const value=evaluate(parameter,depth+1);
                validateSchema(schema,value);
                arguments_.push(structuredClone(value));
            }
            const request={op:'native_context_call',identity:[...contract.identity],dispatch:contract.dispatch,
                context_offset:expression.context_offset,receiver:structuredClone(reference),
                receiver_schema:structuredClone(expression.receiver_schema),
                parameter_schemas:structuredClone(contract.parameters),arguments:arguments_,
                adapter_family_present:false,adapter_required:true};
            emit(request);
            trace.push({source_index:sourceIndex,...structuredClone(request)});
            return null;
        }
        if (expression.op === 'native_self') {
            const context=notifications.native;
            if (expression.source_owner_index !== program.source_owner_index
                || context?.source_owner_index !== program.source_owner_index
                || typeof context.source_package !== 'string') throw new Error('Original Blueprint self reference is unavailable');
            return {kind:'source_self',source_package:context.source_package,
                source_owner_index:program.source_owner_index,declared_class:expression.class || null};
        }
        if (expression.op === 'native_widget_effect') {
            const identity=expression.identity;
            const method=expression.method;
            const supported=method === 'SetFocus'
                && JSON.stringify(identity) === JSON.stringify(['/Script/UMG','Widget','SetFocus'])
                && expression.dispatch === 'EX_FinalFunction'
                || method === 'SetVisibility'
                && JSON.stringify(identity) === JSON.stringify(['/Script/UMG','Widget','SetVisibility'])
                && expression.dispatch === 'EX_VirtualFunction'
                && expression.parameter?.schema?.type === 'ByteProperty'
                || method === 'SetBrushFromMaterial'
                && JSON.stringify(identity) === JSON.stringify(['/Script/UMG','Border','SetBrushFromMaterial'])
                && expression.dispatch === 'EX_FinalFunction'
                && expression.parameter?.schema?.type === 'ObjectProperty'
                && expression.parameter?.schema?.class?.[0] === '/Script/Engine'
                && ['Material','MaterialInstance','MaterialInstanceConstant','MaterialInterface']
                    .includes(expression.parameter?.schema?.class?.[1])
                || method === 'SetPercent'
                && JSON.stringify(identity) === JSON.stringify(['/Script/UMG','ProgressBar','SetPercent'])
                && expression.dispatch === 'EX_FinalFunction'
                && expression.parameter?.schema?.type === 'FloatProperty'
                || method === 'SetBrushFromTexture'
                && JSON.stringify(identity) === JSON.stringify(['/Script/UMG','Image','SetBrushFromTexture'])
                && expression.dispatch === 'EX_VirtualFunction'
                && Array.isArray(expression.parameters) && expression.parameters.length === 2
                && Array.isArray(expression.parameter_schemas) && expression.parameter_schemas.length === 2
                && expression.parameter_schemas[0]?.type === 'ObjectProperty'
                && JSON.stringify(expression.parameter_schemas[0]?.class) === JSON.stringify(['/Script/Engine','Texture2D'])
                && expression.parameter_schemas[1]?.type === 'BoolProperty'
                || method === 'SetText'
                && JSON.stringify(identity) === JSON.stringify(['/Script/UMG','TextBlock','SetText'])
                && ['EX_FinalFunction','EX_VirtualFunction'].includes(expression.dispatch)
                && expression.parameter?.schema?.type === 'TextProperty'
                || method === 'SetColorAndOpacity'
                && JSON.stringify(identity) === JSON.stringify(['/Script/UMG','TextBlock','SetColorAndOpacity'])
                && expression.dispatch === 'EX_FinalFunction'
                && expression.parameter?.schema?.type === 'StructProperty'
                && JSON.stringify(expression.parameter?.schema) === JSON.stringify(nativeSlateColorSchema())
                || method === 'SetBrushFromTexture'
                && JSON.stringify(identity) === JSON.stringify(['/Script/UMG','Image','SetBrushFromTexture'])
                && expression.dispatch === 'EX_VirtualFunction'
                && expression.receiver_schema?.class?.[1] === 'Image'
                && expression.parameter?.schema?.type === 'ObjectProperty'
                && JSON.stringify(expression.parameter?.schema?.class) === JSON.stringify(['/Script/Engine','Texture2D'])
                && expression.options?.bMatchSize?.schema?.type === 'BoolProperty';
            if (!supported || expression.source_owner_index !== program.source_owner_index
                || expression.source_binding_required !== true
                || expression.visual_1to1_certified !== false || !expression.receiver_schema
                || expression.receiver_schema.reference_kind !== 'runtime_native_widget'
                || !safeField(expression.receiver_field) || expression.receiver?.op !== 'get'
                || expression.receiver.scope !== 'self'
                || expression.receiver.field !== expression.receiver_field)
                throw new Error('Unsupported or unbound original UMG context contract');
            const reference=evaluate(expression.receiver,depth+1);
            if (reference === null) {
                trace.push({source_index:sourceIndex,op:'warning',message:'Accessed None: UMG widget call skipped'});
                return null;
            }
            validateSchema(expression.receiver_schema,reference);
            const widgets=notifications.native?.widgets;
            const descriptor=widgets && Object.hasOwn(widgets,expression.receiver_field)
                ? widgets[expression.receiver_field] : null;
            if (!descriptor || descriptor.binding_complete !== true
                || descriptor.source_owner_index !== expression.source_owner_index
                || descriptor.source_field !== expression.receiver_field
                || JSON.stringify(descriptor.declared_class) !== JSON.stringify(expression.receiver_schema.class)
                || JSON.stringify(descriptor.reference) !== JSON.stringify(reference)
                || reference.source_package !== notifications.native.source_package
                || reference.source_field !== expression.receiver_field
                || reference.source_owner_index !== expression.source_owner_index)
                throw new Error('Original widget source binding is unavailable or foreign');
            const values=[];
            if (method === 'SetBrushFromTexture') {
                const brushParameters=Array.isArray(expression.parameters) ? expression.parameters
                    : [expression.parameter.value,expression.options.bMatchSize.value];
                const brushSchemas=Array.isArray(expression.parameter_schemas) ? expression.parameter_schemas
                    : [expression.parameter.schema,expression.options.bMatchSize.schema];
                for (const [index,parameter] of brushParameters.entries()) {
                    const value=evaluate(parameter,depth+1);
                    validateSchema(brushSchemas[index],value);
                    values.push(structuredClone(value));
                }
                if (typeof values[1] !== 'boolean') throw new Error('Unverified original UMG brush size flag');
            } else if (method !== 'SetFocus') {
                const value=evaluate(expression.parameter.value,depth+1);
                validateSchema(expression.parameter.schema,value);
                values.push(structuredClone(value));
            }
            if (method === 'SetVisibility' && (!Number.isInteger(values[0]) || values[0] < 0 || values[0] > 4))
                throw new Error('Unverified original ESlateVisibility value');
            if (method === 'SetColorAndOpacity' && values[0]?.ColorUseRule !== 0)
                throw new Error('Original FSlateColor style binding is unavailable outside UseColor_Specified');
            const effect={op:'native_widget_effect',identity:[...identity],dispatch:expression.dispatch,
                widget_id:reference.widget_id,source_field:expression.receiver_field,
                source_package:reference.source_package,source_owner_index:reference.source_owner_index,
                method,...(method === 'SetBrushFromTexture' ? {parameters:values,parameter:values[0],match_size:values[1]}
                    : method === 'SetFocus' ? {} : {parameter:values[0]})};
            emit(effect);
            trace.push({source_index:sourceIndex,...structuredClone(effect)});
            return null;
        }
        if (expression.op === 'native_audio_vfx') {
            const contract=nativeAudioVfxContracts.get(JSON.stringify(expression.identity));
            if (!contract || expression.dispatch !== contract.dispatch || !Array.isArray(expression.parameters)
                || expression.parameters.length !== contract.parameters.length
                || JSON.stringify(expression.parameter_schemas) !== JSON.stringify(contract.parameters)
                || JSON.stringify(expression.return_schema) !== JSON.stringify(contract.result)
                || (contract.receiver ? expression.receiver === null || !expression.receiver_schema
                    || !nativeAudioVfxIsA(expression.receiver_schema.class,contract.receiver)
                    : expression.receiver !== null || expression.receiver_schema !== null))
                throw new Error('Unsupported original native audio/VFX call contract');
            let receiver=null;
            if (contract.receiver) {
                receiver=evaluate(expression.receiver,depth+1);
                if (receiver === null) {
                    trace.push({source_index:sourceIndex,op:'warning',message:'Accessed None: native audio/VFX context skipped'});
                    return null;
                }
                validateNativeAudioVfxArgument(expression.receiver_schema,nativeObject(contract.receiver),
                    receiver,program,notifications);
            }
            const values=[], argumentSchemas=[];
            for (const [index,parameter] of expression.parameters.entries()) {
                const expected=contract.parameters[index];
                if (JSON.stringify(parameter.contract) !== JSON.stringify(expected) || !parameter.schema || !parameter.value)
                    throw new Error('Original native audio/VFX parameter contract differs');
                const value=evaluate(parameter.value,depth+1);
                validateNativeAudioVfxArgument(parameter.schema,expected,value,program,notifications);
                values.push(structuredClone(value)); argumentSchemas.push(structuredClone(parameter.schema));
            }
            const request={op:'native_audio_vfx',identity:[...expression.identity],dispatch:expression.dispatch,
                receiver:structuredClone(receiver),receiver_schema:structuredClone(expression.receiver_schema),
                parameter_schemas:structuredClone(contract.parameters),argument_schemas:argumentSchemas,
                arguments:values};
            emit(request); trace.push({source_index:sourceIndex,...structuredClone(request)});
            // Spawn functions return native object pointers. Without a bound
            // native adapter, keep the ordered request but never invent a handle.
            return contract.result ? undefined : null;
        }
        if (expression.op === 'primitive_cast') {
            const types = expression.conversion === 3 ? ['DoubleProperty', 'FloatProperty']
                : expression.conversion === 4 ? ['FloatProperty', 'DoubleProperty'] : null;
            if (!types || expression.source_type !== types[0] || expression.return_type !== types[1])
                throw new Error('Unsupported original primitive cast contract');
            const source = expression.value;
            const declared = source?.op === 'get'
                ? (source.scope === 'persistent' ? program.persistent_types?.[source.frame]?.[source.field]
                    : program.field_types?.[source.scope]?.[source.field])
                : source?.op === 'typed_literal' ? source.schema?.type : null;
            if (declared && declared !== types[0]) throw new Error('Original primitive cast source type differs');
            const value = evaluate(expression.value, depth+1);
            if (typeof value !== 'number' || !Number.isFinite(value))
                throw new Error('Invalid original primitive cast input');
            // Stored UE FloatProperties are IEEE754 float32, even though the
            // host represents them with JavaScript Number.
            const result = Math.fround(value);
            if (!Number.isFinite(result)) throw new Error('Non-finite original primitive cast result');
            return result;
        }
        if (expression.op === 'typed_literal') {
            validateSchema(expression.schema, expression.value);
            return structuredClone(expression.value);
        }
        if (expression.op === 'struct_literal') {
            if (expression.schema?.type !== 'StructProperty' || !expression.fields
                || Object.keys(expression.fields).length !== Object.keys(expression.schema.fields).length)
                throw new Error('Invalid original struct literal');
            const value = Object.create(null);
            for (const field of expression.schema.member_order || []) {
                if (!safeField(field) || !owns(expression.fields, field)) throw new Error('Invalid original struct member order');
                value[field] = evaluate(expression.fields[field], depth+1);
            }
            validateSchema(expression.schema, value);
            return structuredClone(value);
        }
        if (expression.op === 'mark_dirty') {
            if (!safeField(expression.field)
                || !validPrimitive('IntProperty', expression.source_rep_index) || expression.source_rep_index < 0)
                throw new Error('Invalid original dirty-property witness');
            emit({op: 'mark_dirty', field: expression.field, source_rep_index: expression.source_rep_index});
            return null;
        }
        if (expression.op === 'broadcast') {
            const signature = notifications.signatures[expression.delegate];
            if (!safeField(expression.delegate) || !signature || signature.export_index !== expression.export_index
                || JSON.stringify(signature.parameters) !== JSON.stringify(expression.parameters)
                || !Array.isArray(expression.args) || expression.args.length !== signature.parameters.length)
                throw new Error('Unresolved original multicast declaration');
            const values = expression.args.map((arg, index) => {
                const value = evaluate(arg, depth+1); validateSchema(signature.parameters[index].schema, value);
                return structuredClone(value);
            });
            const listeners = notifications.bindings[expression.delegate] || [];
            if (!Array.isArray(listeners)) throw new Error('Invalid original delegate listener list');
            emit({op: 'broadcast', delegate: expression.delegate,
                parameters: Object.fromEntries(signature.parameters.map((param, index) => [param.name, values[index]])), listeners: listeners.length});
            // UE copies the multicast invocation list and visits it in insertion order.
            for (const listener of [...listeners]) {
                const callee = owns(functions, listener.function) ? functions[listener.function] : null;
                if (!callee || callee.source_export_index !== listener.export_index || callee.source_owner_index !== program.source_owner_index
                    || !Array.isArray(callee.parameters) || callee.parameters.length !== signature.parameters.length
                    || callee.parameters.some((param, index) => !safeField(param.name) || !param.schema
                        || JSON.stringify(param.schema) !== JSON.stringify(signature.parameters[index].schema)))
                    throw new Error('Untranslated or incompatible original delegate handler');
                const args = Object.fromEntries(callee.parameters.map((param, index) => [param.name, values[index]]));
                const nested = runBlueprint(callee, instance, args, functions, budget, callDepth+1, frames, tables, notifications);
                Object.assign(instance, nested.state);
                trace.push({source_index: sourceIndex, op: 'delegate_handler', delegate: expression.delegate, function: listener.function, trace: nested.trace});
            }
            return null;
        }
        if (expression.op === 'table_get') {
            const reference = evaluate(expression.table, depth+1), row = evaluate(expression.row, depth+1), target = expression.target;
            const table = reference && owns(tables, reference.asset) ? tables[reference.asset] : null;
            if (JSON.stringify(expression.identity) !== JSON.stringify([
                '/Script/Engine', 'DataTableFunctionLibrary', 'GetDataTableRowFromName'])
                || expression.dispatch !== 'EX_FinalFunction'
                || JSON.stringify(expression.row_schema) !== JSON.stringify({type:'NameProperty',default:'None'}))
                throw new Error('Original data table call identity, dispatch or row type differs');
            if (!reference || JSON.stringify(reference.declared_class) !== JSON.stringify(['/Script/Engine','DataTable'])
                || !table || target?.op !== 'get' || target.scope !== 'local' || !safeField(target.field)
                || JSON.stringify(table.schema) !== JSON.stringify(program.schemas?.local?.[target.field])
                || table.schema?.source !== expression.row_source
                || typeof row !== 'string' || !row || /[^\x01-\x7f]/.test(row)) throw new Error('Unmigrated or incompatible original data table');
            validateSchema(expression.row_schema, row);
            const key = Object.keys(table.rows).find(name => name.toUpperCase() === row.toUpperCase());
            if (key !== undefined) {
                const value = table.rows[key]; validateSchema(program.schemas.local[target.field], value);
                locals[target.field] = structuredClone(value);
            }
            // UE leaves OutRow unchanged when the row is absent.
            trace.push({source_index: sourceIndex, op: 'table_get', table: reference.asset, row, found: key !== undefined});
            return key !== undefined;
        }
        if (expression.op === 'array_length') {
            if (expression.identity !== undefined) requireArrayIdentity(expression, 'Array_Length', false);
            const array = evaluate(expression.array, depth+1);
            if (!Array.isArray(array)) throw new Error('Invalid source Array_Length');
            return array.length;
        }
        if (expression.op === 'array_is_not_empty' || expression.op === 'array_last_index') {
            const name = expression.op === 'array_is_not_empty' ? 'Array_IsNotEmpty' : 'Array_LastIndex';
            requireArrayIdentity(expression, name);
            const schema = schemaFor(expression.array), array = evaluate(expression.array, depth+1);
            if (schema?.type !== 'ArrayProperty' || !Array.isArray(array)) throw new Error('Invalid typed source ' + name);
            return expression.op === 'array_is_not_empty' ? array.length !== 0 : array.length - 1;
        }
        if (expression.op === 'array_contains' || expression.op === 'array_find') {
            const name = expression.op === 'array_contains' ? 'Array_Contains' : 'Array_Find';
            requireArrayIdentity(expression, name);
            const schema = schemaFor(expression.array), array = evaluate(expression.array, depth+1);
            if (schema?.type !== 'ArrayProperty' || JSON.stringify(schema.element) !== JSON.stringify(expression.element)
                || !Array.isArray(array)) throw new Error('Unresolved typed source ' + name);
            const item = evaluate(expression.item, depth+1); validateSchema(expression.element, item);
            const index = array.findIndex(value => sourceArrayValueEqual(expression.element, value, item));
            return expression.op === 'array_contains' ? index !== -1 : index;
        }
        if (expression.op === 'array_valid') {
            if (expression.identity !== undefined) requireArrayIdentity(expression, 'Array_IsValidIndex', false);
            const array = evaluate(expression.array, depth+1), index = evaluate(expression.index, depth+1);
            if (!Array.isArray(array) || !validPrimitive('IntProperty', index)) throw new Error('Invalid source Array_IsValidIndex');
            return index >= 0 && index < array.length;
        }
        if (expression.op === 'array_mutate') {
            const target = expression.target;
            if (target?.op !== 'get' || !safeField(target.field) || !['local', 'self', 'persistent'].includes(target.scope)
                || schemaFor(target)?.type !== 'ArrayProperty'
                || JSON.stringify(schemaFor(target)?.element) !== JSON.stringify(expression.element))
                throw new Error('Unresolved typed source array mutation');
            const array = evaluate(target, depth+1), operation = expression.operation;
            if (!Array.isArray(array)) throw new Error('Invalid source array mutation');
            const identityOperations = ['Array_AddUnique', 'Array_RemoveItem', 'Array_Insert', 'Array_Reverse'];
            if (identityOperations.includes(operation)) requireArrayIdentity(expression, operation);
            else if (expression.identity !== undefined) requireArrayIdentity(expression, operation, false);
            const index = expression.index ? evaluate(expression.index, depth+1) : null;
            if (['Array_Set', 'Array_Remove', 'Array_Insert'].includes(operation) && !validPrimitive('IntProperty', index)) throw new Error('Invalid source array index');
            const value = expression.value ? structuredClone(evaluate(expression.value, depth+1)) : null;
            let result = null, inBounds = index >= 0 && index < array.length;
            if (operation === 'Array_Set') {
                const resize = evaluate(expression.resize, depth+1);
                if (typeof resize !== 'boolean') throw new Error('Invalid source Array_Set resize flag');
                validateSchema(expression.element, value);
                if (resize && index >= 0) {
                    if (index >= 100000) throw new Error('Source array resource limit exceeded');
                    while (array.length <= index) { validateSchema(expression.element, expression.element.default); array.push(structuredClone(expression.element.default)); }
                    inBounds = true;
                }
                if (inBounds) array[index] = value;
            } else if (operation === 'Array_Remove') { if (inBounds) array.splice(index, 1); }
            else if (operation === 'Array_Clear') array.length = 0;
            else if (operation === 'Array_Add') {
                validateSchema(expression.element, value);
                if (array.length >= 100000) throw new Error('Source array resource limit exceeded');
                result = array.length; array.push(value);
            } else if (operation === 'Array_AddUnique') {
                validateSchema(expression.element, value);
                const found = array.findIndex(item => sourceArrayValueEqual(expression.element, item, value));
                if (found === -1) {
                    if (array.length >= 100000) throw new Error('Source array resource limit exceeded');
                    result = array.length; array.push(value);
                } else result = -1;
                inBounds = found !== -1;
            } else if (operation === 'Array_RemoveItem') {
                validateSchema(expression.element, value);
                let write = 0, removed = false;
                for (const item of array) {
                    if (sourceArrayValueEqual(expression.element, item, value)) removed = true;
                    else array[write++] = item;
                }
                array.length = write; result = removed; inBounds = removed;
            } else if (operation === 'Array_Insert') {
                validateSchema(expression.element, value);
                if (index < 0 || index > array.length) throw new RangeError('Original Array_Insert index is outside the valid range');
                if (array.length >= 100000) throw new Error('Source array resource limit exceeded');
                array.splice(index, 0, value); inBounds = true;
            } else if (operation === 'Array_Reverse') {
                array.reverse(); inBounds = true;
            } else if (operation === 'Array_Append') {
                if (!Array.isArray(value) || array.length+value.length > 100000) throw new Error('Invalid or oversized source array append');
                for (const item of value) validateSchema(expression.element, item);
                // Copying the source first also preserves UE's self-append behavior.
                for (const item of value) array.push(item);
            } else throw new Error('Unsupported source array mutation');
            if (['Array_Set', 'Array_Remove'].includes(operation) && !inBounds)
                trace.push({source_index: sourceIndex, op: 'warning', message: operation+' index out of bounds; source array unchanged'});
            trace.push({source_index: sourceIndex, op: 'array_mutate', operation, scope: target.scope, field: target.field,
                index, in_bounds: inBounds, length: array.length});
            return result;
        }
        if (expression.op === 'array_literal') {
            const target = expression.target, schema = schemaFor(target);
            if (target?.op !== 'get' || !safeField(target.field) || !['local', 'self', 'persistent'].includes(target.scope)
                || schema?.type !== 'ArrayProperty' || JSON.stringify(schema.element) !== JSON.stringify(expression.element)
                || !Array.isArray(expression.elements) || expression.elements.length > 100000)
                throw new Error('Unresolved typed source array literal');
            let array = evaluate(target, depth+1);
            if (!Array.isArray(array)) throw new Error('Invalid source SetArray destination');
            array.length = 0;
            const canMutate = value => value && typeof value === 'object' &&
                (['call','array_literal','array_mutate','array_add','array_set'].includes(value.op) || Object.values(value).some(canMutate));
            for (const item of expression.elements) {
                // execSetArray constructs each slot BEFORE evaluating its source.
                validateSchema(schema.element, schema.element.default);
                const index = array.length; array.push(structuredClone(schema.element.default));
                const before = canMutate(item) ? JSON.stringify(array) : null;
                const value = structuredClone(evaluate(item, depth+1));
                // A transactional nested call may replace the state with a copy.
                // Reacquire that copy; actual reentrant destination writes fail.
                array = evaluate(target, depth+1);
                if (array.length !== index+1 || before !== null && JSON.stringify(array) !== before)
                    throw new Error('Reentrant SetArray destination mutation is unsupported');
                validateSchema(schema.element, value); array[index] = value;
            }
            trace.push({source_index:sourceIndex,op:'array_literal',scope:target.scope,field:target.field,length:array.length});
            return null;
        }
        if (expression.op === 'array_add') {
            if (expression.identity !== undefined) requireArrayIdentity(expression, 'Array_Add', false);
            const target = expression.target;
            if (target?.op !== 'get' || target.scope !== 'self' || !safeField(target.field))
                throw new Error('Unsupported Array_Add source destination');
            const schema = program.schemas?.self?.[target.field];
            if (!schema || schema.type !== 'ArrayProperty'
                || JSON.stringify(schema.element) !== JSON.stringify(expression.element))
                throw new Error('Unresolved original Array_Add element schema');
            const array = evaluate(target, depth+1);
            const item = evaluate(expression.item, depth+1);
            if (!Array.isArray(array)) throw new Error('Invalid original Array_Add source array');
            validateSchema(schema.element, item);
            if (array.length >= 100000) throw new Error('Array_Add exceeds maximum verified array size');
            const index = array.length;
            array.push(structuredClone(item));
            checkType('self', target.field, array);
            trace.push({source_index: sourceIndex, op: 'array_add', index, value: structuredClone(item)});
            return index;
        }
        if (expression.op === 'array_set') {
            if (expression.identity !== undefined) requireArrayIdentity(expression, 'Array_Set', false);
            const target = expression.target;
            if (target?.op !== 'get' || target.scope !== 'self' || !safeField(target.field))
                throw new Error('Unsupported Array_Set source destination');
            const schema = program.schemas?.self?.[target.field];
            if (!schema || schema.type !== 'ArrayProperty'
                || JSON.stringify(schema.element) !== JSON.stringify(expression.element))
                throw new Error('Unresolved original Array_Set element schema');
            const array = evaluate(target, depth+1);
            const index = evaluate(expression.index, depth+1);
            const item = evaluate(expression.item, depth+1);
            const sizeToFit = evaluate(expression.size_to_fit, depth+1);
            if (!Array.isArray(array) || !validPrimitive('IntProperty', index) || typeof sizeToFit !== 'boolean')
                throw new Error('Invalid original Array_Set index or size-to-fit flag');
            validateSchema(schema.element, item);
            // UE Set Array Elem writes only a valid nonnegative index. When
            // Size to Fit is true, zero-initialize skipped elements using the
            // *declared source element constructor*, never invented values.
            if (index < 0 || (index >= array.length && !sizeToFit)) {
                trace.push({source_index: sourceIndex, op: 'array_set', index, applied: false, size_to_fit: sizeToFit});
                return null;
            }
            if (index >= 100000) throw new Error('Array_Set exceeds maximum verified array size');
            if (index >= array.length) {
                validateSchema(schema.element, schema.element.default);
                while (array.length <= index) array.push(structuredClone(schema.element.default));
            }
            array[index] = structuredClone(item);
            checkType('self', target.field, array);
            trace.push({source_index: sourceIndex, op: 'array_set', index, applied: true, size_to_fit: sizeToFit});
            return null;
        }
        if (expression.op === 'array_get') {
            if (expression.identity !== undefined) requireArrayIdentity(expression, 'Array_Get', false);
            const array = evaluate(expression.array, depth+1), index = evaluate(expression.index, depth+1), target = expression.target;
            if (!Array.isArray(array) || !validPrimitive('IntProperty', index) || target?.op !== 'get'
                || !safeField(target.field) || !['local', 'self', 'persistent'].includes(target.scope)) throw new Error('Invalid source Array_Get');
            const inBounds = index >= 0 && index < array.length;
            const value = inBounds ? array[index] : expression.element?.default;
            validateSchema(expression.element, value); checkType(target.scope, target.field, value, target.frame);
            ownerFor(target.scope, target.frame)[target.field] = structuredClone(value);
            if (!inBounds) trace.push({source_index: sourceIndex, op: 'warning', message: 'Array_Get index out of bounds; original source type default restored'});
            trace.push({source_index: sourceIndex, op: 'array_get', index, in_bounds: inBounds, value: structuredClone(value)});
            return null;
        }
        if (expression.op === 'call') {
            const callee = owns(functions, expression.function) ? functions[expression.function] : null;
            if (!callee || callee.source_export_index !== expression.export_index
                || callee.source_owner_index !== program.source_owner_index || !Array.isArray(expression.bindings))
                throw new Error(`Untranslated or mismatched function dependency: ${expression.function}`);
            const args = Object.create(null), targets = [];
            for (const binding of expression.bindings) {
                if (!safeField(binding.parameter) || owns(args, binding.parameter)) throw new Error('Invalid call parameter');
                if (binding.mode === 'input') args[binding.parameter] = structuredClone(evaluate(binding.value, depth+1));
                else if (binding.mode === 'output' && binding.target?.op === 'get' && safeField(binding.target.field)
                    && ['self', 'local', 'persistent'].includes(binding.target.scope)) {
                    const owner = ownerFor(binding.target.scope, binding.target.frame);
                    if (owns(owner, binding.target.field)) args[binding.parameter] = structuredClone(owner[binding.target.field]);
                    targets.push(binding);
                } else throw new Error('Unsupported call argument');
            }
            const nested = runBlueprint(callee, instance, args, functions, budget, callDepth + 1, frames, tables, notifications);
            for (const binding of targets) {
                if (!owns(nested.outputs, binding.parameter)) throw new Error(`Missing call output: ${binding.parameter}`);
                checkType(binding.target.scope, binding.target.field, nested.outputs[binding.parameter], binding.target.frame);
            }
            Object.assign(instance, nested.state);
            for (const binding of targets) {
                const owner = ownerFor(binding.target.scope, binding.target.frame);
                owner[binding.target.field] = structuredClone(nested.outputs[binding.parameter]);
            }
            trace.push({source_index: sourceIndex, op: 'call', function: expression.function, outputs: nested.outputs, trace: nested.trace});
            return nested.value;
        }
        if (expression.op === 'math_outputs') {
            const outputNames=expression.name === 'BreakVector' ? ['X','Y','Z']
                : expression.name === 'BreakVector2D' ? ['X','Y']
                : expression.name === 'BreakRotator' ? ['Roll','Pitch','Yaw']
                : expression.name === 'BreakTransform' ? ['Location','Rotation','Scale'] : null;
            const nativeOutputs=expression.name === 'BreakTransform' ? ['Vector','Rotator','Vector'] : null;
            if (!outputNames || JSON.stringify(expression.components) !== JSON.stringify(outputNames)
                || !Array.isArray(expression.args) || expression.args.length !== 1
                || !Array.isArray(expression.targets) || expression.targets.length !== outputNames.length)
                throw new Error('Unsupported original native math output call');
            requireNativeMathStruct(expression.args[0],expression.name === 'BreakVector' ? 'Vector'
                : expression.name === 'BreakVector2D' ? 'Vector2D'
                : expression.name === 'BreakRotator' ? 'Rotator' : 'Transform');
            const values=expression.args.map(argument=>evaluate(argument,depth+1));
            const components=evaluateNativeMath(expression.name,values);
            const writes=expression.targets.map((target,index)=>{
                const expectedType=nativeOutputs ? 'StructProperty' : ['BreakVector','BreakVector2D'].includes(expression.name)
                    ? 'DoubleProperty' : 'FloatProperty';
                if (target?.op !== 'get' || !safeField(target.field) || target.type !== expectedType
                    || !['local','self','persistent'].includes(target.scope)
                    || target.scope === 'persistent' && !Number.isSafeInteger(target.frame))
                    throw new Error('Invalid original native math output target');
                const declaredType=target.scope === 'persistent'
                    ? program.persistent_types?.[target.frame]?.[target.field]
                    : program.field_types?.[target.scope]?.[target.field];
                if (declaredType !== expectedType) throw new Error('Original native math output type differs');
                if (nativeOutputs && (target.native !== nativeOutputs[index]
                    || JSON.stringify(schemaFor(target)) !== JSON.stringify(nativeStruct(nativeOutputs[index]))))
                    throw new Error('Original BreakTransform output struct differs');
                const value=components[outputNames[index]];
                checkType(target.scope,target.field,value,target.frame);
                return {target,value};
            });
            for (const {target,value} of writes) ownerFor(target.scope,target.frame)[target.field]=value;
            trace.push({source_index:sourceIndex,op:'math_outputs',name:expression.name,
                targets:writes.map(({target,value})=>({scope:target.scope,
                    ...(target.frame !== undefined ? {frame:target.frame} : {}),field:target.field,value}))});
            return null;
        }
        if (expression.op === 'math' && Array.isArray(expression.args)) {
            const structContracts={
                Add_VectorVector:['Vector','Vector'],Subtract_VectorVector:['Vector','Vector'],
                Multiply_VectorVector:['Vector','Vector'],Vector_DistanceSquared:['Vector','Vector'],BreakVector:['Vector'],
                BreakRotator:['Rotator'],MakeTransform:['Vector','Rotator','Vector'],
                Conv_RotatorToVector:['Rotator'],GetUpVector:['Rotator'],Conv_VectorToRotator:['Vector'],
                GreaterGreater_VectorRotator:['Vector','Rotator'],ProjectPointOnToPlane:['Vector','Vector','Vector'],
                NotEqual_VectorVector:['Vector','Vector',null],SelectTransform:['Transform','Transform',null],
                BreakVector2D:['Vector2D'],RInterpTo:['Rotator','Rotator',null,null],
                EqualEqual_KeyKey:['Key','Key']};
            const expected=structContracts[expression.name];
            if (expected) {
                if (expected.length !== expression.args.length) throw new Error('Invalid original native math parameter count');
                expression.args.forEach((argument,index)=>{if (expected[index]) requireNativeMathStruct(argument,expected[index]);});
            }
            const args = expression.args.map(arg => evaluate(arg, depth+1));
            const value = evaluateNativeMath(expression.name, args, message => trace.push({source_index: sourceIndex, op: 'warning', message}));
            if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite native math result is unsupported');
            return value;
        }
        if (expression.op === 'native_call') {
            // Only source-witnessed pure Kismet string conversions are valid.
            // No generic method dispatch, JS coercion, locale-dependent text or
            // guessed native API fallbacks.
            const contracts = {
                Concat_StrStr: {args: ['StrProperty', 'StrProperty'], result: 'StrProperty'},
                Conv_NameToString: {args: ['NameProperty'], result: 'StrProperty'},
                Conv_IntToString: {args: ['IntProperty'], result: 'StrProperty'},
                Len: {args: ['StrProperty'], result: 'IntProperty'},
                Contains: {args: ['StrProperty', 'StrProperty', 'BoolProperty', 'BoolProperty'], result: 'BoolProperty'},
                MakeLiteralDouble: {args:['DoubleProperty'], result:'DoubleProperty', library:'KismetSystemLibrary'},
                MakeLiteralString: {args:['StrProperty'], result:'StrProperty', library:'KismetSystemLibrary'},
                MakeLiteralText: {args:['TextProperty'], result:'TextProperty', library:'KismetSystemLibrary'},
                Conv_StringToText: {args:['StrProperty'], result:'TextProperty', library:'KismetTextLibrary'},
                Conv_NameToText: {args:['NameProperty'], result:'TextProperty', library:'KismetTextLibrary'},
                Conv_TextToString: {args:['TextProperty'], result:'StrProperty', library:'KismetTextLibrary'}
            };
            const name = expression.identity?.[2];
            const contract = Object.hasOwn(contracts, name) ? contracts[name] : null;
            if (!contract
                || JSON.stringify(expression.identity) !== JSON.stringify(['/Script/Engine', contract.library || 'KismetStringLibrary', name])
                || JSON.stringify(expression.parameter_types) !== JSON.stringify(contract.args)
                || expression.return_type !== contract.result || !Array.isArray(expression.args)
                || expression.args.length !== contract.args.length)
                throw new Error('Unsupported original native object call');
            const values = expression.args.map((argument, index) => {
                let sourceType = null;
                if (argument?.op === 'typed_literal') sourceType = argument.schema?.type;
                else if (argument?.op === 'native_call') sourceType = argument.return_type;
                else if (argument?.op === 'get') {
                    const schemaType = schemaFor(argument)?.type;
                    const declaredType = argument.scope === 'persistent' ? program.persistent_types?.[argument.frame]?.[argument.field]
                        : program.field_types?.[argument.scope]?.[argument.field];
                    if (schemaType && declaredType && schemaType !== declaredType)
                        throw new Error('Original native object parameter schema differs');
                    sourceType = schemaType || declaredType || null;
                }
                if (sourceType !== contract.args[index])
                    throw new Error('Original native object parameter type differs');
                const value = evaluate(argument, depth+1);
                if (sourceType === 'IntProperty') {
                    if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647)
                        throw new Error('Invalid original native object int32 parameter');
                } else if (sourceType === 'BoolProperty') {
                    if (typeof value !== 'boolean')
                        throw new Error('Invalid original native object bool parameter');
                } else if (sourceType === 'DoubleProperty') {
                    if (typeof value !== 'number' || !Number.isFinite(value))
                        throw new Error('Invalid original native double parameter');
                } else if (sourceType === 'TextProperty') {
                    validateSchema({type:'TextProperty'},value);
                } else if (typeof value !== 'string') {
                    throw new Error('Invalid original native object string parameter');
                }
                return value;
            });
            if (name === 'MakeLiteralDouble' || name === 'MakeLiteralString' || name === 'MakeLiteralText') return values[0];
            if (name === 'Len') return values[0].length; // Unreal FString.Len counts UTF-16 TCHAR units.
            if (name === 'Contains') {
                if (values[2] !== false || values[3] !== false)
                    throw new Error('Original FString.Contains search mode is not supported');
                // Fail closed for Unicode case folds that do not necessarily
                // match Unreal FChar::ToLower; ASCII bone names are source-backed.
                if (!/^[\x00-\x7f]*$/.test(values[0]) || !/^[\x00-\x7f]*$/.test(values[1]))
                    throw new Error('Original Unicode FString.Contains case folding requires Unreal parity');
                return values[0].toLowerCase().includes(values[1].toLowerCase());
            }
            if (name === 'Concat_StrStr') return values[0] + values[1];
            if (name === 'Conv_IntToString') return String(values[0]);
            if (name === 'Conv_StringToText' || name === 'Conv_NameToText')
                return {history:values[0] === '' ? 'empty' : 'invariant', text:values[0], flags:2};
            if (name === 'Conv_TextToString') return values[0].text;
            return values[0]; // Original FName spelling preserved by the source value.
        }
        if (expression.op === 'constant') {
            const value = expression.value;
            if (value !== null && !['string', 'boolean', 'number'].includes(typeof value)
                || typeof value === 'number' && !Number.isFinite(value)) throw new Error('Invalid Blueprint constant');
            return value;
        }
        if (expression.op === 'member' && safeField(expression.field)) {
            const structure = evaluate(expression.value, depth+1);
            if (!structure || typeof structure !== 'object' || Array.isArray(structure) || !owns(structure, expression.field))
                throw new Error(`Missing source struct member: ${expression.field}`);
            return structuredClone(structure[expression.field]);
        }
        if (expression.op === 'get' && safeField(expression.field) && ['self', 'local', 'persistent'].includes(expression.scope)) {
            const owner = ownerFor(expression.scope, expression.frame);
            if (!owns(owner, expression.field)) throw new Error(`Missing ${expression.scope} property: ${expression.field}`);
            checkType(expression.scope, expression.field, owner[expression.field], expression.frame);
            return owner[expression.field];
        }
        throw new Error(`Unsupported Blueprint expression: ${expression.op}`);
    };
    const ownerFor = (scope, frame) => {
        if (scope === 'self') return instance;
        if (scope === 'local') return locals;
        if (scope !== 'persistent' || !owns(program.persistent_types || {}, frame) || !owns(frames, frame))
            throw new Error('Unresolved persistent frame');
        return frames[frame];
    };
    const callDepth = depth;
    const flow = [];
    const jumpTarget = target => {
        if (!Number.isInteger(target) || target < 0 || target >= program.steps.length) throw new Error('Invalid Blueprint jump target');
        return target;
    };
    let pc = 0;
    while (pc < program.steps.length) {
        if (--budget.remaining < 0) throw new Error('Blueprint instruction budget exceeded');
        const step = program.steps[pc++];
        sourceIndex = step.source_index;
        if (step.op === 'nop') continue;
        if (step.op === 'push_flow') {
            if (flow.length >= 32) throw new Error('Blueprint flow stack exceeded');
            flow.push(jumpTarget(step.target));
            trace.push({source_index: sourceIndex, op: step.op, target: step.target});
            continue;
        }
        if (step.op === 'pop_flow') {
            let take = true;
            if (step.value) {
                const condition = evaluate(step.value);
                if (typeof condition !== 'boolean') throw new Error('Blueprint flow condition requires Boolean');
                take = !condition;
            }
            if (take) {
                if (!flow.length) throw new Error('Blueprint empty flow stack');
                pc = jumpTarget(flow.pop());
            }
            trace.push({source_index: sourceIndex, op: step.op, taken: take, target: take ? pc : null});
            continue;
        }
        if (step.op === 'jump_dynamic') {
            const vmOffset = evaluate(step.value);
            const targets = program.source_offset_targets;
            if (!Number.isInteger(vmOffset) || vmOffset < 0 || vmOffset > 2147483647 || !Array.isArray(targets))
                throw new Error('Invalid original Blueprint computed jump offset');
            // Source-authored VM offsets, not array indices: a binary search
            // matches the compiler's exact verified instruction boundaries.
            let low = 0, high = targets.length - 1, targetIndex = null;
            while (low <= high) {
                const mid = (low + high) >>> 1, row = targets[mid];
                if (!Array.isArray(row) || row.length !== 2 || !Number.isInteger(row[0]))
                    throw new Error('Invalid original Blueprint boundary table');
                if (row[0] === vmOffset) { targetIndex = row[1]; break; }
                if (row[0] < vmOffset) low = mid + 1;
                else high = mid - 1;
            }
            if (targetIndex === null)
                throw new Error('Computed Blueprint jump misses an original instruction boundary');
            pc = jumpTarget(targetIndex);
            trace.push({source_index: sourceIndex, op: 'jump_dynamic', target_offset: vmOffset, target: pc});
            continue;
        }
        if (step.op === 'jump' || step.op === 'branch') {
            if (!Number.isInteger(step.target) || step.target < 0 || step.target >= program.steps.length)
                throw new Error('Invalid Blueprint jump target');
            let take = true;
            if (step.op === 'branch') {
                const condition = evaluate(step.value);
                if (typeof condition !== 'boolean') throw new Error('Blueprint branch requires Boolean');
                take = !condition;
            }
            trace.push({source_index: step.source_index, op: step.op, taken: take, target: step.target});
            if (take) pc = step.target;
            continue;
        }
        if (step.op === 'end') throw new Error('Blueprint reached EndOfScript without return');
        if (step.op === 'evaluate') { evaluate(step.value); continue; }
        if (step.op === 'set_actor_member') {
            const target=step.target;
            if (target?.op!=='source_actor_member') throw Error('Invalid original Actor property assignment');
            const reference=evaluate(target.target);
            validateSchema(target.target_schema,reference);
            const value=evaluate(step.value);
            if (step.member_field!==undefined && (target.schema?.type!=='StructProperty'
                ||!safeField(step.member_field)||!owns(target.schema.fields,step.member_field)))
                throw Error('Original Actor struct member assignment schema differs');
            validateSchema(step.member_field===undefined ? target.schema : target.schema.fields[step.member_field],value);
            if (reference===null) {
                trace.push({source_index:sourceIndex,op:'warning',message:'Accessed None: original Actor property assignment skipped'});
                continue;
            }
            const environment={instance,queries:notifications.queries,world:notifications.world};
            const replacement=step.member_field===undefined ? value
                : readSourceActorMember(notifications.native,reference,target,environment);
            if (step.member_field!==undefined) replacement[step.member_field]=structuredClone(value);
            validateSchema(target.schema,replacement);
            writeSourceActorMember(notifications.native,reference,target,replacement,environment);
            trace.push({source_index:sourceIndex,op:'set_actor_member',package:target.package,field:target.field,value:structuredClone(value)});
            continue;
        }
        if (step.op === 'set_member') {
            const target = step.target;
            if (target?.op !== 'get' || !safeField(step.field)) throw new Error('Invalid source struct assignment');
            const schema = schemaFor(target);
            if (!schema || schema.type !== 'StructProperty' || !owns(schema.fields, step.field)
                || schema.fields[step.field].type !== step.member_type) throw new Error('Unresolved source struct assignment type');
            const value = evaluate(step.value); validateSchema(schema.fields[step.field], value);
            // An original nested call can assign this same source property.
            // Reacquire its storage after evaluating the RHS, as its VM address
            // still denotes that property rather than an obsolete JS object.
            const structure = evaluate(target); validateSchema(schema,structure);
            structure[step.field] = structuredClone(value);
            trace.push({source_index: sourceIndex, op: 'set_member', scope: target.scope, field: target.field, member: step.field, value: structuredClone(value)});
            continue;
        }
        if (step.op === 'set' && safeField(step.field)) {
            const scope = step.scope || 'local';
            if (!['self', 'local', 'persistent'].includes(scope)) throw new Error('Invalid assignment scope');
            const value = evaluate(step.value);
            if (step.boolean && typeof value !== 'boolean') throw new Error(`Expected Boolean: ${step.field}`);
            checkType(scope, step.field, value, step.frame);
            if (scope === 'self') {
                if (!owns(instance, step.field)) throw new Error(`Missing self property: ${step.field}`);
                instance[step.field] = structuredClone(value);
            } else ownerFor(scope, step.frame)[step.field] = structuredClone(value);
            trace.push({source_index: step.source_index, op: 'set', scope, field: step.field, value: structuredClone(value)});
        } else if (step.op === 'return') {
            const value = evaluate(step.value);
            if (value === undefined) throw new Error('Unresolved native audio/VFX return value');
            const outputs = Object.create(null);
            for (const field of program.output_fields) {
                if (!owns(locals, field)) throw new Error(`Missing output property: ${field}`);
                outputs[field] = structuredClone(locals[field]);
            }
            trace.push({source_index: step.source_index, op: 'return', value: structuredClone(value)});
            // Nested calls share a staged effect journal. Copying its entire
            // growing prefix at every return is quadratic for source loops.
            return {value: structuredClone(value), outputs, state: instance, frames, trace,
                effects:callDepth === 0 ? structuredClone(notifications.effects) : notifications.effects};
        } else throw new Error(`Unsupported Blueprint instruction: ${step.op}`);
    }
    throw new Error('Blueprint returned no result');
}
