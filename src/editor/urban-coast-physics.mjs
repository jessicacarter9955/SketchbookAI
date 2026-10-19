import * as CANNON from 'cannon-es';
import {urbanOceanRegions} from './urban-coast-water.mjs';
import {urbanSandHeight} from './urban-coast-sand.mjs';

// Visual THREE.Water has NO Cannon collision geometry. Build a real, shallow
// seabed from the exact four ocean strips, without colliding across the city.
export function urbanOceanContains(layout,x,z){
  if(!layout||!Number.isFinite(x)||!Number.isFinite(z))return false;
  const {inner,outer}=urbanOceanRegions(layout);
  return x>outer.minX&&x<outer.maxX&&z>outer.minZ&&z<outer.maxZ &&
    !(x>=inner.minX&&x<=inner.maxX&&z>=inner.minZ&&z<=inner.maxZ);
}
export function urbanOceanFloorRects(layout){
  const {inner,outer}=urbanOceanRegions(layout);
  return [
    [outer.minX,outer.minZ,inner.minX,outer.maxZ],
    [inner.maxX,outer.minZ,outer.maxX,outer.maxZ],
    [inner.minX,outer.minZ,inner.maxX,inner.minZ],
    [inner.minX,inner.maxZ,inner.maxX,outer.maxZ]
  ];
}
export function createUrbanOceanFloorBodies(layout,depth=-3.6){
  if(!Number.isFinite(depth)||depth>=-.6)throw Error('Invalid urban seabed depth');
  return urbanOceanFloorRects(layout).map(([x0,z0,x1,z1])=>{
    const top=depth,thickness=.7;
    const body=new CANNON.Body({mass:0,
      shape:new CANNON.Box(new CANNON.Vec3((x1-x0)/2,thickness/2,(z1-z0)/2)),
      position:new CANNON.Vec3((x0+x1)/2,top-thickness/2,(z0+z1)/2)});
    body.userData={urbanOceanSeabed:true};
    return body;
  });
}
export function applyUrbanOceanFlotation(world,layout,timeSeconds=0){
  const player=world?.editorPlayer;
  const char=player?.characterCapsule?.body;
  let floated=false;
  // Do not float the character's inactive capsule while seated in a car.
  if(char&&char.world&&char.mass>0&&!player.occupyingSeat&&!player.controlledObject &&
      urbanOceanContains(layout,char.position.x,char.position.z)){
    const seaLevel=-.23;
    const target=seaLevel+.68+.025*Math.sin(timeSeconds*1.7);
    // Cannon gravity still acts; neutralize downward speed and hold the
    // capsule at head-above-water height. This is surface flotation, NOT
    // a claim of swimming animations or hydrodynamic simulation.
    if(char.position.y<target+.06){
      if(char.position.y<target)char.position.y=target;
      char.velocity.y=Math.max(0,Math.min(char.velocity.y,.55));
      char.velocity.x*=.90;char.velocity.z*=.90;
      char.previousPosition.y=Math.max(char.previousPosition.y,char.position.y);
      char.interpolatedPosition.y=Math.max(char.interpolatedPosition.y,char.position.y);
      char.aabbNeedsUpdate=true;
      floated=true;
    }
  }
  return floated;
}

export function urbanCoastGroundHeight(layout,x,z,seaFloor=-3.6){
  if(!layout||!Number.isFinite(x)||!Number.isFinite(z))return null;
  // Beach meshes and Cannon support are from the same source height function.
  for(const side of layout.sides){
    const [cx,cz]=side.center,[width,depth]=side.size;
    if(Math.abs(x-cx)>width/2||Math.abs(z-cz)>depth/2)continue;
    const coord=side.axis==='x'?x:z;
    const t=(coord-(side.shore-side.sign*layout.beachWidth))*
      side.sign/layout.beachWidth;
    return urbanSandHeight(t,x,z);
  }
  return urbanOceanContains(layout,x,z)?seaFloor:null;
}
