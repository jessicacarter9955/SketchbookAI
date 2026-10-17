import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader';
import {parseSanAndreasNodeFile,buildSanAndreasNetwork} from './sa-paths.mjs';
import {saveSanAndreasFiles,saveSanAndreasGeometryMetadata,clearSanAndreasFiles,listSanAndreasFiles} from './sa-local-map.mjs';

const mount=document.getElementById('sa-viewport'),stats=document.getElementById('sa-stats');
// Return to the exact SA scene that sent the user here, not a different playtest.
const returnScene=new URLSearchParams(location.search).get('scene');
if(['san-andreas-local','san-andreas-streetlab'].includes(returnScene)){
  const play=document.getElementById('sa-play');
  play.href='editor.html?scene='+encodeURIComponent(returnScene)+'&play=1';
  if(returnScene==='san-andreas-streetlab')play.textContent='▶ Avvia San Andreas StreetLab con i tuoi GLB';
}
const logBox=document.getElementById('sa-log'),entries=[];
const log=(msg,error=false)=>{
  entries.push('['+new Date().toLocaleTimeString()+'] '+msg);
  if(entries.length>120)entries.shift();
  logBox.textContent=entries.join('\n');logBox.scrollTop=logBox.scrollHeight;
  (error?console.error:console.info)('[SA import]',msg);
};
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.75));
renderer.setClearColor(0x142330);
mount.append(renderer.domElement);
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(60,1,0.1,15000);
camera.position.set(60,110,140);
const controls=new OrbitControls(camera,renderer.domElement);
controls.enableDamping=true;controls.dampingFactor=.07;
controls.target.set(0,0,0);controls.update();
scene.add(new THREE.HemisphereLight(0xbcdcf4,0x303c3f,2));
const sunlight=new THREE.DirectionalLight(0xffe6cc,2);sunlight.position.set(400,900,300);scene.add(sunlight);
const materials={pedestrian:new THREE.LineBasicMaterial({color:0x6bf5a1,transparent:true,opacity:.9}),
  vehicle:new THREE.LineBasicMaterial({color:0x65c5ff,transparent:true,opacity:.8})};
