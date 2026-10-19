import * as THREE from 'three';

// Gently descending four-sided beach, using real 2K photographic sand PBR.
// Geometry supplies large-scale shore relief, PBR normal texture supplies grit.
export function urbanSandHeight(t,x,z){
  const u=Math.max(0,Math.min(1,t)),smooth=u*u*(3-2*u);
  const ripples=.022*Math.sin(x*.24+z*.13)*Math.sin(z*.37-x*.09);
  return .07-.25*smooth+ripples*(1-.3*smooth);
}
export function buildUrbanBeachGeometry(side,layout){
  const [cx,cz]=side.center,[width,depth]=side.size;
  if(width<=0||depth<=0||!layout?.beachWidth)throw Error('Invalid sand beach geometry');
  const nx=Math.max(8,Math.ceil(width/3)),nz=Math.max(8,Math.ceil(depth/3));
  const positions=[],uv=[],indices=[];
  const x0=cx-width/2,z0=cz-depth/2,shore=side.shore,origin=shore-side.sign*layout.beachWidth;
  for(let ix=0;ix<=nx;ix++)for(let iz=0;iz<=nz;iz++){
    const x=x0+width*ix/nx,z=z0+depth*iz/nz;
    const across=side.axis==='x'?x:z;
    const t=(across-origin)*side.sign/layout.beachWidth;
    positions.push(x,urbanSandHeight(t,x,z),z);
    // World-aligned UVs prevent discontinuities where the four beaches meet.
    uv.push(x/2.7,z/2.7);
    if(ix<nx&&iz<nz){
      const a=ix*(nz+1)+iz,b=a+nz+1;
      // +Y winding, correct for the outdoor sun and photographic normal map.
      indices.push(a,a+1,b,b,a+1,b+1);
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geometry.setIndex(indices);geometry.computeVertexNormals();
  geometry.userData={beachSide:side.name,pbr:true,physicallyWalkable:true};
  return geometry;
}
