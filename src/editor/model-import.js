import { unzipSync } from 'three/examples/jsm/libs/fflate.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter';
import { MAX_BYTES, checkGLB, encodeBytes } from './asset-store.mjs';

// Check the central directory before allocating decompressed files.
function checkArchive(bytes) {
    const view = new DataView(bytes); let end = bytes.byteLength - 22;
    const minimum = Math.max(0, end - 65535);
    while (end >= minimum && view.getUint32(end, true) !== 0x06054b50) end--;
    if (end < minimum) throw new Error('Archivio ZIP non valido.');
    const count = view.getUint16(end + 10, true); let offset = view.getUint32(end + 16, true), total = 0;
    if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count) throw new Error('ZIP multiparte non supportati.');
    if (!count || count > 2048) throw new Error('Archivio con troppi file (massimo 2048).');
    for (let i = 0; i < count; i++) {
        if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error('Indice ZIP non valido.');
        if (view.getUint16(offset + 8, true) & 1) throw new Error('ZIP protetti da password non supportati.');
        total += view.getUint32(offset + 24, true);
        if (total > MAX_BYTES * 2) throw new Error('Archivio superiore a 100 MB dopo decompressione.');
        offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    }
}

export async function modelToGLB(bytes) {
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 22 || bytes.byteLength > MAX_BYTES) throw new Error('Modello non valido o superiore a 50 MB.');
    if (new DataView(bytes).getUint32(0, true) === 0x46546c67) { checkGLB(bytes); return bytes; }
    checkArchive(bytes);
    const files = unzipSync(new Uint8Array(bytes));
    const names = Object.keys(files).filter(name => !name.startsWith('__MACOSX/'));
    const glbs = names.filter(name => /\.glb$/i.test(name));
    const gltfs = names.filter(name => /\.gltf$/i.test(name));
    if (glbs.length === 1 && !gltfs.length) {
        const file = files[glbs[0]], result = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength); checkGLB(result); return result;
    }
    const main = gltfs.find(name => /(^|\/)scene\.gltf$/i.test(name)) || (gltfs.length === 1 ? gltfs[0] : null);
    if (!main) throw new Error('Lo ZIP deve contenere un modello glTF (scene.gltf) o un singolo GLB.');
    const data = JSON.parse(new TextDecoder().decode(files[main]));
    for (const resource of [...(data.buffers || []), ...(data.images || [])]) {
        if (!resource.uri || resource.uri.startsWith('data:')) continue;
        if (/^[a-z][a-z0-9+.-]*:|^[/\\]/i.test(resource.uri)) throw new Error('Il modello ZIP contiene risorse esterne non consentite.');
        const path = decodeURIComponent(new URL(resource.uri, `https://archive.invalid/${main}`).pathname.slice(1));
        const content = files[path]; if (!content) throw new Error(`File mancante nello ZIP: ${path}`);
        const mime = /\.png$/i.test(path) ? 'image/png' : /\.jpe?g$/i.test(path) ? 'image/jpeg' : /\.webp$/i.test(path) ? 'image/webp' : 'application/octet-stream';
        resource.uri = `data:${mime};base64,${encodeBytes(content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength))}`;
    }
    const gltf = await new GLTFLoader().parseAsync(JSON.stringify(data), '');
    try {
        const result = await new GLTFExporter().parseAsync(gltf.scene, { binary: true, animations: gltf.animations });
        checkGLB(result); return result;
    } finally {
        gltf.scene.traverse(node => { node.geometry?.dispose(); for (const material of [].concat(node.material || [])) { for (const value of Object.values(material)) if (value?.isTexture) value.dispose(); material.dispose(); } });
    }
}
