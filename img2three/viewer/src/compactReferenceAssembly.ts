import * as THREE from 'three';

/**
 * Independent photographic components measured against compact.png
 * (source photograph: 1150 × 916 px).
 * Black slide, exposed steel barrel, purple polymer chassis, contoured grip,
 * magazine base and sights are independent Three.js geometry — no whole-gun slab.
 * The photograph is only projected on the observed reference side.
 */
const W=1150,H=916,SCALE=9.6/W;
type Point=[number,number];
const toVec=(p:Point)=>new THREE.Vector2((p[0]-W/2)*SCALE,(H/2-p[1])*SCALE);
const C=(hex:number,rough=.8,metal=.04)=>new THREE.MeshPhysicalMaterial({
 color:hex,roughness:rough,metalness:metal,clearcoat:.11,clearcoatRoughness:.7,side:THREE.DoubleSide
});
function componentShape(points:Point[],holes:Point[][]):THREE.Shape {
 const pt=points.map(toVec);
 const shape=new THREE.Shape();
 pt.forEach((p,i)=>i?shape.lineTo(p.x,p.y):shape.moveTo(p.x,p.y));shape.closePath();
 for(const hole of holes) {
  const trace=hole.map(toVec),p=new THREE.Path();
  trace.forEach((v,i)=>i?p.lineTo(v.x,v.y):p.moveTo(v.x,v.y));
  p.closePath();shape.holes.push(p);
 }
 return shape;
}
function atlasSampler(texture:THREE.Texture) {
 const img=texture.image as HTMLImageElement;
 const c=document.createElement('canvas');c.width=img.naturalWidth||W;c.height=img.naturalHeight||H;
 const ctx=c.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(img,0,0);
 const data=ctx.getImageData(0,0,c.width,c.height).data;
 return (x:number,y:number)=>{
  const xx=Math.max(0,Math.min(c.width-1,Math.round((x/SCALE+W/2)/W*(c.width-1))));
  const yy=Math.max(0,Math.min(c.height-1,Math.round((H/2-y/SCALE)/H*(c.height-1))));
  let i=(yy*c.width+xx)*4;
  if(data[i+3]<100)for(let r=1;r<=20;r++){
   const k=(Math.min(c.height-1,yy+r)*c.width+xx)*4;
   if(data[k+3]>180){i=k;break;}
  }
  return new THREE.Color().setRGB(data[i]/255,data[i+1]/255,data[i+2]/255,THREE.SRGBColorSpace);
 };
}
export async function createCompactReferenceAssembly():Promise<THREE.Group>{
 const texture=await new THREE.TextureLoader().loadAsync('./ref/compact.webp');
 texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=16;
 const group=new THREE.Group();group.name='Compact pistol, separate photographed source-accurate components';
 const sample=atlasSampler(texture);
 function part(name:string,contour:Point[],holes:Point[][],depth:number,tint:number,round=.02,swell=0){
  const shape=componentShape(contour,holes);
  const geom=new THREE.ExtrudeGeometry(shape,{
   depth:depth*2,steps:4,bevelEnabled:true,bevelSegments:6,
   bevelSize:round,bevelThickness:round,curveSegments:12
  });
  geom.translate(0,0,-depth);
  const pos=geom.getAttribute('position'),uv=geom.getAttribute('uv');
  const col=new Float32Array(pos.count*3);
  for(let i=0;i<pos.count;i++){
   const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i);
   // Contoured backs, while photo-facing cap preserves original projection.
   if(z<0 && swell){
    const py=H/2-y/SCALE,u=x/SCALE+W/2;
    const t=Math.exp(-Math.pow((py-580)/240,2)-Math.pow((u-260)/240,2));
    pos.setZ(i,z-swell*t);
   }
   uv.setXY(i,x/(W*SCALE)+.5,y/(H*SCALE)+.5);
   const c=sample(x,y);col[3*i]=c.r;col[3*i+1]=c.g;col[3*i+2]=c.b;
  }
  geom.setAttribute('color',new THREE.BufferAttribute(col,3));
  pos.needsUpdate=true;uv.needsUpdate=true;geom.computeVertexNormals();
  const front=new THREE.MeshBasicMaterial({
   map:texture,side:THREE.DoubleSide,transparent:true,alphaTest:.09,toneMapped:false,depthWrite:true
  });
  const side=new THREE.MeshPhysicalMaterial({
   vertexColors:true,color:0xd5d5d5,metalness:tint===0x27272c?.24:.055,
   roughness:.66,clearcoat:.13,clearcoatRoughness:.66,side:THREE.DoubleSide
  });
  const mesh=new THREE.Mesh(geom,[front,side]);
  mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);return mesh;
 }
 // Slide is a separate compact hard-surface volume; it is not fused to the polymer frame.
 part('Black machined slide with independent window and front cocking serrations',[
  [29,182],[39,105],[47,57],[78,43],[531,43],[546,53],[734,52],
  [751,42],[1095,42],[1127,45],[1136,183],[1130,193],[30,194]
 ],[
  [[551,48],[738,48],[743,61],[744,124],[734,140],
   [559,140],[549,128],[549,65]]
 ],.345,0x27272c,.018);
 // Curved steel ejection-port sleeve is independently visible through the slide opening.
 const barrelMat=new THREE.MeshPhysicalMaterial({color:0x929a9b,metalness:.81,roughness:.31,side:THREE.DoubleSide});
 const tube=new THREE.Mesh(new THREE.CylinderGeometry(.307,.307,1.50,96,1,false),barrelMat);
 tube.rotation.z=Math.PI/2;
 tube.position.set((645-W/2)*SCALE,(H/2-91)*SCALE,.055);
 tube.name='Round polished barrel volume visible under ejection-port cut';
 tube.castShadow=true;group.add(tube);
 // Keep reference finish of the stainless window exactly as photographed.
 part('Steel barrel photographic surface with accurate fine grooves',[
  [552,48],[740,48],[742,66],[741,124],[728,139],[560,140],[551,128]
 ],[],.360,0x777d7e,.012);
 // The polymer body is separately lofted from slide and has a REAL
 // trigger-guard hole following the clear part of the original source.
 part('Violet polymer frame and independent trigger-guard opening',[
  [20,194],[1135,193],[1136,309],[1123,320],[1071,327],
  [816,329],[813,461],[803,490],[571,493],[482,463],
  [455,505],[388,647],[366,803],[353,827],[29,825],
  [15,799],[40,681],[83,568],[128,451],[152,378],
  [150,327],[133,290],[95,270],[21,266]
 ],[
  [[487,397],[547,314],[583,309],[737,313],[761,319],
   [783,340],[793,375],[790,429],[775,460],[755,469],
   [557,461],[495,443],[472,425]]
 ],.245,0x6a36a0,.026);
 // Grip geometry has its own rear palm swell and is treated as a part,
 // rather than extending the slide's thickness all the way through.
 const grip=part('Textured violet handle with separate gently swollen cross-section',[
  [170,368],[211,381],[438,467],[425,512],[397,634],
  [369,787],[359,822],[35,823],[17,794],[32,696],
  [73,567],[128,444],[151,393]
 ],[],.263,0x633699,.021,.11);
 // The continuous original side must not be split by a raised diagonal seam:
 // let the handle shape reinforce the REVERSE volume under the front chassis.
 grip.position.z=-.032;
 part('Real black curved trigger inside source-matched guard opening',[
  [564,307],[617,309],[625,338],[642,385],[657,416],
  [636,443],[613,453],[586,425],[563,382],[512,366],[516,341]
 ],[],.295,0x222326,.015);
 part('Black removable magazine base and foot',[
  [66,836],[355,831],[360,849],[356,873],[339,887],
  [74,888],[53,877],[51,858]
 ],[],.30,0x202124,.017);
 part('Front sight hood and notch',[
  [79,51],[93,12],[122,12],[136,52]
 ],[],.36,0x242427,.012);
 part('Rear raised iron sight',[
  [1036,43],[1046,16],[1097,17],[1106,43]
 ],[],.37,0x242427,.012);
 group.userData={
  source:'Original 1150x916 photo reference',
  method:'Slide/barrel/frame/guard/grip/magazine/sights independent Three.js photo-registered assemblies',
  status:'Awaiting multiview visual assessment; rear geometry inferred'
 };
 group.position.sub(new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3()));
 return group;
}
