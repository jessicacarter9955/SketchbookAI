import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { createStreetProps } from './UrbanProps.js';
import { batchUrbanStaticBoxes } from './UrbanStaticBatch.js';
import { batchUrbanPbrSurfaces } from './UrbanSurfaceBatch.js';
import {restoreUrbanFacades,saveUrbanFacades} from './UrbanSceneCache.js';
import { buildUrbanStreets } from './UrbanStreets.js';
import { createVegetation } from './UrbanVegetation.js';
import { isHiddenBehindBuildings,isOccludedSector,isOccludedTree } from './urban-visibility.mjs';
import { photographicLighting, loadSurface, metricUV, captureStreetReflections } from './UrbanLighting.js';
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


function createDistantSkyline(plan,config){
  const group=new THREE.Group();group.name='Distant skyline';
  const width=plan.bounds.maxX-plan.bounds.minX,depth=plan.bounds.maxZ-plan.bounds.minZ;
  const radiusX=width/2+95,radiusZ=depth/2+95;
  const countPerSide=34,total=countPerSide*4;
  const geometry=new THREE.BoxGeometry(1,1,1);
  const materials=[
    new THREE.MeshStandardMaterial({color:0x78858a,roughness:.88,metalness:.05}),
    new THREE.MeshStandardMaterial({color:0x6e7478,roughness:.9,metalness:.03}),
    new THREE.MeshStandardMaterial({color:0x59686f,roughness:.76,metalness:.12})
  ];
  const meshes=materials.map(mat=>new THREE.InstancedMesh(geometry,mat,total));
  const matrices=meshes.map(()=>new THREE.Matrix4()),q=new THREE.Quaternion(),scale=new THREE.Vector3(),pos=new THREE.Vector3();
  const seeded=i=>{
    const x=Math.sin((i+1)*12.9898+config.seed*.017)*43758.5453;
    return x-Math.floor(x);
  };
  let indexes=[0,0,0];
  for(let side=0;side<4;side++)for(let i=0;i<countPerSide;i++){
    const r=seeded(side*101+i),r2=seeded(side*211+i+9),r3=seeded(side*307+i+21);
    const h=16+r*48,w=9+r2*13,d=9+r3*14;
    const along=(i/(countPerSide-1)-.5)*(side<2?depth+220:width+220);
    const offset=35+r2*95;
    if(side===0)pos.set(-radiusX-offset,h/2-1,along);
    else if(side===1)pos.set(radiusX+offset,h/2-1,along);
    else if(side===2)pos.set(along,h/2-1,-radiusZ-offset);
    else pos.set(along,h/2-1,radiusZ+offset);
    q.setFromAxisAngle(new THREE.Vector3(0,1,0),(r3-.5)*.12);
    matrices[side%3].compose(pos,q,scale.set(w,h,d));
    meshes[side%3].setMatrixAt(indexes[side%3]++,matrices[side%3]);
  }
  for(let m=0;m<meshes.length;m++){
    meshes[m].count=indexes[m];meshes[m].instanceMatrix.needsUpdate=true;meshes[m].castShadow=false;meshes[m].receiveShadow=false;
    group.add(meshes[m]);
  }
  const beltGeo=new THREE.SphereGeometry(1,7,5),beltMat=new THREE.MeshStandardMaterial({color:0x405844,roughness:1});
  const beltCount=96,belt=new THREE.InstancedMesh(beltGeo,beltMat,beltCount),matrix=new THREE.Matrix4();
  for(let i=0;i<beltCount;i++){
    const angle=i/beltCount*Math.PI*2,r= Math.max(width,depth)*.58+58+seeded(i+800)*42;
    const h=3.5+seeded(i+1200)*3.5;
    matrix.compose(new THREE.Vector3(Math.cos(angle)*r,h*.75,Math.sin(angle)*r),q,scale.set(h*1.1,h,h*1.1));
    belt.setMatrixAt(i,matrix);
  }
  belt.instanceMatrix.needsUpdate=true;belt.castShadow=false;group.add(belt);
  group.userData={distantSkyline:true,buildingCount:indexes.reduce((a,b)=>a+b,0),treeCanopies:beltCount};
  return group;
}

