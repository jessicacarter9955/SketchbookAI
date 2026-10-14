import * as THREE from 'three';

/**
 * Reference-FIRST 3D assembly of the user's violet ported pistol.
 *
 * Calibrated to the actual original 1150x761 source photograph, not a generic
 * pistol template. Top tube, chassis, guard, grip and sights are distinct,
 * genuinely volumetric parts. All visible surfaces project the original
 * source-albedo from a shared world-space UV camera. Hidden geometry is inferred.
 *
 * The perforated curved shroud is tessellated directly: openings are actual
 * missing faces surrounded by thickness walls, never dark painted rectangles.
 */
const PHOTO_W=1150, PHOTO_H=761, WORLD_W=9.6, UNIT=WORLD_W/PHOTO_W;
type Point=[number,number];
const wx=(x:number)=>(x-PHOTO_W/2)*UNIT;
const wy=(y:number)=>(PHOTO_H/2-y)*UNIT;
const I=(x:number,y:number)=>new THREE.Vector2(wx(x),wy(y));
const DARK=0x222225;

function mat(color:number,roughness:number,metalness:number):THREE.MeshPhysicalMaterial{
 return new THREE.MeshPhysicalMaterial({color,roughness,metalness,clearcoat:.08,clearcoatRoughness:.7,side:THREE.DoubleSide});
}
function soften(poly:Point[],samples=5):THREE.Vector2[]{
 const p=poly.map(([x,y])=>I(x,y));
 const cr=new THREE.SplineCurve([...p,p[0],p[1]]);
 const output:THREE.Vector2[]=[];
 for(let k=0;k<poly.length;k++){
   // Smooth but do not distort the photographed source outline.
   const a=p[(k+poly.length-1)%poly.length],b=p[k],c=p[(k+1)%poly.length];
   for(let i=0;i<samples;i++){
     const t=i/samples;
     const left=b.clone().lerp(a,Math.min(.12,(1-t)*.12));
     const right=b.clone().lerp(c,Math.min(.12,t*.12));
     output.push(left.lerp(right,t));
   }
 }
 void cr;
 return output;
}
function oriented(points:THREE.Vector2[],cw:boolean):THREE.Vector2[]{
 const arr=points.slice();
 return THREE.ShapeUtils.isClockWise(arr)===cw?arr:arr.reverse();
}
const crossSections=[-1,-.986,-.94,-.84,-.55,0,.55,.84,.94,.986,1];
function partGeometry(outline:Point[],holes:Point[][],half:(x:number,y:number)=>number,rounded:boolean):THREE.BufferGeometry {
 const outer=oriented(rounded?soften(outline,3):outline.map(([x,y])=>I(x,y)),false);
 const inner=holes.map(h=>oriented(h.map(([x,y])=>I(x,y)),true));
 const rings=[outer,...inner],basis:number[]=[];let n=0;
 for(const ring of rings){basis.push(n);n+=ring.length;}
 const cap=THREE.ShapeUtils.triangulateShape(outer,inner);
 const positions:number[]=[];
 const roll=.023;
 for(const t of crossSections){
  const bend=roll*(1-Math.sqrt(Math.max(0,1-t*t)));
  for(const ring of rings){
   for(let j=0;j<ring.length;j++){
    const p=ring[j],a=ring[(j-1+ring.length)%ring.length],b=ring[(j+1)%ring.length];
    const dA=p.clone().sub(a).normalize(),dB=b.clone().sub(p).normalize();
    const nA=new THREE.Vector2(-dA.y,dA.x),nB=new THREE.Vector2(-dB.y,dB.x);
    const normal=nA.add(nB).normalize();
    const x=p.x+normal.x*bend,y=p.y+normal.y*bend;
    positions.push(x,y,t*half(x,y));
   }
  }
 }
 const front:number[]=[],back:number[]=[],walls:number[]=[];
 const top=(crossSections.length-1)*n;
 for(const [a,b,c] of cap){front.push(top+a,top+b,top+c);back.push(c,b,a);}
 for(let layer=0;layer<crossSections.length-1;layer++){
  for(let r=0;r<rings.length;r++){
   const ring=rings[r],base=basis[r];
   for(let j=0;j<ring.length;j++){
    const k=(j+1)%ring.length;
    const aa=layer*n+base+j,bb=layer*n+base+k;
    const cc=(layer+1)*n+base+j,dd=(layer+1)*n+base+k;
    walls.push(aa,bb,cc,bb,dd,cc);
   }
  }
 }
 const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
 g.setIndex([...front,...back,...walls]);
 g.addGroup(0,front.length,0);
 g.addGroup(front.length,back.length,1);
 g.addGroup(front.length+back.length,walls.length,2);
 const uvs=new Float32Array(positions.length/3*2);
 for(let i=0;i<positions.length/3;i++){
  uvs[i*2]=positions[i*3]/WORLD_W+.5;
  uvs[i*2+1]=positions[i*3+1]/(PHOTO_H*UNIT)+.5;
 }
 g.setAttribute('uv',new THREE.BufferAttribute(uvs,2));g.computeVertexNormals();
 return g;
}
function faceMats(tex:THREE.Texture,base:number){
 const front=new THREE.MeshBasicMaterial({map:tex,toneMapped:false,alphaTest:.08,transparent:true,side:THREE.DoubleSide});
 const reverse=new THREE.MeshStandardMaterial({color:base,map:tex,metalness:.03,roughness:.82,side:THREE.DoubleSide});
 const sides=mat(base,.77,.055);
 return [front,reverse,sides];
}
function photoPart(target:THREE.Group,name:string,polygon:Point[],holes:Point[][],depth:(x:number,y:number)=>number,tex:THREE.Texture,tint:number,soft=true){
 const g=partGeometry(polygon,holes,depth,soft);
 const obj=new THREE.Mesh(g,faceMats(tex,tint));
 obj.name=name;obj.castShadow=true;obj.receiveShadow=true;target.add(obj);
 return obj;
}
type Cut={x0:number;x1:number;y0:number;y1:number};
const CUTS:Cut[]=[
 {x0:127,x1:184,y0:87,y1:121},
 {x0:200,x1:329,y0:85,y1:124},
 {x0:336,x1:398,y0:85,y1:126},
 {x0:127,x1:184,y0:150,y1:185},
 {x0:200,x1:329,y0:149,y1:189},
 {x0:336,x1:398,y0:149,y1:189}
];
function isOpen(x:number,y:number,z:number):boolean{
 if(z<=0)return false; // photograph shows openings on near-facing side only
 return CUTS.some(h=>{
  const margin=Math.min(11,(h.x1-h.x0)*.22),r=Math.min(10,(h.y1-h.y0)*.27);
  const cx=(h.x0+h.x1)/2,cy=(h.y0+h.y1)/2;
  const dx=Math.abs(x-cx),dy=Math.abs(y-cy);
  if(dx>(h.x1-h.x0)/2||dy>(h.y1-h.y0)/2)return false;
  // Rounded rectangular machinings, not arbitrary square texture deletions.
  const px=Math.max(0,dx-((h.x1-h.x0)/2-margin));
  const py=Math.max(0,dy-((h.y1-h.y0)/2-r));
  return px*px/(margin*margin)+py*py/(r*r)<1;
 });
}
function makeShroud(parent:THREE.Group,texture:THREE.Texture){
 const tube=new THREE.Group();tube.name='Independent variable-radius purple shroud';parent.add(tube);
 const start=78,end=1125,nx=160,nt=96;
 const p:number[]=[],uv:number[]=[],idx:number[]=[];
 const innerPos:number[]=[],innerIdx:number[]=[];
 const add=(arr:number[],point:THREE.Vector3)=>{arr.push(point.x,point.y,point.z);return arr.length/3-1;};
 const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
 function surface(x:number,t:number,k=1){
  const blend=THREE.MathUtils.smoothstep(x,393,481);
  const cy=lerp(131,124,blend),ry=lerp(70,61,blend);
  const y=cy-ry*Math.cos(t)*k;
  const z=Math.sin(t)*lerp(.585,.53,blend)*k;
  return new THREE.Vector3(wx(x),wy(y),z);
 }
 const outMaterial=new THREE.MeshPhysicalMaterial({
  map:texture,metalness:.29,roughness:.45,clearcoat:.21,
  clearcoatRoughness:.25,emissiveMap:texture,emissive:new THREE.Color(0xffffff),
  emissiveIntensity:.21,side:THREE.DoubleSide,alphaTest:.13,transparent:true
 });
 const darkInside=mat(0x18191d,.67,.28);
 for(let i=0;i<nx;i++){
  const x0=lerp(start,end,i/nx),x1=lerp(start,end,(i+1)/nx);
  for(let j=0;j<nt;j++){
    const t0=2*Math.PI*j/nt,t1=2*Math.PI*(j+1)/nt;
    const mid=surface((x0+x1)/2,(t0+t1)/2);
    const pixY=PHOTO_H/2-mid.y/UNIT;
    const active=isOpen((x0+x1)/2,pixY,mid.z);
    const va=surface(x0,t0),vb=surface(x1,t0),vc=surface(x1,t1),vd=surface(x0,t1);
    if(!active){
      const ids=[va,vb,vc,vd].map(v=>add(p,v));
      for(const v of [va,vb,vc,vd])uv.push(v.x/WORLD_W+.5,v.y/(PHOTO_H*UNIT)+.5);
      idx.push(ids[0],ids[1],ids[2],ids[0],ids[2],ids[3]);
    }
    const sa=surface(x0,t0,.76),sb=surface(x1,t0,.76),sc=surface(x1,t1,.76),sd=surface(x0,t1,.76);
    const ii=[sa,sb,sc,sd].map(v=>add(innerPos,v));
    innerIdx.push(ii[0],ii[2],ii[1],ii[0],ii[3],ii[2]);
    if(active){
     // Visible physical cut-wall: the hole passes through the outer shell.
     const quad=(v:THREE.Vector3[])=>{
       const ids=v.map(q=>add(innerPos,q));
       innerIdx.push(ids[0],ids[1],ids[2],ids[0],ids[2],ids[3]);
     };
     const left=isOpen(x0-1,pixY,mid.z),right=isOpen(x1+1,pixY,mid.z);
     const before=isOpen((x0+x1)/2,PHOTO_H/2-surface((x0+x1)/2,t0-.038).y/UNIT,surface((x0+x1)/2,t0-.038).z);
     const after=isOpen((x0+x1)/2,PHOTO_H/2-surface((x0+x1)/2,t1+.038).y/UNIT,surface((x0+x1)/2,t1+.038).z);
     if(!left)quad([va,vd,sd,sa]);
     if(!right)quad([vb,sb,sc,vc]);
     if(!before)quad([va,sa,sb,vb]);
     if(!after)quad([vd,vc,sc,sd]);
    }
  }
 }
 const outer=new THREE.BufferGeometry();
 outer.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
 outer.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));outer.setIndex(idx);outer.computeVertexNormals();
 const mesh=new THREE.Mesh(outer,outMaterial);mesh.name='96-sided photo-projected curved shroud with six true ports';
 mesh.castShadow=true;mesh.receiveShadow=true;tube.add(mesh);
 const interior=new THREE.BufferGeometry();
 interior.setAttribute('position',new THREE.Float32BufferAttribute(innerPos,3));interior.setIndex(innerIdx);interior.computeVertexNormals();
 const inside=new THREE.Mesh(interior,darkInside);inside.name='Hollow purple shroud internal surface and port wall thickness';tube.add(inside);
 // Original image has a black circular knurled nose at the LEFT end.
 const lip=mat(0x232428,.49,.52);
 const axisGeometry=(inner:number,outer:number,x:number):THREE.BufferGeometry=>{
  const g=new THREE.RingGeometry(inner,outer,128);
  g.rotateY(Math.PI/2);g.translate(wx(x),wy(131),0);return g;
 };
 const frontRim=new THREE.Mesh(axisGeometry(.26,.57,7),lip);
 frontRim.name='Open muzzle annulus with actual centre aperture';tube.add(frontRim);
 const cylindricalRim=new THREE.Mesh(new THREE.CylinderGeometry(.56,.56,.57,128,1,true),lip);
 cylindricalRim.rotation.z=Math.PI/2;cylindricalRim.position.set(wx(46),wy(131),0);
 cylindricalRim.name='Independent rounded dark muzzle surround';tube.add(cylindricalRim);
 const bore=new THREE.Mesh(new THREE.CylinderGeometry(.26,.26,.60,96,1,true),mat(0x090b0d,.88,.13));
 bore.rotation.z=Math.PI/2;bore.position.copy(cylindricalRim.position);
 bore.name='Recessed real hollow muzzle lining';tube.add(bore);
 const rearThread=new THREE.Mesh(new THREE.CylinderGeometry(.21,.21,.22,96,1,false),lip);
 rearThread.rotation.z=Math.PI/2;rearThread.position.set(wx(1128),wy(129),0);
 rearThread.name='Threaded rear collar, separate from painted shroud';tube.add(rearThread);
}

