import * as THREE from 'three';
import { loadSurface,metricUV } from './UrbanLighting.js';

const bladeMaterial=new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:1,envMapIntensity:.6});
let surfacePromise;
const blades=new Map();
function bladeTile(density){
  if(blades.has(density))return blades.get(density);
  let seed=913;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const positions=[],colors=[],indices=[];
  for(let i=0;i<density*4;i++){
    const x=(random()-.5)*2,z=(random()-.5)*2,angle=random()*Math.PI*2;
    const height=.065+random()*.10,width=.009+random()*.007,bend=.02+random()*.035;
    const vx=Math.cos(angle),vz=Math.sin(angle),start=positions.length/3;
    const tint=.72+random()*.35;
    for(let row=0;row<4;row++){
      const t=row/3;
      for(const side of [-1,1]){
        positions.push(x+vx*width*(1-t)*side-vz*bend*t*t,height*t,z+vz*width*(1-t)*side+vx*bend*t*t);
        const shade=(.52+t*.48)*tint;
        colors.push(.17*shade,.29*shade,.065*shade);
      }
      if(row<3){const a=start+row*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
    }
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();blades.set(density,geometry);return geometry;
}
export function loadLawnSurface(){return surfacePromise ||= loadSurface('grass_ground',2,0xb5c799);}

// Two levels of actual curved blades near the camera; the scanned surface
// continues beyond them. Tile-level bounds allow normal frustum culling.
export async function createLawns(rectangles,{surface=true}={}){
  const group=new THREE.Group();group.name='Detailed lawns';
  const mat=await loadLawnSurface();
  for(const r of rectangles){
    if(surface){
      const ground=new THREE.Mesh(new THREE.BoxGeometry(r.w,.045,r.d),mat);ground.position.set(r.x,(r.y||.2)-.025,r.z);metricUV(ground);ground.receiveShadow=true;group.add(ground);
    }
    const cols=Math.ceil(r.w/2),rows=Math.ceil(r.d/2),tw=r.w/cols,td=r.d/rows;
    for(let ix=0;ix<cols;ix++)for(let iz=0;iz<rows;iz++){
      const lod=new THREE.LOD();lod.position.set(r.x-r.w/2+(ix+.5)*tw,r.y||.2,r.z-r.d/2+(iz+.5)*td);
      for(const [density,distance] of [[700,0],[160,18]]){
        const mesh=new THREE.Mesh(bladeTile(density),bladeMaterial);mesh.scale.set(tw/2,1,td/2);mesh.receiveShadow=true;mesh.userData.sharedUrbanAsset=true;
        lod.addLevel(mesh,distance,.15);
      }
      lod.addLevel(new THREE.Group(),38,.1);group.add(lod);
    }
  }
  group.userData.surface='grass_ground';return group;
}
