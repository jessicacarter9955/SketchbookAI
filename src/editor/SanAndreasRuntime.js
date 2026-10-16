import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader';
import {readSanAndreasFile,listSanAndreasFiles,saFileSector} from './sa-local-map.mjs';
import {parseSanAndreasNodeFile,buildSanAndreasNetwork} from './sa-paths.mjs';

// Real geometry and nodes only. This is the first playable bridge, not
// a reproduction of the complete GTA SA mission/vehicle/map systems.
const MAX_COLLIDER_TRIANGLES=55000,PHYSICS_RADIUS=130,MAX_ACTIVE_COLLIDERS=36;
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
  this.surfaces=[];this.colliders=new Map();this.ready=false;this.lastTick=0;
  world.camera.far=12000;world.camera.updateProjectionMatrix();
  world.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio||1,1.25));
  world.respawnPosition=new CANNON.Vec3(0,3,0);
  world.isOutOfBounds=p=>p.y<-1200||Math.abs(p.x)>12000||Math.abs(p.z)>12000;
 }
 async initialize(report=()=>{}){
  this.report=report;
  const names=await listSanAndreasFiles('geometry');
  if(!names.length)throw Error('Nessuna geometria San Andreas importata. Apri sa-navigation.html, seleziona i settori GLB originali e poi premi Prova.');
  this.report('San Andreas · '+names.length+' settori originali; inizializzo GLB e texture incorporate.');
  const loader=new GLTFLoader(),bounds=new THREE.Box3();
  for(let i=0;i<names.length;i++){
    const name=names[i],file=await readSanAndreasFile('geometry',name);
    if(!file)throw Error('GLB locale non più disponibile: '+name);
    const parsed=await loader.parseAsync(await file.arrayBuffer(),'');
    if(!parsed.scene?.getObjectByProperty('isMesh',true))throw Error('GLB senza geometria: '+name);
    parsed.scene.name='San Andreas sector · '+name;
    this.root.add(parsed.scene);
    parsed.scene.updateMatrixWorld(true);
    bounds.expandByObject(parsed.scene);
    parsed.scene.traverse(mesh=>{
      if(!mesh.isMesh||!mesh.geometry?.attributes?.position)return;
      const bbox=new THREE.Box3().setFromObject(mesh);
      if(bbox.isEmpty())return;
      this.surfaces.push({mesh,bbox,body:null,ignored:false});
    });
    this.report('San Andreas · mesh autentiche '+(i+1)+'/'+names.length+': '+name);
    if(i%2===1)await new Promise(resolve=>setTimeout(resolve,0));
  }
  if(bounds.isEmpty()||!this.surfaces.length)throw Error('GLB importati privi di superfici utilizzabili.');
  this.bounds=bounds;
  const nodeNames=await listSanAndreasFiles('nodes'),parsed=[];
  for(let i=0;i<nodeNames.length;i++){
    const name=nodeNames[i],sector=saFileSector(name);
    if(sector===null)throw Error('Nome nodo SA non valido: '+name);
    const file=await readSanAndreasFile('nodes',name);
    if(!file)throw Error('File nodes*.dat scomparso: '+name);
    parsed.push(parseSanAndreasNodeFile(await file.arrayBuffer(),sector));
    if(i%6===5)await new Promise(resolve=>setTimeout(resolve,0));
  }
  this.navigation={
    pedestrian:parsed.length?buildSanAndreasNetwork(parsed,'pedestrian'):null,
    vehicle:parsed.length?buildSanAndreasNetwork(parsed,'vehicle'):null
  };
  const sp=saSpawnFromNetwork(this.navigation.pedestrian,bounds);
  const floor=this.groundAt(sp[0],sp[2],sp[1]+12);
  const spawn=[sp[0],Number.isFinite(floor)?floor:sp[1],sp[2]];
  this.manifest={spawns:[{id:'sa-import-spawn',name:'Mappa San Andreas importata',position:spawn}]};
  this.report('San Andreas · '+this.surfaces.length+' superfici GLB, '+(this.navigation.pedestrian?.nodes.length||0)+' nodi pedoni, '+(this.navigation.vehicle?.nodes.length||0)+' nodi veicoli.');
  this.refreshPhysics(new THREE.Vector3(...spawn));
  this.ready=true;
 }
 focusPosition(){
  const p=this.world.editorPlayer;
  return p?.controlledObject?.position||p?.position||new THREE.Vector3(...this.manifest.spawns[0].position);
 }
 groundAt(x,z,top=1000){
  if(!this.surfaces.length)return undefined;
  const ray=new THREE.Raycaster(new THREE.Vector3(x,top,z),new THREE.Vector3(0,-1,0),0,40000);
  // Broad-phase filtering keeps raycasting bounded when thousands of meshes exist.
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
  surface.body=body;
  return body;
 }
 refreshPhysics(position){
  if(!this.surfaces.length)return;
  const near=this.surfaces.map((surface,index)=>({
   surface,index,d:saBoundsDistanceXZ(position,surface.bbox)
  })).sort((a,b)=>a.d-b.d);
  const keep=new Set(near.filter(x=>x.d<PHYSICS_RADIUS).slice(0,MAX_ACTIVE_COLLIDERS).map(x=>x.index));
  for(const [index,body] of this.colliders)if(!keep.has(index)){
    this.world.physicsWorld.removeBody(body);this.colliders.delete(index);
    this.surfaces[index].body=null;
  }
  for(const index of keep){
    const s=this.surfaces[index];if(s.body||s.ignored)continue;
    const collider=this.makeCollider(s);
    if(collider)this.colliders.set(index,collider);
  }
 }
 async ensure(position){this.refreshPhysics(position);this.ready=true;}
 update(){
  if(!this.ready)return;
  const now=performance.now();
  const player=this.focusPosition();
  this.world.actorLayer?.update(player);
  if(now-this.lastTick<400)return;
  this.lastTick=now;
  this.refreshPhysics(player);
  const hud=document.querySelector('[data-city-status]');
  if(hud)hud.textContent='San Andreas · '+this.root.children.length+' GLB originali · '+this.colliders.size+' collider attivi · '+(this.navigation.pedestrian?.nodes.length||0)+' nodi pedoni · '+(this.world.actorLayer?.saPopulation?.stats.active||0)+' agenti vicini';
 }
}
