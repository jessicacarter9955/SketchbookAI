import * as THREE from 'three';

// Persistent, original-quality instanced PBR facade geometry. Cache contains
// material textures, normals, instance transforms and full imported geometry,
// NOT screenshots or low-poly substitutes.
const VERSION='hd-facades-r1-20261013';
const DB='sketchbook-photoreal-city';
const STORE='scenes';
const MAX_AGE=45*24*3600*1000;
const log=(message)=>globalThis.cityDiagnostics?.activity?.('CACHE HD: '+message);

export function urbanCacheKey(config){
  const keys=['seed','blocksX','blocksZ','blockSize','roadWidth','sidewalkWidth','minFloors',
    'maxFloors','buildingDensity','terrain'];
  return VERSION+'|'+keys.map(k=>String(config?.[k]??'')).join(':');
}
export function openUrbanCache(){
  return new Promise((resolve,reject)=>{
    if(!globalThis.indexedDB){resolve(null);return;}
    const request=indexedDB.open(DB,1);
    request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE);};
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>resolve(request.result);
  });
}
function transact(db,key,mode,data){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,mode),req=mode==='readonly'?
      tx.objectStore(STORE).get(key):tx.objectStore(STORE).put(data,key);
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
async function encode(payload){
  const json=JSON.stringify(payload);
  if(typeof CompressionStream!=='function')return {compressed:false,data:json};
  const stream=new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  return {compressed:true,data:await new Response(stream).arrayBuffer()};
}
async function decode(record){
  let json=record.data;
  if(record.compressed){
    if(typeof DecompressionStream!=='function')throw new Error('Gzip cache not supported');
    const stream=new Blob([record.data]).stream().pipeThrough(new DecompressionStream('gzip'));
    json=await new Response(stream).text();
  }
  return JSON.parse(json);
}
export async function restoreUrbanFacades(config){
  let db;
  try{
    db=await openUrbanCache();if(!db)return null;
    const record=await transact(db,urbanCacheKey(config),'readonly');
    if(!record||Date.now()-record.time>MAX_AGE||record.version!==VERSION)return null;
    log('Ripristino geometrie HD precedentemente assemblate dal disco…');
    const serialized=await decode(record);
    const group=await new THREE.ObjectLoader().parseAsync(serialized);
    if(!group?.isGroup||!group.children.length)throw Error('cache scene empty');
    if(!group.children.every(node=>node.isGroup&&node.name.startsWith('PBR city sector ')))
      throw Error('invalid facade sector cache');
    // Rehydrate GPU-instance bounds for native frustum culling.
    group.traverse(node=>{if(node.isInstancedMesh){node.instanceMatrix.needsUpdate=true;
      node.computeBoundingSphere?.();}});
    log('Recuperati '+group.children.length+' settori fotorealistici senza ricostruirli');
    return group;
  }catch(error){
    console.warn('[CITY HD CACHE] Read failed; rebuilding original PBR geometry',error);
    return null;
  }finally{db?.close();}
}
export async function saveUrbanFacades(config,clusters){
  let db;
  try{
    db=await openUrbanCache();if(!db)return false;
    const root=new THREE.Group();root.name='PBR facade snapshot';
    // Reparent only while the opaque loader is showing. No new geometry or
    // material clones are created; Object3D.toJSON deduplicates shared items.
    for(const sector of clusters)if(sector.node)root.add(sector.node);
    let payload;
    try{payload=root.toJSON();}
    finally{for(const sector of clusters)if(sector.node)sector.parent.add(sector.node);}
    log('Compressione cache HD persistente…');
    const encoded=await encode(payload);
    await transact(db,urbanCacheKey(config),'readwrite',{
      version:VERSION,time:Date.now(),...encoded
    });
    log('Scena HD salvata su disco ('+
      Math.round((encoded.compressed?encoded.data.byteLength:encoded.data.length)/1048576*10)/10+' MiB)');
    return true;
  }catch(error){
    console.warn('[CITY HD CACHE] Storage unavailable; next load will rebuild',error);
    return false;
  }finally{db?.close();}
}
