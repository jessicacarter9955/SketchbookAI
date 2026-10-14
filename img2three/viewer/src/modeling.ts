import * as THREE from 'three';

export const mat=(color:number,roughness=.52,metalness=.05):THREE.MeshStandardMaterial=>
 new THREE.MeshStandardMaterial({color,roughness,metalness});
export const pbr=(color:number,roughness=.30,metalness=.30):THREE.MeshPhysicalMaterial=>
 new THREE.MeshPhysicalMaterial({color,roughness,metalness,clearcoat:.45,clearcoatRoughness:.28,envMapIntensity:1.25});

export function cube(group:THREE.Group,name:string,position:[number,number,number],scale:[number,number,number],m:THREE.Material,bevel=0){
 let mesh:THREE.Mesh;
 if(bevel>0) {
   const s=new THREE.Shape(),w=scale[0],h=scale[1],r=Math.min(bevel,w*.3,h*.3);
   s.moveTo(-w/2+r,-h/2);s.lineTo(w/2-r,-h/2);
   s.quadraticCurveTo(w/2,-h/2,w/2,-h/2+r);
   s.lineTo(w/2,h/2-r);s.quadraticCurveTo(w/2,h/2,w/2-r,h/2);
   s.lineTo(-w/2+r,h/2);s.quadraticCurveTo(-w/2,h/2,-w/2,h/2-r);
   s.lineTo(-w/2,-h/2+r);s.quadraticCurveTo(-w/2,-h/2,-w/2+r,-h/2);
   const g=new THREE.ExtrudeGeometry(s,{depth:scale[2]-2*Math.min(.02,scale[2]/5),bevelEnabled:true,bevelThickness:Math.min(.02,scale[2]/5),bevelSize:r*.32,bevelSegments:2,steps:1,curveSegments:4});
   g.translate(0,0,-scale[2]/2+.01);mesh=new THREE.Mesh(g,m);
 } else { mesh=new THREE.Mesh(new THREE.BoxGeometry(...scale),m); }
 mesh.name=name;mesh.position.set(...position);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);return mesh;
}
export function extrude(g:THREE.Group,name:string,points:[number,number][],depth:number,m:THREE.Material,holes:Array<[number,number][]> = [],pos:[number,number,number]=[0,0,0],bevel=.028){
 const shape=new THREE.Shape();points.forEach((p,i)=>i?shape.lineTo(...p):shape.moveTo(...p));shape.closePath();
 for(const h of holes){const path=new THREE.Path();h.forEach((p,i)=>i?path.lineTo(...p):path.moveTo(...p));path.closePath();shape.holes.push(path);}
 const geom=new THREE.ExtrudeGeometry(shape,{depth,steps:1,bevelEnabled:bevel>0,bevelThickness:bevel,bevelSize:bevel*.65,bevelSegments:2,curveSegments:12});
 geom.translate(0,0,-depth/2);
 const mesh=new THREE.Mesh(geom,m);mesh.name=name;mesh.position.set(...pos);mesh.castShadow=true;mesh.receiveShadow=true;g.add(mesh);return mesh;
}
export function rod(g:THREE.Group,name:string,a:THREE.Vector3,b:THREE.Vector3,radius:number,m:THREE.Material,ends=9,radiusTop=radius){
 const d=new THREE.Vector3().subVectors(b,a),c=new THREE.Mesh(new THREE.CylinderGeometry(radiusTop,radius,d.length(),ends,1),m);
 c.position.copy(a).addScaledVector(d,.5);c.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());
 c.name=name;c.castShadow=true;c.receiveShadow=true;g.add(c);return c;
}
export function cylinderX(g:THREE.Group,name:string,x:number,y:number,z:number,length:number,radius:number,m:THREE.Material,segments=36){
 const c=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,length,segments),m);c.rotation.z=Math.PI/2;c.position.set(x,y,z);
 c.name=name;c.castShadow=true;c.receiveShadow=true;g.add(c);return c;
}
export function screw(g:THREE.Group,x:number,y:number,z:number,r=.05,color=0x22272b){
 const m=pbr(color,.34,.7);
 const c=new THREE.Mesh(new THREE.CylinderGeometry(r,r,r*.3,16),m);
 c.rotation.x=Math.PI/2;c.position.set(x,y,z);g.add(c);
 cube(g,'screw slot',[x,y,z+r*.15],[r*.9,r*.14,.005],mat(0x101519,.5,.7));return c;
}
export function disc(g:THREE.Group,x:number,y:number,z:number,r:number,m:THREE.Material){
 const t=new THREE.Mesh(new THREE.CylinderGeometry(r,r,.018,20),m);t.rotation.x=Math.PI/2;t.position.set(x,y,z);g.add(t);return t;
}
export function turntableBounds(g:THREE.Object3D){const b=new THREE.Box3().setFromObject(g);return {center:b.getCenter(new THREE.Vector3()),size:b.getSize(new THREE.Vector3())};}