const pathGroups={pedestrian:new THREE.Group(),vehicle:new THREE.Group()};
pathGroups.pedestrian.name='Authentic San Andreas pedestrian navigation';
pathGroups.vehicle.name='Authentic San Andreas vehicle navigation';
scene.add(pathGroups.pedestrian,pathGroups.vehicle);
const imported=new THREE.Group();imported.name='User imported real GTA SA geometry';scene.add(imported);
let sectorCount=0,nodeCount={pedestrian:0,vehicle:0},loadedMeshes=0,busy=false;
const setStats=()=>{stats.textContent=[
  'Settori nodi: '+sectorCount+' / 64',
  'Nodi pedonali: '+nodeCount.pedestrian,
  'Nodi veicoli: '+nodeCount.vehicle,
  'Modelli GLB autentici: '+loadedMeshes,
  'Nessun file è stato inviato a server'
].join('\n');};
const fit=()=>{
  const box=new THREE.Box3();
  if(imported.children.length)box.expandByObject(imported);
  else for(const group of Object.values(pathGroups))if(group.children.length)box.expandByObject(group);
  if(box.isEmpty())return;
  const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
  controls.target.copy(center);
  const radius=Math.max(5,size.length()*.57);
  camera.near=Math.max(.1,radius/10000);camera.far=Math.max(500,radius*30);
  camera.updateProjectionMatrix();
  camera.position.copy(center).add(new THREE.Vector3(radius*.8,radius*.6,radius*.9));
  controls.update();
};
const renderLinks=(net,type)=>{
  const lines=[];let count=0;
  outer: for(const node of net.nodes)for(const edge of node.edges){
    const end=net.byKey.get(edge.to);
    if(!end||!Number.isFinite(node.y)||!Number.isFinite(end.y))continue;
    lines.push(node.x,node.y+.12,node.z,end.x,end.y+.12,end.z);
    if(++count>=1000000)break outer;
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(lines,3));
  const object=new THREE.LineSegments(geometry,materials[type]);
  pathGroups[type].add(object);nodeCount[type]=net.nodes.length;
};
const releaseGroup=group=>{
  group.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material&&!Object.values(materials).includes(o.material)){
    for(const mat of [].concat(o.material))mat.dispose?.();
  }});
  group.clear();
};
document.getElementById('sa-nodes').onchange=async e=>{
  if(busy)return;
  const list=[...e.target.files];e.target.value='';
  if(!list.length)return;
  busy=true;log('Importazione '+list.length+' file nodes*.dat');
  try{
    const parsed=[],used=new Set();
    for(const file of list){
      const match=/^nodes([0-9]|[1-5][0-9]|6[0-3])\.dat$/i.exec(file.name);
      if(!match)throw Error('Nome file GTA SA non valido: '+file.name);
      const sector=Number(match[1]);
      if(used.has(sector))throw Error('Settore duplicato: '+sector);
      used.add(sector);
      parsed.push(parseSanAndreasNodeFile(await file.arrayBuffer(),sector));
    }
    const ped=buildSanAndreasNetwork(parsed,'pedestrian'),vehicle=buildSanAndreasNetwork(parsed,'vehicle');
    releaseGroup(pathGroups.pedestrian);releaseGroup(pathGroups.vehicle);
    renderLinks(ped,'pedestrian');renderLinks(vehicle,'vehicle');
    await saveSanAndreasFiles('nodes',list);
    sectorCount=parsed.length;setStats();fit();
    log('Rete originale: '+ped.nodes.length+' pedoni, '+vehicle.nodes.length+' veicoli, '+sectorCount+' settori.');
  }catch(error){log('ERRORE NODI: '+error.message,true);}
  finally{busy=false;}
};
const loader=new GLTFLoader();
document.getElementById('sa-meshes').onchange=async e=>{
  if(busy)return;
  const files=[...e.target.files];e.target.value='';
  if(!files.length)return;
  busy=true;
  try{
    if(files.length>128)throw Error('Massimo 128 settori GLB per importazione.');
    // Stage all scenes first; a failed GLB does not erase previously imported map data.
    const staged=[],metadata=[];
    for(const file of files){
      if(!/\.glb$/i.test(file.name)||file.size>256*1024*1024)throw Error('GLB non valido o oltre 256 MB: '+file.name);
      log('Caricamento geometria: '+file.name+' ('+Math.round(file.size/1048576)+' MiB)');
      const url=URL.createObjectURL(file);
      try{
        const gltf=await loader.loadAsync(url);
        if(!gltf.scene?.getObjectByProperty('isMesh',true))throw Error('Il GLB non contiene mesh: '+file.name);
        gltf.scene.name=file.name;
        gltf.scene.updateMatrixWorld(true);
        const box=new THREE.Box3().setFromObject(gltf.scene);
        if(box.isEmpty())throw Error('Geometria GLB senza bounds: '+file.name);
        metadata.push({name:file.name,bounds:[box.min.x,box.min.y,box.min.z,box.max.x,box.max.y,box.max.z]});
        staged.push(gltf.scene);
      }finally{URL.revokeObjectURL(url);}
    }
    await saveSanAndreasFiles('geometry',files);
    await saveSanAndreasGeometryMetadata(metadata);
    log('Indici spaziali salvati: '+metadata.length+' settori. Il gioco può caricare soltanto le zone vicine.');
    releaseGroup(imported);
    loadedMeshes=0;
    for(const obj of staged)imported.add(obj);
    loadedMeshes=staged.length;setStats();fit();
    document.getElementById('sa-play').hidden=false;
    log('Geometria aggiunta: '+staged.length+' GLB originali, totale '+loadedMeshes);
  }catch(error){log('ERRORE MAPPA: '+error.message,true);}
  finally{busy=false;}
};
document.getElementById('sa-vehicle-lines').onchange=e=>pathGroups.vehicle.visible=e.target.checked;
document.getElementById('sa-ped-lines').onchange=e=>pathGroups.pedestrian.visible=e.target.checked;
document.getElementById('sa-focus').onclick=fit;
document.getElementById('sa-clear').onclick=async()=>{
  if(busy)return;
  busy=true;
  try{await Promise.all([clearSanAndreasFiles('geometry'),clearSanAndreasFiles('nodes')]);}
  catch(error){log('ERRORE PULIZIA: '+error.message,true);busy=false;return;}
  busy=false;
  document.getElementById('sa-play').hidden=true;
  releaseGroup(imported);releaseGroup(pathGroups.pedestrian);releaseGroup(pathGroups.vehicle);
  loadedMeshes=0;sectorCount=0;nodeCount={pedestrian:0,vehicle:0};setStats();log('Sessione svuotata.');
};
const allLogs=()=>entries.join('\n');
document.getElementById('sa-copy').onclick=async()=>{
  try{await navigator.clipboard.writeText(allLogs());log('Log copiato.');}
  catch{logBox.focus();const selection=window.getSelection(),range=document.createRange();range.selectNodeContents(logBox);
    selection.removeAllRanges();selection.addRange(range);log('Seleziona e copia il log manualmente.');}
};
document.getElementById('sa-download').onclick=()=>{
  const url=URL.createObjectURL(new Blob([allLogs()],{type:'text/plain'})),a=document.createElement('a');
  a.href=url;a.download='sa-import-log.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
const resize=()=>{const w=Math.max(mount.clientWidth,1),h=Math.max(mount.clientHeight,1);
  renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();};
new ResizeObserver(resize).observe(mount);resize();setStats();
listSanAndreasFiles('geometry').then(keys=>{if(keys.length){document.getElementById('sa-play').hidden=false;log('Settori già salvati in questo browser: '+keys.length+'. Puoi aprire la scena giocabile.');}}).catch(error=>log('Archivio locale: '+error.message,true));
log('Visualizzatore pronto. Seleziona file GTA SA originali, non sono inclusi nel deploy.');
function frame(){requestAnimationFrame(frame);controls.update();renderer.render(scene,camera);}
frame();
