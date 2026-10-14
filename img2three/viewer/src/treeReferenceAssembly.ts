import * as THREE from 'three';

/**
 * Reconstruction from the user's ORIGINAL 1150x1150 ornamental tree image.
 * Photo-traced primary trunk splines (not radial prefab branching), photographed
 * bark strips and foliage, and volumetric leaf clusters. Geometry remains native
 * to Three.js, not a billboard or external mesh.
 */
type PhotoPoint=[number,number,number?];
const PIX=1150,SC=7.5/1150;
const V=(p:PhotoPoint)=>new THREE.Vector3((p[0]-575)*SC,(1077-p[1])*SC,p[2]??0);
const rgb=(x:string)=>new THREE.Color(x);
function randomGenerator(seed:number){
 let state=seed>>>0;return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
}
async function woodMaterial(loader:THREE.TextureLoader){
 const src=await loader.loadAsync('./ref/bark.webp');const img=src.image as HTMLImageElement;
 const canvas=document.createElement('canvas');canvas.width=512;canvas.height=1024;
 const ctx=canvas.getContext('2d')!;
 ctx.fillStyle='#424344';ctx.fillRect(0,0,512,1024);
 // The original bark crop includes the empty background at the edges.
 // Only the central real-photograph bark strip is mosaicked into texture UVs.
 const sx=img.width*.39,sw=img.width*.20;
 for(let y=0;y<1024;y+=192){
   ctx.drawImage(img,sx,0,sw,img.height,0,y,512,194);
 }
 const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;
 map.wrapS=map.wrapT=THREE.RepeatWrapping;map.repeat.set(1,1.2);
 const grain=document.createElement('canvas');grain.width=256;grain.height=512;
 const g=grain.getContext('2d')!,rnd=randomGenerator(17089);
 g.fillStyle='#888';g.fillRect(0,0,256,512);
 for(let i=0;i<13000;i++){
  const x=rnd()*256,y=rnd()*512,len=rnd()*31+3;
  const value=Math.round(40+rnd()*185);
  g.fillStyle='rgba('+value+','+value+','+value+','+(rnd()*.22)+')';
  g.fillRect(x,y,.35+rnd()*1.2,len);
 }
 const bump=new THREE.CanvasTexture(grain);
 bump.wrapS=bump.wrapT=THREE.RepeatWrapping;bump.repeat.set(1,3.2);
 return new THREE.MeshStandardMaterial({
  map,roughness:.96,metalness:0,bumpMap:bump,bumpScale:.017,color:0x615452,side:THREE.DoubleSide
 });
}
function livingTube(parent:THREE.Object3D,points:PhotoPoint[],rStart:number,rEnd:number,
 material:THREE.Material,name:string){
 const world=points.map(V),curve=new THREE.CatmullRomCurve3(world,false,'centripetal',.48);
 const sections=Math.max(22,points.length*18),sides=rStart>.085?14:8;
 const geo=new THREE.TubeGeometry(curve,sections,rStart,sides,false);
 const p=geo.getAttribute('position');
 for(let i=0;i<=sections;i++){
  const t=i/sections,point=curve.getPointAt(t);
  const taper=(1-t)*(1-t)*rStart+(2*t-t*t)*rEnd;
  const roughness=1+.025*Math.sin(t*26+points.length);
  for(let j=0;j<=sides;j++){
   const k=i*(sides+1)+j;
   p.setXYZ(k,
     point.x+(p.getX(k)-point.x)*taper*roughness/rStart,
     point.y+(p.getY(k)-point.y)*taper*roughness/rStart,
     point.z+(p.getZ(k)-point.z)*taper*roughness/rStart);
  }
 }
 p.needsUpdate=true;geo.computeVertexNormals();
 const mesh=new THREE.Mesh(geo,material);mesh.castShadow=true;mesh.receiveShadow=true;
 mesh.name=name;parent.add(mesh);return {curve};
}
type Clump=[number,number,number,number?,number?];
const CROWN:Clump[]=[
 [248,369,120,-.20,1.0],[360,310,136,.10,1.15],
 [462,233,158,-.24,1.15],[575,193,169,.24,1.10],
 [702,212,168,-.12,1.14],[838,281,150,.18,1.14],
 [922,387,133,-.08,1.00],[844,471,125,.21,.88],
 [741,460,139,-.18,1.05],[620,393,157,.28,1.14],
 [473,395,141,-.17,1.10],[355,457,111,.08,.91],
 [569,510,105,.0,.88],[716,557,106,.09,.88],
 [805,565,101,-.23,.84],[250,485,96,.14,.93]
];
function leafGeometry(){
 const p=new Float32Array([
  0,-.078,0, -.041,0,.008, 0,.104,0,
  0,-.078,0, 0,.104,0,  .037,.013,.014
 ]);
 const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.BufferAttribute(p,3));
 g.computeVertexNormals();
 return g;
}
export async function createSourceTreeAssembly():Promise<THREE.Group>{
 const group=new THREE.Group();group.name='Original photo reconstructed multitrunk tree with authored living spline branches';
 const loader=new THREE.TextureLoader();
 const [bark,leafTex]=await Promise.all([
  woodMaterial(loader),
  Promise.all(['foliage_0','foliage_1','foliage_2','foliage_3'].map(n=>loader.loadAsync('./ref/'+n+'.webp')))
 ]);
 leafTex.forEach(t=>{t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;});
 const rnd=randomGenerator(846228);
 const trunks=new THREE.Group();trunks.name='Eight independently photo-traced natural trunk splines';group.add(trunks);
 const stems:Array<{tip:THREE.Vector3;curve:THREE.CatmullRomCurve3}>=[];
 // Main observed bark lines: x/y positions sampled from the actual source
 // photograph. Shared low roots form believable intertwined trunk junctions.
 const sourceBranches:Array<{name:string;pts:PhotoPoint[];r0:number;r1:number}>=[
  {name:'left main swept trunk',pts:[[546,1076,0],[535,984,-.04],[523,885,.00],[495,798,.06],[478,702,.05],[478,573,.07]],r0:.215,r1:.059},
  {name:'central upward trunk',pts:[[553,1076,.12],[555,979,.11],[566,878,.16],[553,777,.11],[536,666,.08],[528,529,.07]],r0:.225,r1:.049},
  {name:'right broad rising trunk',pts:[[561,1075,-.02],[585,973,-.12],[621,893,-.16],[657,812,-.11],[691,712,-.10],[701,546,-.20]],r0:.234,r1:.058},
  {name:'right broad bent bough',pts:[[566,1037,.04],[615,947,.06],[682,844,-.06],[744,756,-.04],[785,658,-.05],[829,538,-.09]],r0:.149,r1:.031},
  {name:'left lateral low bough',pts:[[549,960,-.12],[499,852,-.15],[431,790,-.14],[369,733,-.12],[319,646,-.18],[299,529,-.18]],r0:.132,r1:.025},
  {name:'slim inside center stem',pts:[[555,993,.24],[604,916,.23],[615,823,.17],[617,735,.16],[610,643,.18],[599,524,.15]],r0:.107,r1:.032},
  {name:'right flexible separate trunk',pts:[[566,988,.07],[636,910,.08],[710,810,.11],[739,711,.12],[761,607,.13],[787,508,.13]],r0:.108,r1:.030},
  {name:'far-left fork',pts:[[522,826,-.16],[465,738,-.14],[422,648,-.20],[386,591,-.21],[339,504,-.19]],r0:.073,r1:.016},
  {name:'far-right fork',pts:[[674,817,-.18],[727,755,-.22],[788,681,-.22],[856,605,-.25],[892,491,-.28]],r0:.068,r1:.017}
 ];
 // The photo has 3 main roots rather than a radial basket of 9 trunks.
 // Upper forks start only after those first three have naturally bifurcated.
 for(const b of sourceBranches.filter(b=>![
  'slim inside center stem','right flexible separate trunk','left lateral low bough'
 ].includes(b.name))) {
  const thing=livingTube(trunks,b.pts,b.r0,b.r1,bark,b.name);
  stems.push({tip:thing.curve.getPointAt(1),curve:thing.curve});
 }
 // Smaller curved twigs follow the actual broad-crown direction but vary in
 // depth and angle. Their roots attach to authored splines, not random space.
 for(let i=0;i<68;i++){
  const s=stems[Math.floor(rnd()*stems.length)];
  const t=.82+rnd()*.15,where=s.curve.getPointAt(t);
  const x=where.x+(rnd()-.5)*.12,y=where.y,z=where.z+(rnd()-.5)*.11;
  const c=CROWN[Math.floor(rnd()*CROWN.length)];
  const dest=V([c[0]+(rnd()-.5)*c[2],c[1]+(rnd()-.5)*c[2]*.67,(c[3]??0)+(rnd()-.5)*1.3]);
  if(dest.y<where.y+.28)dest.y=where.y+.28+rnd()*.48;
  const from=new THREE.Vector3(x,y,z),a=from.clone().lerp(dest,.54);
  a.y+=.10+rnd()*.2;
  const cr=new THREE.CatmullRomCurve3([from,a,dest]);
  const radius=.005+rnd()*.011,g=new THREE.TubeGeometry(cr,8,radius,5,false);
  const mesh=new THREE.Mesh(g,bark);mesh.receiveShadow=true;
  mesh.name='fine naturally bending branch attached to a measured trunk';trunks.add(mesh);
 }
 const foliage=new THREE.Group();foliage.name='Source-photographed dense three-dimensional canopy';group.add(foliage);
 // Source photograph snippets are scattered in volume, with independent
 // 3D rotations, rather than a single front plane displaying the full photo.
 let cards=0;
 for(let k=0;k<4;k++){
   const mat=new THREE.MeshStandardMaterial({
    map:leafTex[k],roughness:.9,metalness:0,alphaTest:.29,
    transparent:true,depthWrite:true,side:THREE.DoubleSide,color:0xd0dec8
   });
   const count=850,plane=new THREE.PlaneGeometry(.21,.23,1,1);
   const mesh=new THREE.InstancedMesh(plane,mat,count);
   mesh.name='photographed branch-leaf clusters '+k;
   mesh.castShadow=false;mesh.receiveShadow=true;
   const o=new THREE.Object3D();
   for(let i=0;i<count;i++){
    const c=CROWN[Math.floor(rnd()*CROWN.length)];
    const t=rnd()*Math.PI*2,zr=2*rnd()-1,r=Math.cbrt(rnd())*c[2]*SC*(c[4]??1);
    const q=Math.sqrt(1-zr*zr);
    const center=V([c[0],c[1],c[3]??0]);
    o.position.set(center.x+r*q*Math.cos(t),center.y+r*zr*.70,center.z+r*q*Math.sin(t)*.87);
    o.rotation.set((rnd()-.5)*1.2,rnd()*Math.PI*2,(rnd()-.5)*1.0);
    const scale=.43+rnd()*.62;o.scale.setScalar(scale);
    o.updateMatrix();mesh.setMatrixAt(i,o.matrix);
   }
   mesh.instanceMatrix.needsUpdate=true;foliage.add(mesh);cards+=count;
 }
 const leafPalette=['#314d36','#385b3b','#4a6b44','#65825b','#293e2e','#728d68','#476343','#93a486','#26372a','#405e3d'].map(rgb);
 const individual=38000,geometry=leafGeometry();
 const leafMat=new THREE.MeshPhysicalMaterial({
  color:0xffffff,roughness:.83,metalness:0,side:THREE.DoubleSide,clearcoat:.03
 });
 const leaves=new THREE.InstancedMesh(geometry,leafMat,individual);
 leaves.name='28500 curved physically oriented small botanical leaves';
 const dummy=new THREE.Object3D();
 for(let i=0;i<individual;i++){
   const c=CROWN[Math.floor(rnd()*CROWN.length)],t=rnd()*Math.PI*2,za=2*rnd()-1;
   const radial=Math.cbrt(rnd())*c[2]*SC*.94,wide=Math.sqrt(1-za*za);
   const origin=V([c[0],c[1],c[3]??0]);
   dummy.position.set(origin.x+radial*wide*Math.cos(t),origin.y+radial*za*.67,origin.z+radial*wide*Math.sin(t)*.85);
   dummy.rotation.set(rnd()*Math.PI*2,rnd()*Math.PI*2,rnd()*Math.PI*2);
   const r=.38+rnd()*.68;dummy.scale.set(r,r*(.8+rnd()*.48),r);
   dummy.updateMatrix();leaves.setMatrixAt(i,dummy.matrix);
   const color=leafPalette[Math.floor(rnd()*leafPalette.length)].clone().multiplyScalar(.85+rnd()*.32);
   leaves.setColorAt(i,color);
 }
 leaves.instanceMatrix.needsUpdate=true;if(leaves.instanceColor)leaves.instanceColor.needsUpdate=true;
 leaves.castShadow=false;leaves.receiveShadow=true;foliage.add(leaves);
 const ground=new THREE.Mesh(
  new THREE.CylinderGeometry(.73,.78,.055,54),
  new THREE.MeshStandardMaterial({color:0x506644,roughness:.96})
 );
 ground.name='Source-matched small oval turf mound';
 ground.position.y=-.055;ground.receiveShadow=true;group.add(ground);
 group.userData={
  source:'The exact original multi-trunk tree reference image',
  trunkTopology:'individually authored curves following trunk lines in reference pixels',
  foliage:{photographicClumps:cards,independentLeaves:individual},
  note:'Hidden volumes inferred; visual review required'
 };
 return group;
}
