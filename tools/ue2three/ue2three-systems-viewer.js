import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {forEachCollisionChunk} from '../../src/editor/ue2three-collision.mjs';
import {NativeEffectBridge,nativeEffectCoverage} from '../../src/editor/ue2three-native-effects.mjs';
import {configureMapLights} from './map-presentation.mjs';

const $=id=>document.getElementById(id),report={schema_version:1,scope:'technical_fixture_not_dds_gameplay',checks:[],source_calls:[]};
const log=text=>{$('log').textContent+=`\n${new Date().toLocaleTimeString()} · ${text}`;};
function check(name,ok,scope) {
  report.checks.push({name,ok,scope});const row=document.createElement('tr');
  for(const value of [name,ok?'🟢 Superato':'🔴 Fallito',scope]){const cell=document.createElement('td');cell.textContent=value;row.append(cell);} $('checks').append(row);
  $('progress').value=report.checks.length;log(`${name}: ${ok?'superato':'fallito'}`);
}
const canvas=$('view'),renderer=new THREE.WebGLRenderer({canvas,antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
const scene=new THREE.Scene();scene.background=new THREE.Color(0x182430);
const root=new THREE.Group();scene.add(root);
const origin=new THREE.Vector3(1000,20,-1000);
const floor=new THREE.Mesh(new THREE.BoxGeometry(12,0.3,10),new THREE.MeshStandardMaterial({color:0x4b7885,roughness:0.9}));
floor.position.copy(origin);root.add(floor);
for(const [x,z,color] of [[-2,1,0x3b99a9],[2,-1,0xe99a45]]) {
 const box=new THREE.Mesh(new THREE.BoxGeometry(1.5,1.5,1.5),new THREE.MeshStandardMaterial({color}));
 box.position.copy(origin).add(new THREE.Vector3(x,0.9,z));root.add(box);
}
const sun=new THREE.DirectionalLight(0xffead7,3);sun.position.copy(origin).add(new THREE.Vector3(5,10,6));sun.target.position.copy(origin);root.add(sun,sun.target);
scene.add(new THREE.HemisphereLight(0xc6e7ff,0x516066,1));
configureMapLights(renderer,root);
const camera=new THREE.PerspectiveCamera(48,1,0.01,100);camera.position.copy(origin).add(new THREE.Vector3(10,8,11));camera.lookAt(origin);
const world=new CANNON.World({gravity:new CANNON.Vec3(0,-9.81,0)});
let stats;forEachCollisionChunk(root,(vertices,indices)=>world.addBody(new CANNON.Body({mass:0,shape:new CANNON.Trimesh(vertices,indices)})),{onStats:value=>stats=value});
const ball=new CANNON.Body({mass:1,shape:new CANNON.Sphere(0.5)});ball.position.set(origin.x,origin.y+4,origin.z);world.addBody(ball);
const mesh=new THREE.Mesh(new THREE.SphereGeometry(0.5,24,16),new THREE.MeshStandardMaterial({color:0xf0cb56,roughness:0.4}));mesh.castShadow=true;scene.add(mesh);
function draw(){renderer.setSize(canvas.clientWidth,canvas.clientHeight,false);camera.aspect=canvas.clientWidth/canvas.clientHeight;camera.updateProjectionMatrix();mesh.position.copy(ball.position);renderer.render(scene,camera);}
draw();
const waitFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
async function run() {
  log('Simulazione di 360 passi fisici su superfici trasformate.');
  for(let step=0;step<360;step++){world.step(1/120);if(step%6===0){draw();await waitFrame();}}
  draw();check('Contatto fisico',Math.abs(ball.position.y-(origin.y+0.65))<0.03 && world.contacts.length>0,'Sfera su triangoli statici; non è il Mover/PhysicsAsset DDS.');
  report.physics={...stats,body_height:ball.position.y,contacts:world.contacts.length};
  const bounds=new THREE.Box3().setFromObject(root),points=[];sun.shadow.camera.updateMatrixWorld(true);
  for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])points.push(new THREE.Vector3(x,y,z).project(sun.shadow.camera));
  const gl=renderer.getContext();
  const pixels=()=>{const data=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,data);return data;};
  draw();const shadowed=pixels();sun.castShadow=false;draw();const unshadowed=pixels();sun.castShadow=true;draw();
  let changed=0;for(let i=0;i<shadowed.length;i+=4)if(Math.abs(shadowed[i]-unshadowed[i])+Math.abs(shadowed[i+1]-unshadowed[i+1])+Math.abs(shadowed[i+2]-unshadowed[i+2])>6)changed++;
  report.shadow_pixels_changed=changed;
  check('Ombre fuori origine',changed>16 && points.every(p=>Math.abs(p.x)<=1&&Math.abs(p.y)<=1&&Math.abs(p.z)<=1),`Frustum e pixel delle ombre verificati (${changed} pixel differenti). Lumen/postprocessing esclusi.`);
  const bridge=new NativeEffectBridge(),identity=['/Script/Engine','AudioComponent','SetVolumeMultiplier'],ordered=[];
  bridge.register(identity,async e=>{await Promise.resolve();ordered.push(e.arguments[0]);});
  await bridge.enqueue([1,2,3].map(n=>({op:'native_audio_vfx',identity,arguments:[n]})));
  check('Ordine degli effetti',ordered.join(',')==='1,2,3','Prova tecnica della coda; non riproduce suoni DDS.');
  await bridge.enqueue([{op:'native_audio_vfx',identity:['/Script/Niagara','NiagaraFunctionLibrary','SpawnSystemAtLocation'],arguments:[]}]);
  check('Effetti non supportati',bridge.receipts.at(-1)?.code==='adapter_missing','Adapter mancante segnalato; nessun Niagara sostitutivo inventato.');
  report.receipts=bridge.receipts;
  const params=new URLSearchParams(location.search),base=params.get('base') || 'build/local-scenes/ue2three/projects/VIPExtractionKitDDS-23a280ac11/';
  if(!/^build\/local-scenes\/ue2three\/projects\/[A-Za-z0-9_-]+\/$/.test(base))throw Error('Percorso progetto non valido');
  const response=await fetch('/'+base+'blueprint-programs.json',{cache:'no-store'});
  if(!response.ok)throw Error('Report Blueprint DDS non disponibile');
  const programs=await response.json();report.source_calls=nativeEffectCoverage(programs);report.source_counts=programs.counts;
  $('source-status').textContent=`Report salvato: ${programs.counts.translated} funzioni tradotte, ${programs.counts.blocked} bloccate. Queste chiamate non provano l’esecuzione dei flussi originali.`;
  for(const call of report.source_calls){const row=document.createElement('tr');for(const value of [call.identity.slice(1).join('.'),call.call_sites,'🟡 Asset/grafo originale e binding dei componenti']){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}$('coverage').append(row);}
  const audio=await fetch('/'+base+'audio-manifest.json',{cache:'no-store'});
  $('audio-state').textContent=audio.ok?'Manifest audio presente: riproduzione originale ancora da verificare.':'🔴 Manifest audio originale non presente in questo progetto pubblicato.';
  report.audio_manifest_present=audio.ok;report.multiplayer_verified=false;report.dds_gameplay_verified=false;
  $('result').textContent=JSON.stringify(report,null,2);log('Controlli terminati. I risultati verdi riguardano esclusivamente le prove tecniche indicate.');
}
run().catch(error=>{log('Errore: '+error.message);report.error=error.message;$('result').textContent=JSON.stringify(report,null,2);});
window.addEventListener('resize',draw);
