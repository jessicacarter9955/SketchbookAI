// User-owned DDS exports are retained ONLY in browser IndexedDB.
const DB='sketchbook-gta-imports',STORE='dds-assets',VERSION=1;
const MAX_FILE=128*1024*1024,MAX_TOTAL=700*1024*1024;
export const DDS_REQUIRED_CLIPS=[
  'idle','walk','run','sprint','falling','jump_idle','jump_running','drop_idle',
  'rotate_left','rotate_right','crouch_idle','crouch_walk','heal',
  'rifle_ready','rifle_aim','rifle_fire','rifle_reload','rifle_unequip',
  'pistol_ready','pistol_aim','pistol_fire','pistol_reload','pistol_equip'
];
const safe=n=>typeof n==='string'&&/^[a-z0-9_-]+\.glb$/i.test(n);
export function validateDdsExport(manifest,available){
  if(!manifest||manifest.version!==1||!safe(manifest.mesh))throw Error('Manifest DDS v1 o mannequin GLB non valido.');
  for(const key of DDS_REQUIRED_CLIPS)if(!safe(manifest.clips?.[key]))throw Error('Animazione DDS mancante: '+key);
  for(const key of ['rifle','pistol'])if(!safe(manifest.weapons?.[key]))throw Error('Arma DDS mancante: '+key);
  const required=[manifest.mesh,...Object.values(manifest.clips),...Object.values(manifest.weapons),...Object.values(manifest.weaponClips||{})];
  if(!required.every(safe))throw Error('Il manifest DDS contiene percorsi non sicuri o file non GLB.');
  const unique=[...new Set(required)];
  if(available){
    const names=new Set([...available].map(x=>String(x).toLowerCase()));
    for(const file of unique)if(!names.has(file.toLowerCase()))throw Error('File esportato assente: '+file);
  }
  return unique;
}
const openDb=()=>new Promise((resolve,reject)=>{
  if(!globalThis.indexedDB)return reject(Error('IndexedDB non disponibile in questo browser'));
  const request=indexedDB.open(DB,VERSION);
  request.onupgradeneeded=()=>request.result.createObjectStore(STORE);
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error||Error('Errore apertura archivio DDS'));
});
export async function readLocalDds(name){
  const db=await openDb();
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readonly'),request=tx.objectStore(STORE).get(name);
    request.onsuccess=()=>resolve(request.result||null);
    request.onerror=()=>reject(request.error);
  });}finally{db.close();}
}
export async function localDdsManifest(){
  const blob=await readLocalDds('manifest.json');
  if(!blob)return null;
  const manifest=JSON.parse(await blob.text());
  validateDdsExport(manifest);
  return manifest;
}
export async function importLocalDdsFiles(files,progress=()=>{}){
  const map=new Map();
  for(const file of files){
    if(!file||typeof file.name!=='string')continue;
    const name=file.name.toLowerCase();
    if(name==='manifest.json'||safe(name)){
      if(map.has(name))throw Error('Nome file DDS duplicato: '+name);
      map.set(name,file);
    }
  }
  const file=map.get('manifest.json');
  if(!file)throw Error('Seleziona manifest.json e tutti i file GLB dalla cartella esportata da Unreal.');
  if(file.size>1024*1024)throw Error('Manifest DDS troppo grande.');
  let manifest;
  try{manifest=JSON.parse(await file.text());}
  catch{throw Error('manifest.json non è un JSON valido.');}
  const names=validateDdsExport(manifest,map.keys());
  const total=names.reduce((sum,name)=>sum+map.get(name.toLowerCase()).size,file.size);
  if(total>MAX_TOTAL||names.some(name=>map.get(name.toLowerCase()).size>MAX_FILE))
    throw Error('Export DDS troppo grande per il browser.');
  progress('Verificati '+names.length+' GLB; salvataggio locale…');
  const db=await openDb();
  try{
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);
      store.clear();
      store.put(new Blob([JSON.stringify(manifest)],{type:'application/json'}),'manifest.json');
      for(const name of names)store.put(map.get(name.toLowerCase()),name);
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error||Error('Salvataggio DDS non riuscito'));
      tx.onabort=()=>reject(tx.error||Error('Salvataggio DDS annullato'));
    });
  }finally{db.close();}
  progress('DDS salvato nel browser: '+names.length+' GLB originali.');
  return {count:names.length,bytes:total};
}
