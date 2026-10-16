// Original user-supplied GTA SA files stay in this browser's IndexedDB.
// Import is never uploaded to Netlify or GitHub, and deploy has no map assets.
const DB_NAME='sketchbook-sa-local-world',VERSION=1;
const stores={geometry:'geometry',nodes:'navigation'};
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
export async function clearSanAndreasFiles(kind){await transact(kind,'readwrite',store=>store.clear());}
