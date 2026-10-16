// Original user-supplied GTA SA files stay in this browser's IndexedDB.
// Import is never uploaded to Netlify or GitHub, and deploy has no map assets.
const DB_NAME='sketchbook-sa-local-world',VERSION=2;
const stores={geometry:'geometry',nodes:'navigation',metadata:'geometry-bounds'};
const MAX_GLBS=128,MAX_NODES=64,MAX_FILE=256*1024*1024;
export const saFileSector=name=>{
 const m=/^nodes([0-9]|[1-5][0-9]|6[0-3])\.dat$/i.exec(name);
 return m?Number(m[1]):null;
};
const check=(kind,files)=>{
 if(!stores[kind])throw Error('Tipo dati GTA SA non valido: '+kind);
 const list=Array.from(files||[]),limit=kind==='nodes'?MAX_NODES:MAX_GLBS;
 if(!list.length||list.length>limit)throw Error('Numero file '+kind+' non valido: massimo '+limit);
 const names=new Set(),sectors=new Set();
 for(const file of list){
   if(!file||typeof file.name!=='string'||typeof file.size!=='number'||file.size<=0||file.size>MAX_FILE)throw Error('File GTA SA vuoto o troppo grande.');
   const key=file.name.toLowerCase();
   if(names.has(key))throw Error('File GTA SA duplicato: '+key);
   names.add(key);
   if(kind==='geometry'){
     if(!/^[a-z0-9_.-]+\.glb$/i.test(key)||key.startsWith('.'))throw Error('Nome settore GLB non valido: '+file.name);
   }else{
     const sector=saFileSector(key);
     if(sector===null||sectors.has(sector))throw Error('File nodes*.dat non valido o duplicato: '+file.name);
     sectors.add(sector);
   }
 }
 return list;
};
const open=()=>new Promise((resolve,reject)=>{
 if(!globalThis.indexedDB)return reject(Error('Archivio IndexedDB non disponibile.'));
 const req=indexedDB.open(DB_NAME,VERSION);
 req.onupgradeneeded=()=>{for(const name of Object.values(stores))if(!req.result.objectStoreNames.contains(name))req.result.createObjectStore(name);};
 req.onsuccess=()=>resolve(req.result);
 req.onerror=()=>reject(req.error||Error('Impossibile aprire archivio GTA SA.'));
});
const transact=async(kind,mode,callback)=>{
 if(!stores[kind])throw Error('Archivio GTA SA sconosciuto.');
 const db=await open();
 try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction(stores[kind],mode),store=tx.objectStore(stores[kind]);
  let value;
  try{value=callback(store,tx);}catch(e){tx.abort();reject(e);return;}
  tx.oncomplete=()=>resolve(value?.value);
  tx.onerror=()=>reject(tx.error||Error('Errore archivio GTA SA.'));
  tx.onabort=()=>reject(tx.error||Error('Operazione GTA SA annullata.'));
 });}finally{db.close();}
};
export async function saveSanAndreasFiles(kind,files){
 const list=check(kind,files);
 await transact(kind,'readwrite',store=>{
   store.clear();for(const file of list)store.put(file,file.name.toLowerCase());
 });
 return list.length;
}
export async function listSanAndreasFiles(kind){
 const db=await open();
 try{return await new Promise((resolve,reject)=>{
   const tx=db.transaction(stores[kind],'readonly'),request=tx.objectStore(stores[kind]).getAllKeys();
   request.onsuccess=()=>resolve(request.result||[]);
   request.onerror=()=>reject(request.error);
 });}finally{db.close();}
}
export async function readSanAndreasFile(kind,name){
 const db=await open();
 try{return await new Promise((resolve,reject)=>{
   const tx=db.transaction(stores[kind],'readonly'),request=tx.objectStore(stores[kind]).get(String(name).toLowerCase());
   request.onsuccess=()=>resolve(request.result||null);
   request.onerror=()=>reject(request.error);
 });}finally{db.close();}
}
export async function clearSanAndreasFiles(kind){
 await transact(kind,'readwrite',store=>store.clear());
 if(kind==='geometry')await transact('metadata','readwrite',store=>store.clear());
}
export function validateSaGeometryMetadata(entries){
 if(!Array.isArray(entries)||!entries.length||entries.length>MAX_GLBS)throw Error('Metadata settori SA non validi.');
 const names=new Set();
 for(const entry of entries){
   if(!entry||typeof entry.name!=='string'||!/^[a-z0-9_.-]+\.glb$/i.test(entry.name)||names.has(entry.name.toLowerCase()))throw Error('Identificativo settore SA non valido.');
   names.add(entry.name.toLowerCase());
   const b=entry.bounds;
   if(!Array.isArray(b)||b.length!==6||!b.every(x=>Number.isFinite(x)&&Math.abs(x)<=200000)||
     b[3]<=b[0]||b[4]<b[1]||b[5]<=b[2])throw Error('Limiti geometrici settore SA non validi: '+entry.name);
 }
 return entries.map(e=>({name:e.name.toLowerCase(),bounds:[...e.bounds]}));
}
export async function saveSanAndreasGeometryMetadata(entries){
 const data=validateSaGeometryMetadata(entries);
 await transact('metadata','readwrite',store=>{
   store.clear();
   for(const x of data)store.put(x,x.name);
 });
 return data.length;
}
export async function listSanAndreasGeometryMetadata(){
 const db=await open();
 try{return await new Promise((resolve,reject)=>{
   const request=db.transaction(stores.metadata,'readonly').objectStore(stores.metadata).getAll();
   request.onsuccess=()=>resolve(request.result||[]);
   request.onerror=()=>reject(request.error);
 });}finally{db.close();}
}
