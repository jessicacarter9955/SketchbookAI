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

// Sketchbook ships this freely redistributable demo scene with the application.
// It is NOT a Rockstar / GTA San Andreas game asset or a substitute claim.
const DEMO_NAME='sketchbook-demo-world.glb';
const DEMO_URL='build/assets/world.glb';
export const isSketchbookSaDemo = keys => Array.from(keys||[]).includes(DEMO_NAME);
function showDemoNotice(report=()=>{},diagnostics){
  const message='STREETLAB DEMO SKETCHBOOK · Geometria GTA San Andreas originale non disponibile. '+
    'La scena di prova è stata caricata automaticamente dal progetto.';
  if(!document.getElementById('sa-demo-notice')){
    const notice=document.createElement('aside');
    notice.id='sa-demo-notice';
    notice.setAttribute('role','status');
    notice.textContent=message;
    Object.assign(notice.style,{position:'fixed',zIndex:'10012',right:'12px',bottom:'12px',
      maxWidth:'min(440px,90vw)',padding:'9px 12px',borderRadius:'7px',
      border:'1px solid #78aec8',background:'rgba(12,31,43,.9)',
      color:'#f5faff',font:'600 12px/1.45 system-ui',pointerEvents:'none'});
    document.body.append(notice);
  }
  diagnostics?.activity?.(message);report(message);
}
export async function tryAutoLoadSketchbookDemo({sceneId,report=()=>{},diagnostics}){
  // The genuine-SA import scene stays strict; only StreetLab provides a demo
  // fallback. ?sa=original opts out without disabling the local importer.
  if(sceneId!=='san-andreas-streetlab'||
    new URLSearchParams(location.search).get('sa')==='original')return false;
  const keys=await listSanAndreasFiles('geometry');
  if(keys.length){
    if(isSketchbookSaDemo(keys))showDemoNotice(report,diagnostics);
    return true;
  }
  diagnostics?.stage?.('StreetLab · download automatico demo Sketchbook');
  report('StreetLab: nessun settore originale disponibile, preparo demo Sketchbook inclusa nel sito…');
  try{
    const response=await fetch(new URL(DEMO_URL,location.href),{
      signal:AbortSignal.timeout(60000),cache:'force-cache'
    });
    if(!response.ok)throw Error('Demo Sketchbook HTTP '+response.status);
    const blob=await response.blob();
    if(blob.size<100000||blob.size>256*1024*1024)
      throw Error('GLB demo troppo piccolo o non valido: '+blob.size+' byte');
    const file=new File([blob],DEMO_NAME,{type:'model/gltf-binary'});
    // Same validated import path as user-selected original GLBs. Cache it for
    // future visits on this hostname. Never upload any user's files.
    await importSaGeometryFromBrowser([file],msg=>{
      report('StreetLab AUTO: '+msg);
      diagnostics?.activity?.('SA DEMO: '+msg);
    });
    showDemoNotice(report,diagnostics);
    diagnostics?.stage?.('StreetLab · download automatico demo Sketchbook','done');
    return true;
  }catch(error){
    diagnostics?.problem?.(error,'Download automatico demo StreetLab');
    report('StreetLab: demo automatica indisponibile ('+error.message+'), apro diagnostica importazione.');
    return false;
  }
}

// Missing locally imported geometry is an expected user-input state, NOT a fatal app crash.
export async function requireSaGeometry({loading,sceneId,report,diagnostics}){
  if(await tryAutoLoadSketchbookDemo({sceneId,report,diagnostics}))return;
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
