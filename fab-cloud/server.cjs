'use strict';
const http = require('node:http');
const { execFile, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { zipStore } = require('../tools/fab-bridge.cjs');
const sketchfab = require('./sketchfab-supercars.cjs');
const exec = promisify(execFile);
const PORT = Number(process.env.PORT || 10000);
const ORIGIN = process.env.FAB_ALLOWED_ORIGIN || 'https://my-test-site3.netlify.app';
const KEY = process.env.FAB_BRIDGE_KEY || '';
const BIN = process.env.FABCLI_BIN || 'fabcli';
const MAX = 50 * 1024 * 1024;
let activeDownload = false;
let activeLogin = false;
const calls = new Map();
function isAllowedOrigin(origin) {
    // Exact production site or an immutable Netlify deployment of the same site.
    // Never trust arbitrary *.netlify.app origins.
    return !origin || origin === ORIGIN || /^https:\/\/[a-z0-9-]+--my-test-site3\.netlify\.app$/.test(origin);
}
function hasAccess(value) {
    if (!KEY || !value || typeof value !== 'string') return false;
    const a = Buffer.from(value), b = Buffer.from(KEY);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function reply(res, status, payload, origin, type='application/json') {
    res.writeHead(status, {'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
        'Access-Control-Allow-Origin':origin || ORIGIN, 'Vary':'Origin', 'Access-Control-Allow-Headers':'X-Fab-Bridge-Key, Content-Type',
        'Access-Control-Allow-Methods':'GET,POST,OPTIONS'});
    res.end(Buffer.isBuffer(payload) ? payload : JSON.stringify(payload));
}
function throttle(req, limit=20) {
    const ip = req.socket.remoteAddress || 'unknown', now=Date.now();
    const hit = calls.get(ip) || {n:0,start:now};
    if (now-hit.start>60000) {hit.n=0;hit.start=now;}
    hit.n++;calls.set(ip,hit);
    if(calls.size>512) for(const [k,v] of calls) if(now-v.start>60000) calls.delete(k);
    return hit.n<=limit;
}
async function run(args, timeout=60000) {
    try {
        const { stdout } = await exec(BIN,args,{timeout,maxBuffer:10*1024*1024,windowsHide:true});
        return JSON.parse(stdout);
    } catch(err) {
        if(err.code==='ENOENT') throw Error('FabCLI non installato nel container.');
        let parsed;
        try { parsed=JSON.parse((err.stderr||'').trim().split('\n').at(-1)); } catch {}
        const message = err.code===2 ? 'Collega prima Epic Games al bridge.' :
            err.code===3 ? 'Asset Fab non trovato oppure non presente nella libreria Epic.' :
            err.code===4 ? 'Fab ha temporaneamente limitato le richieste.' :
            parsed?.error?.message || 'FabCLI non ha completato la richiesta.';
        throw Error(String(message).slice(0,250));
    }
}
function manualLogin(code) {
    return new Promise((resolve,reject)=>{
        const child=spawn('python3',[path.join(__dirname,'manual-login.py')],{stdio:['pipe','pipe','pipe']});
        let out='';
        const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Autenticazione Epic scaduta.'));},90000);
        child.stdout.on('data',buf=>{out+=buf.toString().slice(0,1000);});
        child.on('error',e=>{clearTimeout(timer);reject(Error('Impossibile avviare la procedura Epic.'));});
        child.on('close',exit=>{
            clearTimeout(timer);
            let result;
            try {result=JSON.parse(out.trim());}catch{result={ok:false};}
            exit===0&&result.ok?resolve(result):reject(Error('Codice Epic non accettato o login non completato.'));
        });
        child.stdin.end(code+'\n');
    });
}
async function inspect(root,base=root,out=[]) {
    for(const entry of await fs.readdir(root,{withFileTypes:true})) {
        if(entry.isSymbolicLink()) continue;
        const full=path.join(root,entry.name),name=path.relative(base,full).replace(/\\/g,'/');
        if(entry.isDirectory()) await inspect(full,base,out);
        else if(entry.isFile()) {
            const stat=await fs.stat(full);
            out.push({full,name,size:stat.size});
        }
        if(out.length>800) throw Error('Fab: archivio troppo complesso.');
    }
    return out;
}
async function download(uid) {
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'sketchbook-fab-'));
    try {
        await run(['download',uid,'-o',path.join(directory,'asset')],240000);
        const files=await inspect(directory);
        const single=files.filter(file=>/\.(glb|zip)$/i.test(file.name));
        const gltfs=files.filter(file=>/\.gltf$/i.test(file.name));
        let bytes;
        if(single.length===1 && gltfs.length===0) {
            if(single[0].size>MAX) throw Error('Asset oltre 50 MB.');
            bytes=await fs.readFile(single[0].full);
        } else if(gltfs.length===1) {
            const dir=path.dirname(gltfs[0].full), associated=await inspect(dir);
            if(associated.reduce((sum,x)=>sum+x.size,0)>MAX) throw Error('Asset oltre 50 MB.');
            const entries=[];
            for(const f of associated) entries.push({name:f.name,bytes:await fs.readFile(f.full)});
            bytes=zipStore(entries);
        } else throw Error('Formato Fab incompatibile: serve un file GLB o glTF/ZIP, non un .uasset.');
        if(bytes.length>MAX) throw Error('Asset oltre 50 MB.');
        return bytes;
    } finally {await fs.rm(directory,{recursive:true,force:true});}
}
async function readJSON(req) {
    let length=0,parts=[];
    for await(const chunk of req) {
        length+=chunk.length;
        if(length>2048) throw Error('Richiesta troppo grande.');
        parts.push(chunk);
    }
    try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}
    catch{throw Error('JSON non valido.');}
}
async function app(req,res) {
    const origin=req.headers.origin||'';
    if(!isAllowedOrigin(origin)) return reply(res,403,{error:'Origine non consentita.'},'');
    if(req.method==='OPTIONS') return reply(res,204,Buffer.alloc(0),origin);
    const url=new URL(req.url,'https://fab.example');
    if(url.pathname==='/health' && req.method==='GET') return reply(res,200,{ok:true,bridge:true,mode:'private-fabcli',requiresEpicLogin:true},origin);
    // Fixed, credited CC BY showcase is public; arbitrary model downloads still require
    // Sketchfab's own permission and are not exposed through this bridge.
    if(req.method==='GET' && url.pathname==='/sketchfab/showcase') {
        return reply(res,200,{provider:'sketchfab',configured:sketchfab.configured(),
            vehicles:sketchfab.catalog()},origin);
    }
    if(req.method==='GET' && /^\/sketchfab\/cars\/(bmw|ferrari|lamborghini)$/.test(url.pathname)) {
        if(!throttle(req,12)) return reply(res,429,{error:'Troppe richieste.'},origin);
        try {
            const id = url.pathname.split('/').pop();
            const item = await sketchfab.loadAsset(id);
            return reply(res,200,item.bytes,origin,'application/octet-stream');
        } catch(error) {
            const code = error.status === 401 ? 503 : error.status === 429 ? 429 :
                error.status === 403 ? 403 : error.status === 503 ? 503 : 502;
            return reply(res,code,{error:String(error.message).slice(0,180)},origin);
        }
    }
    if(!hasAccess(req.headers['x-fab-bridge-key'])) return reply(res,401,{error:'Inserisci la chiave personale del bridge Fab.'},origin);
    if(!throttle(req)) return reply(res,429,{error:'Troppe richieste: riprova tra un minuto.'},origin);
    try {
        if(req.method==='GET' && url.pathname==='/status') {
            try {
                const data=await run(['auth','status'],25000);
                return reply(res,200,{bridge:true,mode:'private-fabcli',connected:!!(data.epic?.authenticated||data.epic?.valid||data.epic_authenticated||data.authenticated),
                    details:data.epic?.authenticated===false?'Epic login necessario':undefined},origin);
            } catch {return reply(res,200,{bridge:true,mode:'private-fabcli',connected:false,details:'Epic login necessario'},origin);}
        }
        if(req.method==='POST' && url.pathname==='/auth/code') {
            if(activeLogin) return reply(res,409,{error:'Autenticazione già in corso.'},origin);
            const data=await readJSON(req);
            if(typeof data.code!=='string'||!/^[A-Za-z0-9_-]{12,512}$/.test(data.code)) return reply(res,400,{error:'Codice Epic non valido.'},origin);
            activeLogin=true;
            try{await manualLogin(data.code);return reply(res,200,{ok:true,connected:true},origin);}
            finally{activeLogin=false;}
        }
        if(req.method==='GET' && url.pathname==='/search') {
            const q=(url.searchParams.get('q')||'').trim();
            if(q.length<2||q.length>100) return reply(res,400,{error:'Ricerca da 2 a 100 caratteri.'},origin);
            const data=await run(['search','-q',q],45000);
            return reply(res,200,{results:Array.isArray(data.results)?data.results.slice(0,24):[]},origin);
        }
        if(req.method==='POST' && url.pathname==='/download') {
            if(activeDownload) return reply(res,409,{error:'Download già in corso.'},origin);
            const data=await readJSON(req);
            if(!/^[a-zA-Z0-9_-]{1,100}$/.test(data.uid||'')) return reply(res,400,{error:'UID Fab non valido.'},origin);
            activeDownload=true;
            try {
                const bytes=await download(data.uid);
                return reply(res,200,bytes,origin,'application/octet-stream');
            } finally { activeDownload=false; }
        }
        return reply(res,404,{error:'Percorso sconosciuto.'},origin);
    } catch(error) {
        const sanitized=String(error.message||'Errore Fab').replace(/[\x00-\x1f]/g,' ').slice(0,260);
        return reply(res,502,{error:sanitized},origin);
    }
}
const server=http.createServer((req,res)=>app(req,res).catch(()=>{
    if(!res.headersSent)reply(res,500,{error:'Errore interno del bridge.'},req.headers.origin||'');
}));
if(require.main===module)server.listen(PORT,'0.0.0.0',()=>console.log('Fab private bridge listening',PORT));
module.exports={server,hasAccess,isAllowedOrigin,readJSON};
