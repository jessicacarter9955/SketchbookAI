/** Private, user-supplied Unreal GLB packs. Nothing is uploaded to GitHub/Netlify.
 * The original source is never altered and storage remains origin-scoped IndexedDB.
 * A successful import validates transport and structure, NOT Unreal 1:1 fidelity.
 */
import { validateCharacterManifest } from './ue2three-manifest.mjs';

const DB_NAME = 'sketchbook-private-ue2three-packs';
const DB_VERSION = 1;
const STORE = 'packs';
const MAX_FILE_BYTES = 160 * 1024 * 1024;
const MAX_TOTAL_BYTES = 900 * 1024 * 1024;
const SAFE_GLB = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\.glb$/;
const LEGACY_CLIPS = [
  'idle','walk','run','sprint','falling','jump_idle','jump_running','drop_idle',
  'rotate_left','rotate_right','crouch_idle','crouch_walk','heal',
  'rifle_ready','rifle_aim','rifle_fire','rifle_reload','rifle_unequip',
  'pistol_ready','pistol_aim','pistol_fire','pistol_reload','pistol_equip'
];

export function validatePrivatePackManifest(format, value) {
  if(format === 'ue2three') {
    const manifest = validateCharacterManifest(value);
    return [...new Set([manifest.mesh, ...Object.values(manifest.clips),
      ...Object.values(manifest.attachment_assets || {}).map(entry => entry.file)])];
  }
  if(format === 'dds') {
    if(!value || value.version !== 1 || !SAFE_GLB.test(value.mesh))
      throw Error('Il manifest DDS originale deve essere versione 1 e contenere una mesh GLB valida.');
    for(const name of LEGACY_CLIPS) {
      if(!SAFE_GLB.test(value.clips?.[name])) throw Error('Clip DDS obbligatoria mancante: ' + name);
    }
    for(const name of ['rifle','pistol']) {
      if(!SAFE_GLB.test(value.weapons?.[name])) throw Error('Arma DDS obbligatoria mancante: ' + name);
    }
    const files=[value.mesh,...Object.values(value.clips),
      ...Object.values(value.weapons),
      ...Object.values(value.weaponClips || {})];
    if(files.some(name=>typeof name !== 'string' || !SAFE_GLB.test(name)))
      throw Error('Percorso GLB non sicuro nel manifest DDS.');
    return [...new Set(files)];
  }
  throw Error('Formato non supportato: ' + String(format));
}

/** Does not parse or render content: a strict self-contained GLB 2.0 gate. */
export async function validatePrivateGLB(blob, filename) {
  if(!(blob instanceof Blob) || blob.size < 32 || blob.size > MAX_FILE_BYTES)
    throw Error('GLB vuoto o troppo grande: ' + filename);
  const header=new DataView(await blob.slice(0,20).arrayBuffer());
  if(header.getUint32(0,true)!==0x46546c67 ||
     header.getUint32(4,true)!==2 ||
     header.getUint32(8,true)!==blob.size ||
     header.getUint32(16,true)!==0x4e4f534a)
    throw Error('GLB 2.0 non valido: ' + filename);
  const jsonSize=header.getUint32(12,true);
  if(jsonSize < 2 || jsonSize > blob.size - 20 || jsonSize > 64*1024*1024)
    throw Error('Dimensione JSON GLB non valida: ' + filename);
  let gltf;
  try {
    gltf=JSON.parse(await blob.slice(20,20+jsonSize).text());
  } catch {
    throw Error('JSON interno GLB danneggiato: ' + filename);
  }
  if(gltf.asset?.version!=='2.0') throw Error('glTF 2.0 richiesto: '+filename);
  for(const item of [...(gltf.buffers||[]), ...(gltf.images||[])]) {
    if(item.uri && !item.uri.startsWith('data:'))
      throw Error('GLB contiene risorse esterne non incluse: '+filename);
  }
  if(!(gltf.meshes?.length || gltf.animations?.length))
    throw Error('GLB senza geometria o animazioni: '+filename);
  return {meshes:gltf.meshes?.length||0,clips:gltf.animations?.length||0};
}

function connect() {
  return new Promise((resolve,reject)=>{
    if(!globalThis.indexedDB) return reject(Error('IndexedDB non disponibile su questo browser.'));
    const request=indexedDB.open(DB_NAME,DB_VERSION);
    request.onupgradeneeded=()=>request.result.createObjectStore(STORE,{keyPath:'format'});
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||Error('Impossibile aprire il database DDS.'));
  });
}

