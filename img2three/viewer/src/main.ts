import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {createTwistingGlassSkyscraperModel,createTwistingGlassSkyscraperEnvironment,configureTwistingGlassSkyscraperRenderer} from './generated/createTowerModel.ts';
import {buildArchitecturalRefinement} from './architecturalRefinement.ts';
import {makeCompactPistol} from './compactPistol.ts';
import {makePurplePortedPistol} from './purplePortedPistol.ts';
import {makeLimeGreenCarbine} from './limeCarbine.ts';
import {makeMultiTrunkTree} from './treeModel.ts';
import './style.css';

type AssetKey='tower'|'compact'|'purple'|'rifle'|'tree';
const assets:Array<{id:AssetKey;title:string;subtitle:string;maker:()=>THREE.Group;fov?:number}>= [
 {id:'tower',title:'Glass Tower',subtitle:'45 floors · glass + limestone',maker:()=>{
    const factory=createTwistingGlassSkyscraperModel({textureSize:256,textureAnisotropy:4});
    factory.traverse(o=>{if(o instanceof THREE.Mesh)o.visible=false;});
    const ref=buildArchitecturalRefinement();factory.add(ref.group);factory.userData.stats=ref.stats;return factory;
 },fov:34},
 {id:'compact',title:'Compact Violet',subtitle:'Polymer + matte-black steel',maker:makeCompactPistol,fov:39},
 {id:'purple',title:'Violet Cylinder',subtitle:'Anodized aluminum + polymer',maker:makePurplePortedPistol,fov:36},
 {id:'rifle',title:'Lime Carbine',subtitle:'Green cerakote + black hardware',maker:makeLimeGreenCarbine,fov:39},
 {id:'tree',title:'Multi-trunk Tree',subtitle:'6,300 leaves · 800 grass blades',maker:makeMultiTrunkTree,fov:36},
];
const root=document.getElementById('app')!;
root.innerHTML='<div class="ui"><div class="overline">IMG2THREEJS <span>· INTERACTIVE GALLERY</span></div>'+
'<h1 id="asset-title">Five high-detail 3D models</h1><div class="asset-tabs" id="asset-tabs"></div>'+
'<div class="asset-subtitle" id="asset-subtitle">Loading…</div>'+
'<div class="row"><button id="front">Front</button><button id="threequarter">3/4 view</button>'+
'<button id="side">Side</button><button id="rear">Rear</button><button id="wire">Wireframe</button>'+
'<button id="shot">Screenshot</button></div>'+
'<div class="small-note" id="status">Original photo = visual priority · inferred missing depths · real geometry</div></div>'+
'<div class="bottomhint">Drag to orbit · Wheel/pinch to zoom · Keyboard ← → cycles models</div>';

