
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  createTwistingGlassSkyscraperModel,
  createTwistingGlassSkyscraperLookDevLights,
  createTwistingGlassSkyscraperEnvironment,
  configureTwistingGlassSkyscraperRenderer,
} from '../../output/createTowerModel.ts';
import './style.css';

const host = document.getElementById('app')!;
host.innerHTML = `
<header><h1>img2threejs / Twisting Glass Skyscraper</h1>
<p>Original upstream Three.js factory • Generated from a reference image • Blockout review</p>
<p id="status">Initializing WebGL...</p>
<div class="row"><button id="front">Front</button><button id="orbit">3/4 view</button><button id="side">Side</button><button id="wire">Wireframe</button><button id="shot">Screenshot</button></div>
</header><div class="credit">Drag to orbit · Wheel/pinch to zoom</div>`;
try {
  const scene = new THREE.Scene(); scene.background=new THREE.Color('#eef1f6');
  const camera = new THREE.PerspectiveCamera(38,innerWidth/innerHeight,0.02,150);
  const renderer = new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
  renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;configureTwistingGlassSkyscraperRenderer(renderer);
  host.appendChild(renderer.domElement);
  scene.environment = createTwistingGlassSkyscraperEnvironment(renderer);
  const model=createTwistingGlassSkyscraperModel({textureSize:512,textureAnisotropy:4});
  scene.add(model);
  scene.add(createTwistingGlassSkyscraperLookDevLights('neutral'));
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(80,80),new THREE.MeshStandardMaterial({color:'#e1e5eb',roughness:.85}));
  ground.rotation.x=-Math.PI/2; ground.position.y=-5.1;ground.receiveShadow=true;scene.add(ground);
  const bbox=new THREE.Box3().setFromObject(model),center=bbox.getCenter(new THREE.Vector3()),size=bbox.getSize(new THREE.Vector3());
  const radius=Math.max(9,size.length()*1.15);
  camera.position.set(center.x+radius*0.28,center.y+radius*0.08,center.z+radius*1.18);
  camera.lookAt(center);
  const controls=new OrbitControls(camera,renderer.domElement);controls.target.copy(center);controls.enableDamping=true;
  controls.minDistance=2;controls.maxDistance=80;controls.update();
  function cameraView(x:number,y:number,z:number){camera.position.set(center.x+x,center.y+y,center.z+z);camera.lookAt(center);controls.update()}
  document.getElementById('front')!.onclick=()=>cameraView(0,1,radius*1.15);
  document.getElementById('orbit')!.onclick=()=>cameraView(radius*.28,radius*.08,radius*1.18);
  document.getElementById('side')!.onclick=()=>cameraView(radius*1.15,1,0);
  let wire=false; document.getElementById('wire')!.onclick=()=>{
    wire=!wire; model.traverse(o=>{if(o instanceof THREE.Mesh){const mats=Array.isArray(o.material)?o.material:[o.material];mats.forEach(m=>{if(m instanceof THREE.MeshStandardMaterial)m.wireframe=wire;})}});
  };
  document.getElementById('shot')!.onclick=()=>{const link=document.createElement('a');link.download='img2threejs-tower.png';link.href=renderer.domElement.toDataURL('image/png');link.click()};
  const meshCount=Object.keys(model.userData.sculptRuntime?.meshes||{}).length;
  document.getElementById('status')!.textContent=`Loaded ${meshCount} native generated parts · ${Math.round(size.y*100)/100} units tall`;
  (window as any).__threeReady=true; (window as any).__threeStats={meshCount,height:size.y};
  window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
  function tick(){requestAnimationFrame(tick);controls.update();renderer.render(scene,camera)}tick();
} catch(error) {
  console.error(error);
  const el=document.createElement('div');el.className='error';el.textContent='Three.js failed: '+String(error);host.appendChild(el);
  (window as any).__threeError=String(error);
}
