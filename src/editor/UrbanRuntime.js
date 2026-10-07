import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { createStreetProps } from './UrbanProps.js';
import { buildUrbanStreets } from './UrbanStreets.js';
import { createVegetation } from './UrbanVegetation.js';
import { photographicLighting, loadSurface, metricUV } from './UrbanLighting.js';
import { prepareFacadeKit, buildModularBuilding, instanceArchitecture } from './UrbanArchitecture.js';
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
  const group=new THREE.Group(); group.name='Procedural vegetation fallback'; if(!items.length)return group;
  const trunkGeo=new THREE.CylinderGeometry(.13,.24,2.8,8), crownGeo=new THREE.SphereGeometry(1,10,7);
  const trunkMat=new THREE.MeshStandardMaterial({color:0x644833,roughness:1});
  const crownMatA=new THREE.MeshStandardMaterial({color:0x375f3b,roughness:.98});
  const crownMatB=new THREE.MeshStandardMaterial({color:0x52794d,roughness:.98});
  const trunks=new THREE.InstancedMesh(trunkGeo,trunkMat,items.length);
  const crownsA=new THREE.InstancedMesh(crownGeo,crownMatA,items.length);
  const crownsB=new THREE.InstancedMesh(crownGeo,crownMatB,items.length);
  const matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),scale=new THREE.Vector3();
  items.forEach((t,i)=>{
    const y=t.y||0,s=t.scale||1,phase=((Math.abs(t.x*13.7+t.z*7.9)%11)/11)-.5;
    q.setFromAxisAngle(new THREE.Vector3(0,1,0),phase*1.8);
    matrix.compose(new THREE.Vector3(t.x,y+1.4*s,t.z),q,scale.set(s*.92,s,s*.92)); trunks.setMatrixAt(i,matrix);
    matrix.compose(new THREE.Vector3(t.x-.28*s,y+3.25*s,t.z+.08*s),q,scale.set(s*1.22,s*1.45,s*1.08)); crownsA.setMatrixAt(i,matrix);
    matrix.compose(new THREE.Vector3(t.x+.42*s,y+3.72*s,t.z-.18*s),q,scale.set(s*.94,s*1.08,s*.88)); crownsB.setMatrixAt(i,matrix);
  });
  for(const mesh of [trunks,crownsA,crownsB]){mesh.instanceMatrix.needsUpdate=true;mesh.castShadow=true;mesh.receiveShadow=true;}
  group.add(trunks,crownsA,crownsB); return group;
}

const kitPromises=new Map();
function loadUrbanKit(loader,assetId){
  if(!kitPromises.has(assetId))kitPromises.set(assetId,fetchUrbanKit(loader,assetId).catch(error=>{kitPromises.delete(assetId);throw error;}));
  return kitPromises.get(assetId);
}
async function fetchUrbanKit(loader,assetId){
  try{return await loader.loadAsync(`assets/urban-kits/${assetId}/scene.gltf`);}
  catch(localError){
    const remote=await polyHavenGltfURL(assetId);
    try{return await loader.loadAsync(remote);}
    catch(remoteError){remoteError.cause=localError;throw remoteError;}
  }
}