try {
 const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});
 renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,2));
 renderer.outputColorSpace=THREE.SRGBColorSpace;
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 configureTwistingGlassSkyscraperRenderer(renderer);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.07;
 root.append(renderer.domElement);
 const scene=new THREE.Scene();scene.background=new THREE.Color('#e9edf2');
 scene.environment=createTwistingGlassSkyscraperEnvironment(renderer);
 const camera=new THREE.PerspectiveCamera(37,innerWidth/innerHeight,.01,400);
 const controls=new OrbitControls(camera,renderer.domElement);
 controls.enableDamping=true;controls.dampingFactor=.075;controls.minDistance=.9;controls.maxDistance=120;
 const hemi=new THREE.HemisphereLight(0xf4f8ff,0xa8aab1,2);scene.add(hemi);
 const key=new THREE.DirectionalLight(0xffffff,3.2);key.position.set(-5,12,10);key.castShadow=true;
 key.shadow.mapSize.set(2048,2048);key.shadow.bias=-.0002;key.shadow.normalBias=.015;
 key.shadow.camera.left=-14;key.shadow.camera.right=14;key.shadow.camera.top=17;key.shadow.camera.bottom=-14;
 key.shadow.camera.near=.5;key.shadow.camera.far=80;scene.add(key);
 const fill=new THREE.DirectionalLight(0xc0dafa,1.25);fill.position.set(9,7,3);scene.add(fill);
 const rim=new THREE.DirectionalLight(0xffffff,1.1);rim.position.set(3,10,-8);scene.add(rim);
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(250,250),new THREE.MeshStandardMaterial({color:'#e7ebef',roughness:.85,metalness:0}));
 ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);
 const tabs=document.getElementById('asset-tabs')!;
 let current:THREE.Group|null=null, currentKey:AssetKey='tower',modelCenter=new THREE.Vector3(),cameraDistance=16,wire=false;
 let firstReady=false;
 const cache=new Map<AssetKey,THREE.Group>();
 function getModel(which:AssetKey){if(!cache.has(which)){const entry=assets.find(x=>x.id===which)!;cache.set(which,entry.maker());}return cache.get(which)!;}
 function front(){placeView('front')}
 function fit(){
   if(!current)return;
   const bounds=new THREE.Box3().setFromObject(current);const size=bounds.getSize(new THREE.Vector3());
   modelCenter=bounds.getCenter(new THREE.Vector3());
   camera.fov=assets.find(x=>x.id===currentKey)!.fov??38;camera.updateProjectionMatrix();
   const vFOV=camera.fov*Math.PI/180,hFOV=2*Math.atan(Math.tan(vFOV/2)*camera.aspect);
   const fitY=size.y/(2*Math.tan(vFOV/2)),fitX=size.x/(2*Math.tan(hFOV/2));
   cameraDistance=Math.max(fitY,fitX,size.z*1.6)*1.45+size.z*.5;
   cameraDistance*=innerWidth<700?1.12:1;
   controls.target.copy(modelCenter);controls.minDistance=Math.max(size.length()*.08,.6);
   controls.maxDistance=cameraDistance*5;front();ground.position.y=bounds.min.y-.095;
   key.shadow.camera.left=Math.min(-14,-size.length());key.shadow.camera.right=-key.shadow.camera.left;
   key.shadow.camera.bottom=key.shadow.camera.left;key.shadow.camera.top=key.shadow.camera.right;
   key.shadow.camera.updateProjectionMatrix();
 }
 function placeView(type:'front'|'angle'|'side'|'back'){
   const d=cameraDistance;
   if(type==='front')camera.position.copy(modelCenter).add(new THREE.Vector3(0,Math.max(.07,d*.025),d));
   if(type==='angle')camera.position.copy(modelCenter).add(new THREE.Vector3(d*.64,d*.21,d*.93));
   if(type==='side')camera.position.copy(modelCenter).add(new THREE.Vector3(d,Math.max(.07,d*.02),0));
   if(type==='back')camera.position.copy(modelCenter).add(new THREE.Vector3(0,Math.max(.07,d*.025),-d));
   camera.lookAt(modelCenter);controls.update();
 }
 function choose(which:AssetKey){
    if(current)scene.remove(current);currentKey=which;current=getModel(which);
    scene.add(current);wire=false;setWire(false);fit();
    const entry=assets.find(x=>x.id===which)!;
    document.getElementById('asset-title')!.textContent=entry.title;
    document.getElementById('asset-subtitle')!.textContent=entry.subtitle;
    document.getElementById('status')!.textContent='True geometry · reference view prioritized · unseen sides estimated';
    [...tabs.children].forEach(n=>(n as HTMLElement).classList.toggle('active',(n as HTMLElement).dataset.id===which));
    (window as any).__threeStats={model:which,meshCount:countMeshes(current),instances:countInstances(current),version:'reference-gallery-1'};
    (window as any).__threeReady=true;(window as any).__activeModel=which;firstReady=false;
 }
 function countMeshes(group:THREE.Object3D){let n=0;group.traverse(o=>{if(o instanceof THREE.Mesh && o.visible)n++});return n;}
 function countInstances(group:THREE.Object3D){let n=0;group.traverse(o=>{if(o instanceof THREE.InstancedMesh && o.visible)n+=o.count});return n;}
 function setWire(on:boolean){
   if(!current)return;
   current.traverse(o=>{if(o instanceof THREE.Mesh){
      const mats=Array.isArray(o.material)?o.material:[o.material];mats.forEach(m=>{if(m instanceof THREE.MeshStandardMaterial)m.wireframe=on;});
   }});
 }
 for(const entry of assets){const btn=document.createElement('button');btn.textContent=entry.title;btn.dataset.id=entry.id;btn.className='model-tab';btn.onclick=()=>choose(entry.id);tabs.append(btn);}
 document.getElementById('front')!.onclick=()=>placeView('front');
 document.getElementById('threequarter')!.onclick=()=>placeView('angle');
 document.getElementById('side')!.onclick=()=>placeView('side');
 document.getElementById('rear')!.onclick=()=>placeView('back');
 document.getElementById('wire')!.onclick=()=>{wire=!wire;setWire(wire);};
 document.getElementById('shot')!.onclick=()=>{
   renderer.render(scene,camera);const a=document.createElement('a');a.download='img2threejs-'+currentKey+'.png';
   a.href=renderer.domElement.toDataURL('image/png');a.click();
 };
 window.addEventListener('keydown',e=>{
    if(e.key==='ArrowRight'||e.key==='ArrowLeft'){
      const i=assets.findIndex(a=>a.id===currentKey),next=(i+(e.key==='ArrowRight'?1:assets.length-1))%assets.length;
      choose(assets[next].id);
    }
 });
 window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);fit();});
 choose('tower');
 function render(){requestAnimationFrame(render);controls.update();renderer.render(scene,camera);if(!firstReady){firstReady=true;(window as any).__firstRenderComplete=true;}}
 render();
 (window as any).__chooseAsset=choose;
} catch(e){console.error(e);const div=document.createElement('pre');div.className='error';div.textContent='3D rendering error: '+String(e);root.append(div);(window as any).__threeError=String(e);}