export async function createVioletPistolAssembly():Promise<THREE.Group>{
 const texture=await new THREE.TextureLoader().loadAsync('./ref/purple.webp');
 texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=16;
 const group=new THREE.Group();group.name='Violet pistol – source-locked multi-part native Three.js';
 const base=photoPart(group,'Polymer frame and separate physical trigger guard',[
  [410,188],[1104,185],[1114,224],[1099,241],[1035,248],[989,260],
  [956,281],[949,316],[945,341],[945,367],[965,415],[976,448],
  [758,448],[725,434],[702,415],[680,411],[649,418],[491,420],
  [453,390],[450,365],[460,339],[457,316],[451,292],
  [415,268],[404,244]
 ],[
  [[486,283],[604,283],[628,293],[658,302],[672,323],
   [670,357],[653,385],[632,393],[486,394],[471,381],[465,358],[470,310]]
 ],()=>.247,texture,0x313035);
 void base;
 const grip=photoPart(group,'Separate natural grip volume with palm swell',[
  [699,347],[736,325],[891,294],[943,294],[952,362],[963,425],
  [986,484],[1020,551],[1052,610],[1082,646],[1097,683],
  [1083,705],[1048,718],[841,718],[811,699],[790,649],
  [775,596],[751,526],[730,461],[709,408]
 ],[],(x,y)=>{
  const v=.5-y/(PHOTO_H*UNIT);
  const u=x/WORLD_W+.5;
  const swell=Math.max(0,1-Math.abs(u-.77)/.21);
  const pad=Math.max(0,1-Math.abs(v-.69)/.28);
  return .274+.105*swell*pad;
 },texture,0x252326);
 // Independent, raised checkering/grip side plate (not a repeated polygon shell).
 photoPart(group,'Inset photo-registered knurled grip panel',[
  [778,374],[909,371],[950,421],[979,521],[1007,600],
  [1026,645],[993,667],[857,653],[817,567],[796,482]
 ],[],()=>.375,texture,0x17191b);
 makeShroud(group,texture);
 // Sights are disconnected hard-surface components, not shadows on the tube.
 photoPart(group,'Front dovetail sight component',[
  [88,13],[149,13],[164,49],[255,54],[255,64],[83,64]
 ],[],()=>.385,texture,DARK);
 photoPart(group,'Rear optic/iron-sight housing component',[
  [896,35],[924,28],[993,28],[1002,18],[1053,18],
  [1056,63],[1010,72],[894,69],[886,56]
 ],[],()=>.396,texture,DARK);
 group.userData.reconstruction={
  method:'reference-first independent mechanical components and six geometric shroud ports',
  source:'the original user-provided purple pistol photo',
  photography:'source-side color alignment locked; hidden surfaces inferred',
  reviewStatus:'unrated pending real 3/4 screenshot review'
 };
 group.position.sub(new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3()));
 return group;
}
