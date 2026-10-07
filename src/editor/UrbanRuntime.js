import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { DEFAULT_URBAN, validateUrban, generateUrbanPlan, urbanGroundHeight } from './urban-data.mjs';

export class UrbanRuntime {
  constructor(world) {
    this.world=world; this.ready=false; this.config=null; this.bodies=[];
    this.root=new THREE.Group(); this.root.name='Città procedurale'; world.graphicsWorld.add(this.root);
    world.camera.far=1800; world.camera.updateProjectionMatrix();
    world.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
    world.respawnPosition=new CANNON.Vec3(0,3,0);
    world.isOutOfBounds=p=>p.y < -25 || Math.abs(p.x)>2500 || Math.abs(p.z)>2500;
  }
  initialize() { this.generate(DEFAULT_URBAN); }
  clearGenerated() {
    this.bodies.forEach(body=>this.world.physicsWorld.removeBody(body)); this.bodies=[];
    this.root.traverse(node=>{ if(node.geometry) node.geometry.dispose(); if(node.material) [].concat(node.material).forEach(m=>m.dispose?.()); });
    this.root.clear();
  }
  generate(raw) {
    const config=validateUrban(raw);
    if(JSON.stringify(config)===JSON.stringify(this.config)) return;
    const plan=generateUrbanPlan(config), group=new THREE.Group(), bodies=[];
    const matRoad=new THREE.MeshStandardMaterial({color:0x2d3338,roughness:.96});
    const matSidewalk=new THREE.MeshStandardMaterial({color:0x777b7b,roughness:.95});
    const matLamp=new THREE.MeshStandardMaterial({color:0x3d474d,roughness:.8});
    const box=(size,pos,mat,collision=false)=>{
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),mat); mesh.position.set(...pos); mesh.receiveShadow=true; mesh.castShadow=true; group.add(mesh);
      if(collision){const body=new CANNON.Body({mass:0,shape:new CANNON.Box(new CANNON.Vec3(...size.map(v=>v/2))),position:new CANNON.Vec3(...pos)});bodies.push(body);}
      return mesh;
    };
    const width=plan.bounds.maxX-plan.bounds.minX, depth=plan.bounds.maxZ-plan.bounds.minZ;
    box([width,.5,depth],[0,-.3,0],new THREE.MeshStandardMaterial({color:0x64705e,roughness:1}),true);
    for(const r of plan.roads) {
      const size=r.axis==='x'?[r.length,.08,r.width]:[r.width,.08,r.length];
      box(size,[r.x,.03,r.z],matRoad,false);
      const lineMat=new THREE.MeshStandardMaterial({color:0xd7ca8c,roughness:.9});
      const dashCount=Math.floor(r.length/8);
      for(let i=0;i<dashCount;i+=2){
        const along=-r.length/2+i*8+4;
        const pos=r.axis==='x'?[along,.09,r.z]:[r.x,.09,along];
        box(r.axis==='x'?[3,.02,.14]:[.14,.02,3],pos,lineMat,false);
      }
    }
    const sidewalkDepth=Math.max(.08,config.sidewalkWidth);
    if(config.sidewalkWidth>0) {
      for(let ix=0;ix<config.blocksX;ix++) for(let iz=0;iz<config.blocksZ;iz++){
        const x=plan.bounds.minX+config.roadWidth/2+(ix+.5)*config.blockSize;
        const z=plan.bounds.minZ+config.roadWidth/2+(iz+.5)*config.blockSize;
        const s=config.blockSize-config.roadWidth;
        box([s,.16,s],[x,.08,z],matSidewalk,false);
      }
    }
    for(const b of plan.buildings) {
      const baseY=urbanGroundHeight(b.x,b.z,config);
      const color=new THREE.Color().setHSL(.56+b.tint*.08,.12,.36+b.tint*.18);
      const mat=new THREE.MeshStandardMaterial({color,roughness:.83,metalness:.03});
      const building=box([b.w,b.height,b.d],[b.x,baseY+b.height/2+.17,b.z],mat,true);
      building.userData.urbanBuilding=true; building.userData.floors=b.floors;
      const roofMat=new THREE.MeshStandardMaterial({color:0x32383c,roughness:.9});
      box([b.w*.78,.35,b.d*.78],[b.x,baseY+b.height+.36,b.z],roofMat,false);
    }
    for(const l of plan.lamps) {
      const y=urbanGroundHeight(l.x,l.z,config);
      box([.15,4.5,.15],[l.x,y+2.25,l.z],matLamp,false);
      box([1.1,.12,.12],[l.x+.48,y+4.45,l.z],matLamp,false);
    }
    this.clearGenerated(); this.root.add(group); bodies.forEach(b=>this.world.physicsWorld.addBody(b)); this.bodies=bodies;
    this.plan=plan; this.config=config; this.manifest={spawns:plan.spawns}; this.applySky(config.sky); this.ready=true;
  }
  applySky(preset) {
    const settings={day:{elevation:50,azimuth:145,haze:2,fog:0xb8c8cd,sun:0xffefd6,intensity:.65},sunset:{elevation:8,azimuth:245,haze:5,fog:0xb98d85,sun:0xffaa63,intensity:.45},haze:{elevation:30,azimuth:160,haze:14,fog:0x9ea9ad,sun:0xd0d4d5,intensity:.28}}[preset];
    this.world.sky.setAtmosphere(settings.elevation,settings.azimuth,settings.haze,settings.sun,settings.intensity);
    this.world.graphicsWorld.fog=new THREE.Fog(settings.fog,300,1500);
  }
  async ensure(){this.ready=true;}
  refreshPhysics(){}
  groundAt(x,z){return urbanGroundHeight(x,z,this.config||DEFAULT_URBAN);}
  update(){
    const player=this.world.editorPlayer, p=player?.controlledObject?.position||player?.position;
    if(p) this.world.actorLayer?.update(p);
    const status=document.querySelector('[data-city-status]');
    if(status) status.textContent=`Procedural City · ${this.plan?.buildings.length||0} edifici · ${Math.round(player?.controlledObject?.collision.velocity.length()*3.6||0)} km/h`;
  }
}
