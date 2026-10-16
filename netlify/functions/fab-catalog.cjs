'use strict';

/**
 * Public-only Fab catalog bridge for Netlify Functions.
 * No Epic credentials, no account actions, no unrestricted proxy, no downloads.
 * Fab's public marketplace endpoints are not versioned APIs; upstream may change.
 */
const SOURCE = 'https://www.fab.com/i/listings/search';
const CACHE_SECONDS = 180;
function json(statusCode, data, cache = false) {
    return {statusCode,headers:{
        'Content-Type':'application/json; charset=utf-8',
        'Cache-Control':cache?'public, max-age=60, s-maxage='+CACHE_SECONDS:'no-store',
        'X-Content-Type-Options':'nosniff',
        'Access-Control-Allow-Origin':'https://my-test-site3.netlify.app'
    },body:JSON.stringify(data)};
}
function bounded(value, max) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function thumbnail(item) {
    const previews = item.thumbnails || item.media || item.images || [];
    const candidates = Array.isArray(previews) ? previews : [previews];
    for(const candidate of candidates) {
        const t = candidate?.url || candidate?.src || candidate?.image_url ||
            candidate?.imageUrl || candidate?.images?.[0]?.url || candidate?.thumbnail?.url || '';
        if(typeof t === 'string' && t.startsWith('https://')) return t;
    }
    const t = item.thumbnail?.url || item.thumbnail_url || item.image_url || '';
    return typeof t === 'string' && t.startsWith('https://') ? t : '';
}
function normalizeListing(item) {
    if (!item || typeof item !== 'object') return null;
    const uid = item.uid || item.id || item.listing_id || '';
    if (typeof uid !== 'string' || !/^[a-f0-9-]{16,64}$/i.test(uid)) return null;
    const rawPublisher = item.publisher || item.seller || {};
    const publisher = typeof rawPublisher === 'string' ? rawPublisher :
        (rawPublisher.display_name || rawPublisher.name || item.publisher_name || 'Fab');
    const license = item.license?.name || item.license_type || (Array.isArray(item.licenses) ?
        item.licenses.map(x => x.name || x.slug).filter(Boolean).join(', ') : '') || 'Controlla la licenza su Fab';
    return {
        uid, title: bounded(item.title || item.name, 160) || 'Modello Fab',
        thumbnail_url: thumbnail(item),
        publisher_name: bounded(publisher, 100),
        license_type: bounded(license, 140),
        owned: null,  // Never claim ownership without a real Epic session.
        source: 'public-fab-catalog',
        face_count: Number(item.face_count) || 0,
        animation_count: Number(item.animation_count) || 0
    };
}
async function searchPublicFab(query, fetcher = fetch) {
    const url = new URL(SOURCE);
    url.searchParams.set('q',query);
    url.searchParams.set('currency','USD');
    url.searchParams.set('count','24');
    const res = await fetcher(url.href,{method:'GET',redirect:'follow',
        headers:{'Accept':'application/json','User-Agent':'SketchbookAI/1.0 (Fab catalog, public discovery)'},
        signal:AbortSignal.timeout(12000)});
    if(!res.ok) {
        const error = new Error('Il catalogo Fab non è raggiungibile ('+res.status+').');
        error.status = res.status; throw error;
    }
    const body = await res.text();
    if(body.length > 2500000) throw new Error('Risposta Fab troppo grande.');
    let parsed;
    try {parsed=JSON.parse(body)}catch{throw new Error('Fab ha cambiato il formato della risposta.');}
    const raw = Array.isArray(parsed.results) ? parsed.results :
        Array.isArray(parsed?.data?.results) ? parsed.data.results : null;
    if (!raw) throw new Error('Formato ricerca Fab non riconosciuto.');
    return { results:raw.slice(0,24).map(normalizeListing).filter(Boolean), source:'public-fab-catalog',
        authenticated:false, downloadable:false };
}
async function handler(event) {
    if (event.httpMethod !== 'GET') return json(405,{error:'Metodo non consentito.'});
    const operation = event.queryStringParameters?.operation || 'status';
    if(operation === 'status') return json(200,{bridge:true, mode:'public-search-only',
        connected:false, downloadable:false, login:'Epic authentication is not configured for the cloud backend.'});
    if(operation !== 'search') return json(404,{error:'Operazione non disponibile.'});
    const q = event.queryStringParameters?.q?.trim() || '';
    if (q.length < 2 || q.length > 100 || /[\x00-\x1F]/.test(q)) return json(400,{error:'Inserisci una ricerca Fab da 2 a 100 caratteri.'});
    try {
        const data = await searchPublicFab(q);
        return json(200,data,true);
    } catch (error) {
        console.error('Fab catalog bridge:', error.status || error.name);
        return json(502,{error:'Ricerca Fab temporaneamente non disponibile. '+error.message});
    }
}
module.exports={handler,normalizeListing,searchPublicFab,thumbnail};
