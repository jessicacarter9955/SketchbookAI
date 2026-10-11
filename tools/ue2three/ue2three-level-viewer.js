import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const params = new URLSearchParams(location.search);
const model = params.get('model') || '';
const title = params.get('title') || 'Mappa Unreal migrata';
const status = document.querySelector('#status');
document.querySelector('#title').textContent = title;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.physicallyCorrectLights = true;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.querySelector('#view').append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x182430);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.01, 100000);
camera.position.set(8, 7, 8);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
let importedScene = null;
window.__ue2threeAudit = {ready:false, error:null};
const ambient = new THREE.HemisphereLight(0xffffff, 0x8090a0, 1.5);
scene.add(ambient);
// glTF has no SkyLight reflection capture. A neutral, explicitly approximate
// environment keeps reflective surfaces visible without changing source PBR values.
const reflectionScene = new THREE.Scene();
reflectionScene.background = new THREE.Color(0.25, 0.25, 0.25);
const pmrem = new THREE.PMREMGenerator(renderer);
const reflectionTarget = pmrem.fromScene(reflectionScene, 0);
scene.environment = reflectionTarget.texture;
pmrem.dispose();
const key = new THREE.DirectionalLight(0xffedcf, 2.2);
key.position.set(8, 15, 9);

function fit(object) {
  const bounds = new THREE.Box3().setFromObject(object);
  if (bounds.isEmpty()) return;
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z, 1) * 0.5;
  const distance = radius / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(distance * 0.85, distance * 0.65, distance * 0.85));
  camera.near = Math.max(0.01, distance / 10000);
  camera.far = Math.max(10000, distance * 20);
  camera.updateProjectionMatrix();
  controls.update();
}

async function openModel() {
  if (!model.startsWith('build/local-scenes/ue2three/projects/') || model.includes('..')) {
    throw new Error('Percorso del modello non valido. Riapri la scena dal Migration Manager.');
  }
  const gltf = await new GLTFLoader().loadAsync('/' + model);
  importedScene = gltf.scene;
  scene.add(gltf.scene);
  const bounds = new THREE.Box3().setFromObject(gltf.scene);
  const radius = Math.max(10,bounds.getSize(new THREE.Vector3()).length()*0.5);
  let sourceDirectional = false;
  gltf.scene.traverse(node => {
    if(node.isMesh) { node.castShadow=true; node.receiveShadow=true; }
    if(node.isDirectionalLight) {
      sourceDirectional=true; node.castShadow=true;
      node.shadow.mapSize.set(2048,2048);
      Object.assign(node.shadow.camera,{left:-radius,right:radius,top:radius,bottom:-radius,near:0.1,far:radius*6});
      node.shadow.bias=-0.00005; node.shadow.normalBias=0.08;
    }
  });
  // glTF does not carry Unreal SkyLight capture/Lumen. Keep this modest ambient
  // fallback explicit; the authored punctual lights provide direct illumination.
  if(!sourceDirectional) scene.add(key);
  fit(gltf.scene);
  if(params.get('view')==='ground') window.__ue2threeAudit.setView('ground');
  status.textContent = 'Scena caricata · trascina per ruotare, rotella per zoom. Illuminazione ambiente approssimata; fedeltà in verifica.';
  window.__ue2threeAudit.ready = true;
}

openModel().catch(error => {
  status.classList.add('error');
  status.textContent = `Caricamento non riuscito: ${error.message}`;
  window.__ue2threeAudit.error = error.message;
});