async function withStore(mode,callback) {
  const db=await connect();
  try{
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,mode);
      const request=callback(tx.objectStore(STORE));
      request.onsuccess=()=>resolve(request.result||null);
      request.onerror=()=>reject(request.error||Error('Archivio DDS non accessibile.'));
      tx.onabort=()=>reject(tx.error||Error('Scrittura DDS annullata.'));
    });
  } finally { db.close(); }
}

/** Import an export folder or a multi-selected set of manifest.json + every GLB. */
export async function importPrivateExport(format,files,onProgress=()=>{}) {
  const named=new Map();
  for(const file of files||[]) {
    if(!file || typeof file.name!=='string') continue;
    const name=file.name.toLowerCase();
    if(name==='manifest.json' || SAFE_GLB.test(file.name)) {
      if(named.has(name)) throw Error('Nome duplicato (anche in sottocartelle): '+file.name);
      named.set(name,file);
    }
  }
  const manifestFile=named.get('manifest.json');
  if(!manifestFile || manifestFile.size>1024*1024)
    throw Error('Seleziona manifest.json e tutti i GLB della stessa esportazione.');
  let manifest;
  try { manifest=JSON.parse(await manifestFile.text()); }
  catch { throw Error('manifest.json non è JSON valido.'); }
  const needed=validatePrivatePackManifest(format,manifest);
  let total=manifestFile.size;
  const records=[];
  for(let i=0;i<needed.length;i++) {
    const filename=needed[i];
    const file=named.get(filename.toLowerCase());
    if(!file) throw Error('File originale mancante: '+filename);
    total+=file.size;
    if(total>MAX_TOTAL_BYTES) throw Error('Pacchetto DDS maggiore di 900 MB: spezzare per batch.');
    onProgress('Verifica reale GLB '+(i+1)+'/'+needed.length+': '+filename);
    const audit=await validatePrivateGLB(file,filename);
    records.push({name:filename,blob:file,size:file.size,...audit});
  }
  const mesh=records.find(x=>x.name===manifest.mesh);
  if(!mesh?.meshes) throw Error('Il GLB del manichino non contiene alcuna mesh.');
  for(const filename of Object.values(manifest.clips)) {
    if(!records.find(x=>x.name===filename)?.clips)
      throw Error('Animazione GLB senza tracce animate: '+filename);
  }
  const result={format,manifest,records,stored_at:new Date().toISOString(),
    bytes:total,files:records.length,source_verification:'not_verified_against_original_unreal'};
  // One atomic replacement: previous working pack survives failed validations.
  await withStore('readwrite',store=>store.put(result));
  onProgress('Salvati in questo browser '+records.length+' GLB ('+Math.round(total/1048576)+' MiB).');
  return {format,count:records.length,bytes:total,source_verification:result.source_verification};
}

export async function readPrivateExport(format) {
  if(!['ue2three','dds'].includes(format)) throw Error('Formato DDS non valido.');
  return await withStore('readonly',store=>store.get(format));
}

export async function privateExportStatus(format) {
  const p=await readPrivateExport(format);
  if(!p) return {format,available:false};
  validatePrivatePackManifest(format,p.manifest);
  return {format,available:true,files:p.files,bytes:p.bytes,
    stored_at:p.stored_at,source_verification:p.source_verification};
}

export async function clearPrivateExport(format) {
  if(!['ue2three','dds'].includes(format)) throw Error('Formato DDS non valido.');
  await withStore('readwrite',store=>store.delete(format));
}

/** Make one in-memory URL map. Revoke after GLTFLoader settles. */
export function privateExportObjectURLs(pack) {
  validatePrivatePackManifest(pack.format,pack.manifest);
  const byName=new Map();
  for(const record of pack.records) {
    if(!SAFE_GLB.test(record.name)||byName.has(record.name.toLowerCase()))
      throw Error('File DDS duplicato o insicuro: '+record.name);
    if(!(record.blob instanceof Blob)) throw Error('File DDS non disponibile: '+record.name);
    byName.set(record.name.toLowerCase(),URL.createObjectURL(record.blob));
  }
  const filenames=validatePrivatePackManifest(pack.format,pack.manifest);
  for(const name of filenames) {
    if(!byName.has(name.toLowerCase())) {
      for(const url of byName.values()) URL.revokeObjectURL(url);
      throw Error('Pacchetto DDS incompleto in IndexedDB: '+name);
    }
  }
  return {
    resolve:requested=>{
      const name=String(requested).split(/[/?#]/).filter(Boolean).pop()?.toLowerCase();
      return byName.get(name)||requested;
    },
    url:name=>byName.get(name.toLowerCase()),
    release:()=>{for(const url of byName.values()) URL.revokeObjectURL(url);}
  };
}
