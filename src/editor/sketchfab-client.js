(function (root) {
    const API = 'https://api.sketchfab.com/v3/';
    class SketchfabClient {
        constructor(fetcher = (...args) => fetch(...args)) { this.fetcher = fetcher; this.token = ''; }
        async request(url, signal) {
            const parsed = new URL(url);
            if (parsed.origin !== 'https://api.sketchfab.com' || !parsed.pathname.startsWith('/v3/')) throw new Error('URL Sketchfab non valida.');
            const response = await this.fetcher(parsed.href, { signal: signal || AbortSignal.timeout(30000), headers: this.token ? { Authorization: `Token ${this.token}` } : {} });
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