window.__ue2threeAudit.stats = () => {
  const bounds = new THREE.Box3().setFromObject(importedScene);
  let meshes=0, lights=0, landscapeVertices=0, invalidVertices=0;
  const materials=new Set(), textures=new Set();
  importedScene.traverse(node => {
    if(node.isLight) lights++;
    if(!node.isMesh) return;
    meshes++;
    for(const material of Array.isArray(node.material)?node.material:[node.material]) {
      materials.add(material);
      for(const value of Object.values(material)) if(value?.isTexture) textures.add(value);
    }
    const pos=node.geometry.attributes.position;
    for(let i=0;i<pos.count;i++) if(!Number.isFinite(pos.getX(i)+pos.getY(i)+pos.getZ(i))) invalidVertices++;
    if(/LandscapeComponent/.test(node.name)) landscapeVertices+=pos.count;
  });
  return {meshes, materials:materials.size,textures:textures.size,source_lights:lights,landscape_vertices:landscapeVertices,
    invalid_vertices:invalidVertices,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},shadows:renderer.shadowMap.enabled};
};
window.__ue2threeAudit.setView = view => {
  if(view==='overview') { fit(importedScene); return; }
  const spawn=importedScene.getObjectByName('BP_PlayerSpawnPoint') || importedScene.getObjectByName('PlayerStart');
  if(view==='ground'&&spawn) {
    const p=spawn.getWorldPosition(new THREE.Vector3());p.y+=1.7;
    const direction=new THREE.Vector3(1,0,0).applyQuaternion(spawn.getWorldQuaternion(new THREE.Quaternion()));
    camera.position.copy(p);controls.target.copy(p).addScaledVector(direction,8);controls.update();renderer.render(scene,camera);return;
  }
  // Pick a textured nearby object without relying on project-specific actor names.
  const sceneBounds=new THREE.Box3().setFromObject(importedScene);
  const anchor=spawn ? spawn.getWorldPosition(new THREE.Vector3()) : sceneBounds.getCenter(new THREE.Vector3());
  let focus=null, nearest=Infinity;
  const sample=document.createElement('canvas');sample.width=sample.height=8;
  const context=sample.getContext('2d',{willReadFrequently:true});
  const chromaCache=new Map();
  const chroma=material=>{
    if(chromaCache.has(material.map)) return chromaCache.get(material.map);
    try {
      context.clearRect(0,0,8,8);context.drawImage(material.map.image,0,0,8,8);
      const data=context.getImageData(0,0,8,8).data, rgb=[0,0,0];
      for(let i=0;i<data.length;i+=4) for(let c=0;c<3;c++) rgb[c]+=data[i+c];
      const value=(Math.max(...rgb)-Math.min(...rgb))/Math.max(1,...rgb);
      chromaCache.set(material.map,value);return value;
    } catch { return 0; }
  };
  importedScene.traverse(node => {
    if((!node.isMesh && !node.children.length) || /LandscapeComponent/.test(node.name)) return;
    const materials=[];
    node.traverse(child=>{if(child.isMesh) materials.push(...(Array.isArray(child.material)?child.material:[child.material]));});
    if(!materials.some(material=>material.map)) return;
    const box=new THREE.Box3().setFromObject(node), dimensions=box.getSize(new THREE.Vector3()), diameter=dimensions.length();
    if(Math.min(dimensions.x,dimensions.y,dimensions.z)<0.5 || diameter<1 || diameter>15) return;
    const distance=box.getCenter(new THREE.Vector3()).distanceTo(anchor);
    // Prefer a colored prop over a nearby wall, with distance as a stable tie-break.
    const allTextured=materials.every(material=>material.map);
    const compact=Math.max(dimensions.x,dimensions.y,dimensions.z)/Math.min(dimensions.x,dimensions.y,dimensions.z)<5 && diameter<10;
    const score=distance+(materials.some(material=>material.map && chroma(material)>0.22)?0:1000)
      +(allTextured && compact?0:2000);
    if(score<nearest) { nearest=score; focus=node; }
  });
  focus=focus || importedScene;
  const bounds=new THREE.Box3().setFromObject(focus), center=bounds.getCenter(new THREE.Vector3());
  if(focus===importedScene) center.y=Math.max(0,bounds.max.y*0.05);
  const radius=focus===importedScene?15:Math.max(3,bounds.getSize(new THREE.Vector3()).length()*0.7);
  const offset=view==='ground'?new THREE.Vector3(radius,1.7,radius):new THREE.Vector3(radius,radius*0.7,radius);
  if(focus!==importedScene && view==='detail') {
    const raycaster=new THREE.Raycaster();
    for(let i=0;i<16;i++) {
      const angle=i*Math.PI/8;
      const candidate=new THREE.Vector3(Math.cos(angle)*radius,radius*0.7,Math.sin(angle)*radius);
      const origin=center.clone().add(candidate), direction=candidate.clone().negate().normalize();
      raycaster.set(origin,direction);
      const blocked=raycaster.intersectObject(importedScene,true).some(hit=>{
        let object=hit.object;
        while(object) { if(object===focus) return false;object=object.parent; }
        return hit.distance<candidate.length()-0.1;
      });
      if(!blocked) { offset.copy(candidate); break; }
    }
  }
  controls.target.copy(center); camera.position.copy(center).add(offset); controls.update(); renderer.render(scene,camera);
  window.__ue2threeAudit.framing={view,focus:focus.name,camera:camera.position.toArray(),target:center.toArray()};
};
window.__ue2threeAudit.pixels = () => {
  renderer.render(scene,camera);
  const gl=renderer.getContext(), w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;
  const pixels=new Uint8Array(w*h*4); gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  const colors=new Set(); let white=0,magenta=0,dark=0,total=0;
  for(let i=0;i<pixels.length;i+=4*16) {
    const r=pixels[i],g=pixels[i+1],b=pixels[i+2];total++;
    colors.add(`${r>>4},${g>>4},${b>>4}`);
    if(Math.min(r,g,b)>245) white++;
    if(r>200&&b>200&&g<80) magenta++;
    if(Math.max(r,g,b)<8) dark++;
  }
  return {distinct_colors:colors.size,white_fraction:white/total,magenta_fraction:magenta/total,dark_fraction:dark/total};
};

function render() { controls.update(); renderer.render(scene, camera); requestAnimationFrame(render); }
render();
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
