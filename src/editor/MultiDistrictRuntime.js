import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {IslandRuntime} from './IslandRuntime.js';
import {DISTRICT_PRESET,generateDistrictPlan,districtGround,districtDeckHeight,districtHash} from './district-data.mjs';

// City-scale coast, road collision, four distinct architectural/vegetation palettes.
// Retains Sketchbook's Water, World physics, ActorLayer, editor, controllable vehicles and camera.
const zonePalette={
 ny:{body:0x818b91,roof:0x3c4650,trim:0x3d4e58,glass:0x5d818b},
 sf:{body:0xc6bbaa,roof:0x677b77,trim:0xe0d6c6,glass:0x607e8b},
 rio:{body:0xe1d5b5,roof:0x969b81,trim:0xf8efe0,glass:0x79a3a4},
 miami:{body:0xf0dbbd,roof:0xa6c6c7,trim:0xf2e9df,glass:0x79c5d5}
};
const STANDARD={roughness:.78,metalness:.04};
function m(color,extras={}){return new THREE.MeshStandardMaterial({color,...STANDARD,...extras});}
function mesh(geometry,material,parent,position,shadow=false){
 const o=new THREE.Mesh(geometry,material);o.position.set(...position);
 o.receiveShadow=true;o.castShadow=shadow;parent.add(o);return o;
}
function roadSurfaceData(plan){
 const roads=[];
 for(const r of plan.roads){
  const count=r.kind==='bridge'?12:Math.max(1,Math.ceil(r.length/16));
  for(let i=0;i<count;i++){
   const point=t=>({x:r.a.x+(r.b.x-r.a.x)*t,z:r.a.z+(r.b.z-r.a.z)*t});
   const a=point(i/count),b=point((i+1)/count);
   const height=p=>r.kind==='bridge'?districtDeckHeight(p.x,p.z)??districtGround(p.x,p.z):districtGround(p.x,p.z);
   const ay=height(a)+.17,by=height(b)+.17;
   const A=new THREE.Vector3(a.x,ay,a.z),B=new THREE.Vector3(b.x,by,b.z);
   const middle=A.clone().add(B).multiplyScalar(.5),dir=B.clone().sub(A);
   const angle=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),dir.clone().normalize());
   roads.push({kind:r.kind,width:r.width,center:middle,rotation:angle,length:dir.length()});
  }
 }
 return roads;
}
function placeRoads(group,plan,bodies){
 const mats={local:m(0x383b40),avenue:m(0x33373a),bridge:m(0x303a41),
  curb:m(0xaeb4b1),line:m(0xe2dfcc),yellow:m(0xcab76d),pillar:m(0x90999b)};
 const deck=new THREE.BoxGeometry(1,.26,1);
 for(const road of roadSurfaceData(plan)){
  const slab=mesh(deck,mats[road.kind],group,road.center.toArray());
  slab.userData.surfaceTag='street';
  slab.scale.set(road.width,1,road.length+.22);slab.quaternion.copy(road.rotation);
  const shape=new CANNON.Box(new CANNON.Vec3(road.width/2,.13,(road.length+.22)/2));
  const body=new CANNON.Body({mass:0,shape,position:new CANNON.Vec3(...road.center.toArray())});
  body.quaternion.set(road.rotation.x,road.rotation.y,road.rotation.z,road.rotation.w);bodies.push(body);
  if(road.kind!=='local'){
   for(const side of [-1,1]){
    const mark=mesh(new THREE.BoxGeometry(.15,.025,road.length-.1),mats.line,group,[0,.18,0]);
    mark.position.copy(road.center).add(new THREE.Vector3(side*road.width*.43,0,0).applyQuaternion(road.rotation));
    mark.quaternion.copy(road.rotation);
   }
  }
  if(road.kind==='bridge'){
   for(const side of [-1,1]){
    const rail=mesh(new THREE.BoxGeometry(.32,1.1,road.length+.15),mats.curb,group,[0,0,0],true);
    rail.position.copy(road.center).add(new THREE.Vector3(side*(road.width/2-.17),.64,0).applyQuaternion(road.rotation));
    rail.quaternion.copy(road.rotation);
   }
  }
 }
 const bridge=plan.bridge;
 for(let x=-66;x<=66;x+=33){
  const top=districtDeckHeight(x,125)||9.7;
  const pier=mesh(new THREE.CylinderGeometry(1.25,2.15,top+7,12),mats.pillar,group,[x,(top-7)/2,125],true);
  pier.userData.bridgePier=true;
 }
}
function buildFacadeTexture(theme,seed=0){
 // PBR-ready procedural window atlas; photographic PBR ground material is loaded separately.
 const cnv=document.createElement('canvas');cnv.width=256;cnv.height=512;const c=cnv.getContext('2d');
 const palette={ny:['#69767e','#52616a','#77969e'],sf:['#b5a690','#e0c1a1','#788fa0'],
  rio:['#d7cfb5','#f3eee1','#89bdba'],miami:['#e3cfc5','#f4deb6','#79abb5']}[theme];
 c.fillStyle=palette[0];c.fillRect(0,0,256,512);
 for(let iy=0;iy<11;iy++)for(let ix=0;ix<5;ix++){
  const x=ix*51.2+6,y=iy*46.5+7,h=33,w=39;
  c.fillStyle=palette[1];c.fillRect(x-2,y-2,w+4,h+4);
  c.fillStyle=districtHash(ix,iy+seed,seed)>.83?'#c4c8ba':palette[2];c.fillRect(x,y,w,h);
  c.fillStyle='rgba(9,22,29,.35)';c.fillRect(x+w*.48,y,3,h);
  c.fillStyle='rgba(255,255,255,.12)';c.fillRect(x+2,y+2,w*.35,3);
 }
 const tex=new THREE.CanvasTexture(cnv);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=4;return tex;
}
function architecture(group,plan,bodies){
 const mats={};
 for(const d of plan.zones){
  const p=zonePalette[d.id],atlas=buildFacadeTexture(d.id,plan.config.seed);
  mats[d.id]={body:m(p.body,{map:atlas}),roof:m(p.roof),trim:m(p.trim),window:new THREE.MeshPhysicalMaterial({
   color:p.glass,roughness:.14,metalness:.34,clearcoat:1,clearcoatRoughness:.08})};
 }
 const cube=new THREE.BoxGeometry(1,1,1),windowGeometry=new THREE.BoxGeometry(1,1,.075);
 const windows=new Map(plan.zones.map(d=>[d.id,[]]));
 const pushWindow=(type,x,y,z,w,h,angle=0)=>{
  const mat=new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),
   new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),angle),new THREE.Vector3(w,h,1));
  windows.get(type).push(mat);
 };
 for(const b of plan.buildings){
  const y=districtGround(b.x,b.z),s=mats[b.district],rise=b.height;
  const base=mesh(cube,s.body,group,[b.x,y+rise/2,b.z],true);
  base.scale.set(b.w,rise,b.d);base.userData.districtBuilding=b.id;
  const profile=b.theme==='metro'&&b.floors>17||b.theme==='tropical'&&b.floors>8;
  if(profile){
   const cap=mesh(cube,s.body,group,[b.x,y+rise+rise*.10,b.z],true);
   cap.scale.set(b.w*.75,rise*.20,b.d*.78);
  }
  const roof=mesh(cube,s.roof,group,[b.x,y+rise+.17,b.z],true);
  roof.scale.set(b.w*1.04,.33,b.d*1.05);
  // Architectural signatures: crown/roof equipment, Miami stepped parapets,
  // San Francisco sloped roof and Rio terrace edges.
  if(b.theme==='metro'&&b.roofVariant>.6){
   const crown=mesh(cube,s.trim,group,[b.x,y+rise+1.9,b.z]);
   crown.scale.set(b.w*.34,3.5,b.d*.35);
  }else if(b.theme==='hills'){
   const roofline=mesh(new THREE.ConeGeometry(Math.max(b.w,b.d)*.74,3.6,4),s.roof,group,[b.x,y+rise+1.75,b.z]);
   roofline.rotation.y=Math.PI/4;
  }else if(b.theme==='artdeco'){
   for(const side of [-1,1]){
    const crown=mesh(cube,s.trim,group,[b.x+side*b.w*.34,y+rise+1.05,b.z]);
    crown.scale.set(b.w*.2,1.7,b.d*.8);
   }
  }else if(b.theme==='tropical'&&b.roofVariant>.4){
   const terrace=mesh(cube,s.trim,group,[b.x,y+rise+.4,b.z+b.d*.18]);
   terrace.scale.set(b.w*.68,.23,b.d*.62);
  }
  const entry=mesh(cube,s.trim,group,[b.x,y+1.6,b.z+b.d/2+.2]);
  entry.scale.set(Math.min(3,b.w*.35),2.9,.3);
  const floors=Math.min(36,b.floors),bayX=Math.min(7,Math.max(2,Math.floor(b.w/4))),
     bayZ=Math.min(7,Math.max(2,Math.floor(b.d/4)));
  // Windows are real instanced geometry, not a single flat painted cube.
  for(let floor=0;floor<floors;floor++){
   const yy=y+floor*3.1+1.82;
   for(let k=0;k<bayX;k++){
    const xx=b.x-b.w/2+(k+.5)*b.w/bayX;
    pushWindow(b.district,xx,yy,b.z+b.d/2+.06,Math.min(2.45,b.w/bayX*.74),1.7);
    pushWindow(b.district,xx,yy,b.z-b.d/2-.06,Math.min(2.45,b.w/bayX*.74),1.7,Math.PI);
   }
   for(let k=0;k<bayZ;k++){
    const zz=b.z-b.d/2+(k+.5)*b.d/bayZ;
    pushWindow(b.district,b.x+b.w/2+.06,yy,zz,Math.min(2.4,b.d/bayZ*.72),1.7,Math.PI/2);
    pushWindow(b.district,b.x-b.w/2-.06,yy,zz,Math.min(2.4,b.d/bayZ*.72),1.7,-Math.PI/2);
   }
  }
  const body=new CANNON.Body({mass:0,shape:new CANNON.Box(new CANNON.Vec3(b.w/2,rise/2,b.d/2)),
    position:new CANNON.Vec3(b.x,y+rise/2,b.z)});bodies.push(body);
 }
 for(const [type,instances] of windows){
  if(!instances.length)continue;
  const windowMeshes=new THREE.InstancedMesh(windowGeometry,mats[type].window,instances.length);
  instances.forEach((matrix,i)=>windowMeshes.setMatrixAt(i,matrix));
  windowMeshes.instanceMatrix.needsUpdate=true;windowMeshes.castShadow=false;windowMeshes.receiveShadow=false;
  windowMeshes.name=type+' · PBR facade glass windows';group.add(windowMeshes);
 }
}
function vegetation(group,plan){
 const trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.15,.32,1,7),m(0x675443),plan.plants.length);
 const canopyMats={plane:m(0x52704c),cypress:m(0x355542),palm:m(0x487b45),tropical:m(0x35734e)};
 const canopyGeo={plane:new THREE.IcosahedronGeometry(1,1),cypress:new THREE.ConeGeometry(1,4,7),
  palm:new THREE.ConeGeometry(1,1,7),tropical:new THREE.IcosahedronGeometry(1,2)};
 const canopies=Object.fromEntries(Object.keys(canopyMats).map(k=>[k,new THREE.InstancedMesh(canopyGeo[k],canopyMats[k],plan.plants.length)]));
 const idx=Object.fromEntries(Object.keys(canopies).map(k=>[k,0]));
 const matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),s=new THREE.Vector3(),p=new THREE.Vector3();
 const scale=1.0;
 for(let i=0;i<plan.plants.length;i++){
  const t=plan.plants[i],h=(t.type==='palm'?6.6:t.type==='cypress'?6.8:4.3)*t.scale,y=districtGround(t.x,t.z);
  matrix.compose(p.set(t.x,y+h/2,t.z),q,s.set(.9*t.scale,h,.9*t.scale));trunks.setMatrixAt(i,matrix);
  const n=idx[t.type]++,c=canopies[t.type];
  const cy=t.type==='palm'?y+h+.6:t.type==='cypress'?y+h+1.1:y+h+.9;
  matrix.compose(p.set(t.x,cy,t.z),q,s.set(t.type==='palm'?4*t.scale:2.2*t.scale,
    t.type==='cypress'?2.1*t.scale:1.8*t.scale,t.type==='palm'?4*t.scale:2.2*t.scale));
  c.setMatrixAt(n,matrix);
 }
 trunks.instanceMatrix.needsUpdate=true;trunks.castShadow=true;group.add(trunks);
 for(const [type,c] of Object.entries(canopies)){c.count=idx[type];c.instanceMatrix.needsUpdate=true;c.castShadow=true;group.add(c);}
}
function terrain(group,bodies,plan){
 const sizeX=760,sizeZ=690,cell=12,nx=Math.round(sizeX/cell),nz=Math.round(sizeZ/cell),x0=-sizeX/2,z0=sizeZ/2;
 const positions=[],colors=[],indices=[],heightValues=[];
 const color=new THREE.Color();
 for(let x=0;x<=nx;x++){
  heightValues[x]=[];
  for(let z=0;z<=nz;z++){
   const xx=x0+x*sizeX/nx,zz=z0-z*sizeZ/nz,y=districtGround(xx,zz);
   heightValues[x].push(y);positions.push(xx,y,zz);
   const sand=y<2.1,rock=xx>0&&zz<0&&y>12;
   color.set(sand?0xb9aa7d:rock?0x898b80:zz>130?0x759269:0x6c7969);
   color.multiplyScalar(.94+.12*districtHash(x,z,plan.config.seed));colors.push(color.r,color.g,color.b);
   if(x<nx&&z<nz){const a=x*(nz+1)+z,b=a+nz+1;indices.push(a,b,a+1,b,b+1,a+1);}
  }
 }
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
 geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.setIndex(indices);geo.computeVertexNormals();
 mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.92}),group,[0,0,0]);
 const hshape=new CANNON.Heightfield(heightValues,{elementSize:sizeX/nx});
 const hbody=new CANNON.Body({mass:0,shape:hshape,position:new CANNON.Vec3(x0,0,z0)});
 hbody.quaternion.setFromEuler(-Math.PI/2,0,0);bodies.push(hbody);
}
function buildBeaches(group,plan){
 const sand=m(0xe0ceb0,{roughness:1});
 for(const spot of plan.beaches){
  const gridX=16,gridZ=10,vertices=[],uv=[],triangles=[];
  for(let ix=0;ix<=gridX;ix++)for(let iz=0;iz<=gridZ;iz++){
   const x=spot.x-spot.width/2+spot.width*ix/gridX;
   const z=spot.z-spot.depth/2+spot.depth*iz/gridZ;
   vertices.push(x,districtGround(x,z)+.065,z);uv.push(ix/gridX,iz/gridZ);
   if(ix<gridX&&iz<gridZ){
    const a=ix*(gridZ+1)+iz,b=a+gridZ+1;triangles.push(a,b,a+1,b,b+1,a+1);
   }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(triangles);
  geometry.computeVertexNormals();
  const beach=mesh(geometry,sand,group,[0,0,0]);
  beach.name='Coastal beach · '+spot.x;beach.userData.surfaceTag='sand';
 }
}
function applyCoastalPBR(group){
 // Optional CC0 photographed ground material. Missing CDN access never blocks play.
 const loader=new THREE.TextureLoader();
 const apply=async (url,key)=>{
  try{
   const map=await loader.loadAsync(url);map.wrapS=map.wrapT=THREE.RepeatWrapping;map.repeat.set(6,6);
   map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=4;
   if(!group.parent)return;
   const updated=new Set();group.traverse(o=>{if(o.isMesh&&o.userData.surfaceTag===key&&!updated.has(o.material)){
    updated.add(o.material);o.material.map=map;o.material.needsUpdate=true;
   }});
  }catch(error){console.info('[Districts] CC0 texture not cached; physical fallback kept:',key,error.message);}
 };
 apply('https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/asphalt_02/asphalt_02_diff_1k.jpg','street');
 apply('https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/coast_sand_01/coast_sand_01_diff_1k.jpg','sand');
}
export class MultiDistrictRuntime extends IslandRuntime {
 constructor(world){
  super(world);this.root.name='Sketchbook · Four Coastal Districts';this.isDistrictCity=true;this.plan=null;
  world.camera.far=2300;world.camera.updateProjectionMatrix();
  world.isOutOfBounds=p=>p.y<-18||Math.abs(p.x)>1100||Math.abs(p.z)>900;
 }
 initialize(){this.generate(DISTRICT_PRESET);}
 generate(raw=DISTRICT_PRESET){
  const plan=generateDistrictPlan(raw),group=new THREE.Group(),bodies=[];
  terrain(group,bodies,plan);architecture(group,plan,bodies);
  placeRoads(group,plan,bodies);buildBeaches(group,plan);vegetation(group,plan);
  // Pier-side boardwalk: above the beach, away from the bridge navigation corridor.
  const boardwalk=mesh(new THREE.BoxGeometry(255,.25,7),m(0xaa9781),group,[175,2.2,200]);
  boardwalk.userData.boardwalk=true;
  this.bodies.forEach(b=>this.world.physicsWorld.removeBody(b));
  this.root.clear();this.root.add(group);for(const b of bodies)this.world.physicsWorld.addBody(b);
  this.bodies=bodies;this.plan=plan;this.config={...raw};this.manifest={spawns:plan.spawns};
  this.applySky(raw.sky||'day');this.ready=true;
  applyCoastalPBR(group);
 }
 groundAt(x,z){return districtDeckHeight(x,z)??districtGround(x,z);}
 async ensure(){this.ready=true;}
 refreshPhysics(){}
}
