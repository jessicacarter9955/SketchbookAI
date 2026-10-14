import * as THREE from 'three';
import tracedData from './referenceContourData';

/**
 * Reference-first, multi-section mesh reconstruction.
 * Geometry strategy adapted from the official img2threejs Glock-18 showcase:
 * eleven cross-sectional loft rings, source-projected cap UVs, separated
 * front/back/rim materials, and independently varying part thicknesses.
 *
 * Unlike the old one-step ExtrudeGeometry, there is a rounded 3-D surface
 * spanning every reference-traced boundary. Hidden depth is inferred.
 */
type Weapon='compact'|'purple'|'rifle';
type ShapeRecord={aspect:number;contours:number[][][];holes:number[][][]};
const shapes=tracedData as unknown as Record<Weapon,ShapeRecord>;
const LOFT_T=[-1,-.988,-.946,-.88,-.59,0,.59,.88,.946,.988,1] as const;
const smooth=(a:number,b:number,x:number)=>{
 const t=THREE.MathUtils.clamp((x-a)/(b-a),0,1);
 return t*t*(3-2*t);
};
const area=(x:number,a:number,b:number,soft:number)=>
 smooth(a,a+soft,x)*(1-smooth(b-soft,b,x));

function patch(u:number,v:number,x0:number,x1:number,y0:number,y1:number,soft=.025):number {
 return area(u,x0,x1,soft)*area(v,y0,y1,soft);
}
function halfDepth(key:Weapon,x:number,y:number,width:number,height:number):number {
 const u=x/width+.5,v=.5-y/height;
 if(key==='rifle') {
  const stock=patch(u,v,.012,.32,.09,.77,.05)*.23;
  const receiver=patch(u,v,.30,.593,.055,.54,.04)*.40;
  const forearm=patch(u,v,.59,.914,.035,.34,.03)*.27;
  const grip=patch(u,v,.265,.45,.34,.89,.03)*.095;
  const magazine=patch(u,v,.45,.63,.37,.99,.035)*.17;
  const muzzle=patch(u,v,.905,.995,.08,.26,.025)*.12;
  // Most of the reference-facing broadside stays slender; the real volume
  // comes from independent receiver/forearm/grip/brace thickness regions.
  return .11+stock+receiver+forearm+grip+magazine+muzzle;
 }
 if(key==='purple') {
  const tube=patch(u,v,.015,.96,.055,.315,.037)*.24;
  const grip=patch(u,v,.47,.9,.38,.96,.06)*.135;
  const receiver=patch(u,v,.30,.96,.25,.52,.065)*.24;
  return .13+tube+grip+receiver;
 }
 const slide=patch(u,v,.02,.98,.09,.35,.04)*.225;
 const chassis=patch(u,v,.01,.98,.28,.5,.05)*.135;
 const grip=patch(u,v,.015,.48,.36,.98,.035)*.13;
 return .11+slide+chassis+grip;
}
function shapeRing(points:number[][],w:number,h:number):THREE.Vector2[] {
 return points.map(([x,y])=>new THREE.Vector2((x-.5)*w,(.5-y)*h));
}
function cleanRing(r:THREE.Vector2[],clockwise:boolean):THREE.Vector2[] {
 let a=r.filter((p,i)=>i===0||p.distanceToSquared(r[i-1])>1e-10);
 if(a.length>1&&a[0].distanceToSquared(a[a.length-1])<1e-10)a=a.slice(0,-1);
 return THREE.ShapeUtils.isClockWise(a)===clockwise?a:a.reverse();
}
function offsetRing(r:THREE.Vector2[],amount:number):THREE.Vector2[]{
 return r.map((p,i)=>{
  const prev=r[(i+r.length-1)%r.length],next=r[(i+1)%r.length];
  const a=p.clone().sub(prev).normalize(),b=next.clone().sub(p).normalize();
  const n1=new THREE.Vector2(-a.y,a.x),n2=new THREE.Vector2(-b.y,b.x);
  const n=n1.clone().add(n2);
  if(n.lengthSq()<.004)return p.clone().addScaledVector(n1,amount);
  n.normalize();
  return p.clone().addScaledVector(n,Math.min(amount*2,amount/Math.max(.25,n.dot(n1))));
 });
}
function isInPolygon(px:number,py:number,pts:number[][]){
 let inside=false;
 for(let i=0,j=pts.length-1;i<pts.length;j=i++){
  const [xi,yi]=pts[i],[xj,yj]=pts[j];
  if((yi>py)!==(yj>py) && px<(xj-xi)*(py-yi)/(yj-yi)+xi)inside=!inside;
 }
 return inside;
}
function roundedHole(u:number,v:number,w:number,h:number,xScale:number,yScale:number):THREE.Vector2[]{
 const x=(u-.5)*xScale,y=(.5-v)*yScale,a=w*xScale/2,b=h*yScale/2;
 const n=8,out:THREE.Vector2[]=[];
 for(let i=0;i<n*4;i++){
  const t=i*Math.PI/(n*2),cx=Math.cos(t),cy=Math.sin(t);
  const xx=x+cx*a,yy=y+cy*b;
  out.push(new THREE.Vector2(xx,yy));
 }
 return out;
}
function depthMesh(outline:THREE.Vector2[],holes:THREE.Vector2[][],
 key:Weapon,w:number,h:number):THREE.BufferGeometry {
 const rings=[cleanRing(outline,false),...holes.map(x=>cleanRing(x,true))];
 const stride=rings.reduce((s,r)=>s+r.length,0);
 const origins:number[]=[];let sum=0;
 for(const ring of rings){origins.push(sum);sum+=ring.length;}
 const faces=THREE.ShapeUtils.triangulateShape(rings[0],rings.slice(1));
 const xyz:number[]=[];
 const addVert=(x:number,y:number,z:number)=>{xyz.push(x,y,z);return xyz.length/3-1;};
 const radius=key==='rifle'?.050:key==='compact'?.037:.046;
 for(const t of LOFT_T) {
   const amount=radius*(1-Math.sqrt(Math.max(0,1-t*t)));
   rings.forEach(ring=>{
     const inset=offsetRing(ring,amount);
     ring.forEach((point,j)=>{
       const z=t*halfDepth(key,point.x,point.y,w,h);
       addVert(inset[j].x,inset[j].y,z);
     });
   });
 }
 const fi=(LOFT_T.length-1)*stride;
 const front:number[]=[],back:number[]=[],wall:number[]=[];
 for(const [a,b,c] of faces){front.push(fi+a,fi+b,fi+c);back.push(c,b,a);}
 for(let layer=0;layer<LOFT_T.length-1;layer++){
   const base=layer*stride,top=(layer+1)*stride;
   rings.forEach((ring,i)=>{
     const offset=origins[i];
     for(let j=0;j<ring.length;j++){
       const k=(j+1)%ring.length;
       const a=base+offset+j,b=base+offset+k,c=top+offset+j,d=top+offset+k;
       wall.push(a,b,c,b,d,c);
     }
   });
 }
 const geom=new THREE.BufferGeometry();
 geom.setAttribute('position',new THREE.Float32BufferAttribute(xyz,3));
 geom.setIndex([...front,...back,...wall]);
 geom.addGroup(0,front.length,0);
 geom.addGroup(front.length,back.length,1);
 geom.addGroup(front.length+back.length,wall.length,2);
 const uvs:number[]=new Array(xyz.length/3*2);
 for(let i=0;i<xyz.length/3;i++){
  uvs[2*i]=xyz[3*i]/w+.5;
  uvs[2*i+1]=xyz[3*i+1]/h+.5;
 }
 geom.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
 geom.computeVertexNormals();
 return geom;
}
function imageColorSampler(tex:THREE.Texture,w:number,h:number){
 const canvas=document.createElement('canvas');
 const img=tex.image as HTMLImageElement;
 canvas.width=img.naturalWidth||img.width;canvas.height=img.naturalHeight||img.height;
 const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
 ctx.drawImage(img,0,0);
 const px=ctx.getImageData(0,0,canvas.width,canvas.height).data;
 return (x:number,y:number)=>{
  const ix=Math.max(0,Math.min(canvas.width-1,Math.round((x/w+.5)*(canvas.width-1))));
  const iy=Math.max(0,Math.min(canvas.height-1,Math.round((.5-y/h)*(canvas.height-1))));
  let idx=(iy*canvas.width+ix)*4;
  if(px[idx+3]<100){
   outer:for(let step=1;step<=15;step++)for(let k=0;k<16;k++){
    const ang=k*Math.PI/8;
    const xx=Math.max(0,Math.min(canvas.width-1,Math.round(ix+step*Math.cos(ang))));
    const yy=Math.max(0,Math.min(canvas.height-1,Math.round(iy+step*Math.sin(ang))));
    const at=(yy*canvas.width+xx)*4;
    if(px[at+3]>170){idx=at;break outer;}
   }
  }
  if(px[idx+3]<100)return new THREE.Color('#4b4e4b');
  return new THREE.Color().setRGB(px[idx]/255,px[idx+1]/255,px[idx+2]/255,THREE.SRGBColorSpace);
 };
}
export async function makeReferenceLoft(key:Weapon):Promise<THREE.Group>{
 const src=shapes[key],w=key==='rifle'?12.2:key==='purple'?8.3:5.5,h=w/src.aspect;
 const source=await new THREE.TextureLoader().loadAsync('./ref/'+key+'.webp');
 source.colorSpace=THREE.SRGBColorSpace;source.anisotropy=16;source.wrapS=source.wrapT=THREE.ClampToEdgeWrapping;
 const sample=imageColorSampler(source,w,h);
 const output=new THREE.Group();output.name=key+' — image-locked eleven-ring volumetric loft';
 const face=new THREE.MeshBasicMaterial({map:source,toneMapped:false,transparent:true,alphaTest:.06,side:THREE.DoubleSide,depthWrite:true});
 const back=new THREE.MeshStandardMaterial({map:source,color:0x777777,metalness:.1,roughness:.74,transparent:true,alphaTest:.1,side:THREE.DoubleSide});
 const side=new THREE.MeshPhysicalMaterial({vertexColors:true,color:0xffffff,metalness:.09,roughness:.65,clearcoat:.12,clearcoatRoughness:.65,side:THREE.DoubleSide});
 for(const boundary of src.contours){
  if(boundary.length<4)continue;
  const holeList=src.holes.filter(hole=>hole.length>3&&isInPolygon(hole[0][0],hole[0][1],boundary)).map(r=>shapeRing(r,w,h));
  // Source-observed dark handguard apertures that alpha extraction misses.
  if(key==='rifle')for(const [u,v,holeW,holeH] of [[.805,.093,.052,.02],[.652,.244,.054,.024],[.730,.244,.054,.024],[.810,.244,.054,.024]]){
   if(isInPolygon(u,v,boundary))holeList.push(roundedHole(u,v,holeW,holeH,w,h));
  }
  const geom=depthMesh(shapeRing(boundary,w,h),holeList,key,w,h);
  const pos=geom.getAttribute('position') as THREE.BufferAttribute;
  const colors=new Float32Array(pos.count*3);
  for(let i=0;i<pos.count;i++){
   const c=sample(pos.getX(i),pos.getY(i));
   colors[3*i]=c.r;colors[3*i+1]=c.g;colors[3*i+2]=c.b;
  }
  geom.setAttribute('color',new THREE.BufferAttribute(colors,3));
  // We purposely keep all three materials separate: front photograph,
  // inferred back and physically shaded walls, rather than a flat box.
  const mesh=new THREE.Mesh(geom,[face,back,side]);
  mesh.castShadow=true;mesh.receiveShadow=true;
  mesh.name='Reference-traced 11-section loft; photo cap, curved side and reverse';
  output.add(mesh);
 }
 // Reference-guided interior layers: traced vent holes reveal physically
 // shaded internals, not white studio background or an invented raised panel.
 // The silhouette cap and its source UVs remain completely untouched.
 function internalSurface(name:string,u:number,v:number,uw:number,vh:number,color:number,z=.016){
  const mat=new THREE.MeshStandardMaterial({
   color,roughness:.87,metalness:.12,side:THREE.DoubleSide
  });
  const plane=new THREE.Mesh(new THREE.PlaneGeometry(uw*w,vh*h),mat);
  plane.name=name;
  plane.position.set((u-.5)*w,(.5-v)*h,z);
  plane.receiveShadow=true;
  output.add(plane);
 }
 if(key==='rifle'){
  // An interior backing for each aperture avoids a black rectangular slab
  // sticking out past the silhouette at oblique camera angles.
  for(const [u,v,wu,hv] of [[.805,.093,.052,.02],[.652,.244,.054,.024],[.730,.244,.054,.024],[.810,.244,.054,.024],[.680,.104,.061,.022],[.755,.104,.064,.022]]){
   internalSurface('shadowed internal wall confined to traced ventilation port',u,v,wu*.94,hv*.94,0x101813,-.018);
  }
  // The barrel lives between the photographed near face and the reverse
  // shell, and is actually observable through the ventilation openings.
  const innerBarrel=new THREE.Mesh(
   new THREE.CylinderGeometry(.110,.110,3.18,48,1,false),
   new THREE.MeshStandardMaterial({color:0x151719,metalness:.62,roughness:.59})
  );
  innerBarrel.rotation.z=Math.PI/2;
  innerBarrel.position.set((.754-.5)*w,(.5-.174)*h,-.032);
  innerBarrel.name='partially exposed interior barrel underneath handguard';
  innerBarrel.castShadow=true;output.add(innerBarrel);
 }
 if(key==='purple'){
  for(const u of [.137,.23,.324])for(const v of [.13,.212]){
   internalSurface('local dark housing beneath genuine port',u,v,.047,.030,0x111017,-.006);
  }
 }
 if(key==='compact'){
  internalSurface('dark interior behind photographed slide window',.574,.121,.22,.095,0x393d41,.006);
 }
 output.userData={
  reference:'original user photograph /ref/'+key+'.webp',
  geometry:'img2threejs Glock-inspired eleven-ring nonconstant cross section',
  invariant:'source-facing alpha contour and projected markings',
  caveat:'single-image unseen surfaces inferred',
  quality:'unrated: must be visually reviewed'
 };
 const center=new THREE.Box3().setFromObject(output).getCenter(new THREE.Vector3());
 output.position.sub(center);
 return output;
}
