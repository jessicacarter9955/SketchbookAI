import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader';
import {readSanAndreasFile,listSanAndreasFiles,listSanAndreasGeometryMetadata,saFileSector} from './sa-local-map.mjs';
import {parseSanAndreasNodeFile,buildSanAndreasNetwork} from './sa-paths.mjs';
import {nearestSanAndreasSectors,saSectorDistanceXZ,sanAndreasResolutionStep} from './sa-streaming.mjs';

// Import original geometry only. Sector bounds are indexed at import time;
// nearby GLBs are loaded on demand and distant ones released from GPU memory.
const MAX_COLLIDER_TRIANGLES=55000,PHYSICS_RADIUS=130,MAX_ACTIVE_COLLIDERS=36;
const LOAD_RADIUS=520,UNLOAD_RADIUS=1250,MAX_VISIBLE_SECTORS=12;
export function saBoundsDistanceXZ(point,box){
 const x=Math.max(box.min.x-point.x,0,point.x-box.max.x);
 const z=Math.max(box.min.z-point.z,0,point.z-box.max.z);
 return Math.hypot(x,z);
}
export function saCollisionTriangleCount(geometry){
 const n=geometry.index?.count??geometry.attributes.position?.count??0;
 return Math.floor(n/3);
}
export function saSpawnFromNetwork(graph,bounds){
 const mid=bounds.getCenter(new THREE.Vector3());
 if(!graph?.nodes?.length)return [mid.x,bounds.max.y,mid.z];
 const eligible=graph.nodes.filter(n=>n.x>=bounds.min.x&&n.x<=bounds.max.x&&n.z>=bounds.min.z&&n.z<=bounds.max.z&&!n.roadBlock);
 const candidates=eligible.length?eligible:graph.nodes;
 const node=candidates.reduce((best,n)=>{
  const d=Math.hypot(n.x-mid.x,n.z-mid.z);
  return !best||d<best.distance?{node:n,distance:d}:best;
 },null)?.node;
 return [node.x,node.y,node.z];
}
export class SanAndreasRuntime{
 constructor(world){
  this.world=world;this.root=new THREE.Group();this.root.name='San Andreas · GLB originali importati';
  world.graphicsWorld.add(this.root);
  this.surfaces=[];this.colliders=new Map();this.sectors=new Map();this.pending=new Map();
  this.lastErrors=new Map();this.loader=new GLTFLoader();this.ready=false;this.lastTick=0;
  this.initializing=true;this.initialNames=[];this.frameStart=performance.now();this.frameCount=0;
  this.fps=0;this.drawCalls=0;this.lastResolutionChange=performance.now();
  this.maxPixelRatio=Math.min(globalThis.devicePixelRatio||1,1.25);
  this.minPixelRatio=Math.min(this.maxPixelRatio,0.9);
  world.camera.far=12000;world.camera.updateProjectionMatrix();
  world.renderer.setPixelRatio(this.maxPixelRatio);
  world.respawnPosition=new CANNON.Vec3(0,3,0);
  world.isOutOfBounds=p=>p.y<-1200||Math.abs(p.x)>12000||Math.abs(p.z)>12000;
 }
 async initialize(report=()=>{}){
  this.report=report;
  const names=await listSanAndreasFiles('geometry');
  if(!names.length)throw Error('Nessuna geometria San Andreas importata. Apri sa-navigation.html, seleziona i settori GLB originali e poi premi Prova.');
  const nodeNames=await listSanAndreasFiles('nodes'),parsed=[];
  for(let i=0;i<nodeNames.length;i++){
   const name=nodeNames[i],sector=saFileSector(name);
   if(sector===null)throw Error('Nome nodo SA non valido: '+name);
   const blob=await readSanAndreasFile('nodes',name);
   if(!blob)throw Error('Nodi originali non trovati in archivio: '+name);
   parsed.push(parseSanAndreasNodeFile(await blob.arrayBuffer(),sector));
   if(i%6===5)await new Promise(resolve=>setTimeout(resolve,0));
  }
  this.navigation={pedestrian:parsed.length?buildSanAndreasNetwork(parsed,'pedestrian'):null,
    vehicle:parsed.length?buildSanAndreasNetwork(parsed,'vehicle'):null};
  const meta=await listSanAndreasGeometryMetadata(),byName=new Map(meta.map(m=>[m.name,m]));
  const missing=names.filter(n=>!byName.has(n));
  // Pre-indexed geometry is required to avoid decoding all GLBs to locate spawn.
  if(missing.length){
   if(names.length>2)throw Error('Questa mappa è stata importata prima dello streaming. Riapri sa-navigation.html e reimporta i GLB per creare i bounds spaziali.');
   this.report('San Andreas: vecchia importazione senza bounds, carico '+names.length+' GLB.');
   const coarse=[];
   for(const name of names){
    const sector=await this.loadSector(name);
    const b=new THREE.Box3().setFromObject(sector.scene);
    coarse.push({name,bounds:[b.min.x,b.min.y,b.min.z,b.max.x,b.max.y,b.max.z]});
   }
   this.sectorInfo=coarse;
  }else this.sectorInfo=names.map(n=>byName.get(n));
  const bounds=new THREE.Box3();
  for(const s of this.sectorInfo){
   bounds.expandByPoint(new THREE.Vector3(s.bounds[0],s.bounds[1],s.bounds[2]));
   bounds.expandByPoint(new THREE.Vector3(s.bounds[3],s.bounds[4],s.bounds[5]));
  }
  this.bounds=bounds;
  const start=saSpawnFromNetwork(this.navigation.pedestrian,bounds);
  const target=new THREE.Vector3(...start);
  await this.ensure(target,LOAD_RADIUS);
  if(!this.surfaces.length)throw Error('Nessuna superficie reale disponibile vicino allo spawn GTA SA.');
  let floor=this.groundAt(start[0],start[2],start[1]+12);
  if(floor===undefined)floor=this.groundAt(start[0],start[2],bounds.max.y+3);
  const spawn=[start[0],Number.isFinite(floor)?floor:start[1],start[2]];
  this.manifest={spawns:[{id:'sa-import-spawn',name:'Zona originale importata',position:spawn}]};
  this.report('San Andreas: '+this.sectors.size+'/'+names.length+' settori caricati, '+(this.navigation.pedestrian?.nodes.length||0)+' nodi pedoni, '+(this.navigation.vehicle?.nodes.length||0)+' nodi auto.');
  this.refreshPhysics(new THREE.Vector3(...spawn));
  if(this.world.renderer.compileAsync)await this.world.renderer.compileAsync(this.world.graphicsWorld,this.world.camera);
  this.initializing=false;this.ready=true;
 }
 async loadSector(name){
  if(this.sectors.has(name))return this.sectors.get(name);
  if(this.pending.has(name))return this.pending.get(name);
  const task=(async()=>{
   const blob=await readSanAndreasFile('geometry',name);
   if(!blob)throw Error('GLB originale mancante: '+name);
   const gltf=await this.loader.parseAsync(await blob.arrayBuffer(),'');
   if(!gltf.scene?.getObjectByProperty('isMesh',true))throw Error('GLB senza geometria: '+name);
   const scene=gltf.scene;scene.name='San Andreas original · '+name;
   scene.updateMatrixWorld(true);
   const record={name,scene,surfaces:[],loadedAt:performance.now()};
   scene.traverse(mesh=>{
    if(!mesh.isMesh||!mesh.geometry?.attributes?.position)return;
    const box=new THREE.Box3().setFromObject(mesh);
    if(box.isEmpty())return;
    record.surfaces.push({mesh,bbox:box,body:null,ignored:false});
    // All imported map geometry is static. Keep its exact geometry/materials.
    if(!mesh.isSkinnedMesh)mesh.matrixAutoUpdate=false;
   });
   if(!record.surfaces.length)throw Error('Nessuna mesh utilizzabile in settore: '+name);
   this.root.add(scene);this.sectors.set(name,record);
   this.surfaces.push(...record.surfaces);
   this.lastErrors.delete(name);
   return record;
  })();
  this.pending.set(name,task);
  try{return await task;}catch(error){this.lastErrors.set(name,performance.now());throw error;}
  finally{this.pending.delete(name);}
 }
 unloadSector(name){
  const record=this.sectors.get(name);if(!record)return;
  for(const surface of record.surfaces){
   if(this.colliders.has(surface)){
    this.world.physicsWorld.removeBody(this.colliders.get(surface));
    this.colliders.delete(surface);
   }
  }
  this.surfaces=this.surfaces.filter(s=>!record.surfaces.includes(s));
  this.root.remove(record.scene);
  const geometries=new Set(),materials=new Set(),textures=new Set();
  record.scene.traverse(obj=>{
   if(obj.geometry)geometries.add(obj.geometry);
   if(obj.material)for(const mat of [].concat(obj.material))materials.add(mat);
  });
  for(const mat of materials){
   for(const value of Object.values(mat))if(value?.isTexture)textures.add(value);
   mat.dispose();
  }
  for(const texture of textures)texture.dispose();
  for(const geometry of geometries)geometry.dispose();
  this.sectors.delete(name);
 }
 async ensure(point,radius=LOAD_RADIUS){
  const wanted=nearestSanAndreasSectors(this.sectorInfo,point,radius,MAX_VISIBLE_SECTORS);
  const needs=wanted.filter(x=>!this.sectors.has(x.name)&&!this.pending.has(x.name));
  for(let i=0;i<needs.length;i+=2){
   const batch=needs.slice(i,i+2);
   // All requested sectors must finish before the initial play view is revealed.
   await Promise.all(batch.map(s=>this.loadSector(s.name)));
   this.report?.('San Andreas: '+this.sectors.size+' settori autentici pronti su '+this.sectorInfo.length);
   if(i%4===2)await new Promise(resolve=>setTimeout(resolve,0));
  }
  this.refreshPhysics(point);
  return wanted.length;
 }
 focusPosition(){
  const p=this.world.editorPlayer;
  return p?.controlledObject?.position||p?.position||
    new THREE.Vector3(...this.manifest?.spawns?.[0]?.position||[0,0,0]);
 }
 groundAt(x,z,top=1000){
  const ray=new THREE.Raycaster(new THREE.Vector3(x,top,z),new THREE.Vector3(0,-1,0),0,40000);
  // Keep only meshes whose bounding boxes contain the query in X/Z;
  // unlike brute-force scene traversal this scales with local sector density.
  const nearby=this.surfaces.filter(s=>x>=s.bbox.min.x&&x<=s.bbox.max.x&&z>=s.bbox.min.z&&z<=s.bbox.max.z);
  const hit=ray.intersectObjects(nearby.map(s=>s.mesh),false)[0];
  return hit?.point.y;
 }
 makeCollider(surface){
  const {mesh}=surface,geometry=mesh.geometry;
  const tris=saCollisionTriangleCount(geometry);
  if(!tris||tris>MAX_COLLIDER_TRIANGLES){surface.ignored=true;return null;}
  const pos=geometry.attributes.position,idx=geometry.index;
  if(!pos||pos.count<3){surface.ignored=true;return null;}
  const v=new Float32Array(pos.count*3),point=new THREE.Vector3();
  mesh.updateMatrixWorld(true);
  for(let i=0;i<pos.count;i++){
   point.fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld);
   v[i*3]=point.x;v[i*3+1]=point.y;v[i*3+2]=point.z;
  }
  const indices=idx?Array.from(idx.array):Array.from({length:pos.count},(_,i)=>i);
  if(indices.length%3!==0){surface.ignored=true;return null;}
  const body=new CANNON.Body({mass:0,shape:new CANNON.Trimesh(Array.from(v),indices)});
  this.world.physicsWorld.addBody(body);
  surface.body=body;return body;
 }
 refreshPhysics(position){
  if(!this.surfaces.length)return;
  const near=this.surfaces.map(surface=>({surface,d:saBoundsDistanceXZ(position,surface.bbox)}))
   .filter(x=>x.d<PHYSICS_RADIUS).sort((a,b)=>a.d-b.d).slice(0,MAX_ACTIVE_COLLIDERS);
  const keep=new Set(near.map(x=>x.surface));
  for(const [surface,body] of this.colliders)if(!keep.has(surface)){
   this.world.physicsWorld.removeBody(body);this.colliders.delete(surface);surface.body=null;
  }
  // Creating one huge trimesh is expensive. Budget at most 3 new physics meshes
  // per streaming tick, prioritizing those closest to the controlled player.
  let added=0;
  for(const {surface} of near){
   if(surface.body||surface.ignored)continue;
   if(added>=3)break;
   const collider=this.makeCollider(surface);
   if(collider){this.colliders.set(surface,collider);added++;}
  }
 }
 samplePerformance(now){
  this.frameCount++;
  if(now-this.frameStart<1900)return;
  this.fps=Math.round(1000*this.frameCount/(now-this.frameStart));
  this.frameCount=0;this.frameStart=now;
  this.drawCalls=this.world.renderer.info?.render?.calls??0;
  if(this.initializing||new URLSearchParams(location.search).get('adaptive')==='0'||now-this.lastResolutionChange<5800)return;
  const current=this.world.renderer.getPixelRatio();
  const next=sanAndreasResolutionStep(this.fps,current,this.minPixelRatio,this.maxPixelRatio);
  if(Math.abs(next-current)>.01){this.world.renderer.setPixelRatio(next);this.lastResolutionChange=now;}
 }
 update(){
  if(!this.ready)return;
  const now=performance.now(),player=this.focusPosition();
  this.world.actorLayer?.update(player);
  this.samplePerformance(now);
  if(now-this.lastTick<600)return;
  this.lastTick=now;
  this.refreshPhysics(player);
  // Load only nearby original sectors; stream asynchronously, never drop all
  // existing sections while a new GLB is being parsed.
  if(!this.streaming){
   this.streaming=true;
   this.ensure(player).catch(e=>this.report?.('San Andreas · streaming: '+e.message))
     .finally(()=>this.streaming=false);
  }
  for(const s of this.sectorInfo){
   if(saSectorDistanceXZ(player,s.bounds)<UNLOAD_RADIUS)continue;
   if(this.sectors.has(s.name)&&this.sectors.size>2)this.unloadSector(s.name);
  }
  const hud=document.querySelector('[data-city-status]');
  if(hud)hud.textContent='San Andreas · '+this.fps+' FPS · '+this.drawCalls+' draw calls · '+this.sectors.size+'/'+this.sectorInfo.length+' settori · '+this.colliders.size+' collider · '+(this.world.actorLayer?.saPopulation?.stats.active||0)+' agenti';
 }
}
