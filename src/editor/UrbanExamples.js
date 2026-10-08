import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { prepareFacadeKit,buildModularBuilding,instanceArchitecture } from './UrbanArchitecture.js';
import { photographicLighting,loadSurface,metricUV,captureStreetReflections } from './UrbanLighting.js';
import { createVegetation } from './UrbanVegetation.js';
import { createStreetProps } from './UrbanProps.js';
const query=new URLSearchParams(location.search),variant=query.get('variant')||'residential';
const variants={residential:['01 · Strada residenziale','Facciate profonde, balconi e arredi con materiali fotografici.'],industrial:['02 · Quartiere industriale','Mattoni, serramenti in metallo e architettura modulare.'],courtyard:['03 · Corte verde','Edifici misti, vegetazione e percorsi pedonali.']};
const [title,description]=variants[variant]||variants.residential;
document.querySelector('#title').textContent=title;document.querySelector('#description').textContent=description;
const scene=new THREE.Scene(),renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});
renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(1);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;document.body.appendChild(renderer.domElement);
const camera=new THREE.PerspectiveCamera(52,innerWidth/innerHeight,.12,500);camera.position.set(18,2,25);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(-8,5,-9);controls.update();
const world={renderer,camera,graphicsWorld:scene,composer:new EffectComposer(renderer),sky:{setPhotographic(){}}};
let ready=false,vegetation;
function render(){if(!ready)return;world.urbanLighting.update();vegetation.children.forEach(lod=>lod.update(camera));world.composer.render();}
function box(w,h,d,x,y,z,mat){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);mesh.position.set(x,y,z);metricUV(mesh);mesh.castShadow=mesh.receiveShadow=true;scene.add(mesh);return mesh;}
try{
 const loader=new GLTFLoader();
 const [apartments,factory,road,pavement,grass]=await Promise.all([
  loader.loadAsync('assets/urban-kits/modular_urban_apartments_facade/scene.gltf'),loader.loadAsync('assets/urban-kits/modular_factory_facade/scene.gltf'),
  loadSurface('asphalt_02',3,0xbababa),loadSurface('concrete_pavement',3,0xd6d1c6),loadSurface('leafy_grass',2,0x91a27b),photographicLighting(world)
 ]);
 prepareFacadeKit(apartments.scene);prepareFacadeKit(factory.scene);
 box(180,.3,180,0,-.25,0,pavement);box(110,.1,12,0,.05,12,road);
 for(const z of [3.6,20.4])box(110,.18,4.6,0,.09,z,pavement);
 const curb=new THREE.MeshStandardMaterial({color:0x858074,roughness:.9}),paint=new THREE.MeshStandardMaterial({color:0xc8c5b9,roughness:.9});
 for(const z of [5.96,18.04])for(let x=-54;x<55;x+=1.2)box(1.18,.16,.24,x,.16,z,curb);
 for(let x=-49;x<51;x+=7)box(2.8,.007,.11,x,.105,12,paint);
 for(let i=0;i<7;i++)box(.42,.008,10.6,-12+i*.7,.105,12,paint);
 const buildings=[],assembly=new THREE.Group();
 function building(x,z,bays,floors,industrial=false,angle=0){const b={x,z,w:bays*3,d:12,floors,ground:0,massing:['setback','corner','slab','courtyard','crown'][buildings.length%5]};const g=buildModularBuilding(industrial?factory.scene:apartments.scene,b,buildings.length,industrial);g.rotation.y=angle;assembly.add(g);buildings.push(b);}
 if(variant==='industrial')for(let i=0;i<3;i++){building((i-1)*27,-7,7,3+i,true);building((i-1)*27,-29,7,4,true);}
 else if(variant==='courtyard'){
  building(-26,-10,6,5,false,Math.PI/2);building(26,-10,6,5,false,-Math.PI/2);building(0,-34,8,3,true);
  box(32,.1,26,0,.08,-12,grass);box(2,.13,26,0,.17,-12,pavement);box(32,.13,2,0,.17,-10,pavement);
  camera.position.set(22,10,32);controls.target.set(0,4,-10);controls.update();
 }else for(let i=0;i<5;i++){building((i-2)*21,-7,6,4+i%3);building((i-2)*21,-29,6,5,i%2===0);}
 scene.add(instanceArchitecture(assembly));
 const positions=variant==='courtyard'?[[-11,-3],[11,-3],[-11,-17],[11,-17],[-10,-24],[10,-24],[-40,3],[40,3]]:[[-35,3],[-14,3],[9,3],[32,3],[-40,22],[-18,22],[8,22],[34,22]];
 vegetation=await createVegetation(positions.map(([x,z])=>({x,z,kind:'street',scale:1})),1847);scene.add(vegetation);
 const soil=new THREE.MeshStandardMaterial({color:0x38382a,roughness:1});
 for(const [x,z]of positions){box(1.6,.025,1.6,x,.19,z,soil);for(const side of [-1,1]){box(1.8,.09,.1,x,.215,z+side*.85,curb);box(.1,.09,1.6,x+side*.85,.215,z,curb);}}
 const props=await createStreetProps({buildings,lamps:[-43,-22,0,22,43].map(x=>({x,z:4.8}))},{seed:1847,terrain:'flat',blockSize:42});scene.add(props.layer);
 captureStreetReflections(world,scene);
 const report={variant,buildings:buildings.length,trees:positions.length,localKits:5,props:props.instances,renderer:'Shared runtime PBR / HDR / SSAO'};
 ready=true;globalThis.__urbanExample={ready:true,report,render};
 globalThis.__urbanExampleCapture=(position,target)=>{camera.position.set(...position);controls.target.set(...target);camera.lookAt(...target);camera.updateMatrixWorld(true);render();return renderer.domElement.toDataURL('image/png');};
 document.querySelector('#status').textContent=`${buildings.length} edifici · ${positions.length} alberi · ${props.instances} arredi`;
 render();
}catch(error){globalThis.__urbanExample={ready:false,error:error.message};document.querySelector('#status').textContent=error.message;console.error(error);}
controls.addEventListener('end',render);
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);render();});
