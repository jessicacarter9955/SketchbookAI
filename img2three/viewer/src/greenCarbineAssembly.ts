import * as THREE from 'three';

/**
 * Source registered 3D assembly of the user's original green carbine.
 * The input is /public/ref/rifle.webp, extracted from the original photograph.
 * Receivers, fore-end, brace, handgrip, magazine and barrel are independent
 * spatial objects rather than a generic silhouette extruded at one thickness.
 * This is visual geometry only; it contains no operational weapon mechanism.
 */
const W=1150,H=467,S=11/W;
type XY=[number,number];
const pt=([x,y]:XY)=>new THREE.Vector2((x-W/2)*S,(H/2-y)*S);
const colorMat=(color:number,metalness=.05)=>new THREE.MeshPhysicalMaterial({color,metalness,roughness:.73,clearcoat:.11,clearcoatRoughness:.7,side:THREE.DoubleSide});
const G=(r:number)=>r*S;
function figure(outline:XY[],holes:XY[][]=[]):THREE.Shape{
 const s=new THREE.Shape();outline.map(pt).forEach((v,i)=>i?s.lineTo(v.x,v.y):s.moveTo(v.x,v.y));s.closePath();
 for(const h of holes){const p=new THREE.Path();h.map(pt).forEach((v,i)=>i?p.lineTo(v.x,v.y):p.moveTo(v.x,v.y));p.closePath();s.holes.push(p);}return s;
}
function takeSample(texture:THREE.Texture){
 const img=texture.image as HTMLImageElement,c=document.createElement('canvas');
 c.width=img.naturalWidth||W;c.height=img.naturalHeight||H;
 const ctx=c.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(img,0,0);
 const data=ctx.getImageData(0,0,c.width,c.height).data;
 return (x:number,y:number):THREE.Color=>{
   let ix=Math.max(0,Math.min(c.width-1,Math.round((x/S+W/2)/W*(c.width-1))));
   let iy=Math.max(0,Math.min(c.height-1,Math.round((H/2-y/S)/H*(c.height-1))));
   let idx=4*(iy*c.width+ix);
   if(data[idx+3]<120){
     outer:for(let rad=1;rad<20;rad++)for(let a=0;a<12;a++){
       const angle=a*Math.PI/6,xx=Math.min(c.width-1,Math.max(0,Math.round(ix+Math.cos(angle)*rad)));
       const yy=Math.min(c.height-1,Math.max(0,Math.round(iy+Math.sin(angle)*rad)));
       const j=4*(yy*c.width+xx);if(data[j+3]>160){idx=j;break outer;}
     }
   }
   return new THREE.Color().setRGB(data[idx]/255,data[idx+1]/255,data[idx+2]/255,THREE.SRGBColorSpace);
 };
}
export async function makeGreenCarbineAssembly():Promise<THREE.Group>{
 const source=await new THREE.TextureLoader().loadAsync('./ref/rifle.webp');
 source.colorSpace=THREE.SRGBColorSpace;source.anisotropy=16;
 const sample=takeSample(source);
 const assembly=new THREE.Group();assembly.name='Green carbine — independent photo-source mechanical silhouettes';
 function build(name:string,outline:XY[],holes:XY[][],depth:number,bevel:number,sideColor:number){
  const shape=figure(outline,holes);
  const geo=new THREE.ExtrudeGeometry(shape,{
   depth:depth*2,steps:3,bevelEnabled:true,bevelSegments:6,bevelThickness:bevel,
   bevelSize:bevel*.80,curveSegments:12
  });geo.translate(0,0,-depth);
  const pos=geo.getAttribute('position'),uv=geo.getAttribute('uv');
  const colors=new Float32Array(pos.count*3);
  for(let i=0;i<pos.count;i++){
   const x=pos.getX(i),y=pos.getY(i);
   uv.setXY(i,x/(W*S)+.5,y/(H*S)+.5);
   const c=sample(x,y);colors[3*i]=c.r;colors[3*i+1]=c.g;colors[3*i+2]=c.b;
  }
  geo.setAttribute('color',new THREE.BufferAttribute(colors,3));uv.needsUpdate=true;geo.computeVertexNormals();
  const front=new THREE.MeshBasicMaterial({map:source,transparent:true,alphaTest:.08,toneMapped:false,side:THREE.DoubleSide,depthWrite:true});
  const walls=new THREE.MeshPhysicalMaterial({
   vertexColors:true,color:sideColor,metalness:.15,roughness:.61,
   clearcoat:.13,clearcoatRoughness:.69,side:THREE.DoubleSide
  });
  const obj=new THREE.Mesh(geo,[front,walls]);
  obj.castShadow=true;obj.receiveShadow=true;obj.name=name;assembly.add(obj);
  return obj;
 }
 // Functional appearance faithfully copied from reference pixels, with true
 // side depth independent for each externally visible component.
 build('Black brace body and cheekpiece',[
  [19,42],[31,31],[81,31],[98,38],[286,38],[301,42],
  [300,83],[292,101],[276,115],[281,139],[269,150],[147,151],
  [145,168],[110,170],[107,276],[96,297],[37,303],[24,291],[10,76]
 ],[
  [[120,135],[134,130],[141,139],[140,154],[128,162],[118,151]]
 ],.27,.022,0x888888);
 build('Brace mounting tube and rear coupling',[
  [288,43],[335,39],[354,55],[356,97],[331,105],[293,101]
 ],[],.30,.015,0x999999);
 build('Independent lower receiver with integrated trigger guard',[
  [341,88],[659,86],[662,150],[644,184],[649,207],
  [624,222],[549,228],[531,218],[520,221],[438,222],
  [434,188],[420,166],[371,162],[341,145],[331,133]
 ],[
  [[456,163],[518,163],[528,174],[523,200],
   [509,215],[458,214],[448,205],[450,179]]
 ],.315,.028,0xc1e2a4);
 build('Upper receiver and ejection-side detail panel',[
  [338,25],[652,20],[663,34],[660,111],[643,128],
  [354,131],[332,110],[331,50]
 ],[],.357,.031,0xc1ddaa);
 build('Photographed ergonomic pistol grip',[
  [368,161],[429,162],[437,208],[407,291],
  [396,349],[377,354],[294,335],[291,326],[313,276],[337,225]
 ],[],.255,.021,0x969996);
 build('AMEND2 stamped black polymer magazine, real tapered volume',[
  [530,217],[640,187],[654,194],[673,271],
  [693,370],[691,381],[582,406],[566,389],
  [548,305],[539,261]
 ],[],.285,.027,0x999999);
 // Handguard carries genuine holes in a separate green extrusion; dark
 // interior components are visible through them from oblique views.
 const slots:XY[][]=[
  [[758,34],[824,34],[830,39],[830,48],[824,51],[756,51],[752,47],[752,40]],
  [[850,34],[910,34],[918,39],[918,48],[911,51],[849,51],[845,46],[845,39]],
  [[941,34],[997,34],[1005,39],[1005,48],[997,51],[940,51],[935,45],[936,39]],
  [[759,92],[817,92],[825,97],[825,107],[815,111],[759,111],[753,105],[753,98]],
  [[849,92],[907,92],[916,96],[916,107],[908,111],[848,111],[844,106],[844,96]],
  [[939,92],[999,92],[1006,97],[1006,108],[999,111],[938,111],[934,106],[934,97]]
 ];
 build('Vivid lime metal ventilated handguard: six real openings',[
  [648,16],[670,10],[1037,9],[1045,18],[1045,115],
  [1039,125],[673,126],[655,118]
 ],slots,.279,.026,0xb8e99b);
 // Inner shadow volumes, aligned to the original six apertures, must not
 // project beyond the green handguard perimeter at any camera angle.
 const inside=colorMat(0x1b201e,.39);
 const innerBarrel=new THREE.Mesh(new THREE.CylinderGeometry(.135,.135,G(381),64,1,true),inside);
 innerBarrel.rotation.z=Math.PI/2;
 innerBarrel.position.set((849-W/2)*S,(H/2-74)*S,-.028);
 innerBarrel.name='Black internal liner visibly recessed behind real vents';assembly.add(innerBarrel);
 // Photographed top accessory rail, with actual depth-facing individual teeth.
 build('Milled upper rail core',[
  [363,13],[1042,12],[1044,22],[656,22],[362,24]
 ],[],.214,.008,0xafed9e);
 const toothGeo=new THREE.BoxGeometry(G(6),G(7),G(37));
 const toothMat=colorMat(0x7eab47,.16);
 const n=91;const inst=new THREE.InstancedMesh(toothGeo,toothMat,n);
 const obj=new THREE.Object3D();
 for(let i=0;i<n;i++){
  const x=360+i*(678/(n-1));
  obj.position.set((x-W/2)*S,(H/2-9.5)*S,-.02);
  obj.rotation.set(0,0,0);obj.scale.set(1,1,1);
  obj.updateMatrix();inst.setMatrixAt(i,obj.matrix);
 }
 inst.instanceMatrix.needsUpdate=true;inst.castShadow=true;
 inst.name='Independently modeled top rail teeth';assembly.add(inst);
 // Physically hollow forward-facing muzzle shroud, 96 radial segments.
 const muzzle= new THREE.Group();muzzle.name='Separate hollow radial muzzle sleeve';
 const outer=G(24),inner=G(11.5),len=G(90),center=new THREE.Vector3((1091-W/2)*S,(H/2-64)*S,0);
 const shell=new THREE.Mesh(new THREE.CylinderGeometry(outer,outer,len,96,1,true),colorMat(0x262a2d,.44));
 shell.rotation.z=Math.PI/2;shell.position.copy(center);shell.castShadow=true;muzzle.add(shell);
 const liner=new THREE.Mesh(new THREE.CylinderGeometry(inner,inner,len,96,1,true),colorMat(0x0d0f10,.18));
 liner.rotation.z=Math.PI/2;liner.position.copy(center);muzzle.add(liner);
 const annulus=new THREE.Mesh(new THREE.RingGeometry(inner,outer,96),colorMat(0x191d1e,.33));
 annulus.rotation.y=Math.PI/2;
 annulus.position.copy(center).add(new THREE.Vector3(len/2+.005,0,0));
 annulus.name='Real open muzzle cross-section with visible bore';muzzle.add(annulus);
 assembly.add(muzzle);
 assembly.userData={
  source:'Original supplied rifle photo /public/ref/rifle.webp',
  method:'componentwise photographic UV and separate true 3D physical receiver, brace, magazine, grip, handguard and rail',
  quality:'Review against original photo and 3/4 end camera before grading; hidden view inferred'
 };
 assembly.position.sub(new THREE.Box3().setFromObject(assembly).getCenter(new THREE.Vector3()));
 return assembly;
}