async function polyHavenGltfURL(assetId){
  const response=await fetch(`https://api.polyhaven.com/files/${encodeURIComponent(assetId)}`);
  if(!response.ok) throw new Error(`Poly Haven ${assetId}: HTTP ${response.status}`);
  const tree=await response.json(),candidates=[];
  const walk=(value,path='')=>{
    if(typeof value==='string' && /^https?:\/\//i.test(value) && /\.(gltf|glb)(\?|$)/i.test(value)) candidates.push({url:value,path});
    else if(value && typeof value==='object') for(const [key,item] of Object.entries(value)) walk(item,`${path}/${key}`);
  };
  walk(tree);
  candidates.sort((a,b)=>{
    const score=c=>(/\/1k\//i.test(c.path)?0:/\/2k\//i.test(c.path)?1:2)+(/gltf/i.test(c.path)?0:1);
    return score(a)-score(b);
  });
  if(!candidates.length) throw new Error(`Nessun glTF disponibile per ${assetId}`);
  return candidates[0].url;
}

export class UrbanRuntime {
  constructor(world){
    this.world=world; this.ready=false; this.config=null; this.bodies=[]; this.visualState={status:'idle',architecture:[],vegetation:null,error:null};
    this.root=new THREE.Group(); this.root.name='Città procedurale'; world.graphicsWorld.add(this.root);
    world.camera.far=1800; world.camera.updateProjectionMatrix(); world.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
    world.renderer.toneMapping=THREE.ACESFilmicToneMapping; world.renderer.toneMappingExposure=1.08; world.renderer.outputColorSpace=THREE.SRGBColorSpace;
    world.respawnPosition=new CANNON.Vec3(0,3,0); world.isOutOfBounds=p=>p.y<-25||Math.abs(p.x)>2500||Math.abs(p.z)>2500;
  }
  initialize(){this.generate(DEFAULT_URBAN);}
  clearGenerated(){
    this.bodies.forEach(body=>this.world.physicsWorld.removeBody(body)); this.bodies=[];
    this.root.traverse(node=>{if(node.userData.sharedUrbanAsset)return;node.geometry?.dispose();for(const m of [].concat(node.material||[])){for(const v of Object.values(m||{}))if(v?.isTexture)v.dispose?.();m?.dispose?.();}});
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
    const grassCanvas=document.createElement('canvas'); grassCanvas.width=grassCanvas.height=256;
    const gc=grassCanvas.getContext('2d'); gc.fillStyle='#526f45';gc.fillRect(0,0,256,256);
    for(let i=0;i<5200;i++){const v=58+(i*37+config.seed*13)%46;gc.fillStyle=`rgba(${v-18},${v+24},${v-26},.12)`;gc.fillRect((i*71)%256,(i*43)%256,1,1);}
    const grassTex=new THREE.CanvasTexture(grassCanvas);grassTex.wrapS=grassTex.wrapT=THREE.RepeatWrapping;grassTex.repeat.set(12,12);grassTex.colorSpace=THREE.SRGBColorSpace;
    const matGrass=new THREE.MeshStandardMaterial({map:grassTex,color:0xa8b99b,roughness:1});
    const matPlaza=new THREE.MeshStandardMaterial({color:0x99958a,roughness:.98});
    const matLane=new THREE.MeshStandardMaterial({color:0xe8e6da,roughness:.86});
    const matYellow=new THREE.MeshStandardMaterial({color:0xd9b84e,roughness:.86});
    const matLamp=new THREE.MeshStandardMaterial({color:0x31383c,roughness:.58,metalness:.42});
    const matRoadPatch=new THREE.MeshStandardMaterial({color:0x323435,roughness:1,transparent:true,opacity:.72});
    const matDrain=new THREE.MeshStandardMaterial({color:0x23282a,roughness:.72,metalness:.48});
    const matAwning=new THREE.MeshStandardMaterial({color:0x3d5962,roughness:.55,metalness:.12});
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
    buildUrbanStreets(plan,config,box,{road:matRoad,curb:matCurb,paint:matLane,grass:matGrass,iron:matDrain});

    const facadeMats={};
    for(const style of ['glass','office','brick','stone']){
      const tex=facadeTexture(style,config.seed+(style.charCodeAt(0)||0));
      facadeMats[style]=style==='glass' ? new THREE.MeshPhysicalMaterial({map:tex,color:0xd9eff4,roughness:.16,metalness:.18,clearcoat:.55,clearcoatRoughness:.12,reflectivity:.7}) : new THREE.MeshStandardMaterial({map:tex,color:0xffffff,roughness:style==='office'?.52:.8,metalness:.03});
    }
    const roofMat=new THREE.MeshStandardMaterial({map:concreteMap,roughnessMap:concreteRough,color:0x6e7476,roughness:.88,metalness:.08});
    const lobbyMat=new THREE.MeshPhysicalMaterial({color:0x26343a,roughness:.2,metalness:.2,clearcoat:.35,clearcoatRoughness:.18});
    for(const b of plan.buildings){
      const visualStart=group.children.length;
      const baseY=urbanGroundHeight(b.x,b.z,config),mat=facadeMats[b.style]||facadeMats.office;
      const building=box([b.w,b.height,b.d],[b.x,baseY+b.height/2+.18,b.z],mat,true);
      building.userData.urbanBuilding=true;building.userData.floors=b.floors;building.userData.style=b.style;building.userData.planBuilding=b;
      box([b.w*1.02,.65,b.d*1.02],[b.x,baseY+.51,b.z],lobbyMat,false);
      box([b.w*.76,.38,b.d*.76],[b.x,baseY+b.height+.38,b.z],roofMat,false);
      if(b.floors>12){
        box([Math.max(1.2,b.w*.24),1.1,Math.max(1.2,b.d*.24)],[b.x,baseY+b.height+1.05,b.z],roofMat,false);
        if(b.isTower)box([.08,4,.08],[b.x,baseY+b.height+3,b.z],matLamp,false);
      }
      // Entrances, canopies and rooftop mechanical details create believable street/roof silhouettes.
      const detailSeed=Math.abs(Math.sin(b.x*.173+b.z*.119+config.seed*.01));
      if(detailSeed>.28){
        const doorW=Math.min(3.2,Math.max(1.6,b.w*.22));
        box([doorW,2.7,.12],[b.x,baseY+1.52,b.z+b.d/2+.07],lobbyMat,false);
        box([doorW+1.1,.14,1.25],[b.x,baseY+2.95,b.z+b.d/2+.58],matAwning,false);
      }
      const ventCount=b.isTower?4:2;
      for(let vi=0;vi<ventCount;vi++){
        const angle=vi*Math.PI*2/ventCount+detailSeed;
        const vx=b.x+Math.cos(angle)*b.w*.22,vz=b.z+Math.sin(angle)*b.d*.22;
        const vent=new THREE.Mesh(new THREE.CylinderGeometry(.24,.32,.75,10),matLamp);
        vent.position.set(vx,baseY+b.height+.76,vz);vent.castShadow=true;group.add(vent);
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
      group.children.slice(visualStart).forEach(node=>{node.userData.urbanBuildingVisual=true;});
    }
    for(const l of plan.lamps){
      const first=group.children.length;
      const y=urbanGroundHeight(l.x,l.z,config);box([.13,4.7,.13],[l.x,y+2.35,l.z],matLamp,false);
      box([1.2,.12,.12],[l.x+.52,y+4.62,l.z],matLamp,false);box([.42,.13,.28],[l.x+1.05,y+4.55,l.z],new THREE.MeshStandardMaterial({color:0xffefb5,emissive:0xffcf70,emissiveIntensity:.22}),false);
      group.children.slice(first).forEach(node=>{node.userData.primitiveLamp=true;});
    }
    const treeItems=plan.trees.filter(t=>t.kind!=='median'||!(plan.roads.some(r=>r.axis==='x'&&Math.abs(t.z-r.z)<config.roadWidth/2+6)&&plan.roads.some(r=>r.axis==='z'&&Math.abs(t.x-r.x)<config.roadWidth/2+6))).map(t=>({...t,y:urbanGroundHeight(t.x,t.z,config)}));group.add(treeInstances(treeItems));
    group.userData.materialSource='RoadForge UE5 CC0 asphalt/concrete';

    this.clearGenerated();this.root.add(group);bodies.forEach(b=>this.world.physicsWorld.addBody(b));this.bodies=bodies;
    this.plan=plan;this.config=config;this.manifest={spawns:plan.spawns};this.applySky(config.sky);this.ready=true;
    this.visualState={status:'loading',architecture:[],vegetation:null,error:null};
    this.visualPromise=Promise.all([
      this.loadPhotorealArchitecture(group,plan,config),
      this.loadPhotorealVegetation(group,treeItems,config),
      this.loadPhotorealSurfaces(group,matRoad,matSidewalk,matGrass),
      photographicLighting(this.world,config.sky),
      this.loadStreetProps(group,plan,config)
    ]).then(([architecture,vegetation,,lighting,props])=>{
      if(group.parent!==this.root)return this.visualState;
      this.visualState={status:'ready',architecture,vegetation,lighting,props,assembledBuildings:plan.buildings.length,error:null};
      group.userData.photorealReady=true;
      return this.visualState;
    }).catch(error=>{
      if(group.parent!==this.root)return this.visualState;
      this.visualState={status:'error',architecture:group.userData.photorealAssets||[],vegetation:group.userData.photorealVegetation||null,error:String(error?.message||error)};
      group.userData.photorealError=this.visualState.error;
      console.error('Urban photoreal layer failed',error);
      return this.visualState;
    });

  }
  async loadStreetProps(group,plan,config){
    const {layer,assets,instances}=await createStreetProps(plan,config);
    if(group.parent!==this.root)return null;
    group.add(layer);
    group.children.filter(node=>node.userData.primitiveLamp).forEach(node=>node.removeFromParent());
    return {assets,instances};
  }
  async loadPhotorealSurfaces(group,road,pavement,grass){
    const materials=await Promise.all([loadSurface('asphalt_02',3,0xbababa),loadSurface('concrete_pavement',3,0xd6d1c6),loadSurface('leafy_grass',2,0x91a27b)]);
    if(group.parent!==this.root)return;
    group.traverse(node=>{if(node.isMesh){const index=[road,pavement,grass].indexOf(node.material);if(index>=0){node.material=materials[index];metricUV(node);}}});
  }
  async loadPhotorealArchitecture(group,plan,config){
    const [gltf,factory]=await Promise.all(['modular_urban_apartments_facade','modular_factory_facade'].map(id=>loadUrbanKit(new GLTFLoader(),id)));
    if(group.parent!==this.root)return [];
    const kit=prepareFacadeKit(gltf.scene),brick=prepareFacadeKit(factory.scene),assembly=new THREE.Group();
    for(const [index,b] of plan.buildings.entries()){
      assembly.add(buildModularBuilding(index%5===2?brick:kit,{...b,ground:urbanGroundHeight(b.x,b.z,config)},index,index%5===2));
    }
    group.add(instanceArchitecture(assembly));
    // Collision bodies stay in the physics world. Do not depth-write invisible boxes
    // over the imported windows or leave the other two sides as primitive facades.
    const placeholders=[];
    group.traverse(node=>{if(node.userData?.urbanBuildingVisual)placeholders.push(node);});
    placeholders.forEach(node=>node.removeFromParent());
    group.userData.photorealAssets=['modular_urban_apartments_facade','modular_factory_facade'];
    group.userData.assembledBuildings=plan.buildings.length;
    return group.userData.photorealAssets;
  }
  async loadPhotorealVegetation(group,items,config){
    const layer=await createVegetation(items,config.seed);
    if(group.parent!==this.root)return null;
    group.add(layer);
    const fallback=group.getObjectByName('Procedural vegetation fallback');if(fallback)fallback.removeFromParent();
    group.userData.photorealVegetation='tree_small_02 · Poly Haven CC0';
    return {assetId:'tree_small_02',count:layer.children.length,lods:2};
  }
  applySky(preset){
    const settings={day:{elevation:47,azimuth:145,haze:2.2,fog:0xaec2cb,sun:0xffefd6,intensity:.72},sunset:{elevation:8,azimuth:245,haze:5,fog:0xb98d85,sun:0xffaa63,intensity:.45},haze:{elevation:30,azimuth:160,haze:14,fog:0x9ea9ad,sun:0xd0d4d5,intensity:.28}}[preset];
    this.world.sky.setAtmosphere(settings.elevation,settings.azimuth,settings.haze,settings.sun,settings.intensity);this.world.graphicsWorld.fog=new THREE.Fog(settings.fog,330,1450);
  }
  async ensure(){this.ready=true;} refreshPhysics(){}
  groundAt(x,z){return urbanGroundHeight(x,z,this.config||DEFAULT_URBAN);}
  update(){
    this.world.urbanLighting?.update();
    this.root.getObjectByName('CC0 photoreal vegetation')?.children.forEach(lod=>lod.update(this.world.camera));
    const player=this.world.editorPlayer,p=player?.controlledObject?.position||player?.position;if(p)this.world.actorLayer?.update(p);
    const status=document.querySelector('[data-city-status]');if(status)status.textContent=`Procedural City · ${this.plan?.buildings.length||0} edifici · ${this.plan?.trees.length||0} alberi · ${Math.round(player?.controlledObject?.collision.velocity.length()*3.6||0)} km/h`;
  }
}
