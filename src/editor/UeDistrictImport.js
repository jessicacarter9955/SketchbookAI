// Integration boundary for verifiable UNREAL-native map exports from DDS UE2Three.
// No user-side upload: a GitHub/Unreal export runner publishes licensed GLBs
// and this file loads them from the same host as the Realistic City.
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';

export const UE_DISTRICTS=['ny','sf','rio','miami'];
export const UE_DISTRICT_MANIFEST='build/local-scenes/ue2three-districts/manifest.json';
const ROOT=UE_DISTRICT_MANIFEST.replace(/manifest\.json$/,'');
const CODE=/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*\.glb$/;
const VALID_LICENSE=/^(CC0|MIT|CC-BY(?:-\d\.\d)?|Apache-2\.0|BSD-3-Clause|GPL-3\.0|Fab Standard|Proprietary authorized)$/;

export function validateUnrealDistrictManifest(data){
 if(!data || data.version!==1 || !data.districts || typeof data.districts!=='object' || Array.isArray(data.districts))
  throw new Error('Manifest Unreal distretti: versione o schema non valido');
 const verified={version:1,districts:{}};
 for(const [id,entry] of Object.entries(data.districts)){
  if(!UE_DISTRICTS.includes(id))throw new Error('Distretto Unreal non riconosciuto: '+id);
  if(!entry || entry.source_type!=='UNREAL_NATIVE_LEVEL' || typeof entry.url!=='string' || !CODE.test(entry.url) ||
     entry.url.includes('..') || !VALID_LICENSE.test(String(entry.license||'')) ||
     !/^https:\/\//.test(String(entry.source_url||'')))
   throw new Error('Asset '+id+': serve GLB Unreal nativo con URL locale sicuro, provenienza e licenza verificata');
  const where=entry.placement||{};
  const pos=where.position;
  if(!Array.isArray(pos)||pos.length!==3||!pos.every(n=>Number.isFinite(n)&&Math.abs(n)<2000))
   throw new Error('Posizione UE non valida per '+id);
  const scale=where.scale??1,rot=where.rotationY??0;
  if(!Number.isFinite(scale)||scale<.001||scale>10||!Number.isFinite(rot))
   throw new Error('Trasformazione UE non valida per '+id);
  if(!['architecture-only','overlay'].includes(entry.coverage))
   throw new Error('Copertura geometria UE non valida: '+id);
  verified.districts[id]={url:ROOT+entry.url,coverage:entry.coverage,position:pos.slice(),
   scale,rotationY:rot,source_url:entry.source_url,license:entry.license};
 }
 return verified;
}

export async function loadUnrealDistricts({fetcher=fetch,loader=new GLTFLoader(),report=()=>{}}={}){
 let response;
 try {response=await fetcher(UE_DISTRICT_MANIFEST,{cache:'no-cache'});}
 catch(error){report('Asset Unreal non ancora pubblicati: '+error.message);return {items:[],missing:true,errors:[]};}
 if(response.status===404){report('Manifest Unreal assente: città procedurale di anteprima, 0/4 zone Unreal.');return {items:[],missing:true,errors:[]};}
 if(!response.ok)throw new Error('Manifest UE2Three: HTTP '+response.status);
 const manifest=validateUnrealDistrictManifest(await response.json()),items=[],errors=[];
 for(const [id,entry] of Object.entries(manifest.districts)){
  try{
   report('Unreal '+id+': scarico '+entry.url);
   const gltf=await loader.loadAsync(entry.url);
   let meshes=0,pbr=0;
   gltf.scene.traverse(o=>{
    if(!o.isMesh)return;
    meshes++; if([].concat(o.material).some(m=>m && (m.map||m.normalMap||m.roughnessMap)))pbr++;
    o.castShadow=true;o.receiveShadow=true;
   });
   if(meshes===0||pbr===0)throw new Error('GLB privo di geometrie o materiali PBR con texture');
   gltf.scene.name='UNREAL '+id+' · '+entry.source_url;
   gltf.scene.position.fromArray(entry.position);gltf.scene.rotation.y=entry.rotationY;
   gltf.scene.scale.setScalar(entry.scale);
   gltf.scene.userData.ue2three={id,source_url:entry.source_url,license:entry.license,meshes,pbr};
   items.push({id,coverage:entry.coverage,scene:gltf.scene,meshes,pbr});
   report('Unreal '+id+': '+meshes+' mesh e '+pbr+' mesh PBR verificate');
  }catch(error){errors.push({id,error:String(error?.message||error)});
   report('Unreal '+id+': errore asset, fallback procedurale ('+error.message+')');}
 }
 return {items,missing:false,errors};
}
