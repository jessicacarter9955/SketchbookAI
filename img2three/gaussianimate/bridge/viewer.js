import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const canvas = document.querySelector("#stage");
const status = document.querySelector("#status");
const sourceLabel = document.querySelector("#source");
const slider = document.querySelector("#frame");
const toggle = document.querySelector("#toggle");
const renderer = new THREE.WebGLRenderer({canvas, antialias: true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x0d1420);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xb1ebff, 0x314465, 2.8));
const light = new THREE.DirectionalLight(0xffffff, 2.2);
light.position.set(2, 4, 3);
scene.add(light);
const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 2000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
let positions, clip, object, index = 0, playing = true, epoch = performance.now();

function syntheticDemo() {
  // Viewer smoke-test only. This is NOT a GaussiAnimate reconstruction.
  const w=34,h=20,n=w*h,q=96,points=new Float32Array(n*q*3),faces=[];
  for(let y=0;y<h-1;y++)for(let x=0;x<w-1;x++){
    let k=y*w+x;faces.push(k,k+1,k+w,k+1,k+w+1,k+w);
  }
  for(let f=0;f<q;f++)for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let u=x/(w-1),v=y/(h-1),i=(f*n+y*w+x)*3;
    points[i]=(u-.5)*3;
    points[i+1]=(v-.5)*1.7;
    points[i+2]=.2*Math.sin(u*12+f*.1+v*2)*(.2+u)+.05*Math.sin(v*18-f*.09);
  }
  return {points,faces:new Uint32Array(faces),fps:30,count:q,vertices:n};
}

async function loadClip(urlText) {
  const url=new URL(urlText, location.href);
  const response=await fetch(url);
  if(!response.ok)throw new Error("Manifest HTTP "+response.status);
  const data=await response.json();
  if(data.format!=="gaussianimate-three-frames-v1")throw new Error("Unsupported manifest format");
  const body=await fetch(new URL(data.frames_file,url));
  if(!body.ok)throw new Error("Frames HTTP "+body.status);
  const raw=await body.arrayBuffer();
  if(raw.byteLength!==data.frame_count*data.vertex_count*3*4)throw new Error("Invalid frame byte count");
  let faces=null;
  if(data.faces_file){
    const f=await fetch(new URL(data.faces_file,url));
    if(!f.ok)throw new Error("Faces HTTP "+f.status);
    const b=await f.arrayBuffer();
    if(b.byteLength%12!==0)throw new Error("Invalid triangle data length");
    faces=new Uint32Array(b);
  }
  return {points:new Float32Array(raw),faces,fps:data.fps,count:data.frame_count,vertices:data.vertex_count};
}

function showFrame(f) {
  index=(f+clip.count)%clip.count;
  const offset=index*clip.vertices*3;
  positions.set(clip.points.subarray(offset,offset+positions.length));
  const geom=object.geometry;
  geom.attributes.position.needsUpdate=true;
  if(geom.index)geom.computeVertexNormals();
  geom.computeBoundingSphere();
  slider.value=String(index);
  status.textContent="Frame "+(index+1)+"/"+clip.count+" · "+clip.vertices+" tracked points";
}

function init(animation) {
  clip=animation;
  if(!clip.fps || !clip.count || !clip.vertices || clip.points.length!==clip.count*clip.vertices*3)
    throw new Error("Invalid animation dimensions");
  positions=new Float32Array(clip.vertices*3);
  positions.set(clip.points.subarray(0,positions.length));
  const geom=new THREE.BufferGeometry();
  const attr=new THREE.BufferAttribute(positions,3);
  attr.setUsage(THREE.DynamicDrawUsage);
  geom.setAttribute("position",attr);
  if(clip.faces && clip.faces.length){
    geom.setIndex(new THREE.BufferAttribute(clip.faces,1));
    geom.computeVertexNormals();
    object=new THREE.Mesh(geom,new THREE.MeshStandardMaterial({
      color:0x6bd1e5,side:THREE.DoubleSide,roughness:0.65,metalness:0.05
    }));
  } else {
    object=new THREE.Points(geom,new THREE.PointsMaterial({color:0x87e2f1,size:0.025}));
  }
  scene.add(object);
  const bbox=new THREE.Box3().setFromBufferAttribute(attr);
  const center=bbox.getCenter(new THREE.Vector3());
  const radius=Math.max(0.1,bbox.getSize(new THREE.Vector3()).length());
  controls.target.copy(center);
  camera.position.copy(center.clone().add(new THREE.Vector3(radius*.5,radius*.4,radius*1.2)));
  camera.near=radius/1000; camera.far=radius*100; camera.updateProjectionMatrix();
  controls.update();
  slider.max=String(clip.count-1);
  showFrame(0);
  epoch=performance.now();
  window.__gaussiAnimateReady=true;
}

function resize(){
  renderer.setSize(innerWidth,innerHeight,false);
  camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();
}
window.addEventListener("resize",resize);
resize();
toggle.addEventListener("click",()=>{
  playing=!playing;toggle.textContent=playing?"Pause":"Play";
  epoch=performance.now()-index/clip.fps*1000;
});
slider.addEventListener("input",()=>{
  if(!clip)return;
  playing=false;toggle.textContent="Play";showFrame(Number(slider.value));
});
async function boot(){
  try{
    const asset=new URLSearchParams(location.search).get("asset");
    sourceLabel.textContent=asset?"Loaded baked PartMM frames: "+asset:"SYNTHETIC waving cloth — debug viewer only; not a GaussiAnimate result.";
    init(asset?await loadClip(asset):syntheticDemo());
  }catch(e){status.textContent="ERROR: "+e.message;window.__gaussiAnimateError=e.message;console.error(e);}
}
function loop(now){
  requestAnimationFrame(loop);
  if(playing&&clip){
    const f=Math.floor((now-epoch)*clip.fps/1000)%clip.count;
    if(f!==index)showFrame(f);
  }
  controls.update();renderer.render(scene,camera);
}
boot();
requestAnimationFrame(loop);
