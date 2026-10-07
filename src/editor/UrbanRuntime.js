import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { DEFAULT_URBAN, validateUrban, generateUrbanPlan, urbanGroundHeight } from './urban-data.mjs';

function roadForgeTexture(path,{color=false,repeat=[8,8]}={}){
  const tex=new THREE.TextureLoader().load(path);
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping; tex.repeat.set(...repeat);
  tex.anisotropy=8; if(color) tex.colorSpace=THREE.SRGBColorSpace;
  return tex;
}

function facadeTexture(style='office',seed=0){
  const canvas=document.createElement('canvas'); canvas.width=256; canvas.height=256; const c=canvas.getContext('2d');
  const palettes={
    glass:['#20313c','#89aebb','#bfd7dc','#16252d'],
    office:['#9ca0a1','#394a52','#d7dcdb','#6f7678'],
    brick:['#7b5548','#d7bba8','#412f2b','#9d7765'],
    stone:['#a9a59b','#d4d1c7','#4d5152','#817e76']
  },p=palettes[style]||palettes.office;
  c.fillStyle=p[0]; c.fillRect(0,0,256,256);
  const cols=style==='glass'?5:4,rows=8,pad=7,cellW=256/cols,cellH=256/rows;
  for(let y=0;y<rows;y++) for(let x=0;x<cols;x++){
    const lit=((x*13+y*17+seed*7)%11)<2;
    c.fillStyle=lit?'#dbc88c':p[2];
    const inset=style==='glass'?3:pad;
    c.fillRect(x*cellW+inset,y*cellH+pad,cellW-inset*2,cellH-pad*2);
    if(style!=='glass'){c.fillStyle=p[1];c.fillRect(x*cellW+inset+2,y*cellH+pad+2,cellW-inset*2-4,cellH-pad*2-4);}
  }
  if(style==='brick'){c.fillStyle='rgba(255,255,255,.08)';for(let y=0;y<256;y+=16)c.fillRect(0,y,256,1);}
  const tex=new THREE.CanvasTexture(canvas); tex.wrapS=tex.wrapT=THREE.RepeatWrapping; tex.colorSpace=THREE.SRGBColorSpace;
  tex.anisotropy=4; return tex;
}

function treeInstances(items){
  const group=new THREE.Group(); if(!items.length)return group;
  const trunkGeo=new THREE.CylinderGeometry(.16,.24,2.4,7), crownGeo=new THREE.IcosahedronGeometry(1.35,1);
  const trunkMat=new THREE.MeshStandardMaterial({color:0x6c4d34,roughness:1}), crownMat=new THREE.MeshStandardMaterial({color:0x3f6b43,roughness:.95});
  const trunks=new THREE.InstancedMesh(trunkGeo,trunkMat,items.length), crowns=new THREE.InstancedMesh(crownGeo,crownMat,items.length);
  const matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),scale=new THREE.Vector3();
  items.forEach((t,i)=>{
    const y=t.y||0,s=t.scale||1;
    matrix.compose(new THREE.Vector3(t.x,y+1.2*s,t.z),q,scale.set(s,s,s)); trunks.setMatrixAt(i,matrix);
    matrix.compose(new THREE.Vector3(t.x,y+3.25*s,t.z),q,scale.set(s*1.15,s*1.35,s*1.15)); crowns.setMatrixAt(i,matrix);
  });
  trunks.instanceMatrix.needsUpdate=crowns.instanceMatrix.needsUpdate=true; trunks.castShadow=crowns.castShadow=true; crowns.receiveShadow=true;
  group.add(trunks,crowns); return group;
}

