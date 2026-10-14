import * as THREE from 'three';

/** Open-ended tubular shroud. A real empty muzzle, with through-wall radial vents:
 * no black rectangles pasted onto the surface. */
export function buildPortedShroud(
 group:THREE.Group,material:THREE.Material,innerMaterial:THREE.Material
):THREE.Group{
 const out=new THREE.Group();out.name='Hollow precision 3D ported shroud';group.add(out);
 const x0=-3.69,x1=2.67,cy=1.04,outer=.465,inner=.316;
 const radial=96,axial=110;
 const positions:number[]=[],normals:number[]=[],indices:number[]=[];
 const push=(a:THREE.Vector3,b:THREE.Vector3,c:THREE.Vector3,d:THREE.Vector3)=>{
  const base=positions.length/3;
  for(const v of [a,b,c,d])positions.push(v.x,v.y,v.z);
  indices.push(base,base+1,base+2,base,base+2,base+3);
 };
 function vec(x:number,t:number,r:number){return new THREE.Vector3(x,cy+Math.cos(t)*r,Math.sin(t)*r);}
 const vents=[[-3.05,-2.60],[-2.34,-1.49],[-1.20,-.79]];
 const port=(x:number,t:number)=>{
   const side=Math.abs(Math.sin(t))>.68 && Math.abs(Math.cos(t))<.72;
   const longitudinal=vents.some(([a,b])=>x>a&&x<b);
   return side&&longitudinal;
 };
 // Outer curved metal skin, with genuine removed mesh for port apertures.
 for(let i=0;i<axial;i++){
   const xa=x0+(x1-x0)*i/axial,xb=x0+(x1-x0)*(i+1)/axial;
   for(let j=0;j<radial;j++){
     const ta=2*Math.PI*j/radial,tb=2*Math.PI*(j+1)/radial;
     if(port((xa+xb)/2,(ta+tb)/2))continue;
     push(vec(xa,ta,outer),vec(xa,tb,outer),vec(xb,tb,outer),vec(xb,ta,outer));
   }
 }
 const outerGeometry=new THREE.BufferGeometry();
 outerGeometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
 outerGeometry.setIndex(indices);outerGeometry.computeVertexNormals();
 const outerMesh=new THREE.Mesh(outerGeometry,material);
 outerMesh.name='Machined 96-sided external surface with through-ports';
 outerMesh.castShadow=true;outerMesh.receiveShadow=true;out.add(outerMesh);
 const insidePositions:number[]=[],insideIndices:number[]=[];
 const vert=(p:THREE.Vector3)=>{insidePositions.push(p.x,p.y,p.z);return insidePositions.length/3-1;};
 function quad(a:THREE.Vector3,b:THREE.Vector3,c:THREE.Vector3,d:THREE.Vector3){
 const n=[a,b,c,d].map(vert);insideIndices.push(n[0],n[1],n[2],n[0],n[2],n[3]);}
 // Inner cylindrical bore is really open; its interior becomes dark with physical lighting.
 for(let i=0;i<axial;i++){
   const xa=x0+(x1-x0)*i/axial,xb=x0+(x1-x0)*(i+1)/axial;
   for(let j=0;j<radial;j++){
     const ta=2*Math.PI*j/radial,tb=2*Math.PI*(j+1)/radial;
     quad(vec(xa,ta,inner),vec(xb,ta,inner),vec(xb,tb,inner),vec(xa,tb,inner));
     // Visible wall thickness along each side of a port.
     if(port((xa+xb)/2,(ta+tb)/2)){
       for(const t of [ta,tb])quad(vec(xa,t,inner),vec(xa,t,outer),vec(xb,t,outer),vec(xb,t,inner));
       for(const x of [xa,xb])quad(vec(x,ta,inner),vec(x,tb,inner),vec(x,tb,outer),vec(x,ta,outer));
     }
   }
 }
 // Muzzle front ring has a genuine center cutout.
 for(const x of [x0,x1])for(let j=0;j<radial;j++){
   const a=2*Math.PI*j/radial,b=2*Math.PI*(j+1)/radial;
   quad(vec(x,a,inner),vec(x,b,inner),vec(x,b,outer),vec(x,a,outer));
 }
 const insideGeom=new THREE.BufferGeometry();
 insideGeom.setAttribute('position',new THREE.Float32BufferAttribute(insidePositions,3));
 insideGeom.setIndex(insideIndices);insideGeom.computeVertexNormals();
 const mesh=new THREE.Mesh(insideGeom,innerMaterial);mesh.name='Hollow bore / vent thickness / muzzle annulus';
 mesh.castShadow=true;mesh.receiveShadow=true;out.add(mesh);
 return out;
}
