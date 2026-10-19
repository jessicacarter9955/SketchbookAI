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

const smooth=(a,b,t)=>{const x=Math.max(0,Math.min(1,(t-a)/(b-a)));return x*x*(3-2*x);};

// Separate authored photographic CC0 surfaces, alpha-feathered along the
// *distance to the shoreline*. Vertex alpha avoids harsh material borders
// and keeps the original dry sand_03 full quality underneath.
export function buildUrbanSandBlendGeometry(side,layout,kind){
  if(!['dry','wet'].includes(kind))throw Error('Unknown photographic sand blend');
  const geo=buildUrbanBeachGeometry(side,layout);
  const pos=geo.getAttribute('position'),uv=geo.getAttribute('uv');
  const colors=new Float32Array(pos.count*4);
  const shore=side.shore,origin=shore-side.sign*layout.beachWidth;
  const texMeters=kind==='dry'?13:2.25;
  for(let i=0;i<pos.count;i++){
    const x=pos.getX(i),z=pos.getZ(i);
    const t=Math.max(0,Math.min(1,
      ((side.axis==='x'?x:z)-origin)*side.sign/layout.beachWidth));
    // Upper beach is light, naturally rippled. Lower beach is damp,
    // darker and less rough. The overlap blends seamlessly into sand_03.
    const alpha=kind==='dry'?1-smooth(.44,.78,t):smooth(.66,.92,t);
    const j=i*4;
    colors[j]=1;colors[j+1]=1;colors[j+2]=1;colors[j+3]=alpha;
    uv.setXY(i,x/texMeters,z/texMeters);
    pos.setY(i,pos.getY(i)+(kind==='dry'?.008:.016));
  }
  geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,4));
  geo.computeVertexNormals();
  geo.userData.sandBlend=kind;
  return geo;
}
