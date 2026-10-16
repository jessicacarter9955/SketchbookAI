/* Authenticated FabCLI bridge, hosted on Render, with optional local fallback. */
(function (root) {
    const EPIC_LOGIN_URL = 'https://www.epicgames.com/id/login?redirectUrl=https%3A%2F%2Fwww.epicgames.com%2Fid%2Fapi%2Fredirect%3FclientId%3D34a02cf8f4414e29b15921876da36f9a%26responseType%3Dcode';
    const HOSTED_BRIDGE = 'https://sketchbook-fab-bridge.onrender.com';
    class FabClient {
        constructor(fetcher = (...args) => fetch(...args), base = null) {
            this.fetcher = fetcher;
            const host = root.location?.hostname || '';
            const local = !host || ['localhost','127.0.0.1','[::1]'].includes(host);
            this.base = base || (local ? 'http://127.0.0.1:8765' : HOSTED_BRIDGE);
            this.catalogOnly = this.base.startsWith('/.netlify/functions/');
            this.hosted = this.base === HOSTED_BRIDGE;
            this.key = '';
        }
        get epicLoginURL() { return EPIC_LOGIN_URL; }
        async store(mode, action) {
            if (!root.indexedDB) throw Error('IndexedDB non è disponibile in questo browser.');
            const db = await new Promise((resolve,reject)=>{
                const open = root.indexedDB.open('sketchbook-private-settings',1);
                open.onupgradeneeded = () => {
                    if (!open.result.objectStoreNames.contains('credentials')) open.result.createObjectStore('credentials');
                };
                open.onerror = () => reject(Error('Impossibile aprire le impostazioni salvate.'));
                open.onsuccess = () => resolve(open.result);
            });
            try {
                return await new Promise((resolve,reject)=>{
                    const tx = db.transaction('credentials',mode);
                    let result;
                    tx.oncomplete = () => resolve(result);
                    tx.onerror = () => reject(Error('Impossibile salvare la chiave Fab.'));
                    const req = action(tx.objectStore('credentials'));
                    if (req) req.onsuccess = () => result = req.result;
                });
            } finally {db.close();}
        }
        async loadSavedKey() {
            const value = await this.store('readonly',store=>store.get('fab-bridge-key'));
            if (typeof value === 'string' && value.length >= 24) this.key = value;
            return !!this.key;
        }
        async saveBridgeKey(key) {
            if (typeof key !== 'string' || key.trim().length < 24 || key.length > 250)
                throw Error('Inserisci la chiave Fab personale.');
            this.key = key.trim();
            await this.store('readwrite',store=>store.put(this.key,'fab-bridge-key'));
            return this.key.length > 0;
        }
        async clearSavedKey() {
            await this.store('readwrite',store=>store.delete('fab-bridge-key'));
            this.key = '';
        }
        async request(path, options = {}) {
            const url = this.catalogOnly ?
                this.base + '?operation=' + encodeURIComponent(path.slice(1).split('?')[0]) +
                    (path.includes('?') ? '&' + path.split('?').slice(1).join('?') : '') :
                this.base + path;
            const headers = {...(options.headers || {})};
            if (this.hosted && this.key) headers['X-Fab-Bridge-Key'] = this.key;
            const response = await this.fetcher(url,{
                ...options,cache:'no-store',headers,
                signal:options.signal || AbortSignal.timeout(120000)
            });
            if (!response.ok) {
                const data=await response.json().catch(()=>({}));
                throw Error(data.error || 'Fab: errore HTTP '+response.status);
            }
            return response.json();
        }
        status() {return this.request('/status');}
        async connectEpic(code) {
            if (!this.hosted) throw Error('La connessione Epic cloud richiede il bridge online.');
            if (!this.key) throw Error('Salva prima la chiave Fab personale.');
            if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{12,512}$/.test(code.trim()))
                throw Error('Incolla il codice authorizationCode ricevuto da Epic.');
            return this.request('/auth/code',{
                method:'POST',headers:{'Content-Type':'application/json'},
                body:JSON.stringify({code:code.trim()}),
                signal:AbortSignal.timeout(100000)
            });
        }
        async search(query,{signal}={}) {
            const data=await this.request('/search?q='+encodeURIComponent(query.trim()),{signal});
            const results=Array.isArray(data.results)?data.results:[];
            return {next:null,results:results.map(item=>{
                const uid=String(item.uid||item.id||item.listing_id||'');
                const thumbnail=item.thumbnail_url||item.thumbnailUrl||item.image_url||
                    item.imageUrl||item.thumbnail?.url||item.thumbnail||item.images?.[0]?.url||'';
                const publisher=item.publisher?.display_name||item.publisher?.name||
                    item.seller?.name||item.publisher_name||'';
                return {provider:'fab',uid,name:item.title||item.name||'Asset Fab',
                    user:{displayName:publisher},
                    license:{label:item.license?.name||item.license_type||'Controlla licenza Fab'},
                    thumbnails:{images:typeof thumbnail==='string'?[{url:thumbnail,width:480}]:[]},
                    viewerUrl:'https://www.fab.com/listings/'+encodeURIComponent(uid),
                    faceCount:item.face_count||0,animationCount:item.animation_count||0,
                    owned:item.owned===true,ownershipKnown:typeof item.owned==='boolean',
                    importAvailable:!this.catalogOnly
                };
            }).filter(item=>/^[a-zA-Z0-9_-]{1,100}$/.test(item.uid))};
        }
        async download(uid) {
            if(!/^[a-zA-Z0-9_-]{1,100}$/.test(uid)) throw Error('ID Fab non valido.');
            if(this.catalogOnly) throw Error('Download Fab non disponibile senza account Epic.');
            if(this.hosted) {
                if(!this.key) throw Error('Configura la chiave Fab prima di importare.');
                const response=await this.fetcher(this.base+'/download',{
                    method:'POST',cache:'no-store',
                    headers:{'Content-Type':'application/json','X-Fab-Bridge-Key':this.key},
                    body:JSON.stringify({uid}),
                    signal:AbortSignal.timeout(300000)
                });
                if(!response.ok) {
                    const data=await response.json().catch(()=>({}));
                    throw Error(data.error || 'Fab: download non riuscito.');
                }
                if(Number(response.headers?.get?.('content-length'))>50*1024*1024)
                    throw Error('Asset Fab superiore al limite di 50 MB.');
                const bytes=await response.arrayBuffer();
                if(bytes.byteLength>50*1024*1024) throw Error('Asset Fab superiore a 50 MB.');
                return URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));
            }
            const data=await this.request('/download',{
                method:'POST',headers:{'Content-Type':'application/json'},
                body:JSON.stringify({uid}),signal:AbortSignal.timeout(300000)
            });
            if(!/^\/assets\/[a-zA-Z0-9_-]+$/.test(data.path)) throw Error('Percorso Fab inatteso.');
            return this.base+data.path;
        }
    }
    root.FabClient=FabClient;
    if(typeof module!=='undefined')module.exports={FabClient};
})(globalThis);
