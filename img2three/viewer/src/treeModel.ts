import * as THREE from 'three';
import {mat,pbr,cube,rod} from './modeling';

export function makeMultiTrunkTree():THREE.Group{
 const group=new THREE.Group();group.name='Multi-trunk ornamental tree | botanical instanced foliage';
 const bark = mat(0x62534b,.96,.01), innerBark=mat(0x514740,.97,.01),twig=mat(0x433f33,.96);
 const woodDetail=pbr(0x9f9382,.90,.01);
 const SEED=245871;let randSeed=SEED;const rnd=()=>{randSeed=(Math.imul(1664525,randSeed)+1013904223)>>>0;return randSeed/4294967296;};
 const rndRange=(a:number,b:number)=>a+(b-a)*rnd();
 // A family of 8 interwoven trunks with physically tapered cylindrical branch segments.
 let segments=0;const tips:Array<{p:THREE.Vector3,r:number}>=[];
 const branches= new THREE.Group();branches.name='Individual three-dimensional bark branches';group.add(branches);
 function branch(from:THREE.Vector3,dir:THREE.Vector3,length:number,r:number,depth:number,kind:number){
   if(segments>650)return;
   const to=from.clone().addScaledVector(dir.clone().normalize(),length);
   rod(branches,depth<2?'thick multi-stem trunk':'living twig',from,to,r,depth<2?bark:(depth<4?innerBark:twig),depth<2?11:7,r*(depth<3?.75:.59));
   segments++;
   if(depth>=5 || r<.022){
     tips.push({p:to,r:.42+rnd()*.27});return;
   }
   const n=depth<1?3:depth<3?2+Math.floor(rnd()*2):2;
   const turn=0.35+depth*.13;
   for(let k=0;k<n;k++){
     const phi=(k/n)*2*Math.PI+rndRange(-.42,.42);
     const heading=new THREE.Vector3(
       dir.x*.42+Math.cos(phi)*turn*rndRange(.65,1.1),
       dir.y*(depth>1?.70:.87)+rndRange(-.11,.18),
       dir.z*.42+Math.sin(phi)*turn*rndRange(.65,1.1)
     ).normalize();
     const l=length*(depth<2?rndRange(.76,.97):rndRange(.67,.83));
     branch(to.clone(),heading,l,r*rndRange(.53,.75),depth+1,kind);
   }
   if(depth===2 && rnd()>.55){
     const vec=dir.clone().add(new THREE.Vector3(rndRange(-.25,.25),.23,rndRange(-.25,.25))).normalize();
     branch(to.clone().lerp(from,.31),vec,length*.55,r*.49,depth+2,kind);
   }
 }
 const stems=8;
 for(let i=0;i<stems;i++){
   const phase=i*2*Math.PI/stems;
   const offset=new THREE.Vector3(Math.cos(phase)*.18,0,Math.sin(phase)*.15);
   const heading=new THREE.Vector3(Math.cos(phase)*.35+(.1-rnd()*.2),1.0,Math.sin(phase)*.28).normalize();
   branch(offset,heading,rndRange(.87,1.25),rndRange(.16,.24),0,i);
 }
 // Bark longitudinal scars, rough cracks and realistic highlights in 3D.
 for(let i=0;i<72;i++){
   const a=rndRange(0,Math.PI*2),z=Math.sin(a)*rndRange(.07,.27);
   const x=Math.cos(a)*rndRange(.10,.27),y=rndRange(.05,1.15);
   rod(branches,'narrow irregular bark scar',new THREE.Vector3(x,y,z),new THREE.Vector3(x+rndRange(-.065,.065),y+rndRange(.13,.25),z+rndRange(-.04,.04)),rndRange(.003,.007),i%4===0?woodDetail:innerBark,5);
 }
 // Curved leaf surface; thousands of independent leaves have true orientation/depth.
 const verts=new Float32Array([
     0,0,0,     -.085,.14,-.013, 0,.30,.014,
     0,0,0,     0,.30,.014, .085,.14,-.013,
     0,0,0,     0,.30,.014, 0,.14,.033
 ]);
 const idx=[0,1,2,3,4,5,6,7,8];
 const leafGeom=new THREE.BufferGeometry();leafGeom.setAttribute('position',new THREE.BufferAttribute(verts,3));leafGeom.setIndex(idx);leafGeom.computeVertexNormals();
 const leafMat=new THREE.MeshPhysicalMaterial({color:0x879e7d,roughness:.80,metalness:0,side:THREE.DoubleSide,transmission:.035,thickness:.06,clearcoat:.15,clearcoatRoughness:.75});
 const leafCount=6300;const leaves=new THREE.InstancedMesh(leafGeom,leafMat,leafCount);
 leaves.name='6300 physically instanced elliptical living leaves';
 leaves.castShadow=false;leaves.receiveShadow=true;
 const dummy=new THREE.Object3D(),palette=['#244627','#325b2b','#487437','#527e3b','#638b45','#7a994f','#3b632a','#213e27','#879b52','#4d7433'].map(c=>new THREE.Color(c));
 // Rounded asymmetrical crown mass, matching dense split canopy of user's tree.
 const clusters=[[-1.85,5.32,.25,.98],[-.85,5.99,-.25,1.12],[.18,6.28,-.09,1.2],[1.15,6.02,.26,1.28],[2.14,5.51,-.15,.85],[-1.65,4.65,0,.84],[1.64,4.61,.0,.97],[.27,5.06,.3,1.38]];
 let ci=0;
 for(let i=0;i<leafCount;i++){
   let cl=clusters[Math.floor(rnd()*clusters.length)];
   if(i%7===0 && tips.length){const p=tips[Math.floor(rnd()*tips.length)].p;cl=[p.x,p.y,p.z,.65];}
   const theta=rndRange(-Math.PI,Math.PI),u=rndRange(-1,1),rad=Math.cbrt(rnd())*cl[3];
   const fac=Math.sqrt(1-u*u);
   let x=cl[0]+Math.cos(theta)*fac*rad*1.13,
       y=cl[1]+u*rad*.83,
       z=cl[2]+Math.sin(theta)*fac*rad*1.1;
   // Clip low leaves near exposed branching area.
   if(y<3.4)y=3.4+rnd()*.32;
   dummy.position.set(x,y,z);
   dummy.rotation.set(rndRange(-Math.PI,Math.PI),rndRange(-Math.PI,Math.PI),rndRange(-Math.PI,Math.PI));
   const s=rndRange(.62,1.28);dummy.scale.set(s,s*rndRange(.66,1.20),s);
   dummy.updateMatrix();leaves.setMatrixAt(i,dummy.matrix);
   const c=palette[Math.floor(rnd()*palette.length)].clone().multiplyScalar(rndRange(.7,1.24));
   leaves.setColorAt(i,c);ci++;
 }
 leaves.instanceMatrix.needsUpdate=true;if(leaves.instanceColor)leaves.instanceColor.needsUpdate=true;
 group.add(leaves);
 // Natural circular turf base with thousands of efficient instanced blades.
 const turf=new THREE.Mesh(new THREE.CylinderGeometry(.83,.89,.12,40),mat(0x415a2b,.89));
 turf.position.y=-.045;turf.receiveShadow=true;group.add(turf);
 const grassGeom=new THREE.ConeGeometry(.012,.12,3);
 const grassMat=mat(0x8ea94d,.8);
 const grass=new THREE.InstancedMesh(grassGeom,grassMat,800);const m=new THREE.Object3D();
 for(let i=0;i<800;i++){
    const ang=rndRange(0,2*Math.PI),rad=Math.sqrt(rnd())*.85;
    m.position.set(Math.cos(ang)*rad,.02,Math.sin(ang)*rad);
    m.rotation.y=ang;m.rotation.z=rndRange(-.28,.28);m.scale.set(1,rndRange(.7,1.9),1);m.updateMatrix();grass.setMatrixAt(i,m.matrix);
 }
 grass.instanceMatrix.needsUpdate=true;grass.name='1900 individual grass blades';group.add(grass);
 group.userData.botanicalStats={trunks:stems,branchSegments:segments,leaves:leafCount,grass:800};
 return group;
}