export class UrbanRuntime {
  constructor(world){
    this.world=world; this.ready=false; this.config=null; this.bodies=[];
    this.root=new THREE.Group(); this.root.name='Città procedurale'; world.graphicsWorld.add(this.root);
    world.camera.far=1800; world.camera.updateProjectionMatrix(); world.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
    world.renderer.toneMapping=THREE.ACESFilmicToneMapping; world.renderer.toneMappingExposure=1.08; world.renderer.outputColorSpace=THREE.SRGBColorSpace;
    world.respawnPosition=new CANNON.Vec3(0,3,0); world.isOutOfBounds=p=>p.y<-25||Math.abs(p.x)>2500||Math.abs(p.z)>2500;
  }
  initialize(){this.generate(DEFAULT_URBAN);}
  clearGenerated(){
    this.bodies.forEach(body=>this.world.physicsWorld.removeBody(body)); this.bodies=[];
    this.root.traverse(node=>{node.geometry?.dispose();for(const m of [].concat(node.material||[])){for(const v of Object.values(m||{}))if(v?.isTexture)v.dispose?.();m?.dispose?.();}});
    this.root.clear();
  }
  generate(raw){
    const config=validateUrban(raw); if(JSON.stringify(config)===JSON.stringify(this.config))return;
    const plan=generateUrbanPlan(config),group=new THREE.Group(),bodies=[];
    const asphaltMap=roadForgeTexture('assets/roadforge/T_RF_Asphalt_BC.png',{color:true,repeat:[12,12]});
    const asphaltRough=roadForgeTexture('assets/roadforge/T_RF_Asphalt_R.png',{repeat:[12,12]});
    const concreteMap=roadForgeTexture('assets/roadforge/T_RF_Concrete_BC.png',{color:true,repeat:[9,9]});
    const concreteRough=roadForgeTexture('assets/roadforge/T_RF_Concrete_R.png',{repeat:[9,9]});
    const matRoad=new THREE.MeshStandardMaterial({map:asphaltMap,roughnessMap:asphaltRough,roughness:.96,metalness:0,color:0xd8d8d8});
    const matSidewalk=new THREE.MeshStandardMaterial({map:concreteMap,roughnessMap:concreteRough,roughness:.95,color:0xc7c7c0});
    const matCurb=new THREE.MeshStandardMaterial({map:concreteMap,roughnessMap:concreteRough,roughness:.92,color:0xe2e0d6});
    const matGrass=new THREE.MeshStandardMaterial({color:0x527247,roughness:1});
    const matPlaza=new THREE.MeshStandardMaterial({color:0x99958a,roughness:.98});
    const matLane=new THREE.MeshStandardMaterial({color:0xe8e6da,roughness:.86});
    const matYellow=new THREE.MeshStandardMaterial({color:0xd9b84e,roughness:.86});
    const matLamp=new THREE.MeshStandardMaterial({color:0x31383c,roughness:.58,metalness:.42});
    const box=(size,pos,mat,collision=false)=>{
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),mat);mesh.position.set(...pos);mesh.receiveShadow=true;mesh.castShadow=true;group.add(mesh);
      if(collision){const body=new CANNON.Body({mass:0,shape:new CANNON.Box(new CANNON.Vec3(...size.map(v=>v/2))),position:new CANNON.Vec3(...pos)});bodies.push(body);}
      return mesh;
    };
    const width=plan.bounds.maxX-plan.bounds.minX,depth=plan.bounds.maxZ-plan.bounds.minZ;
    box([width+30,.5,depth+30],[0,-.3,0],new THREE.MeshStandardMaterial({color:0x66765a,roughness:1}),true);

    // Parks/lawns first, then sidewalks and roads so curbs read clearly.
    for(const p of plan.parks){
      box([p.w,.12,p.d],[p.x,.08,p.z],p.kind==='lawn'?matGrass:matPlaza,false);
      if(p.kind==='lawn'){
        box([p.w,.16,.45],[p.x,.17,p.z-p.d/2],matCurb,false);box([p.w,.16,.45],[p.x,.17,p.z+p.d/2],matCurb,false);
        box([.45,.16,p.d],[p.x-p.w/2,.17,p.z],matCurb,false);box([.45,.16,p.d],[p.x+p.w/2,.17,p.z],matCurb,false);
      }
    }
    if(config.sidewalkWidth>0){
      for(let ix=0;ix<config.blocksX;ix++)for(let iz=0;iz<config.blocksZ;iz++){
        const x=plan.bounds.minX+config.roadWidth/2+(ix+.5)*config.blockSize,z=plan.bounds.minZ+config.roadWidth/2+(iz+.5)*config.blockSize,s=config.blockSize-config.roadWidth;
        box([s,.18,s],[x,.09,z],matSidewalk,false);
      }
    }
    for(const r of plan.roads){
      const size=r.axis==='x'?[r.length,.10,r.width]:[r.width,.10,r.length]; box(size,[r.x,.05,r.z],matRoad,false);
      // RoadForge UE5 defaults: 15 cm curb height / 18 cm curb width.
      const curbOffset=r.width/2+.09;
      for(const side of [-1,1]){
        const curbPos=r.axis==='x'?[r.x,.15,r.z+side*curbOffset]:[r.x+side*curbOffset,.15,r.z];
        box(r.axis==='x'?[r.length,.15,.18]:[.18,.15,r.length],curbPos,matCurb,false);
      }
      const edge=r.width/2-.34;
      const count=Math.floor(r.length/7);
      for(const side of [-1,1]){
        const pos=r.axis==='x'?[0,.115,r.z+side*edge]:[r.x+side*edge,.115,0];
        box(r.axis==='x'?[r.length,.025,.14]:[.14,.025,r.length],pos,matLane,false);
      }
      for(let i=0;i<count;i+=2){
        const along=-r.length/2+i*7+3.5,pos=r.axis==='x'?[along,.12,r.z]:[r.x,.12,along];
        if(!r.boulevard)box(r.axis==='x'?[3,.025,.13]:[.13,.025,3],pos,matLane,false);
      }
      if(r.boulevard){
        const offset=1.15;
        for(const side of [-1,1]) box(r.axis==='x'?[r.length,.026,.12]:[.12,.026,r.length],r.axis==='x'?[0,.122,r.z+side*offset]:[r.x+side*offset,.122,0],matYellow,false);
      }
    }
    for(const m of plan.medians){
      const size=m.axis==='x'?[m.length,.14,m.width]:[m.width,.14,m.length];
      box(size,[m.x,.12,m.z],matGrass,false);
    }
    for(const c of plan.crosswalks){
      const stripes=6;
      for(let i=0;i<stripes;i++){
        const off=(i-(stripes-1)/2)*.72;
        const pos=c.axis==='x'?[c.x+off,.135,c.z]:[c.x,.135,c.z+off];
        box(c.axis==='x'?[.38,.025,config.roadWidth*.52]:[config.roadWidth*.52,.025,.38],pos,matLane,false);
      }
    }

    const facadeMats={};
    for(const style of ['glass','office','brick','stone']){
      const tex=facadeTexture(style,config.seed+(style.charCodeAt(0)||0));
      facadeMats[style]=style==='glass' ? new THREE.MeshPhysicalMaterial({map:tex,color:0xd9eff4,roughness:.16,metalness:.18,clearcoat:.55,clearcoatRoughness:.12,reflectivity:.7}) : new THREE.MeshStandardMaterial({map:tex,color:0xffffff,roughness:style==='office'?.52:.8,metalness:.03});
    }
    const roofMat=new THREE.MeshStandardMaterial({map:concreteMap,roughnessMap:concreteRough,color:0x6e7476,roughness:.88,metalness:.08});
    const lobbyMat=new THREE.MeshPhysicalMaterial({color:0x26343a,roughness:.2,metalness:.2,clearcoat:.35,clearcoatRoughness:.18});
    for(const b of plan.buildings){
      const baseY=urbanGroundHeight(b.x,b.z,config),mat=facadeMats[b.style]||facadeMats.office;
      const building=box([b.w,b.height,b.d],[b.x,baseY+b.height/2+.18,b.z],mat,true);
      building.userData.urbanBuilding=true;building.userData.floors=b.floors;building.userData.style=b.style;
      box([b.w*1.02,.65,b.d*1.02],[b.x,baseY+.51,b.z],lobbyMat,false);
      box([b.w*.76,.38,b.d*.76],[b.x,baseY+b.height+.38,b.z],roofMat,false);
      if(b.floors>12){
        box([Math.max(1.2,b.w*.24),1.1,Math.max(1.2,b.d*.24)],[b.x,baseY+b.height+1.05,b.z],roofMat,false);
        if(b.isTower)box([.08,4,.08],[b.x,baseY+b.height+3,b.z],matLamp,false);
      }
      // Inspired by the MIT Unreal Procedural-Cities HouseBuilder: lower apartment blocks
      // may receive balconies and roof service volumes to break up flat facades.
      if(!b.isTower && b.floors<10 && (b.style==='brick'||b.style==='stone')){
        const balconyMat=new THREE.MeshStandardMaterial({map:concreteMap,roughnessMap:concreteRough,color:0xc9c6bc,roughness:.9});
        for(let floor=2;floor<b.floors;floor+=2){
          const y=baseY+floor*3.15+.35;
          box([Math.max(2,b.w*.42),.16,1.05],[b.x,y,b.z+b.d/2+.48],balconyMat,false);
          box([Math.max(1.8,b.w*.38),.85,.08],[b.x,y+.5,b.z+b.d/2+.98],matLamp,false);
        }
      }
    }
    for(const l of plan.lamps){
      const y=urbanGroundHeight(l.x,l.z,config);box([.13,4.7,.13],[l.x,y+2.35,l.z],matLamp,false);
      box([1.2,.12,.12],[l.x+.52,y+4.62,l.z],matLamp,false);box([.42,.13,.28],[l.x+1.05,y+4.55,l.z],new THREE.MeshStandardMaterial({color:0xffefb5,emissive:0xffcf70,emissiveIntensity:.22}),false);
    }
    const treeItems=plan.trees.map(t=>({...t,y:urbanGroundHeight(t.x,t.z,config)}));group.add(treeInstances(treeItems));
    group.userData.materialSource='RoadForge UE5 CC0 asphalt/concrete';

    this.clearGenerated();this.root.add(group);bodies.forEach(b=>this.world.physicsWorld.addBody(b));this.bodies=bodies;
    this.plan=plan;this.config=config;this.manifest={spawns:plan.spawns};this.applySky(config.sky);this.ready=true;
  }
  applySky(preset){
    const settings={day:{elevation:47,azimuth:145,haze:2.2,fog:0xaec2cb,sun:0xffefd6,intensity:.72},sunset:{elevation:8,azimuth:245,haze:5,fog:0xb98d85,sun:0xffaa63,intensity:.45},haze:{elevation:30,azimuth:160,haze:14,fog:0x9ea9ad,sun:0xd0d4d5,intensity:.28}}[preset];
    this.world.sky.setAtmosphere(settings.elevation,settings.azimuth,settings.haze,settings.sun,settings.intensity);this.world.graphicsWorld.fog=new THREE.Fog(settings.fog,330,1450);
  }
  async ensure(){this.ready=true;} refreshPhysics(){}
  groundAt(x,z){return urbanGroundHeight(x,z,this.config||DEFAULT_URBAN);}
  update(){
    const player=this.world.editorPlayer,p=player?.controlledObject?.position||player?.position;if(p)this.world.actorLayer?.update(p);
    const status=document.querySelector('[data-city-status]');if(status)status.textContent=`Procedural City · ${this.plan?.buildings.length||0} edifici · ${this.plan?.trees.length||0} alberi · ${Math.round(player?.controlledObject?.collision.velocity.length()*3.6||0)} km/h`;
  }
}
