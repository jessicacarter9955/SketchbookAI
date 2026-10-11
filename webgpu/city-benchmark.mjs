import * as THREE from 'three/webgpu';
import {generateUrbanPlan,DEFAULT_URBAN} from '../src/editor/urban-data.mjs';
import {urbanNetworks} from '../src/editor/urban-navigation.mjs';

const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
const requested=params.get('backend')==='webgl2'?'webgl2':'webgpu';
$('gpu').setAttribute('aria-current',requested==='webgpu'?'page':'false');
$('gl2').setAttribute('aria-current',requested==='webgl2'?'page':'false');
const boot=message=>{$('boot').textContent=message;$('status').textContent=message;};
const state={ready:false,requested,actual:'initializing',threeRevision:THREE.REVISION,
  source:'Sketchbook generateUrbanPlan DEFAULT_URBAN, seed 42',frames:[],
  fps:0,p50:0,p95:0,ms:0,objects:0,drawCalls:0,triangles:0,pixelRatio:1,
  missingAssets:[],errors:[],renderer:'WebGPURenderer'};
globalThis.__sketchbookWebGpuBench=state;
let renderer=null;
const base=DEFAULT_URBAN,plan=generateUrbanPlan(base);
const scene=new THREE.Scene();scene.background=new THREE.Color(0xb6c9d2);
scene.fog=new THREE.FogExp2(0xa8bec9,.0031);
const camera=new THREE.PerspectiveCamera(72,innerWidth/innerHeight,.07,850);
camera.position.set(plan.spawns[0].position[0],2.2,plan.spawns[0].position[2]);
scene.add(new THREE.HemisphereLight(0xd9eafb,0x777c60,2.3));
const sun=new THREE.DirectionalLight(0xfff4dc,2.9);
sun.position.set(60,110,45);scene.add(sun);
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const material=(color,extra={})=>new THREE.MeshStandardMaterial({color,roughness:.82,metalness:.04,...extra});
const unitBox=new THREE.BoxGeometry(1,1,1);
const identity=new THREE.Quaternion();
const matrix=new THREE.Matrix4(),pos=new THREE.Vector3(),scale=new THREE.Vector3();
function applyTransform(mesh,i,x,y,z,w,h,d){
  matrix.compose(pos.set(x,y,z),identity,scale.set(w,h,d));
  mesh.setMatrixAt(i,matrix);
}
function createBatch(name,items,mat,geometry=unitBox,shadows=false){
  if(!items.length)return null;
  const inst=new THREE.InstancedMesh(geometry,mat,items.length);
  inst.name=name;inst.castShadow=shadows;inst.receiveShadow=true;
  items.forEach((a,i)=>applyTransform(inst,i,...a));
  inst.instanceMatrix.needsUpdate=true;
  inst.computeBoundingSphere();
  scene.add(inst);state.objects+=items.length;
  return inst;
}
function facadeTexture(colors) {
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
  const c=canvas.getContext('2d');
  c.fillStyle=colors[0];c.fillRect(0,0,256,256);
  for(let y=0;y<8;y++)for(let x=0;x<6;x++){
    const lit=((x*13+y*7)%17)<2;
    c.fillStyle=colors[1];c.fillRect(x*42+5,y*32+4,33,25);
    c.fillStyle=lit?'#e8cba0':colors[2];c.fillRect(x*42+8,y*32+6,27,21);
    c.fillStyle='#ffffff22';c.fillRect(x*42+10,y*32+7,2,18);
  }
  const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;
  t.anisotropy=4;return t;
}
async function loadTexture(url,color=true){
  try{
    const texture=await new THREE.TextureLoader().loadAsync(url);
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
    texture.repeat.set(6,6);texture.anisotropy=4;
    if(color)texture.colorSpace=THREE.SRGBColorSpace;
    return texture;
  }catch(e){
    state.missingAssets.push(url+' '+String(e.message||e));
    return null;
  }
}
function createWorld(asphalt,concrete){
  boot('Costruzione isolati, carreggiate e vegetazione; seed '+base.seed);
  const road=material(0x999999,asphalt?{map:asphalt}:{color:0x35383b,roughness:.94});
  const paving=material(0xb7b6ad,concrete?{map:concrete}:{}); 
  const grass=material(0x587549);
  const ground=new THREE.Mesh(new THREE.BoxGeometry(900,.3,900),grass);
  ground.position.y=-.45;ground.receiveShadow=true;scene.add(ground);
  // Same road centres, block size, parks and building footprint plan as WebGL city.
  createBatch('Original city road plan',plan.roads.map(r=>[
    r.axis==='x'?0:r.x,.035,r.axis==='x'?r.z:0,
    r.axis==='x'?r.length:r.width,.10,r.axis==='z'?r.length:r.width
  ]),road);
  const sidewalk=[];
  for(let x=0;x<base.blocksX;x++)for(let z=0;z<base.blocksZ;z++){
    const cx=-base.blocksX*base.blockSize/2+(x+.5)*base.blockSize;
    const cz=-base.blocksZ*base.blockSize/2+(z+.5)*base.blockSize;
    const size=base.blockSize-base.roadWidth;
    sidewalk.push([cx,.14,cz,size,.18,size]);
  }
  createBatch('Original city sidewalk plan',sidewalk,paving);
  const styles={
    glass:material(0xd1e8ee,{map:facadeTexture(['#19303b','#9fbfcc','#294b63']),metalness:.36,roughness:.24}),
    office:material(0xb9bbba,{map:facadeTexture(['#525f67','#b5bdc2','#25333d'])}),
    brick:material(0xc6b0a5,{map:facadeTexture(['#745a51','#dfc9b8','#302e36'])}),
    stone:material(0xc4c6c0,{map:facadeTexture(['#747e7a','#bbbdb5','#40515a'])})
  };
  for(const style of Object.keys(styles)){
    createBatch('City '+style+' buildings',plan.buildings.filter(b=>b.style===style).map(b=>[
      b.x,b.height*.5+.18,b.z,b.w,b.height,b.d
    ]),styles[style]);
  }
  createBatch('Original city rooftops',plan.buildings.map(b=>[
    b.x,b.height+.42,b.z,b.w*.76,.4,b.d*.76
  ]),material(0x555f61));
  // A single draw call for repeated sidewalk trees; original positions and density.
  const trunkGeometry=new THREE.CylinderGeometry(.14,.22,1,7);
  createBatch('Tree trunks',plan.trees.map(t=>[t.x,1.25*(t.scale||1),t.z,
    t.scale||1,2.5*(t.scale||1),t.scale||1]),material(0x614938),trunkGeometry);
  const crownGeometry=new THREE.IcosahedronGeometry(1,1);
  createBatch('Tree canopies',plan.trees.map(t=>[t.x,3.6*(t.scale||1),t.z,
    2.25*(t.scale||1),2.7*(t.scale||1),2.25*(t.scale||1)]),material(0x3d6543),crownGeometry);
  createBatch('City lamp posts',plan.lamps.map(l=>[l.x,2.45,l.z,.13,4.7,.13]),material(0x353b3e));
  const net=urbanNetworks(base);
  const carCount=20,carBody=new THREE.InstancedMesh(unitBox,material(0x366c9d,{metalness:.35,roughness:.3}),carCount);
  carBody.name='Traffic visual simulation';
  scene.add(carBody);state.objects+=carCount;
  return {net,carBody,carCount};
}
const keys=new Set();
const queryKeys=new URLSearchParams(location.search);
const touchButtons=[...document.querySelectorAll('[data-key]')];
touchButtons.forEach(b=>{
  b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);keys.add(b.dataset.key);});
  for(const kind of ['pointerup','pointercancel','lostpointercapture'])
    b.addEventListener(kind,()=>keys.delete(b.dataset.key));
});
addEventListener('keydown',e=>{if(/^(Key[WASD]|Arrow(Up|Down|Left|Right))$/.test(e.code)){keys.add(e.code);e.preventDefault();}});
addEventListener('keyup',e=>keys.delete(e.code));
addEventListener('blur',()=>keys.clear());
let yaw=Math.PI*.1,pitch=-.08,dragging=false,lastX=0,lastY=0;
addEventListener('pointerdown',e=>{if(e.target.tagName==='CANVAS'){dragging=true;lastX=e.clientX;lastY=e.clientY;}});
addEventListener('pointermove',e=>{if(!dragging)return;yaw-=(e.clientX-lastX)*.004;pitch=clamp(pitch-(e.clientY-lastY)*.003,-1.22,1.22);lastX=e.clientX;lastY=e.clientY;});
addEventListener('pointerup',()=>dragging=false);
$('toggle').addEventListener('click',()=>{
  const collapsed=$('hud').classList.toggle('collapsed');
  $('toggle').textContent=collapsed?'Mostra dettagli':'Nascondi dettagli';
});
$('copy').onclick=()=>{
  const report=JSON.stringify({...state,frames:state.frames.slice(-400),camera:camera.position.toArray()},null,2);
  navigator.clipboard.writeText(report).then(()=>$('copy').textContent='Copiato').catch(()=>{console.info(report);$('copy').textContent='Report nella console';});
};
const pctl=vs=>Number((vs||0).toFixed(2));
const percentile=(arr,p)=>{
  if(!arr.length)return 0;
  const sorted=arr.slice().sort((a,b)=>a-b);
  return sorted[Math.min(sorted.length-1,Math.max(0,Math.ceil(sorted.length*p)-1))];
};
let previous=0,lastReport=0,frameCount=0,clock=0;
function animate(now,world){
  if(!previous){previous=now;return;}
  const rawDt=(now-previous)/1000;previous=now;
  const dt=clamp(rawDt,0,.05);
  frameCount++;clock+=dt;
  // Controls are intentionally identical in both backend selections.
  const turning=(keys.has('ArrowRight')?1:0)-(keys.has('ArrowLeft')?1:0);
  yaw+=turning*dt*1.65;
  const forward=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0);
  const strafe=(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0);
  camera.position.x+=(Math.sin(yaw)*forward+Math.cos(yaw)*strafe)*dt*11;
  camera.position.z+=(-Math.cos(yaw)*forward+Math.sin(yaw)*strafe)*dt*11;
  camera.rotation.order='YXZ';camera.rotation.set(pitch,yaw,0);
  const forwardMat=new THREE.Matrix4(),carScale=new THREE.Vector3(2,1,4),q=new THREE.Quaternion();
  // Same lightweight ambient cars for both backends.
  for(let i=0;i<world.carCount;i++){
    const segment=world.net.roads[(i*19+7)%world.net.roads.length];
    const t=((clock*(5+i%4)/segment.length+(i*.19)%1)%1);
    const x=segment.a.x+(segment.b.x-segment.a.x)*t;
    const z=segment.a.z+(segment.b.z-segment.a.z)*t;
    q.setFromAxisAngle(new THREE.Vector3(0,1,0),Math.atan2(segment.b.x-segment.a.x,segment.b.z-segment.a.z));
    forwardMat.compose(pos.set(x,.76,z),q,carScale);
    world.carBody.setMatrixAt(i,forwardMat);
  }
  world.carBody.instanceMatrix.needsUpdate=true;
  renderer.render(scene,camera);
  if(rawDt>0&&rawDt<1.5){
    state.frames.push(Math.round(rawDt*100000)/100);
    if(state.frames.length>420)state.frames.shift();
  }
  if(now-lastReport<2500)return;
  lastReport=now;
  const recent=state.frames.slice(-150);
  const average=recent.length?recent.reduce((sum,ms)=>sum+ms,0)/recent.length:0;
  state.fps=pctl(average?1000/average:0);
  state.p50=pctl(percentile(recent,.50));state.p95=pctl(percentile(recent,.95));
  state.ms=pctl(average);state.pixelRatio=renderer.getPixelRatio();
  state.drawCalls=renderer.info.render.calls;state.triangles=renderer.info.render.triangles;
  $('fps').textContent=state.fps+' FPS · P95 '+state.p95+' ms';
  $('status').textContent='Backend effettivo: '+state.actual+'\nThree.js r'+THREE.REVISION+
    ' · pixel ratio '+state.pixelRatio+'\n'+state.objects+' oggetti instanziati · draw calls '+state.drawCalls+
    '\nGeometrie '+renderer.info.memory.geometries+' · texture '+renderer.info.memory.textures+
    '\nFrame P50 '+state.p50+' ms · P95 '+state.p95+' ms'+
    (state.missingAssets.length?'\nTexture sostitutive: '+state.missingAssets.join('; '):'');
}
try{
  boot('Inizializzo WebGPURenderer r'+THREE.REVISION+'…');
  renderer=new THREE.WebGPURenderer({antialias:true,samples:2,
    forceWebGL:requested==='webgl2',powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
  renderer.setSize(innerWidth,innerHeight);
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.05;
  await renderer.init();
  state.actual=renderer.backend?.isWebGPUBackend?'WebGPU':renderer.backend?.isWebGLBackend?'WebGL2 fallback':'backend non identificato';
  const fallback=requested==='webgpu'&&!renderer.backend?.isWebGPUBackend;
  $('backend').textContent=(fallback?'WebGPU NON attivo → ':'')+'Renderer reale: '+state.actual;
  $('backend').style.color=fallback?'#ffcd7a':'#abf0d9';
  boot('Backend '+state.actual+' pronto. Recupero materiali originali…');
  const textures=await Promise.all([
    loadTexture('assets/roadforge/T_RF_Asphalt_BC.png'),
    loadTexture('assets/roadforge/T_RF_Concrete_BC.png')
  ]);
  const world=createWorld(...textures);
  renderer.domElement.setAttribute('aria-label','City 3D WebGPU o WebGL2');
  document.body.insertBefore(renderer.domElement,$('hud'));
  const resize=()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);};
  addEventListener('resize',resize);
  state.ready=true;
  $('loading').hidden=true;
  renderer.setAnimationLoop(now=>animate(now,world));
}catch(error){
  state.errors.push(String(error?.stack||error));
  $('loading').hidden=false;
  $('boot').textContent='Backend sperimentale non avviato: '+String(error?.message||error);
  $('status').textContent='ERRORE: '+String(error?.stack||error);
  $('backend').textContent='Errore inizializzazione '+requested;
  console.error('[CITY WEBGPU EXPERIMENT]',error);
}