export class UrbanRuntime {
  constructor(world){
    this.world=world;
    const url=new URLSearchParams(location.search);
    // Reduced geometry is opt-in. Mobile devices no longer silently receive placeholders.
    this.mobileLite=url.get('quality')==='lite';
    world.sky.setPhotographic(!this.mobileLite); this.ready=false; this.config=null; this.bodies=[]; this.visualState={status:'idle',architecture:[],vegetation:null,error:null};
    this.root=new THREE.Group(); this.root.name='Città procedurale'; world.graphicsWorld.add(this.root);
    world.camera.far=1800; world.camera.updateProjectionMatrix(); world.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
    world.renderer.toneMapping=THREE.ACESFilmicToneMapping; world.renderer.toneMappingExposure=1.08; world.renderer.outputColorSpace=THREE.SRGBColorSpace;
    world.respawnPosition=new CANNON.Vec3(0,3,0); world.isOutOfBounds=p=>p.y<-25||Math.abs(p.x)>2500||Math.abs(p.z)>2500;
    this.facadeStreamer=null;this.lastDetailTick=0;this.lastFoliageTick=0;this.lastOcclusionTick=0;this.lastHudTick=0;this.fps=0;
    this.fallbackBuildingNodes=new Map();this.occlusionStats={buildingsHidden:0,sectorsHidden:0};
    this.adaptiveQuality();
  }
  initialize(config=DEFAULT_URBAN){this.generate(config);}
  clearGenerated(){
    this.facadeStreamer=null;this.hdBuildingIndices=new Set();this.fallbackBuildingNodes.clear();
    this.bodies.forEach(body=>this.world.physicsWorld.removeBody(body)); this.bodies=[];
    this.root.traverse(node=>{if(node.userData.sharedUrbanAsset)return;node.geometry?.dispose();for(const m of [].concat(node.material||[])){for(const v of Object.values(m||{}))if(v?.isTexture)v.dispose?.();m?.dispose?.();}});
    this.root.clear();
  }
  generate(raw){
    const config=validateUrban(raw); if(JSON.stringify(config)===JSON.stringify(this.config))return;
    const plan=generateUrbanPlan(config),group=new THREE.Group(),bodies=[];
    this.loadingHeavy=!this.mobileLite;
    group.visible=false;
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
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),mat);mesh.position.set(...pos);mesh.receiveShadow=true;mesh.castShadow=size[1]>1.3;group.add(mesh);
      if(collision){const body=new CANNON.Body({mass:0,shape:new CANNON.Box(new CANNON.Vec3(...size.map(v=>v/2))),position:new CANNON.Vec3(...pos)});bodies.push(body);}
      return mesh;
    };
    const width=plan.bounds.maxX-plan.bounds.minX,depth=plan.bounds.maxZ-plan.bounds.minZ;
    box([width+30,.5,depth+30],[0,-.3,0],new THREE.MeshStandardMaterial({color:0x66765a,roughness:1}),true);
    const horizonGround=new THREE.Mesh(new THREE.BoxGeometry(width+760,.35,depth+760),matGrass);horizonGround.position.y=-.58;horizonGround.receiveShadow=true;group.add(horizonGround);
    const distantSkyline=createDistantSkyline(plan,config);
    distantSkyline.visible=this.mobileLite; // Never expose low-detail fake buildings in HD mode.
    group.add(distantSkyline);

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
    for(const [buildingIndex,b] of plan.buildings.entries()){
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
      group.children.slice(visualStart).forEach(node=>{node.userData.urbanBuildingVisual=true;node.userData.urbanBuildingIndex=buildingIndex;});
    }
    for(const l of plan.lamps){
      const first=group.children.length;
      const y=urbanGroundHeight(l.x,l.z,config);box([.13,4.7,.13],[l.x,y+2.35,l.z],matLamp,false);
      box([1.2,.12,.12],[l.x+.52,y+4.62,l.z],matLamp,false);box([.42,.13,.28],[l.x+1.05,y+4.55,l.z],new THREE.MeshStandardMaterial({color:0xffefb5,emissive:0xffcf70,emissiveIntensity:.22}),false);
      group.children.slice(first).forEach(node=>{node.userData.primitiveLamp=true;});
    }
    const treeItems=plan.trees.filter(t=>t.kind!=='median'||!(plan.roads.some(r=>r.axis==='x'&&Math.abs(t.z-r.z)<config.roadWidth/2+6)&&plan.roads.some(r=>r.axis==='z'&&Math.abs(t.x-r.x)<config.roadWidth/2+6))).map(t=>({...t,y:urbanGroundHeight(t.x,t.z,config)}));group.add(treeInstances(treeItems));
    group.userData.materialSource='RoadForge UE5 CC0 asphalt/concrete';
    group.userData.staticBatches=batchUrbanStaticBoxes(group,new Set([matRoad,matSidewalk,matGrass]),config.blockSize);

    this.clearGenerated();this.root.add(group);bodies.forEach(b=>this.world.physicsWorld.addBody(b));this.bodies=bodies;
    this.fallbackBuildingNodes.clear();
    for(const node of group.children){
      if(!node.userData.urbanBuildingVisual)continue;
      const id=node.userData.urbanBuildingIndex;
      if(!this.fallbackBuildingNodes.has(id))this.fallbackBuildingNodes.set(id,[]);
      this.fallbackBuildingNodes.get(id).push(node);
    }

    this.plan=plan;this.config=config;this.manifest={spawns:plan.spawns};this.applySky(config.sky);this.ready=true;
    // The procedural geometry and physics are already playable at this point.
    // Never hide the whole city behind optional remote photoreal assets.
    group.visible=true;
    if(this.mobileLite){
      // Avoid HDR PMREM, 4K shadow maps, SSAO, 100 MB glTF geometry and
      // heavy texture uploads on Android WebView. Use direct WebGL baseline.
      const scene=this.world.graphicsWorld;
      this.world.sky.setPhotographic(false);
      scene.background=new THREE.Color(0x8daec7);
      scene.fog=new THREE.Fog(0xa6bbcb,125,570);
      const ambient=new THREE.HemisphereLight(0xe0eeff,0x798578,1.5);
      const sun=new THREE.DirectionalLight(0xfff2dc,2.0);
      sun.position.set(80,120,55);sun.castShadow=false;
      scene.add(ambient,sun);
      this.world.urbanLighting={
        sun,fill:ambient,hdr:null,
        sunOffset:new THREE.Vector3(80,120,55),
        update:()=>{const p=this.world.camera.position;
          sun.position.copy(p).add(this.world.urbanLighting.sunOffset);}
      };
      this.visualProgress={completed:5,total:5,failed:0,label:'Grafica mobile leggera pronta'};
      this.visualState={status:'ready',architecture:['procedural buildings'],vegetation:'procedural trees',
        lighting:'mobile WebGL',props:'procedural street props',error:null,progress:{...this.visualProgress}};
      this.onVisualProgress?.({...this.visualProgress});
      this.visualPromise=Promise.resolve(this.visualState);
      return;
    }
    this.visualProgress={completed:0,total:7,failed:0,label:'Download e preparazione degli asset fotorealistici'};
    this.visualState={status:'loading',architecture:[],vegetation:null,error:null,progress:this.visualProgress};
    const stages=[
      ['Facciate fotorealistiche',()=>this.loadPhotorealArchitecture(group,plan,config)],
      ['Vegetazione',()=>this.loadPhotorealVegetation(group,treeItems,config)],
      ['Strade e materiali',()=>this.loadPhotorealSurfaces(group,matRoad,matSidewalk,matGrass)],
      ['Cielo e illuminazione',()=>photographicLighting(this.world,config.sky)],
      ['Lampioni e arredi',()=>this.loadStreetProps(group,plan,config)]
    ];
    const loads=stages.map(async ([label,task])=>{
      globalThis.cityDiagnostics?.stage(label);
      // Convert each failure to a result; a missing facade must not block NPCs,
      // traffic or the user's ability to move and talk.
      try {
        const value=await Promise.race([task(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Timeout dettaglio HD: '+label)),50000))]);
        globalThis.cityDiagnostics?.stage(label,'done');
        if(group.parent===this.root){
          this.visualProgress.completed++;
          this.visualProgress.label=label+' completato';
          this.onVisualProgress?.({...this.visualProgress});
        }
        return {ok:true,value};
      }catch(error){
        globalThis.cityDiagnostics?.stage(label,'error');
        globalThis.cityDiagnostics?.problem(error,label);
        if(group.parent===this.root){
          this.visualProgress.completed++;
          this.visualProgress.failed++;
          this.visualProgress.label=label+' non disponibile: '+String(error?.message||error);
          this.onVisualProgress?.({...this.visualProgress});
        }
        console.warn('Optional city detail failed:',label,error);
        return {ok:false,error:String(error?.message||error)};
      }
    });
    this.onVisualProgress?.({...this.visualProgress});
    this.visualPromise=Promise.all(loads).then(async results=>{
      if(group.parent!==this.root)return this.visualState;
      const errors=results.map((r,i)=>r.ok?null:stages[i][0]+': '+r.error).filter(Boolean);
      if(!errors.length&&!this.mobileLite){
        // Prefetch every original high-detail facade BEFORE allowing gameplay.
        // Building these mesh batches at running speed created major stutters.
        try{
          await this.prepareAllPhotorealDetails();
          this.visualProgress.completed++;
          this.visualProgress.label='Edifici HD pronti, precompilazione shader…';
          this.onVisualProgress?.({...this.visualProgress});
          if(typeof this.world.renderer.compileAsync==='function'){
            globalThis.cityDiagnostics?.stage('Shader HD visibili');
            const before=performance.now();
            await Promise.race([
              this.world.renderer.compileAsync(this.world.graphicsWorld,this.world.camera),
              new Promise((_,reject)=>setTimeout(()=>reject(new Error('Timeout GPU shader HD')),30000))
            ]);
            globalThis.cityDiagnostics?.stage('Shader HD visibili','done');
            globalThis.cityDiagnostics?.activity('Shader HD compilati in '+Math.round(performance.now()-before)+' ms');
          }
          this.visualProgress.completed++;
          this.visualProgress.label='Shader preparati · scena HD completa';
          this.onVisualProgress?.({...this.visualProgress});
        }catch(error){errors.push('Precaricamento HD: '+String(error?.message||error));
          globalThis.cityDiagnostics?.problem(error,'Precaricamento HD');}
      }
      const skyline=group.getObjectByName('Distant skyline')?.userData||{};
      this.visualState={
        status:errors.length?'partial':'ready',
        architecture:results[0].ok?results[0].value:[],
        vegetation:results[1].ok?results[1].value:null,
        lighting:results[3].ok?results[3].value:null,
        props:results[4].ok?results[4].value:null,
        assembledBuildings:plan.buildings.length,skyline,hdCacheHit:Boolean(this.facadeStreamer?.fromCache),
        error:errors.length?errors.join(' | '):null,
        progress:{...this.visualProgress}
      };
      group.userData.photorealReady=errors.length===0;
      this.loadingHeavy=false;
      // Never expose partially loaded geometry: callers await visualPromise.
      this.onVisualProgress?.({...this.visualProgress});
      return this.visualState;
    });

  }
  async loadStreetProps(group,plan,config){
    globalThis.cityDiagnostics?.activity('Arredo urbano: attesa street_lamp_01 / painted_wooden_bench / metal_trash_can');
    const {layer,assets,instances}=await createStreetProps(plan,config);
    if(group.parent!==this.root)return null;
    group.add(layer);
    group.children.filter(node=>node.userData.primitiveLamp).forEach(node=>node.removeFromParent());
    return {assets,instances};
  }
  async loadPhotorealSurfaces(group,road,pavement,grass){
    const materials=await Promise.all([loadSurface('asphalt_02',3,0xbababa),loadSurface('concrete_pavement',3,0xd6d1c6),loadSurface('leafy_grass',2,0x91a27b)]);
    if(group.parent!==this.root)return;
    // Named shared materials let procedural weather darken wet asphalt and
    // whiten snowy sidewalks without altering model-import or physics data.
    ['Urban asphalt','Urban pavement','Urban lawns'].forEach((name,i)=>{materials[i].name=name;});
    group.traverse(node=>{if(node.isMesh){const index=[road,pavement,grass].indexOf(node.material);if(index>=0){node.material=materials[index];metricUV(node);}}});
    const batched=batchUrbanPbrSurfaces(group,new Set(materials),this.config?.blockSize||42);
    globalThis.cityDiagnostics?.activity('Superfici PBR originali: '+batched.drawCallsSaved+' draw call risparmiate, UV preservate');
  }
  async loadPhotorealArchitecture(group,plan,config){
    // Query the persistent processed-HD cache FIRST. On a valid cache hit
    // none of the hundreds of thousands of facade module clones are rebuilt.
    const names=['modular_urban_apartments_facade','modular_factory_facade'];
    const size=config.blockSize,clusters=new Map(),minX=plan.bounds.minX,minZ=plan.bounds.minZ;
    plan.buildings.forEach((b,index)=>{
      const cx=Math.floor((b.x-minX)/size),cz=Math.floor((b.z-minZ)/size),key=cx+':'+cz;
      if(!clusters.has(key))clusters.set(key,{key,x:minX+(cx+.5)*size,z:minZ+(cz+.5)*size,size,ground:urbanGroundHeight(b.x,b.z,config),buildings:[],node:null});
      clusters.get(key).buildings.push({b,index});
    });
    let cached=await restoreUrbanFacades(config);
    const cachedValid=cached && cached.children.length===clusters.size &&
      [...clusters.keys()].every(key=>cached.getObjectByName('PBR city sector '+key));
    if(!cachedValid)cached=null;
    let standard=null,factory=null,available=names;
    if(!cached){
      const results=await Promise.allSettled(names.map(id=>loadUrbanKit(new GLTFLoader(),id)));
      if(group.parent!==this.root)return [];
      available=results.map((r,i)=>r.status==='fulfilled'?names[i]:null).filter(Boolean);
      if(!available.length)throw new Error('Nessun kit facciate disponibile: '+results.map((r,i)=>names[i]+': '+(r.reason?.message||'errore')).join(' | '));
      standard=results[0].status==='fulfilled'?prepareFacadeKit(results[0].value.scene):prepareFacadeKit(results[1].value.scene);
      factory=results[1].status==='fulfilled'?prepareFacadeKit(results[1].value.scene):standard;
    }
    const placeholders=new Map();
    for(const node of group.children)if(node.userData.urbanBuildingVisual){
      const index=node.userData.urbanBuildingIndex;
      if(!placeholders.has(index))placeholders.set(index,[]);
      placeholders.get(index).push(node);
    }
    this.facadeStreamer={group,config,standard,factory,clusters:[...clusters.values()],placeholders,assembled:0,fromCache:Boolean(cached)};
    if(cached){
      for(const sector of this.facadeStreamer.clusters){
        sector.node=cached.getObjectByName('PBR city sector '+sector.key);
        group.add(sector.node);
        this.facadeStreamer.assembled+=sector.buildings.length;
        for(const {index} of sector.buildings)this.hdBuildingIndices.add(index);
      }
      group.userData.assembledBuildings=this.facadeStreamer.assembled;
      globalThis.cityDiagnostics?.activity('HIT cache HD: '+this.facadeStreamer.clusters.length+' settori importati da IndexedDB');
    }else{
      this.streamPhotorealDetails(true);
      group.userData.assembledBuildings=0;
    }
    group.userData.photorealAssets=available;
    return available;
  }
  streamPhotorealDetails(force=false){
    const streamer=this.facadeStreamer;
    if(!streamer||streamer.group.parent!==this.root)return;
    const now=performance.now();
    if(!force&&now-this.lastDetailTick<130)return;
    this.lastDetailTick=now;
    const camera=this.world.camera;
    camera.updateMatrixWorld(true);
    const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    const player=this.world.editorPlayer?.position||new THREE.Vector3();
    const inRange=cluster=>{
      const dCamera=Math.hypot(camera.position.x-cluster.x,camera.position.z-cluster.z);
      const dPlayer=Math.hypot(player.x-cluster.x,player.z-cluster.z);
      const bounds=new THREE.Box3(new THREE.Vector3(cluster.x-streamer.config.blockSize/2,-3,cluster.z-streamer.config.blockSize/2),
                                  new THREE.Vector3(cluster.x+streamer.config.blockSize/2,170,cluster.z+streamer.config.blockSize/2));
      return dPlayer<55||(dCamera<225&&frustum.intersectsBox(bounds)&&!isOccludedSector(camera.position,cluster,this.plan.buildings));
    };
    const needed=streamer.clusters.filter(inRange).sort((a,b)=>Math.hypot(a.x-player.x,a.z-player.z)-Math.hypot(b.x-player.x,b.z-player.z));
    // Existing distant cells are not drawn, while cached buffers survive short camera turns.
    let occluded=0;
    for(const c of streamer.clusters)if(c.node){const visible=inRange(c);c.node.visible=visible;if(!visible)occluded++;}
    this.occlusionStats.sectorsHidden=occluded;
    const next=needed.find(c=>!c.node);
    if(!next)return;
    this.assembleFacadeCluster(next);
  }
  assembleFacadeCluster(next){
    if(next.node)return;
    const streamer=this.facadeStreamer;
    const assembly=new THREE.Group();
    for(const {b,index} of next.buildings){
      assembly.add(buildModularBuilding(index%5===2?streamer.factory:streamer.standard,
        {...b,ground:urbanGroundHeight(b.x,b.z,streamer.config)},index,index%5===2));
    }
    const batch=instanceArchitecture(assembly);batch.name='PBR city sector '+next.key;
    next.node=batch;streamer.group.add(batch);
    if(!this.hdBuildingIndices)this.hdBuildingIndices=new Set();
    for(const {index} of next.buildings)this.hdBuildingIndices.add(index);
    for(const {index} of next.buildings)for(const mesh of streamer.placeholders.get(index)||[])mesh.visible=false;
    streamer.assembled+=next.buildings.length;
    streamer.group.userData.assembledBuildings=streamer.assembled;
  }
  async prepareAllPhotorealDetails(){
    const streamer=this.facadeStreamer;
    if(!streamer?.clusters?.length)throw new Error('Nessun settore HD disponibile per il precaricamento');
    for(let i=0;i<streamer.clusters.length;i++){
      this.assembleFacadeCluster(streamer.clusters[i]);
      if(i%2===1){
        this.visualProgress.label=`Precaricamento facciate HD ${i+1}/${streamer.clusters.length}`;
        this.onVisualProgress?.({...this.visualProgress});
        await new Promise(resolve=>setTimeout(resolve,0));
      }
    }
    // Remove low-detail facade placeholders permanently, rather than showing
    // them while running and replacing them in view.
    for(const parts of streamer.placeholders.values())for(const node of parts){
      node.removeFromParent();
      node.geometry?.dispose?.();
    }
    streamer.placeholders.clear();this.fallbackBuildingNodes.clear();
    this.root.getObjectByName('Distant skyline')?.removeFromParent();
    if(!streamer.fromCache){
      // First visit: persist the complete imported geometry, PBR materials,
      // and GPU instance matrices. Any unavailable/quota-limited cache is an
      // optional optimization, never a loading failure.
      this.visualProgress.label='Salvataggio facciate HD per gli avvii successivi…';
      this.onVisualProgress?.({...this.visualProgress});
      await saveUrbanFacades(streamer.config,streamer.clusters);
    }
    const layer=this.root.getObjectByName('CC0 photoreal vegetation');
    if(!layer)throw new Error('Vegetazione fotorealistica non disponibile');
    await layer.userData.prepareAll?.(text=>{
       this.visualProgress.label=text;
       globalThis.cityDiagnostics?.activity('VEGETAZIONE: '+text);
       this.onVisualProgress?.({...this.visualProgress});
     },this.world.camera);
    this.streamPhotorealDetails(true);
  }
  async loadPhotorealVegetation(group,items,config){
    globalThis.cityDiagnostics?.activity('Vegetazione LOD: attesa tree_small_02/scene-lod0.gltf e scene-lod1.gltf con .bin e texture');
    const layer=await createVegetation(items,config.seed);
    if(group.parent!==this.root)return null;
    layer.userData.stream?.(this.world.camera);
    const soil=new THREE.MeshStandardMaterial({color:0x302e23,roughness:1});
    const iron=new THREE.MeshStandardMaterial({color:0x343c38,metalness:.7,roughness:.65});
    for(const t of items.filter(t=>t.kind==='street')){
      const bed=new THREE.Mesh(new THREE.BoxGeometry(1.45,.025,1.45),soil);bed.position.set(t.x,t.y+.195,t.z);bed.receiveShadow=true;group.add(bed);
      for(const side of [-1,1])for(const axis of ['x','z']){
        const edge=new THREE.Mesh(new THREE.BoxGeometry(axis==='x'?1.57:.07,.025,axis==='x'?.07:1.5),iron);
        edge.position.set(t.x+(axis==='z'?side*.75:0),t.y+.21,t.z+(axis==='x'?side*.75:0));edge.receiveShadow=true;group.add(edge);
      }
    }
    layer.userData.keepLoaded=!this.mobileLite;
    group.add(layer);
    const fallback=group.getObjectByName('Procedural vegetation fallback');if(fallback)fallback.removeFromParent();
    group.userData.photorealVegetation='tree_small_02 · Poly Haven CC0';
    return {assetId:'tree_small_02',count:items.length,lods:2};
  }
  applySky(preset){
    const settings={day:{elevation:47,azimuth:145,haze:2.2,fog:0xaec2cb,sun:0xffefd6,intensity:.72},sunset:{elevation:8,azimuth:245,haze:5,fog:0xb98d85,sun:0xffaa63,intensity:.45},haze:{elevation:30,azimuth:160,haze:14,fog:0x9ea9ad,sun:0xd0d4d5,intensity:.28}}[preset];
    this.world.sky.setAtmosphere(settings.elevation,settings.azimuth,settings.haze,settings.sun,settings.intensity);this.world.graphicsWorld.fog=new THREE.Fog(settings.fog,330,1450);
  }
  async ensure(){this.ready=true;} refreshPhysics(){}
  groundAt(x,z){return urbanGroundHeight(x,z,this.config||DEFAULT_URBAN);}
  adaptiveQuality(){
    if(this.mobileLite)return;
    const max=Math.min(devicePixelRatio||1,1.5),min=Math.min(max,0.85);
    let last=performance.now(),changed=last,frames=0;
    const sample=now=>{
      frames++;
      if(now-last>=1800){
        this.fps=Math.round(frames*1000/(now-last));frames=0;last=now;
        if(this.world.renderer&&now-changed>5500&&new URLSearchParams(location.search).get('adaptive')!=='0'){
          const current=this.world.renderer.getPixelRatio();
          const next=this.fps<38?Math.max(min,current-0.1):this.fps>56?Math.min(max,current+0.05):current;
          if(Math.abs(next-current)>0.01){this.world.renderer.setPixelRatio(next);changed=now;}
        }
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }
  updateBuildingOcclusion(){
    if(!this.plan?.buildings?.length)return;
    const camera=this.world.camera,from=camera.position,buildings=this.plan.buildings;
    let hidden=0;
    for(const [index,nodes] of this.fallbackBuildingNodes){
      if(this.hdBuildingIndices?.has(index))continue;
      const b=buildings[index],y=urbanGroundHeight(b.x,b.z,this.config);
      const distance=Math.hypot(from.x-b.x,from.z-b.z);
      const blocked=distance>65&&isHiddenBehindBuildings(from,[
        {x:b.x,y:y+Math.min(b.height*.5,10),z:b.z},
        {x:b.x,y:y+b.height,z:b.z},
        {x:b.x-b.w*.5,y:y+b.height*.8,z:b.z-b.d*.5},
        {x:b.x+b.w*.5,y:y+b.height*.8,z:b.z+b.d*.5}
      ],buildings,new Set([index]));
      for(const mesh of nodes)mesh.visible=!blocked;
      if(blocked)hidden++;
    }
    this.occlusionStats.buildingsHidden=hidden;
  }
  update(){
    // Prewarming can clone thousands of PBR modules. Never compete with it by
    // rendering or doing more distance-streaming behind an opaque loader.
    if(this.loadingHeavy)return;
    this.world.urbanLighting?.update();
    this.streamPhotorealDetails();
    const now=performance.now();
    if(now-this.lastOcclusionTick>320){this.lastOcclusionTick=now;this.updateBuildingOcclusion();}
    if(now-this.lastFoliageTick>160){
      this.lastFoliageTick=now;
      const vegetation=this.root.getObjectByName('CC0 photoreal vegetation');
      vegetation?.userData.stream?.(this.world.camera,tree=>!isOccludedTree(this.world.camera.position,tree,this.plan.buildings));
      vegetation?.children.forEach(lod=>{if(lod.visible)lod.update(this.world.camera);});
    }
    const player=this.world.editorPlayer,p=player?.controlledObject?.position||player?.position;if(p)this.world.actorLayer?.update(p);
    this.world.urbanDialogue?.update(1/60);
    if(now-this.lastHudTick>250){
      this.lastHudTick=now;
      const status=document.querySelector('[data-city-status]');
      if(status)status.textContent=`Procedural City · ${this.fps||'…'} FPS · ${this.facadeStreamer?.assembled||0} facciate HD · ${this.occlusionStats.buildingsHidden} edifici coperti · ${this.occlusionStats.sectorsHidden} settori non disegnati · ${this.plan?.trees.length||0} alberi · ${Math.round(player?.controlledObject?.collision.velocity.length()*3.6||0)} km/h`;
    }
  }
}
