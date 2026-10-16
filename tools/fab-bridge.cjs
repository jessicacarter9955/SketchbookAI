#!/usr/bin/env node
/* Localhost-only FabCLI bridge. No Epic credentials or marketplace tokens enter Git or the browser. */
'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const BIN = process.env.FABCLI_BIN || 'fabcli';
const PORT = Number(process.env.FAB_BRIDGE_PORT || 8765);
const MAX = 50 * 1024 * 1024;
const assets = new Map();

function allowedOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return '';
    try {
        const u = new URL(origin);
        const port = Number(u.port);
        if (u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname) &&
            (port >= 8000 && port <= 9000) && port !== PORT) return origin;
    } catch {}
    return null;
}
function send(res, status, body, origin, contentType = 'application/json') {
    res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store',
        ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}) });
    res.end(Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
async function cli(args, timeout = 120000) {
    try {
        const result = await exec(BIN, args, { timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
        return JSON.parse(result.stdout);
    } catch (e) {
        if (e.code === 'ENOENT') throw Error('FabCLI non installato o non nel PATH. Leggi docs/fab-integration.md.');
        let error;
        try { error = JSON.parse((e.stderr || '').trim().split('\n').filter(Boolean).at(-1)); } catch {}
        const message = error?.error?.message || (e.code === 2 ? 'Account Epic non collegato: esegui fabcli auth login.'
            : e.code === 4 ? 'Limite Fab raggiunto: riprova più tardi.'
            : 'FabCLI: richiesta non riuscita. Verifica installazione, connessione e autorizzazioni.');
        throw Error(message);
    }
}
function crc32(buffer) {
    let c = 0xffffffff;
    for (const b of buffer) {
        c ^= b;
        for (let i = 0; i < 8; i++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    return (c ^ 0xffffffff) >>> 0;
}
function zipStore(entries) {
    const chunks = [], central = []; let offset = 0, total = 0;
    for (const { name, bytes } of entries) {
        const filename = Buffer.from(name.replace(/\\/g, '/'), 'utf8'), crc = crc32(bytes);
        const header = Buffer.alloc(30);
        header.writeUInt32LE(0x04034b50, 0);
        header.writeUInt16LE(20, 4);
        header.writeUInt32LE(crc, 14);
        header.writeUInt32LE(bytes.length, 18);
        header.writeUInt32LE(bytes.length, 22);
        header.writeUInt16LE(filename.length, 26);
        chunks.push(header, filename, bytes);
        const record = Buffer.alloc(46);
        record.writeUInt32LE(0x02014b50, 0);
        record.writeUInt16LE(20, 4);
        record.writeUInt16LE(20, 6);
        record.writeUInt32LE(crc, 16);
        record.writeUInt32LE(bytes.length, 20);
        record.writeUInt32LE(bytes.length, 24);
        record.writeUInt16LE(filename.length, 28);
        record.writeUInt32LE(offset, 42);
        central.push(record, filename);
        offset += header.length + filename.length + bytes.length;
        total += bytes.length;
        if (total > MAX || entries.length > 2048) throw Error('Asset Fab troppo grande per Sketchbook (massimo 50 MB).');
    }
    const size = central.reduce((n, item) => n + item.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(size, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...chunks, ...central, end]);
}
async function filesUnder(dir, base = dir, out = []) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const full = path.join(dir, entry.name), relative = path.relative(base, full).replace(/\\/g, '/');
        if (entry.isDirectory()) await filesUnder(full, base, out);
        else if (entry.isFile()) out.push({ full, name: relative });
        if (out.length > 2048) throw Error('Fab: troppi file nell’asset.');
    }
    return out;
}
async function prepareDownload(uid) {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'sketchbook-fab-'));
    try {
        await cli(['download', uid, '-o', path.join(temporary, 'model')], 300000);
        const files = await filesUnder(temporary);
        const glbs = files.filter(file => /\.glb$/i.test(file.name));
        const zips = files.filter(file => /\.zip$/i.test(file.name));
        const gltfs = files.filter(file => /\.gltf$/i.test(file.name));
        let bytes;
        if (glbs.length === 1 && gltfs.length === 0) bytes = await fs.readFile(glbs[0].full);
        else if (zips.length === 1 && gltfs.length === 0 && glbs.length === 0) bytes = await fs.readFile(zips[0].full);
        else if (gltfs.length === 1) {
            const folder = path.dirname(gltfs[0].full);
            const related = await filesUnder(folder);
            const contents = [];
            for (const file of related) {
                const stat = await fs.stat(file.full);
                if (stat.size > MAX) throw Error('File Fab troppo grande.');
                contents.push({ name: file.name, bytes: await fs.readFile(file.full) });
            }
            bytes = zipStore(contents);
        } else throw Error('Formato non supportato: serve GLB, glTF con risorse oppure ZIP glTF. Gli asset UE .uasset richiedono conversione.');
        if (bytes.length > MAX) throw Error('Asset Fab superiore a 50 MB.');
        const id = crypto.randomUUID();
        assets.set(id, bytes);
        while (assets.size > 4) assets.delete(assets.keys().next().value);
        return '/assets/' + id;
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
const server = http.createServer(async (req, res) => {
    const origin = allowedOrigin(req);
    if (origin === null) return send(res, 403, { error: 'Origine non autorizzata.' }, '');
    if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': origin || '',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' });
        return res.end();
    }
    try {
        const u = new URL(req.url, 'http://127.0.0.1');
        if (req.method === 'GET' && u.pathname === '/status') {
            const result = await cli(['auth', 'status'], 20000);
            return send(res, 200, { connected: !!result.authenticated, bridge: true }, origin);
        }
        if (req.method === 'GET' && u.pathname === '/search') {
            const q = (u.searchParams.get('q') || '').trim();
            if (!q || q.length > 200) return send(res, 400, { error: 'Ricerca Fab non valida.' }, origin);
            const result = await cli(['search', '-q', q, '--with-ownership']);
            return send(res, 200, { results: Array.isArray(result.results) ? result.results : [] }, origin);
        }
        if (req.method === 'POST' && u.pathname === '/download') {
            let raw = '';
            for await (const chunk of req) {
                raw += chunk.toString();
                if (raw.length > 2048) return send(res, 413, { error: 'Richiesta troppo grande.' }, origin);
            }
            let body;
            try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'JSON non valido.' }, origin); }
            if (!/^[a-zA-Z0-9_-]{1,100}$/.test(body.uid || '')) return send(res, 400, { error: 'ID Fab non valido.' }, origin);
            const pathname = await prepareDownload(body.uid);
            return send(res, 200, { path: pathname }, origin);
        }
        if (req.method === 'GET' && /^\/assets\/[a-f0-9-]{36}$/.test(u.pathname)) {
            const bytes = assets.get(u.pathname.slice(8));
            if (!bytes) return send(res, 404, { error: 'File Fab scaduto.' }, origin);
            return send(res, 200, bytes, origin, 'application/octet-stream');
        }
        return send(res, 404, { error: 'Operazione non disponibile.' }, origin);
    } catch (error) { return send(res, 502, { error: error.message }, origin); }
});
if (require.main === module) server.listen(PORT, '127.0.0.1', () =>
    process.stdout.write('Fab bridge locale: http://127.0.0.1:' + PORT + '\n'));
module.exports = { server, crc32, zipStore, allowedOrigin };
