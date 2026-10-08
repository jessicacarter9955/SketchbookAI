import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { prepareFacadeKit,buildModularBuilding } from './UrbanArchitecture.js';
import { createVegetation } from './UrbanVegetation.js';
import { loadSurface } from './UrbanLighting.js';
const key=new URLSearchParams(location.search).get('asset')||'brick';
const titles={brick:'Mattoni · infissi e profondità',residential:'Appartamenti · facciata e arretramenti',tree:'Vegetazione · tronco, rami e foglie',bench:'Panchina · legno verniciato e usura',lamp:'Lampione · metallo e vetro',materials:'Asfalto · pavimentazione · terreno'};
document.querySelector('#title').textContent=titles[key]||key;
const scene=new THREE.Scene();scene.background=new THREE.Color(0xc5cccb);
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;renderer.useLegacyLights=false;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;document.body.appendChild(renderer.domElement);
const camera=new THREE.PerspectiveCamera(39,innerWidth/innerHeight,.02,250),controls=new OrbitControls(camera,renderer.domElement);
const sun=new THREE.DirectionalLight(0xfff0dd,3.2);sun.position.set(-8,14,12);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-15,right:15,top:20,bottom:-10,near:.2,far:70});sun.shadow.camera.updateProjectionMatrix();sun.shadow.bias=-.0001;sun.shadow.normalBias=.015;scene.add(sun,sun.target,new THREE.HemisphereLight(0xd1e2ee,0x655c47,.15));
const floor=new THREE.Mesh(new THREE.PlaneGeometry(120,120),new THREE.MeshStandardMaterial({color:0xb8bcb9,roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=-.035;floor.receiveShadow=true;scene.add(floor);
let ready=false;
function render(){if(!ready)return;scene.traverse(n=>{if(n.isLOD)n.update(camera);});renderer.render(scene,camera);}
try{
 const hdr=await new RGBELoader().loadAsync('assets/urban-kits/lighting/sky.hdr');hdr.mapping=THREE.EquirectangularReflectionMapping;const pmrem=new THREE.PMREMGenerator(renderer);scene.environment=pmrem.fromEquirectangular(hdr).texture;pmrem.dispose();
 let object,assetId,scale=1;
 if(key==='materials'){
  const mats=await Promise.all([loadSurface('asphalt_02',1.25),loadSurface('concrete_pavement',1.25),loadSurface('leafy_grass',1.25)]);
  object=new THREE.Group();mats.forEach((mat,i)=>{const sphere=new THREE.Mesh(new THREE.SphereGeometry(1,80,48),mat);sphere.position.set((i-1)*2.65,1.16,0);sphere.castShadow=sphere.receiveShadow=true;object.add(sphere);const slab=new THREE.Mesh(new THREE.BoxGeometry(2.3,.1,2.3),mat);slab.position.set((i-1)*2.65,.04,0);slab.receiveShadow=true;object.add(slab);});assetId='asphalt_02 / concrete_pavement / leafy_grass';
 }else if(key==='tree'){
  object=await createVegetation([{x:0,z:0,kind:'street',scale:1}],1847);assetId='tree_small_02 (LOD0)';
 }else if(key==='residential'||key==='brick'){
  assetId=key==='brick'?'modular_factory_facade':'modular_urban_apartments_facade';
  const kit=await new GLTFLoader().loadAsync(`assets/urban-kits/${assetId}/scene.gltf`);prepareFacadeKit(kit.scene);
  if(key==='brick'){
    object=new THREE.Group();
    for(const name of ['wall_window_centered_large_01','window_centered_large_01','cornice02_standard_standard_01']){
      const part=kit.scene.getObjectByName(name).clone(true);part.position.set(0,name.startsWith('cornice')?3:0,0);object.add(part);
    }
    const rear=new THREE.Mesh(new THREE.BoxGeometry(2.3,2.3,.06),new THREE.MeshStandardMaterial({color:0x423f35,roughness:1}));rear.position.set(-1.5,1.2,-.65);object.add(rear);
  }else object=buildModularBuilding(kit.scene,{x:0,z:0,w:9,d:6,floors:5,massing:'setback'},3,false);
 }else{
  assetId=key==='lamp'?'street_lamp_01':'painted_wooden_bench';
  const gltf=await new GLTFLoader().loadAsync(`assets/urban-kits/${assetId}/scene.gltf`);object=gltf.scene;
 }
 object.traverse(n=>{if(n.isMesh){n.castShadow=n.receiveShadow=true;for(const m of [].concat(n.material)){if(m.map)m.map.anisotropy=8;}}});
 scene.add(object);object.updateMatrixWorld(true);
 const bounds=new THREE.Box3().setFromObject(object),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
 object.position.x-=center.x;object.position.z-=center.z;object.position.y-=bounds.min.y;
 const target=new THREE.Vector3(0,size.y*.46,0),extent=Math.max(size.y,size.x/camera.aspect)*1.9;
 const direction=new THREE.Vector3(key==='brick'?.55:key==='tree'?.1:.68,key==='materials'?.72:.3,1).normalize();
 camera.position.copy(target).addScaledVector(direction,extent+size.z*.5);controls.target.copy(target);controls.update();
 sun.position.set(-extent*.6,extent*.9,extent*.7);sun.target.position.copy(target);sun.shadow.camera.far=extent*4+20;sun.shadow.camera.updateProjectionMatrix();
 ready=true;render();
 const report={key,assetId,bounds:size.toArray(),source:'Poly Haven CC0',renderedAt:new Date().toISOString()};
 globalThis.__urbanAsset={ready:true,report,capture(){render();return renderer.domElement.toDataURL('image/png');}};
 document.querySelector('#status').textContent='Asset caricato · PBR';
}catch(error){globalThis.__urbanAsset={ready:false,error:error.message};document.querySelector('#status').textContent=error.message;console.error(error);}
controls.addEventListener('change',render);addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);render();});
