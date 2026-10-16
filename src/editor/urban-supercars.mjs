import {supercarParkingSlots} from './urban-supercar-slots.mjs';

const ENDPOINT='https://sketchbook-fab-bridge.onrender.com';
export const PHOTO_SUPERCARS=Object.freeze([
    {id:'bmw',uid:'5a9007d569a846548dbf352877550c4e',name:'BMW M4 G82',author:'Rosemarin',license:'CC BY',source:'https://sketchfab.com/3d-models/bmw-m4-g82-5a9007d569a846548dbf352877550c4e'},
    {id:'ferrari',uid:'52a66c41cfcd4f999fb1b1c49bf24d70',name:'Ferrari F40',author:'Black Snow',license:'CC BY',source:'https://sketchfab.com/3d-models/ferrari-f40-52a66c41cfcd4f999fb1b1c49bf24d70'},
    {id:'lamborghini',uid:'4350c8de8fd740f582bd316c1fa010ff',name:'Lamborghini Aventador SV',author:'SDC PERFORMANCE',license:'CC BY',source:'https://sketchfab.com/3d-models/free-lamborghini-aventador-sv-tunnig-by-sdc-4350c8de8fd740f582bd316c1fa010ff'}
]);

export async function installPhotorealSupercars(world,editor,{
    onStatus=()=>{}, fetcher=fetch
}={}) {
    if(editor.worldId!=='procedural-city')return {imported:[],existing:[],errors:[],positions:[]};
    const player=world.editorPlayer;
    if(!player)throw Error('Player non ancora creato.');
    const all=PHOTO_SUPERCARS.map(model=>({...model,sceneName:'Sketchfab · '+model.name}));
    const existing=all.filter(model=>editor.items.some(item=>
        item.prefab==='vehicle' && (
            item.name===model.sceneName ||
            editor.assets.get(item.assetId)?.metadata?.uid===model.uid
        )
    ));
    const missing=all.filter(model=>!existing.includes(model));
    const occupied=editor.items.filter(item=>item.prefab==='vehicle'&&
        !all.some(model=>item.name===model.sceneName)).map(item=>item.position);
    const spawn=player.position.toArray();
    const parking=supercarParkingSlots(world.levelRuntime.config,spawn,occupied);
    const imported=[],errors=[],positions=[];
    for(let i=0;i<missing.length;i++) {
        const model=missing[i],slot=parking[i];
        if(!slot){errors.push(model.name+': nessun parcheggio vicino al giocatore');continue;}
        onStatus('Sketchfab HD · '+model.name+' ('+(i+1)+'/'+missing.length+')');
        try {
            // The photoreal Netlify build publishes verified licensed GLBs to
            // same-origin CDN, so heavy models never depend on Render waking up.
            // Development builds may lack these files: in that case use Render.
            let response;
            try {
                const local=await fetcher('build/assets/supercars/'+model.id+'.glb',{
                    signal:AbortSignal.timeout(60000)
                });
                if(local.ok)response=local;
            }catch { /* local asset unavailable; use authenticated backend cache */ }
            if(!response)response=await fetcher(ENDPOINT+'/sketchfab/cars/'+model.id,{
                signal:AbortSignal.timeout(210000)
            });
            if(!response.ok) {
                const payload=await response.json().catch(()=>({}));
                throw Error(payload.error||'HTTP '+response.status);
            }
            if(Number(response.headers.get('content-length')||0)>50*1024*1024)
                throw Error('Modello superiore a 50 MB');
            const bytes=await response.arrayBuffer();
            if(bytes.byteLength<500||bytes.byteLength>50*1024*1024)
                throw Error('GLB non valido o troppo grande');
            const y=world.levelRuntime.groundAt(slot.x,slot.z,spawn[1]+6);
            const position=[slot.x,(Number.isFinite(y)?y:spawn[1]-1)+0.04,slot.z];
            await editor.importBytes(bytes,{
                name:model.sceneName,author:model.author,license:model.license,
                source:model.source,uid:model.uid,provider:'sketchfab',role:'vehicle'
            },{
                nearPlayer:true,interactivePrefab:'vehicle',position,
                rotation:[0,slot.heading,0]
            });
            imported.push(model.name);
            positions.push(position);
        } catch(error) {
            errors.push(model.name+': '+String(error.message||error));
            console.warn('[Urban Photoreal Sketchfab]',model.name,error.message||error);
        }
    }
    const result={imported,existing:existing.map(model=>model.name),errors,positions};
    globalThis.urbanSupercarsStatus=result;
    return result;
}
