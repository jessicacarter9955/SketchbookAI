'use strict';
// Only three explicitly attributed CC BY vehicles; never a general Sketchfab API proxy.
const MODELS = Object.freeze({
    bmw: { brand:'BMW',name:'BMW M4 G82',uid:'5a9007d569a846548dbf352877550c4e',
        creator:'Rosemarin',license:'CC BY',url:'https://sketchfab.com/3d-models/bmw-m4-g82-5a9007d569a846548dbf352877550c4e' },
    ferrari: { brand:'Ferrari',name:'Ferrari F40',uid:'52a66c41cfcd4f999fb1b1c49bf24d70',
        creator:'Black Snow',license:'CC BY',url:'https://sketchfab.com/3d-models/ferrari-f40-52a66c41cfcd4f999fb1b1c49bf24d70' },
    ferrari288: { brand:'Ferrari',name:'Ferrari 288 GTO',uid:'e83da098149746b5a3ba6f1661645b09',
        creator:'Randomness',license:'CC BY',url:'https://sketchfab.com/3d-models/ferrari-288-gto-e83da098149746b5a3ba6f1661645b09' },
    lamborghini: { brand:'Lamborghini',name:'Lamborghini Aventador SV',uid:'4350c8de8fd740f582bd316c1fa010ff',
        creator:'SDC PERFORMANCE',license:'CC BY',url:'https://sketchfab.com/3d-models/free-lamborghini-aventador-sv-tunnig-by-sdc-4350c8de8fd740f582bd316c1fa010ff'}
});
const LIMIT = 50 * 1024 * 1024;
const queue = new Map();
const cache = new Map();
const tokens = () => [...new Set((process.env.SKETCHFAB_TOKENS || '')
    .split(/[\s,;]+/).map(s => s.trim()).filter(s => /^[a-zA-Z0-9_-]{20,200}$/.test(s)))];
function catalog() {
    return Object.entries(MODELS).map(([id,model]) => ({ id, ...model }));
}
function configured() { return tokens().length > 0; }
async function getGrant(id, fetcher = fetch) {
    const model = MODELS[id];
    if(!model) throw Object.assign(Error('Auto non disponibile.'),{status:404});
    const credentials = tokens();
    if (!credentials.length) throw Object.assign(Error('Credenziali Sketchfab non configurate sul server.'),{status:503});
    // Deterministic credentials, only replace rejected 401 values. Never retry 403 or 429.
    for (const token of credentials) {
        const res = await fetcher('https://api.sketchfab.com/v3/models/'+model.uid+'/download',{
            headers:{Authorization:'Token '+token,Accept:'application/json'},
            signal:AbortSignal.timeout(30000)
        });
        if(res.status===401) continue;
        if(!res.ok) {
            const error = new Error(res.status === 403 ? 'Sketchfab: download non autorizzato.' :
                res.status === 429 ? 'Sketchfab: limite richieste raggiunto.' : 'Sketchfab: download HTTP '+res.status);
            error.status = res.status; throw error;
        }
        const data = await res.json();
        const url = data.glb?.url || data.gltf?.url;
        if (!url || !url.startsWith('https://')) throw Error('Sketchfab non ha fornito GLB o glTF.');
        return url;
    }
    throw Object.assign(Error('Nessun token Sketchfab valido (HTTP 401).'),{status:401});
}
async function loadAsset(id, fetcher = fetch) {
    const saved = cache.get(id);
    if(saved && Date.now()-saved.time < 15*60*1000) return saved;
    if(queue.has(id)) return queue.get(id);
    const task = (async()=>{
        const granted = await getGrant(id,fetcher);
        // The signed download URL comes from authenticated Sketchfab, never from visitor input.
        const res = await fetcher(granted,{signal:AbortSignal.timeout(65000)});
        if(!res.ok) throw Error('Sketchfab: file remoto non accessibile ('+res.status+').');
        if(Number(res.headers.get('content-length')) > LIMIT) throw Error('Modello sopra il limite di 50 MB.');
        const bytes = Buffer.from(await res.arrayBuffer());
        if (!bytes.length || bytes.length > LIMIT) throw Error('Dimensione modello non supportata.');
        const asset = { bytes, time: Date.now(), model:MODELS[id] };
        cache.set(id,asset);
        while (Array.from(cache.values()).reduce((sum,v)=>sum+v.bytes.length,0)>80*1024*1024)
            cache.delete(cache.keys().next().value);
        return asset;
    })();
    queue.set(id,task);
    try { return await task; } finally { queue.delete(id); }
}
module.exports={MODELS,catalog,configured,loadAsset,getGrant};
