import * as THREE from 'three';
import {URBAN_SIGNAL} from './urban-traffic-signals.mjs';

export function signalPhase(seconds){
 const t=((seconds%URBAN_SIGNAL.cycle)+URBAN_SIGNAL.cycle)%URBAN_SIGNAL.cycle;
 return t<URBAN_SIGNAL.eastWestGreen?'eastWest':
  t<URBAN_SIGNAL.eastWestGreen+URBAN_SIGNAL.allRed?'allRed':
  t<URBAN_SIGNAL.eastWestGreen+URBAN_SIGNAL.allRed+URBAN_SIGNAL.northSouthGreen?'northSouth':'allRed';
}

// Four distinct signal heads per inner crossing; actual shared GPU instancing
// keeps the visual signal network under 3 draw calls regardless of junction count.
export class UrbanSignals{
 constructor(config){
  this.group=new THREE.Group();this.group.name='Visible synchronized traffic signals';
  const {blocksX:nx,blocksZ:nz,blockSize:size,roadWidth:width}=config;
  const crossings=Math.max(0,nx-1)*Math.max(0,nz-1);
  this.heads=[];
  if(!crossings)return;
  const total=crossings*4;
  const postGeo=new THREE.CylinderGeometry(.095,.12,3.7,8);
  const black=new THREE.MeshStandardMaterial({color:0x181f24,roughness:.65,metalness:.62});
  const headGeo=new THREE.BoxGeometry(.42,1.18,.27);
  const ledGeo=new THREE.SphereGeometry(.125,8,6);
  const ledMat=new THREE.MeshBasicMaterial({vertexColors:false,color:0xffffff});
  this.posts=new THREE.InstancedMesh(postGeo,black,total);
  this.housings=new THREE.InstancedMesh(headGeo,black,total);
  this.leds=new THREE.InstancedMesh(ledGeo,ledMat,total*3);
  for(const mesh of [this.posts,this.housings,this.leds]){
   mesh.castShadow=false;mesh.receiveShadow=false;mesh.name='GPU-instanced physical traffic light';
   this.group.add(mesh);
  }
  const o=new THREE.Object3D(),x0=-nx*size/2,z0=-nz*size/2;
  let id=0;
  for(let ix=1;ix<nx;ix++)for(let iz=1;iz<nz;iz++){
   const cx=x0+ix*size,cz=z0+iz*size,pad=width/2+.8;
   for(const direction of ['east','west','north','south']){
    const dx=direction==='east'?-pad:direction==='west'?pad:direction==='north'?pad:-pad;
    const dz=direction==='east'?pad:direction==='west'?-pad:direction==='north'?-pad:pad;
    const heading=direction==='east'?Math.PI:direction==='west'?0:
      direction==='north'?Math.PI/2:-Math.PI/2;
    const x=cx+dx,z=cz+dz;
    o.position.set(x,1.85,z);o.rotation.set(0,0,0);o.scale.set(1,1,1);
    o.updateMatrix();this.posts.setMatrixAt(id,o.matrix);
    o.position.set(x,3.75,z);o.rotation.y=heading;o.updateMatrix();this.housings.setMatrixAt(id,o.matrix);
    for(let channel=0;channel<3;channel++){
      const offset=new THREE.Vector3(0,.37-channel*.37,.17).applyAxisAngle(new THREE.Vector3(0,1,0),heading);
      o.position.set(x+offset.x,3.75+offset.y,z+offset.z);o.scale.set(1,1,.67);o.updateMatrix();
      this.leds.setMatrixAt(id*3+channel,o.matrix);
    }
    const axis=direction==='east'||direction==='west'?'eastWest':'northSouth';
    this.heads.push({id,axis});id++;
   }
  }
  // Static bounds include the entire intersection set; avoid frustum errors
  // if the center of the global instanced batch lies outside the camera.
  this.posts.frustumCulled=false;this.housings.frustumCulled=false;this.leds.frustumCulled=false;
  this.lastPhase='';this.update(0);
 }
 update(seconds){
  if(!this.leds)return;
  const phase=signalPhase(seconds);
  if(phase===this.lastPhase)return;
  this.lastPhase=phase;
  const colors=[new THREE.Color(0xff2929),new THREE.Color(0xffbf3f),new THREE.Color(0x22f37b)];
  const dim=new THREE.Color(0x24282a);
  for(const head of this.heads){
   const green=phase===head.axis,amber=phase==='allRed';
   for(let i=0;i<3;i++){
    const active=i===0?!green&&!amber:i===1?amber:green;
    this.leds.setColorAt(head.id*3+i,active?colors[i]:dim);
   }
  }
  if(this.leds.instanceColor)this.leds.instanceColor.needsUpdate=true;
 }
}
