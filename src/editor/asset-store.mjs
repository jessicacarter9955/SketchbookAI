const MAX_BYTES = 50 * 1024 * 1024;
export { MAX_BYTES };
export class AssetStore {
    async open() {
        if (this.db) return this.db;
        this.db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('sketchbook-editor', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('assets', { keyPath: 'id' });
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        return this.db;
    }
    async get(id) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const request = db.transaction('assets').objectStore('assets').get(id);
            request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
    }
    async putAll(assets) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('assets', 'readwrite');
            assets.forEach(asset => tx.objectStore('assets').put(asset));
            tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
        });
    }
}
export function checkGLB(bytes) {
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 20 || bytes.byteLength > MAX_BYTES)
        throw new Error('GLB non valido o superiore a 50 MB.');
    const view = new DataView(bytes);
    if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength)
        throw new Error('Serve un file GLB 2.0, non un archivio ZIP o una pagina web.');
    // Portable packages must contain their textures and buffers, not external URLs.
    const length = view.getUint32(12, true);
    if (view.getUint32(16, true) !== 0x4e4f534a || length > bytes.byteLength - 20) throw new Error('GLB: intestazione JSON non valida.');
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, length)));
    if ([...(json.buffers || []), ...(json.images || [])].some(item => item.uri && !item.uri.startsWith('data:')))
        throw new Error('Il GLB usa risorse esterne. Esporta un GLB con texture incorporate.');
}
export function encodeBytes(bytes) {
    const array = new Uint8Array(bytes); let binary = '';
    for (let i = 0; i < array.length; i += 8192) binary += String.fromCharCode(...array.subarray(i, i + 8192));
    return btoa(binary);
}
export function decodeBytes(base64) {
    if (typeof base64 !== 'string' || base64.length > MAX_BYTES * 1.34) throw new Error('Asset troppo grande.');
    return Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer;
}
