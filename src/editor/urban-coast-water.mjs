import * as THREE from 'three';
import {Water} from 'three/examples/jsm/objects/Water.js';
import {waterNormals} from './island-water-normals.mjs';

// Reflective THREE.Water from the original two-island IslandRuntime, but ONE
// ring-shaped reflector with an actual dry cutout for the city and four beaches.
// This avoids four expensive water render targets and flooding street surfaces.
export function urbanOceanRegions(layout,reach=730){
  if(!layout?.sides||layout.sides.length!==4||!Number.isFinite(reach)||reach<=0)
    throw Error('Invalid urban ocean layout');
  const east=layout.sides.find(s=>s.name==='east');
  const west=layout.sides.find(s=>s.name==='west');
  const north=layout.sides.find(s=>s.name==='north');
  const south=layout.sides.find(s=>s.name==='south');
  if(![east,west,north,south].every(Boolean))throw Error('All four urban coastlines required');
  const inner={minX:west.shore,maxX:east.shore,minZ:north.shore,maxZ:south.shore};
  if(!(inner.minX<inner.maxX&&inner.minZ<inner.maxZ))throw Error('Invalid ocean dry region');
  const outer={minX:inner.minX-reach,maxX:inner.maxX+reach,
    minZ:inner.minZ-reach,maxZ:inner.maxZ+reach};
  return {inner,outer};
}

export function urbanOceanGeometry(layout,reach=730){
  const {inner,outer}=urbanOceanRegions(layout,reach);
  const [cx,cz]=layout.waterCenter;
  const positions=[],indices=[],uv=[];
  function quad(x0,z0,x1,z1){
    // Rotated X/Y plane: local y = -worldZ, therefore +Z normal faces upward.
    const minY=-(z1-cz),maxY=-(z0-cz),offset=positions.length/3;
    const vertices=[
      [x0-cx,minY],[x1-cx,minY],[x1-cx,maxY],[x0-cx,maxY]
    ];
    for(const [x,y] of vertices){positions.push(x,y,0);uv.push(x/3.5,-y/3.5);}
    indices.push(offset,offset+1,offset+2,offset,offset+2,offset+3);
  }
  quad(outer.minX,outer.minZ,inner.minX,outer.maxZ);
  quad(inner.maxX,outer.minZ,outer.maxX,outer.maxZ);
  quad(inner.minX,outer.minZ,inner.maxX,inner.minZ);
  quad(inner.minX,inner.maxZ,inner.maxX,outer.maxZ);
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geometry.setIndex(indices);geometry.computeVertexNormals();
  geometry.userData={dryBounds:inner,oceanBounds:outer,source:'IslandRuntime Water'};
  return geometry;
}
export function createUrbanIslandOcean(layout,sky){
  const ocean=new Water(urbanOceanGeometry(layout),{
    textureWidth:512,textureHeight:512,waterNormals:waterNormals(),
    sunDirection:sky?.sunPosition?.clone()?.normalize()||new THREE.Vector3(0,1,0),
    sunColor:0xffffff,waterColor:0x116c78,distortionScale:2.2,fog:true
  });
  ocean.rotation.x=-Math.PI/2;
  ocean.position.set(layout.waterCenter[0],-.23,layout.waterCenter[1]);
  ocean.name='Miami ocean · original two-island THREE.Water reflections';
  ocean.userData.urbanCoast=true;
  ocean.userData.waterSource='Sketchbook IslandRuntime Water';
  return ocean;
}
export function updateUrbanIslandOcean(ocean,sunPosition,timeSeconds){
  if(!ocean?.material?.uniforms)return;
  const uniforms=ocean.material.uniforms;
  if(Number.isFinite(timeSeconds))uniforms.time.value=timeSeconds*.6;
  if(sunPosition?.isVector3)uniforms.sunDirection.value.copy(sunPosition).normalize();
}
