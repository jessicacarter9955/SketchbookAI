import * as THREE from 'three';
import { loadSurface, metricUV } from './UrbanLighting.js';

// These are newly modelled buildings, not downloaded whole-building assets.
// Shared metric geometry and materials survive the architecture instancing pass.
const geometryCache=new Map();
const metal=new THREE.MeshStandardMaterial({color:0xadb6b5,metalness:.82,roughness:.24});
const darkMetal=new THREE.MeshStandardMaterial({color:0x303b3f,metalness:.72,roughness:.3});
const bronze=new THREE.MeshStandardMaterial({color:0x6f6150,metalness:.72,roughness:.3});
const roof=new THREE.MeshStandardMaterial({color:0x4a4d47,roughness:.93});
const room=new THREE.MeshStandardMaterial({color:0x9b9383,roughness:1});
const soil=new THREE.MeshStandardMaterial({color:0x343326,roughness:1});
const shrubMaterial=new THREE.MeshStandardMaterial({color:0x40552b,vertexColors:true,side:THREE.DoubleSide,roughness:.92});
function foliageClump(){
  let seed=719;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const positions=[],colors=[],indices=[];
  for(let i=0;i<240;i++){
    const angle=rand()*Math.PI*2,y=rand()*2-1,r=Math.sqrt(1-y*y)*(.65+rand()*.35),center=new THREE.Vector3(Math.cos(angle)*r,y,Math.sin(angle)*r);
    const axis=new THREE.Vector3(rand()-.5,rand()-.5,rand()-.5).normalize(),side=new THREE.Vector3().crossVectors(axis,new THREE.Vector3(0,1,0)).normalize().multiplyScalar(.085),tip=axis.multiplyScalar(.22),n=positions.length/3;
    for(const p of [center.clone().sub(tip),center.clone().add(side),center.clone().add(tip),center.clone().sub(side),center.clone().add(new THREE.Vector3(0,.035,0))]){positions.push(p.x,p.y,p.z);const c=.65+rand()*.4;colors.push(c,c,c);}
    indices.push(n,n+1,n+4,n+1,n+2,n+4,n+2,n+3,n+4,n+3,n,n+4);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();return g;
}
const shrubGeometry=foliageClump();
const glass=Array.from({length:5},(_,i)=>{
  const mat=new THREE.MeshPhysicalMaterial({color:new THREE.Color(0x92a9aa).multiplyScalar(.88+i*.027),metalness:.83,roughness:.085+i*.012,clearcoat:1,clearcoatRoughness:.06,envMapIntensity:1.05});
  mat.name='tower-glass';mat.userData.preserveGlazing=true;return mat;
});
const railGlass=new THREE.MeshPhysicalMaterial({color:0xb9d1cd,metalness:.35,roughness:.1,transparent:true,opacity:.38,depthWrite:false});
railGlass.name='balcony-glass';railGlass.userData.preserveGlazing=true;
let materialsPromise;
export function loadTowerMaterials(){
  return materialsPromise ||= Promise.all([
    loadSurface('concrete_tile_facade',3,0xe5e2da),
    loadSurface('white_sandstone_blocks_02',2.5,0xeee9db)
  ]).then(([concrete,stone])=>{concrete.normalScale.setScalar(.2);stone.normalScale.setScalar(.25);return {concrete,stone};});
}
function box(parent,w,h,d,x,y,z,material=metal){
  const key=[w,h,d].map(v=>v.toFixed(4)).join(':');
  if(!geometryCache.has(key)){
    const geometry=new THREE.BoxGeometry(w,h,d),mesh=new THREE.Mesh(geometry);metricUV(mesh);geometryCache.set(key,geometry);
  }
  const mesh=new THREE.Mesh(geometryCache.get(key),material);mesh.position.set(x,y,z);
  mesh.castShadow=material!==railGlass&&!glass.includes(material);mesh.receiveShadow=true;parent.add(mesh);return mesh;
}
function faces(parent,w,d){
  return [[0,d/2,0,w],[w/2,0,Math.PI/2,d],[0,-d/2,Math.PI,w],[-w/2,0,-Math.PI/2,d]].map(([x,z,angle,width])=>{
    const face=new THREE.Group();face.position.set(x,0,z);face.rotation.y=angle;parent.add(face);return {face,width};
  });
}
function glazing(face,width,start,floors,seed,{piers=false,stone,fin=false}={}){
  const bays=Math.max(2,Math.round(width/(piers?2.8:1.55))),bay=width/bays;
  for(let n=0;n<bays;n++){
    const x=-width/2+(n+.5)*bay;
    for(let f=0;f<floors;f++){
      const y=(f+start)*3;
      box(face,bay-(piers?.38:.06),2.45,.075,x,y+1.65,-(piers?.19:.015),glass[(n*3+f+seed)%5]);
      box(face,bay,.49,piers?.26:.12,x,y+.245,-.035,piers?stone:darkMetal);
      box(face,bay,.055,.16,x,y+.51,.065,piers?bronze:metal);
      if(piers)box(face,.04,2.47,.12,x,y+1.65,-.105,bronze);
      // Some recessed blinds create variation without randomly lit yellow squares.
      if((n*13+f*7+seed)%17===0){
        for(let s=0;s<6;s++)box(face,bay-(piers?.45:.16),.025,.07,x,y+2.7-s*.075,piers?-.10:.052,metal);
      }
    }
    box(face,piers?.32:.055,floors*3,piers?.46:.19,-width/2+n*bay,(start+floors/2)*3,piers?.02:.08,piers?stone:metal);
    if(fin&&n%2===0)box(face,.075,floors*3,.42,-width/2+n*bay,(start+floors/2)*3,.18,metal);
  }
  box(face,piers?.32:.055,floors*3,piers?.46:.19,width/2,(start+floors/2)*3,piers?.02:.08,piers?stone:metal);
}
function lobby(group,w,d,mat){
  box(group,w,.18,d,0,.09,0,mat);
  for(const {face,width} of faces(group,w-.28,d-.28)){
    const bays=Math.max(2,Math.round(width/3)),bay=width/bays;
    box(face,width,5.3,.08,0,2.82,-.2,glass[3]);
    for(let b=0;b<=bays;b++)box(face,.12,5.5,.32,-width/2+b*bay,2.8,0,darkMetal);
    box(face,width,.24,.4,0,5.7,0,mat);
    box(face,width,.075,.15,0,2.45,.05,metal);
  }
  // Deep, framed entrance and a supported canopy give the podium a human scale.
  box(group,4.3,.15,2.2,0,3.5,d/2+.55,metal);
  for(const x of [-1.75,1.75])box(group,.09,3.45,.09,x,1.8,d/2+1.35,metal);
  for(const x of [-.9,.9]){
    box(group,1.72,2.7,.055,x,1.56,d/2-.035,glass[1]);
    box(group,.045,2.7,.1,x-.85,1.56,d/2+.015,metal);
    box(group,.035,.65,.065,x*.25,1.48,d/2+.09,bronze);
  }
  box(group,w*.6,.1,1.6,0,.05,d/2+.7,mat);
}
function plant(parent,x,y,z,scale=1){
  box(parent,1.9*scale,.48,1.1*scale,x,y+.24,z,roof);
  box(parent,1.76*scale,.06,.97*scale,x,y+.49,z,soil);
  for(let i=0;i<7;i++){
    const mesh=new THREE.Mesh(shrubGeometry,shrubMaterial);
    mesh.scale.set(.3*scale,.23+.12*(i%3),.3*scale);
    mesh.position.set(x+(i-3)*.22*scale,y+.62,z+Math.sin(i*2)*.12);mesh.castShadow=true;parent.add(mesh);
  }
}
function rooftop(group,w,d,height){
  box(group,w,.18,d,0,height-.09,0,roof);
  const enclosure=new THREE.Group();enclosure.position.y=height;group.add(enclosure);
  box(enclosure,w*.38,1.3,d*.3,0,.65,0,darkMetal);
  for(let y=.14;y<1.3;y+=.14){
    box(enclosure,w*.4,.045,d*.32,0,y,0,metal);
  }
  for(const x of [-w*.31,w*.31]){
    box(enclosure,w*.17,.6,d*.2,x,.35,-d*.2,metal);
    for(let i=0;i<7;i++)box(enclosure,w*.17,.035,.065,x,.67,-d*.2+(i-3)*d*.024,darkMetal);
  }
}
function roundedFaces(parent,w,d,r){
  const points=[];
  [[w/2-r,d/2-r,0],[-w/2+r,d/2-r,90],[-w/2+r,-d/2+r,180],[w/2-r,-d/2+r,270]].forEach(([x,z,a])=>{
    for(let i=0;i<=4;i++){const t=(a+i*22.5)*Math.PI/180;points.push(new THREE.Vector2(x+r*Math.cos(t),z+r*Math.sin(t)));}
  });
  return points.map((p,i)=>{
    const q=points[(i+1)%points.length],dx=q.x-p.x,dz=q.y-p.y;
    const face=new THREE.Group();face.position.set((p.x+q.x)/2,0,(p.y+q.y)/2);face.rotation.y=Math.atan2(dz,-dx);parent.add(face);
    return {face,width:Math.hypot(dx,dz)};
  });
}
function glassTower(group,w,d,floors,seed,mats){
  lobby(group,w,d,mats.concrete);
  const sw=w*.91,sd=d*.91;
  for(const {face,width} of roundedFaces(group,sw,sd,Math.min(w,d)*.115))glazing(face,width,2,floors-2,seed,{fin:width>5});
  // Mechanical crown has a different rhythm from occupied floors.
  for(const {face,width} of roundedFaces(group,sw,sd,Math.min(w,d)*.115)){
    for(let i=0;i<7;i++)box(face,width,.05,.13,0,floors*3+.13+i*.17,.04,metal);
  }
  rooftop(group,sw*.87,sd*.87,floors*3);
}
function stoneTower(group,w,d,floors,seed,mats){
  lobby(group,w,d,mats.stone);
  const levels=[2,Math.max(3,Math.floor(floors*.55)),Math.floor(floors*.78),Math.floor(floors*.92),floors];
  const scales=[1,.81,.61,.42];
  for(let i=0;i<scales.length;i++){
    const start=levels[i],end=levels[i+1];if(end<=start)continue;
    const sw=w*scales[i],sd=d*scales[i];
    for(const {face,width} of faces(group,sw,sd)){
      glazing(face,width,start,end-start,seed,{piers:true,stone:mats.stone});
      box(face,width+.22,.18,.48,0,end*3+.05,0,mats.stone);
      box(face,width,.08,.4,0,end*3-.24,0,bronze);
    }
    box(group,sw,.15,sd,0,end*3-.075,0,roof);
    if(i<3)for(const x of [-sw*.36,sw*.36])plant(group,x,end*3,sd*.38,.8);
  }
  const ch=Math.min(5,floors*.14),cw=w*.25,cd=d*.25;
  box(group,cw,ch,cd,0,floors*3+ch/2,0,mats.stone);
  for(const {face,width} of faces(group,cw,cd))for(let x=-width/2;x<=width/2;x+=.55)box(face,.10,ch,.22,x,floors*3+ch/2,0,bronze);
  box(group,cw+.3,.25,cd+.3,0,floors*3+ch,0,bronze);
}
function terraceBuilding(group,w,d,floors,seed,mats){
  lobby(group,w,d,mats.concrete);
  let lastW=w,lastD=d,lastX=0;
  for(let f=2;f<floors;f++){
    const tier=Math.floor((f-2)/4),scale=Math.max(.57,1-tier*.115);
    const sw=w*scale,sd=d*scale,offset=(tier%2?1:-1)*w*.045;
    const section=new THREE.Group();section.position.set(offset,0,0);group.add(section);
    const inset=1.05;
    for(const {face,width} of faces(section,sw-inset*2,sd-inset*2))glazing(face,width,f,1,seed+f);
    box(section,sw,.22,sd,0,f*3+.03,0,mats.concrete);
    for(const {face,width} of faces(section,sw-.16,sd-.16)){
      box(face,width,1.02,.055,0,f*3+.71,-.02,railGlass);
      box(face,width,.045,.07,0,f*3+1.24,0,metal);
      const bays=Math.ceil(width/1.5);for(let i=0;i<=bays;i++)box(face,.035,1.12,.06,-width/2+i*width/bays,f*3+.69,0,metal);
    }
    // Tall blade walls and the staggered terraces are structural geometry.
    for(const x of [-sw*.23,sw*.27])box(section,.22,2.82,sd-inset*1.6,x,f*3+1.57,0,mats.concrete);
    if(f%3===0)for(const x of [-sw*.31,sw*.31])plant(section,x,f*3+.15,sd/2-.65,.7);
    if(f>2&&f%4===2){
      box(group,lastW,.16,lastD,lastX,f*3-.02,0,mats.concrete);
      for(const x of [-lastW*.3,lastW*.3])plant(group,x+lastX,f*3+.06,lastD/2-.65,.8);
    }
    lastW=sw;lastD=sd;lastX=offset;
  }
  rooftop(group,lastW,lastD,floors*3);
}

export function buildContemporaryBuilding(building,seed,mats,kind='glass'){
  const group=new THREE.Group(),{w,d,floors}=building;
  group.name=`${kind} architecture ${seed}`;group.position.set(building.x||0,(building.ground||0)+.18,building.z||0);
  group.rotation.y=building.rotation||0;group.userData.architectureType=kind;
  if(kind==='stone')stoneTower(group,w,d,Math.max(8,floors),seed,mats);
  else if(kind==='terraces')terraceBuilding(group,w,d,Math.max(3,floors),seed,mats);
  else glassTower(group,w,d,Math.max(3,floors),seed,mats);
  return group;
}
