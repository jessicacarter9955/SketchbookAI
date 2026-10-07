import * as THREE from 'three';

const unitBox = new THREE.BoxGeometry(1,1,1);
const unitCylinder = new THREE.CylinderGeometry(1,1,1,12);
let sharedMaterials;
const labelMaterials=new Map();
// Physical dimensions are in metres. These details are actual scene geometry.
export function createDetails(scene, architecture) {
  if(!sharedMaterials) sharedMaterials=makeMaterials();
  const {stone,iron,zinc,timber,soil,roomMats,shades}=sharedMaterials;
  function makeMaterials(){
  const stone=new THREE.MeshStandardMaterial({color:0x858074,roughness:.86});
  const iron=new THREE.MeshStandardMaterial({color:0x252e2c,roughness:.52,metalness:.72});
  const zinc=new THREE.MeshStandardMaterial({color:0x777d78,roughness:.43,metalness:.75});
  const timber=new THREE.MeshStandardMaterial({color:0x675040,roughness:.84});
  const soil=new THREE.MeshStandardMaterial({color:0x2d2921,roughness:1});
  const roomMats=[0x34362f,0x8f8170,0x635f56,0xb2a791,0x3c4649].map(color=>new THREE.MeshStandardMaterial({color,roughness:.95}));
  const shades=[0x344942,0x754c3e,0x324357].map(color=>new THREE.MeshStandardMaterial({color,roughness:.9}));
  return {stone,iron,zinc,timber,soil,roomMats,shades};}
  function mesh(geometry,material,parent,position){const m=new THREE.Mesh(geometry,material);m.position.set(...position);m.castShadow=m.receiveShadow=true;parent.add(m);return m;}
  function box(parent,w,h,d,x,y,z,material=stone){const m=mesh(unitBox,material,parent,[x,y,z]);m.scale.set(w,h,d);return m;}
  function cylinder(parent,r,h,x,y,z,material=iron){const m=mesh(unitCylinder,material,parent,[x,y,z]);m.scale.set(r,h,r);return m;}
  function label(parent,text,x,y,z,w=.5,h=.25,bg='#273431',fg='#ded3ae'){
    const c=document.createElement('canvas');c.width=512;c.height=160;const ctx=c.getContext('2d');ctx.fillStyle=bg;ctx.fillRect(0,0,512,160);ctx.fillStyle=fg;ctx.font='500 62px serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,256,84,470);const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
    const key=text+bg+fg;if(!labelMaterials.has(key))labelMaterials.set(key,new THREE.MeshStandardMaterial({map:tex,roughness:.8}));else tex.dispose();const m=mesh(new THREE.PlaneGeometry(w,h),labelMaterials.get(key),parent,[x,y,z]);return m;
  }
  function facade(face,bay,floor,floors,seed,door,industrial){
    const x=-bay*3-1.5,y=floor*3;
    // A shallow room behind each opening gives the glass depth, varied curtains and shadows.
    if(!door){
      box(face,2.35,2.45,.07,x,y+1.23,-1.15,roomMats[(seed+bay*3+floor*7)%roomMats.length]);
      box(face,2.35,.08,1.1,x,y+2.48,-.6,stone);
      for(const side of [-1,1])box(face,.07,2.4,1.1,x+side*1.17,y+1.25,-.6,stone);
      if((seed+bay+floor)%3===0){
        const curtain=roomMats[(seed+floor)%3+1];
        for(let q=0;q<7;q++)box(face,.06,1.8,.07,x-.94+q*.055,y+1.4,-.32,curtain);
      }
    }
    if(floor>0&&floor<floors-1&&!industrial&&(bay+seed)%4===1){
      box(face,2.52,.15,1.1,x,y-.05,.48,stone);
      box(face,2.4,.055,.055,x,y+.95,.99,iron);
      for(const side of [-1,1])box(face,.04,.04,1.1,x+side*1.18,y+.95,.47,iron);
      for(let q=0;q<14;q++)box(face,.023,.9,.023,x-1.17+q*.18,y+.48,.99,iron);
      for(const side of [-1,1])for(let q=0;q<6;q++)box(face,.023,.9,.023,x+side*1.18,y+.48,q*.18,iron);
    }
    if(door){
      box(face,2.4,.11,.7,x,-.035,.25,stone);
      label(face,String(18+seed*2+bay),x+1.03,1.8,.045,.24,.15);
      if(seed%2===0){
        const shade=shades[seed%3];
        const canopy=box(face,2.6,.08,1.4,x,2.85,.65,shade);canopy.rotation.x=.12;
        box(face,2.6,.28,.06,x,2.67,1.32,shade);label(face,seed%3?'MAISON':'CAFÉ',x,2.67,1.36,1.7,.18);
      }
    }
  }
  function buildingTrim(group,width,depth,height,seed){
    for(const z of [-depth/2,depth/2]){
      box(group,width+.28,.26,.38,0,height+.27,z,stone);
      cylinder(group,.047,height,width/2-.2,height/2,z+.09,zinc);
      box(group,width,.24,.12,0,.15,z+.04,stone);
    }
    for(const x of [-width/2,width/2])box(group,.35,.26,depth+.2,x,height+.27,0,stone);
    for(let y=3;y<height;y+=3)box(group,width,.09,.12,0,y-.03,depth/2+.04,stone);
    // Rooftop equipment and chimney volumes break up the silhouette.
    box(group,1.35,.85,1.05,-width*.27,height+.55,-1.7,zinc);
    box(group,.7,1.7,.7,width*.28,height+.95,-2,stone);
    box(group,.9,.1,.9,width*.28,height+1.85,-2,zinc);
  }
  function street(){
    // Separate curb stones and expansion joints; road-level gutter and drain slots.
    for(const z of [5.9,18.05])for(let x=-54;x<55;x+=1.2)box(scene,1.17,.18,.3,x,.18,z,stone);
    for(const z of [5.64,18.32])box(scene,110,.018,.17,0,.104,z,soil);
    for(let x=-48;x<51;x+=13){
      box(scene,.58,.025,.4,x,.11,6.32,iron);
      for(let q=0;q<7;q++)box(scene,.028,.018,.35,x-.22+q*.073,.13,6.32,zinc);
      for(const z of [3.65,20.6])cylinder(scene,.055,.85,x,.64,z);
    }
    for(let x=-52;x<54;x+=1.5)for(const z of [3.7,20.25])box(scene,.012,.002,3.5,x,.162,z,soil);
    for(const z of [2.55,3.75,4.95,19.3,20.5,21.7])box(scene,110,.002,.012,0,.162,z,soil);
    for(const [x,z]of [[-14,3],[9,3],[32,3],[-35,3],[-18,23],[8,23],[34,23],[-40,23]]){
      box(scene,1.75,.06,1.75,x,.2,z,soil);
      for(const side of [-1,1]){box(scene,1.88,.12,.09,x,.2,z+side*.92,iron);box(scene,.09,.12,1.75,x+side*.92,.2,z,iron);}
    }
    // A few benches, bins, café tables and bicycle stands for scale.
    for(const x of [-16,15,38]){
      for(let slat=0;slat<5;slat++){box(scene,1.75,.05,.085,x,.68,3+slat*.1,timber);box(scene,1.75,.075,.055,x,.87+slat*.1,2.97,timber);}
      for(const dx of [-.65,.65]){box(scene,.05,.55,.47,x+dx,.4,3.2,iron);box(scene,.05,.85,.055,x+dx,.85,2.96,iron);}
      cylinder(scene,.22,.68,x+1.3,.52,3.4,iron);cylinder(scene,.245,.04,x+1.3,.88,3.4,zinc);
    }
    for(const x of [-1,2]){
      cylinder(scene,.46,.045,x,.91,1.8,timber);cylinder(scene,.045,.7,x,.53,1.8,iron);cylinder(scene,.26,.035,x,.19,1.8,iron);
      for(const dx of [-.65,.65]){box(scene,.4,.035,.4,x+dx,.6,1.8,timber);box(scene,.4,.35,.035,x+dx,.8,1.6,timber);for(const a of [-.16,.16])for(const b of [-.16,.16])cylinder(scene,.017,.4,x+dx+a,.39,1.8+b,iron);}
    }
    for(const x of [-5.6,-4.6,-3.6]){
      for(const dx of [-.24,.24])cylinder(scene,.025,.65,x+dx,.49,3.6,zinc);
      const bar=cylinder(scene,.025,.48,x,.815,3.6,zinc);bar.rotation.z=Math.PI/2;
    }
  }
  return {facade,buildingTrim,street,label,box};
}
