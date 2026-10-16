/* Fab marketplace connector: online public catalog + optional authenticated local FabCLI bridge. */
(function (root) {
    class FabClient {
        constructor(fetcher = (...args) => fetch(...args), base = null) {
            this.fetcher = fetcher;
            const host = root.location?.hostname || '';
            const local = !host || ['localhost', '127.0.0.1', '[::1]'].includes(host);
            this.base = base || (local ? 'http://127.0.0.1:8765' : '/.netlify/functions/fab-catalog');
            this.catalogOnly = this.base.startsWith('/.netlify/functions/');
        }
        async request(path, options = {}) {
            const url = this.catalogOnly
                ? this.base + '?operation=' + encodeURIComponent(path.slice(1).split('?')[0]) +
                    (path.includes('?') ? '&' + path.split('?').slice(1).join('?') : '')
                : this.base + path;
            const response = await this.fetcher(url, {
                ...options,
                cache: 'no-store',
                signal: options.signal || AbortSignal.timeout(120000),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || (this.catalogOnly ? 'Catalogo Fab temporaneamente non disponibile.' : 'Servizio Fab non disponibile. Avvia il bridge locale FabCLI.'));
            return data;
        }
        status() { return this.request('/status'); }
        async search(query, { signal } = {}) {
            const data = await this.request('/search?q=' + encodeURIComponent(query.trim()), { signal });
            const results = Array.isArray(data.results) ? data.results : [];
            return {
                next: null,
                results: results.map(item => {
                    const uid = String(item.uid || item.id || item.listing_id || '');
                    const thumbnail = item.thumbnail_url || item.thumbnailUrl || item.image_url || item.imageUrl ||
                        item.thumbnail?.url || item.thumbnail || item.images?.[0]?.url || '';
                    const publisher = item.publisher?.display_name || item.publisher?.name ||
                        item.seller?.name || item.publisher_name || '';
                    return {
                        provider: 'fab', uid,
                        name: item.title || item.name || 'Asset Fab',
                        user: { displayName: publisher },
                        license: { label: item.license?.name || item.license_type || 'Licenza Fab' },
                        thumbnails: { images: typeof thumbnail === 'string' ? [{ url: thumbnail, width: 480 }] : [] },
                        viewerUrl: 'https://www.fab.com/listings/' + encodeURIComponent(uid),
                        faceCount: item.face_count || 0,
                        animationCount: item.animation_count || 0,
                        owned: item.owned === true,
                        ownershipKnown: typeof item.owned === 'boolean',
                        importAvailable: !this.catalogOnly,
                    };
                }).filter(item => /^[a-zA-Z0-9_-]{1,100}$/.test(item.uid)),
            };
        }
        async download(uid) {
            if (!/^[a-zA-Z0-9_-]{1,100}$/.test(uid)) throw new Error('ID Fab non valido.');
            if (this.catalogOnly) throw new Error('Il catalogo Fab web è consultabile, ma il download richiede ancora un collegamento Epic autenticato. Apri la scheda Fab.');
            const data = await this.request('/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uid }),
                signal: AbortSignal.timeout(300000),
            });
            if (!/^\/assets\/[a-zA-Z0-9_-]+$/.test(data.path)) throw new Error('Percorso Fab inatteso.');
            return this.base + data.path;
        }
    }
    root.FabClient = FabClient;
    if (typeof module !== 'undefined') module.exports = { FabClient };
})(globalThis);
