// Recover a San Andreas scene on the SAME Netlify origin used for the eventual play session.
// Never fetch or ship proprietary GTA geometry: only user-selected, local, embedded-texture GLBs.
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {parseSanAndreasNodeFile,buildSanAndreasNetwork} from './sa-paths.mjs';
import {
  listSanAndreasFiles,saveSanAndreasFiles,saveSanAndreasGeometryMetadata,
  validateSaGeometryMetadata,saFileSector
} from './sa-local-map.mjs';

const MAX_GLB_SIZE=256*1024*1024;
export function validateSaGeometryInput(files){
  const list=Array.from(files||[]);
  if(!list.length||list.length>128)throw Error('Seleziona da 1 a 128 settori GLB originali.');
  const keys=new Set();
  for(const file of list){
    if(!file||!/^[a-z0-9_.-]+\.glb$/i.test(file.name)||file.name.startsWith('.')||
       !Number.isFinite(file.size)||file.size<20||file.size>MAX_GLB_SIZE)
      throw Error('Settore GLB non valido o oltre 256 MB: '+(file?.name||'file sconosciuto'));
    const name=file.name.toLowerCase();
    if(keys.has(name))throw Error('File GLB duplicato: '+name);
    keys.add(name);
  }
  return list;
}
function validateGlbHeader(bytes,name){
  if(bytes.byteLength<20)throw Error('GLB troppo breve: '+name);
  const view=new DataView(bytes);
  if(view.getUint32(0,true)!==0x46546c67||
     view.getUint32(4,true)!==2||view.getUint32(8,true)!==bytes.byteLength)
    throw Error('Il file non è un GLB v2 completo: '+name);
}
function disposeStaged(scene){
  const geometry=new Set(),materials=new Set(),textures=new Set();
  scene.traverse(node=>{
    if(node.geometry)geometry.add(node.geometry);
    if(node.material)for(const mat of [].concat(node.material))materials.add(mat);
  });
  for(const mat of materials){
    for(const value of Object.values(mat))if(value?.isTexture)textures.add(value);
    mat.dispose?.();
  }
  for(const tex of textures)tex.dispose?.();
  for(const g of geometry)g.dispose?.();
}
export async function importSaGeometryFromBrowser(files,report=()=>{}){
  const list=validateSaGeometryInput(files),loader=new GLTFLoader(),metadata=[];
  // Validate all GLBs BEFORE altering IndexedDB, keeping the previous import intact on failure.
  for(let i=0;i<list.length;i++){
    const file=list[i];
    report('Verifico '+(i+1)+'/'+list.length+': '+file.name);
    const bytes=await file.arrayBuffer();
    validateGlbHeader(bytes,file.name);
    const gltf=await loader.parseAsync(bytes,'');
    try{
      if(!gltf.scene?.getObjectByProperty('isMesh',true))
        throw Error('Il settore GLB non contiene mesh: '+file.name);
      gltf.scene.updateMatrixWorld(true);
      const box=new THREE.Box3().setFromObject(gltf.scene);
      metadata.push({name:file.name,bounds:[
        box.min.x,box.min.y,box.min.z,box.max.x,box.max.y,box.max.z
      ]});
    }finally{if(gltf.scene)disposeStaged(gltf.scene);}
  }
  validateSaGeometryMetadata(metadata);
  report('Salvataggio locale di '+list.length+' settori verificati (nessun upload)…');
  await saveSanAndreasFiles('geometry',list);
  await saveSanAndreasGeometryMetadata(metadata);
  return list.length;
}
export async function importSaNodesFromBrowser(files,report=()=>{}){
  const list=Array.from(files||[]),sectors=new Set(),parsed=[];
  if(!list.length||list.length>64)throw Error('Seleziona da 1 a 64 file nodes*.dat.');
  for(const file of list){
    const sector=saFileSector(file?.name||'');
    if(sector===null||sectors.has(sector))throw Error('Nome nodo originale non valido o duplicato: '+file?.name);
    sectors.add(sector);
    report('Verifico nodo '+(parsed.length+1)+'/'+list.length+': '+file.name);
    parsed.push(parseSanAndreasNodeFile(await file.arrayBuffer(),sector));
  }
  const pedestrian=buildSanAndreasNetwork(parsed,'pedestrian');
  const vehicle=buildSanAndreasNetwork(parsed,'vehicle');
  await saveSanAndreasFiles('nodes',list);
  return {files:list.length,pedestrians:pedestrian.nodes.length,vehicles:vehicle.nodes.length};
}

