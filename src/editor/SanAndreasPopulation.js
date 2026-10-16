import * as THREE from 'three';
import {clone} from 'three/examples/jsm/utils/SkeletonUtils';
import {createSanAndreasSpatialIndex,nodesNear,stepOriginalPath} from './sa-agent-navigation.mjs';

// Visual agents follow real directed SA links. Static vehicle models are GPU
// instanced; distant agents sleep and get recycled near the player.
export class SanAndreasPopulation{
 constructor(world,person,car){
  this.world=world;this.graph=world.levelRuntime.navigation;this.elapsed=0;
  this.pedIndex=createSanAndreasSpatialIndex(this.graph.pedestrian);
  this.carIndex=createSanAndreasSpatialIndex(this.graph.vehicle);
  this.group=new THREE.Group();this.group.name='San Andreas original-network agents';
  world.graphicsWorld.add(this.group);
  this.pedestrians=[];this.cars=[];this.trafficBatches=[];
  this.forward=new THREE.Vector3();
  this.stats={cars:0,pedestrians:0,active:0,sleeping:0};
  this.carTemplate=car;
  const nonSkinnedCar=!car.getObjectByProperty('isSkinnedMesh',true);
  const position=world.editorPlayer?.position||world.levelRuntime.manifest.spawns[0].position;
  const focus=Array.isArray(position)?{x:position[0],z:position[2]}:position;
  const carNodes=nodesNear(this.carIndex,focus.x,focus.z,180,180);
  const pedNodes=nodesNear(this.pedIndex,focus.x,focus.z,180,180);
  if(carNodes.length){
   const bb=new THREE.Box3().setFromObject(car);
   const offset=Number.isFinite(bb.min.y)?Math.max(.02,-bb.min.y+.04):.7;
   for(let i=0;i<Math.min(16,carNodes.length);i++){
    const n=carNodes[(i*11)%carNodes.length],obj=nonSkinnedCar?new THREE.Group():clone(car);
    const agent={object:obj,route:{key:n.key,to:null,t:0,turns:0},seed:i,speed:4.1+i%3,offset};
    if(!nonSkinnedCar)this.group.add(obj);
    this.cars.push(agent);
   }
   if(nonSkinnedCar)this.makeInstances(car);
  }
  if(pedNodes.length){
   const bb=new THREE.Box3().setFromObject(person);
   const offset=Number.isFinite(bb.min.y)?Math.max(.02,-bb.min.y+.04):.7;
   for(let i=0;i<Math.min(26,pedNodes.length);i++){
    const n=pedNodes[(i*17)%pedNodes.length],obj=clone(person);
    const agent={object:obj,route:{key:n.key,to:null,t:0,turns:0},seed:i+91,speed:1.1+i%4*.12,offset};
    const clip=person.animations?.find(c=>c.name==='walk')||person.animations?.find(c=>c.name==='run');
    if(clip){agent.mixer=new THREE.AnimationMixer(obj);agent.mixer.clipAction(clip).play();}
    this.group.add(obj);this.pedestrians.push(agent);
   }
  }
  this.stats.cars=this.cars.length;this.stats.pedestrians=this.pedestrians.length;
  this.update(1/60);
 }
 addImportedPedestrian(item,template,clips=[]){
   if(!this.graph.pedestrian?.nodes?.length)return null;
   const [x,y,z]=item.position,near=nodesNear(this.pedIndex,x,z,140,8);
   if(!near.length)return null;
   const obj=clone(template),node=near[0];
   const box=new THREE.Box3().setFromObject(obj);
   const offset=Number.isFinite(box.min.y)?Math.max(.02,-box.min.y+.06):0;
   const a={object:obj,route:{key:node.key,to:null,t:0,turns:0},seed:1000+this.pedestrians.length,
     speed:1.18,offset,source:'Sketchfab/Fab user GLB'};
   if(clips.length){
      a.mixer=new THREE.AnimationMixer(obj);
      const walk=clips.find(c=>/walk/i.test(c.name))||clips.find(c=>/run/i.test(c.name))||clips[0];
      a.mixer.clipAction(walk).play();
   }
   this.group.add(obj);this.pedestrians.push(a);this.stats.pedestrians=this.pedestrians.length;
   return a;
 }
 makeInstances(template){
  template.updateMatrixWorld(true);
  const inverse=template.matrixWorld.clone().invert();
  template.traverse(mesh=>{
   if(!mesh.isMesh||!mesh.geometry)return;
   const relative=inverse.clone().multiply(mesh.matrixWorld);
   const batch=new THREE.InstancedMesh(mesh.geometry,mesh.material,this.cars.length);
   batch.name='GTA SA lane traffic · GPU instances';
   batch.frustumCulled=false;batch.castShadow=false;batch.receiveShadow=true;
   this.group.add(batch);this.trafficBatches.push({batch,relative});
  });
 }
 recycle(a,index,focus,radius){
  const options=nodesNear(index,focus.x,focus.z,radius,64);
  if(!options.length)return false;
  const n=options[(a.seed*19+Math.floor(this.elapsed/6))%options.length];
  a.route={key:n.key,to:null,t:0,turns:0};
  return true;
 }
 update(dt){
  dt=Math.min(.1,Math.max(0,dt||0));this.elapsed+=dt;
  const player=this.world.editorPlayer,camera=this.world.camera;
  const focus=player?.controlledObject?.position||player?.position||camera.position;
  const squared=(a,b)=>((a.x-b.x)**2+(a.z-b.z)**2);
  const pnode=this.graph.pedestrian,cnode=this.graph.vehicle;
  const matrix=new THREE.Matrix4(),hidden=new THREE.Matrix4().makeScale(0,0,0);
  let active=0,sleeping=0;
  for(const [kind,agents,network,spatial] of [
    ['car',this.cars,cnode,this.carIndex],['ped',this.pedestrians,pnode,this.pedIndex]
  ]){
   for(let i=0;i<agents.length;i++){
    const a=agents[i];
    let route=stepOriginalPath(network,a.route,0,0,a.seed),d=route?squared(route,focus):Infinity;
    // Position reset never fabricates a sidewalk or road connection.
    if(d>220*220&&this.elapsed-(a.lastRecycle||-100)>2){
      a.lastRecycle=this.elapsed;
      if(this.recycle(a,spatial,focus,155))route=stepOriginalPath(network,a.route,0,0,a.seed);
      d=route?squared(route,focus):Infinity;
    }
    const visible=d<220*220&&squared(route||a.object.position,camera.position)<260*260;
    a.object.visible=visible;
    if(d>270*270){sleeping++;continue;}
    const near=d<80*80,frequency=near?1:d<150*150?3:7;
    a.skip=(a.skip||0)+1;
    const subdt=Math.min(.18,dt*frequency);
    if(a.skip%frequency===0&&route)route=stepOriginalPath(network,a.route,subdt,a.speed,a.seed);
    if(!route)continue;
    a.object.position.set(route.x,route.y+a.offset,route.z);
    a.object.rotation.y=route.heading;
    if(kind==='ped'&&visible&&near)a.mixer?.update(dt);
    if(near)active++;else sleeping++;
   }
  }
  for(const {batch,relative} of this.trafficBatches){
   for(let i=0;i<this.cars.length;i++){
    const a=this.cars[i],p=a.object.position,visible=a.object.visible&&squared(p,camera.position)<260*260;
    if(visible){
      a.object.updateMatrix();
      matrix.copy(a.object.matrix).multiply(relative);
    }
    batch.setMatrixAt(i,visible?matrix:hidden);
   }
   batch.instanceMatrix.needsUpdate=true;
  }
  this.stats.active=active;this.stats.sleeping=sleeping;
 }
 destroy(){this.group.removeFromParent();this.cars=[];this.pedestrians=[];}
}
