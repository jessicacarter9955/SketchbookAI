(function (root) {
    const API = 'https://api.sketchfab.com/v3/';
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
            // Pick only from locally configured credentials. Never retry rate limits or ownership errors.
            const pool = this._localTokens.length ? this._localTokens : this._savedTokens;
            const credential = this._manualToken || (pool.length ? pool[Math.floor(Math.random() * pool.length)] : '');
            const response = await this.fetcher(parsed.href, { signal: signal || AbortSignal.timeout(30000),
                headers: credential ? { Authorization: `Token ${credential}` } : {} });
            if (response.status === 401 && !this._manualToken && credential) {
                if (this._localTokens.length) this._localTokens = this._localTokens.filter(t => t !== credential);
                else this._savedTokens = this._savedTokens.filter(t => t !== credential);
            }
            if (!response.ok) {
                const messages = { 401: 'Inserisci un token Sketchfab valido.', 403: 'Questo account non può scaricare il modello.', 429: 'Limite Sketchfab raggiunto. Riprova tra poco.' };
                throw new Error(messages[response.status] || `Sketchfab: errore HTTP ${response.status}.`);
            }
            return response.json();
        }
        search(query, { animated = false, maxFaces = '', next = null, signal } = {}) {
            const aliases = { albero: 'tree', alberi: 'trees', macchina: 'car', auto: 'car', macchine: 'cars', edificio: 'building', edifici: 'buildings', lampione: 'street lamp', strada: 'road' };
            const term = query.trim();
            const params = new URLSearchParams({ type: 'models', q: aliases[term.toLowerCase()] || term, downloadable: 'true', count: '24' });
            if (animated) params.set('animated', 'true');
            if (maxFaces) params.set('max_face_count', String(maxFaces));
            return this.request(next || `${API}search?${params}`, signal);
        }
        async download(uid) {
            if (!/^[a-zA-Z0-9_-]+$/.test(uid)) throw new Error('ID Sketchfab non valido.');
            if (!this.token) throw new Error('Per scaricare serve il tuo token Sketchfab (resta solo in memoria).');
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
