(function (root) {
    const API = 'https://api.sketchfab.com/v3/';
    // Selected author-credited CC BY models hosted by the user's existing
    // Sketchbook Render bridge. NEVER expose the server-side token in HTML.
    // General Sketchfab downloads still use the end user's own authorization.
    const CURATED_BRIDGE='https://sketchbook-fab-bridge.onrender.com/sketchfab/cars/';
    const CURATED_DOWNLOADS=Object.freeze({
        '5a9007d569a846548dbf352877550c4e':'bmw',
        '52a66c41cfcd4f999fb1b1c49bf24d70':'ferrari',
        'e83da098149746b5a3ba6f1661645b09':'ferrari288',
        '4350c8de8fd740f582bd316c1fa010ff':'lamborghini'
    });
    // These four licensed models are available through a controlled Render
    // catalog. The private Sketchfab API credential NEVER reaches the browser.
    const CURATED_MODELS=Object.freeze([
        {id:'ferrari288',uid:'e83da098149746b5a3ba6f1661645b09',name:'Ferrari 288 GTO',
          brand:'Ferrari',author:'Randomness',license:'CC BY',
          viewerUrl:'https://sketchfab.com/3d-models/ferrari-288-gto-e83da098149746b5a3ba6f1661645b09'},
        {id:'ferrari',uid:'52a66c41cfcd4f999fb1b1c49bf24d70',name:'Ferrari F40',
          brand:'Ferrari',author:'Black Snow',license:'CC BY',
          viewerUrl:'https://sketchfab.com/3d-models/ferrari-f40-52a66c41cfcd4f999fb1b1c49bf24d70'},
        {id:'bmw',uid:'5a9007d569a846548dbf352877550c4e',name:'BMW M4 G82',
          brand:'BMW',author:'Rosemarin',license:'CC BY',
          viewerUrl:'https://sketchfab.com/3d-models/bmw-m4-g82-5a9007d569a846548dbf352877550c4e'},
        {id:'lamborghini',uid:'4350c8de8fd740f582bd316c1fa010ff',name:'Lamborghini Aventador SV',
          brand:'Lamborghini',author:'SDC PERFORMANCE',license:'CC BY',
          viewerUrl:'https://sketchfab.com/3d-models/free-lamborghini-aventador-sv-tunnig-by-sdc-4350c8de8fd740f582bd316c1fa010ff'}
    ]);
    function modelCard(model){
        return {uid:model.uid,name:model.name,user:{displayName:model.author},
            license:{label:model.license},viewerUrl:model.viewerUrl,
            bridgeCurated:true,faceCount:0};
    }

    // Browser-persistent, origin-scoped credentials: never bundled or committed.
    class SketchfabCredentialStore {
        constructor(factory = root.indexedDB) { this.factory = factory; }
        open() {
            return new Promise((resolve, reject) => {
                if (!this.factory) return reject(new Error('Salvataggio persistente non disponibile in questo browser.'));
                const request = this.factory.open('sketchbook-private-settings', 1);
                request.onupgradeneeded = () => request.result.createObjectStore('credentials');
                request.onerror = () => reject(new Error('Impossibile aprire l’archivio privato del browser.'));
                request.onsuccess = () => resolve(request.result);
            });
        }
        async operation(mode, action) {
            const db = await this.open();
            try {
                return await new Promise((resolve, reject) => {
                    const transaction = db.transaction('credentials', mode);
                    let value;
                    transaction.oncomplete = () => resolve(value);
                    transaction.onerror = () => reject(new Error('Il browser non ha potuto salvare le credenziali.'));
                    transaction.onabort = () => reject(new Error('Salvataggio credenziali interrotto.'));
                    const request = action(transaction.objectStore('credentials'));
                    if (request) request.onsuccess = () => { value = request.result; };
                });
            } finally { db.close(); }
        }
        async load() { return (await this.operation('readonly', store => store.get('sketchfab'))) || []; }
        async save(tokens) { await this.operation('readwrite', store => store.put(tokens, 'sketchfab')); }
        async clear() { await this.operation('readwrite', store => store.delete('sketchfab')); }
    }
    function normalizeTokens(input) {
        let data = input;
        if (typeof data === 'string') {
            data = data.trim();
            if (data.startsWith('{') || data.startsWith('[')) {
                try { data = JSON.parse(data); } catch { throw new Error('Il JSON dei token non è valido.'); }
            } else data = data.split(/[\s,;]+/).filter(Boolean);
        }
        let values = [];
        if (Array.isArray(data)) values = data;
        else if (data && typeof data === 'object') {
            values = [...(typeof data.token === 'string' ? [data.token] : []),
                ...(Array.isArray(data.tokens) ? data.tokens : [])];
        }
        return [...new Set(values.filter(value => typeof value === 'string' && /^[a-zA-Z0-9_-]{20,200}$/.test(value)))].slice(0, 50);
    }
    class SketchfabClient {
        constructor(fetcher = (...args) => fetch(...args)) {
            this.fetcher = fetcher;
            this._manualToken = '';
            this._localTokens = [];
            this._savedTokens = [];
        }
        get token() { return this._manualToken || this._localTokens[0] || this._savedTokens[0] || ''; }
        set token(value) { this._manualToken = typeof value === 'string' ? value.trim() : ''; }
        get credentialCount() { return this._manualToken ? 1 : (this._localTokens.length || this._savedTokens.length); }
        get hasSavedTokens() { return this._savedTokens.length > 0; }
        curatedModels(query='') {
            const needle=String(query||'').toLowerCase().trim();
            if(!needle)return CURATED_MODELS.map(modelCard);
            return CURATED_MODELS.filter(model=>
                [model.name,model.brand,model.author].some(v=>v.toLowerCase().includes(needle))||
                (needle.includes('ferrari')&&model.brand==='Ferrari')||
                (needle.includes('car')||needle.includes('auto')||needle.includes('vehicle'))
            ).map(modelCard);
        }
        async serverAccess() {
            try {
                const response=await this.fetcher('https://sketchbook-fab-bridge.onrender.com/sketchfab/showcase',
                    {signal:AbortSignal.timeout(15000),cache:'no-store'});
                if(!response.ok)return {configured:false,reason:'HTTP '+response.status,models:[]};
                const data=await response.json();
                const catalog=Array.isArray(data.vehicles)?data.vehicles:[];
                const known=catalog.filter(x=>CURATED_MODELS.some(m=>m.id===x.id&&m.uid===x.uid));
                return {configured:data.configured===true&&known.length>0,models:known.map(x=>x.id),
                    count:known.length};
            }catch(error){return {configured:false,reason:error?.message||'Bridge non raggiungibile',models:[]};}
        }
        async loadSavedTokens(store = new SketchfabCredentialStore()) {
            this._savedTokens = normalizeTokens(await store.load());
            return this._savedTokens.length > 0;
        }
        async saveSavedTokens(value, store = new SketchfabCredentialStore()) {
            const tokens = normalizeTokens(value);
            if (!tokens.length) throw new Error('Inserisci almeno un token valido oppure un JSON con token/tokens.');
            await store.save(tokens);
            this._savedTokens = tokens;
            this._manualToken = '';
            return tokens.length;
        }
        async clearSavedTokens(store = new SketchfabCredentialStore()) {
            await store.clear();
            this._savedTokens = [];
            this._manualToken = '';
        }
        async loadLocalToken(location = globalThis.location) {
            // A local-only file: it is never committed, persisted in the scene or fetched on public hosts.
            if (!['localhost', '127.0.0.1', '[::1]'].includes(location?.hostname)) return false;
            try {
                const response = await this.fetcher('/.local/sketchfab.json', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
                if (!response.ok) return false;
                const data = await response.json();
                const valid = normalizeTokens(data);
                if (!valid.length) return false;
                if (!this._manualToken) this._localTokens = valid;
                return !this._manualToken;
            } catch { return false; }
        }
        async request(url, signal) {
            const parsed = new URL(url);
            if (parsed.origin !== 'https://api.sketchfab.com' || !parsed.pathname.startsWith('/v3/')) throw new Error('URL Sketchfab non valida.');
            const pool = this._manualToken ? [this._manualToken] :
                [...new Set([...this._localTokens, ...this._savedTokens])];
            if (!pool.length) pool.push('');
            let unauthorized = false;
            for (const credential of pool) {
                // Invalid (401) credentials can be replaced with the next one the user
                // explicitly configured. Do not rotate 403 permissions or 429 rate limits.
                for (let attempt = 0; attempt < 3; attempt++) {
                    let response;
                    try {
                        response = await this.fetcher(parsed.href, {
                            signal: signal || AbortSignal.timeout(30000),
                            headers: credential ? { Authorization: `Token ${credential}` } : {}
                        });
                    } catch (error) {
                        if (error?.name === 'AbortError' || error?.name === 'TimeoutError' ||
                            attempt === 2 || !(error instanceof TypeError)) throw error;
                        await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
                        continue;
                    }
                    if (response.status === 401 && credential && !this._manualToken) {
                        unauthorized = true;
                        this._localTokens = this._localTokens.filter(t => t !== credential);
                        this._savedTokens = this._savedTokens.filter(t => t !== credential);
                        break;
                    }
                    if ([502,503,504].includes(response.status) && attempt < 2) {
                        await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
                        continue;
                    }
                    if (!response.ok) {
                        const messages = {
                            401: 'Inserisci un token Sketchfab valido.',
                            403: 'Questo account non può scaricare il modello.',
                            429: 'Limite Sketchfab raggiunto. Riprova tra poco.'
                        };
                        throw new Error(messages[response.status] || `Sketchfab: errore HTTP ${response.status}.`);
                    }
                    return response.json();
                }
            }
            if (unauthorized) throw new Error('Nessun token Sketchfab valido: tutte le credenziali salvate sono state rifiutate (HTTP 401). Aggiorna la configurazione.');
            throw new Error('Sketchfab non raggiungibile.');
        }
        search(query, { animated = false, maxFaces = '', next = null, signal } = {}) {
            const aliases = { albero: 'tree', alberi: 'trees', macchina: 'car', auto: 'car', macchine: 'cars', edificio: 'building', edifici: 'buildings', lampione: 'street lamp', strada: 'road' };
            const term = query.trim();
            const params = new URLSearchParams({ type: 'models', q: aliases[term.toLowerCase()] || term, downloadable: 'true', count: '24' });
            if (animated) params.set('animated', 'true');
            if (maxFaces) params.set('max_face_count', String(maxFaces));
            return this.request(next || `${API}search?${params}`, signal);
        }
        canDownloadWithoutBrowserToken(uid) { return Object.hasOwn(CURATED_DOWNLOADS,uid); }
        async download(uid) {
            if (!/^[a-zA-Z0-9_-]+$/.test(uid)) throw new Error('ID Sketchfab non valido.');
            // Curated, attributed CC BY model: bridge uses SKETCHFAB_TOKENS
            // privately on Render, so this particular car requires no form.
            if (this.canDownloadWithoutBrowserToken(uid))
                return CURATED_BRIDGE + CURATED_DOWNLOADS[uid];
            if (!this.token) throw new Error('Questo modello richiede accesso Sketchfab personale. Salva il token JSON oppure collega il tuo account.');
            const data = await this.request(`${API}models/${uid}/download`);
            const download = data.glb || data.gltf;
            if (!download?.url) throw new Error('Sketchfab non offre un file glTF/GLB scaricabile per questo modello.');
            const url = new URL(download.url);
            if (url.protocol !== 'https:') throw new Error('URL di download non valida.');
            return url.href;
        }
    }
    root.SketchfabClient = SketchfabClient;
    root.SketchfabCredentialStore = SketchfabCredentialStore;
    if (typeof module !== 'undefined') module.exports = { SketchfabClient, SketchfabCredentialStore, normalizeTokens };
})(globalThis);
