(function (root) {
    const API = 'https://api.sketchfab.com/v3/';
    class SketchfabClient {
        constructor(fetcher = (...args) => fetch(...args)) {
            this.fetcher = fetcher;
            this._manualToken = '';
            this._localTokens = [];
        }
        get token() { return this._manualToken || this._localTokens[0] || ''; }
        set token(value) { this._manualToken = typeof value === 'string' ? value.trim() : ''; }
        get credentialCount() { return this._manualToken ? 1 : this._localTokens.length; }
        async loadLocalToken(location = globalThis.location) {
            // A local-only file: it is never committed, persisted in the scene or fetched on public hosts.
            if (!['localhost', '127.0.0.1', '[::1]'].includes(location?.hostname)) return false;
            try {
                const response = await this.fetcher('/.local/sketchfab.json', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
                if (!response.ok) return false;
                const data = await response.json();
                const entries = [...(typeof data.token === 'string' ? [data.token] : []),
                    ...(Array.isArray(data.tokens) ? data.tokens : [])];
                const valid = [...new Set(entries.filter(t => typeof t === 'string' && /^[a-zA-Z0-9_-]{20,200}$/.test(t)))].slice(0, 50);
                if (!valid.length) return false;
                if (!this._manualToken) this._localTokens = valid;
                return !this._manualToken;
            } catch { return false; }
        }
        async request(url, signal) {
            const parsed = new URL(url);
            if (parsed.origin !== 'https://api.sketchfab.com' || !parsed.pathname.startsWith('/v3/')) throw new Error('URL Sketchfab non valida.');
            // Pick only from locally configured credentials. Never retry rate limits or ownership errors.
            const credential = this._manualToken || (this._localTokens.length
                ? this._localTokens[Math.floor(Math.random() * this._localTokens.length)] : '');
            const response = await this.fetcher(parsed.href, { signal: signal || AbortSignal.timeout(30000),
                headers: credential ? { Authorization: `Token ${credential}` } : {} });
            if (response.status === 401 && !this._manualToken && credential) {
                this._localTokens = this._localTokens.filter(t => t !== credential);
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
    if (typeof module !== 'undefined') module.exports = { SketchfabClient };
})(globalThis);