// Missing locally imported geometry is an expected user-input state, NOT a fatal app crash.
export async function requireSaGeometry({loading,sceneId,report,diagnostics}){
  if((await listSanAndreasFiles('geometry')).length)return;
  const panel=loading?.querySelector('.city-loading-panel');
  if(!panel)throw Error('Schermata di importazione SA non disponibile.');
  const section=document.createElement('section');
  section.className='sa-local-recovery';
  section.innerHTML=
    '<h2>San Andreas StreetLab · Importazione richiesta</h2>'+
    '<p>Questa scena utilizza settori <strong>GTA San Andreas originali</strong>, che non sono pubblicati su Netlify. '+
    'Se li hai importati su un altro link di deploy, qui non sono visibili: il browser separa i dati per dominio.</p>'+
    '<label>1 · Scegli i tuoi settori GLB originali (obbligatorio)'+
    '<input data-sa-glb type="file" accept=".glb" multiple></label>'+
    '<label>2 · Scegli nodes0.dat … nodes63.dat (per traffico e pedoni autentici)'+
    '<input data-sa-nodes type="file" accept=".dat" multiple></label>'+
    '<p data-sa-import-status role="status" aria-live="polite">In attesa dei tuoi GLB, senza bloccare il browser. '+
    'Le importazioni restano in questo dominio, non vengono inviate al server.</p>'+
    '<a data-sa-import-viewer href="sa-navigation.html">Apri anche il visualizzatore/importatore 3D</a>';
  const go=section.querySelector('[data-sa-import-viewer]');
  go.href='sa-navigation.html?scene='+encodeURIComponent(
    sceneId==='san-andreas-streetlab'?'san-andreas-streetlab':'san-andreas-local');
  panel.append(section);
  loading.style.display='flex';
  diagnostics?.waitingForUser?.('Seleziona i settori GLB originali da questo dispositivo.');
  report('San Andreas: in attesa dei settori originali GLB locali, nessun asset fittizio.');
  const glb=section.querySelector('[data-sa-glb]');
  const nodes=section.querySelector('[data-sa-nodes]');
  const status=section.querySelector('[data-sa-import-status]');
  return new Promise(resolve=>{
    let busy=false;
    nodes.onchange=async()=>{
      if(busy)return;
      const chosen=Array.from(nodes.files||[]);
      nodes.value='';if(!chosen.length)return;
      busy=true;glb.disabled=true;nodes.disabled=true;
      try{
        const result=await importSaNodesFromBrowser(chosen,text=>{
          status.textContent=text;diagnostics?.activity?.('SA IMPORT: '+text);
        });
        status.textContent='Nodi salvati: '+result.vehicles+' veicoli e '+result.pedestrians+
          ' pedoni. Seleziona ora i GLB per entrare nella scena.';
        diagnostics?.activity?.('Nodi SA originali salvati: '+result.files);
      }catch(error){status.textContent='Import nodi non riuscito: '+error.message;
        diagnostics?.problem?.(error,'Import nodi SA');}
      finally{busy=false;glb.disabled=false;nodes.disabled=false;}
    };
    glb.onchange=async()=>{
      if(busy)return;
      const chosen=Array.from(glb.files||[]);
      glb.value='';if(!chosen.length)return;
      busy=true;glb.disabled=true;nodes.disabled=true;
      try{
        const count=await importSaGeometryFromBrowser(chosen,text=>{
          status.textContent=text;diagnostics?.activity?.('SA IMPORT: '+text);
        });
        diagnostics?.activity?.('SA: '+count+' GLB originali salvati; avvio StreetLab.');
        status.textContent=count+' settori GLB importati. Avvio la mappa originale…';
        diagnostics?.resumeUser?.();
        section.remove();resolve();
      }catch(error){
        status.textContent='Importazione non riuscita: '+error.message+
          '. Correggi i GLB e riprova senza perdere i dati già salvati.';
        diagnostics?.problem?.(error,'Import GLB SA');
        busy=false;glb.disabled=false;nodes.disabled=false;
      }
    };
  });
}
