import * as THREE from 'three';
import {clone} from 'three/examples/jsm/utils/SkeletonUtils';

// Mixamo Soldier is an actual skinned/textured character. Sketchbook's game
// asks for many state names, while this asset ships with Idle/Walk/Run. Create
// explicit compatible animations rather than ever binding an undefined clip.
const stateClips={
  idle:'Idle',walk:'Walk',run:'Run',sprint:'Run',
  driving:'Idle',drop_idle:'Idle',drop_running:'Run',drop_running_roll:'Run',
  falling:'Idle',jump_idle:'Idle',jump_running:'Run',reset:'Idle',
  rotate_left:'Walk',rotate_right:'Walk',sit_down_left:'Idle',
  sit_down_right:'Idle',sitting:'Idle',sitting_shift_left:'Idle',
  sitting_shift_right:'Idle',stand_up_left:'Idle',stand_up_right:'Idle',
  start_back_left:'Walk',start_back_right:'Walk',start_forward:'Walk',
  start_left:'Walk',start_right:'Walk',stop:'Idle',
};
export function prepareUrbanPerson(gltf){
  const byName=new Map(gltf.animations.map(clip=>[clip.name.toLowerCase(),clip]));
  const idle=byName.get('idle'),walk=byName.get('walk'),run=byName.get('run');
  if(!idle||!walk||!run)throw new Error('Actor HD incompleto: necessarie le animazioni Idle/Walk/Run');
  const animations=[...gltf.animations];
  for(const [alias,original] of Object.entries(stateClips)){
    if(animations.some(clip=>clip.name===alias))continue;
    const clip={Idle:idle,Walk:walk,Run:run}[original].clone();
    clip.name=alias;animations.push(clip);
  }
  gltf.animations=animations;
  gltf.scene.animations=animations;
  gltf.scene.userData.cityHighDetailPerson=true;
  gltf.scene.traverse(node=>{
    if(!node.isMesh)return;
    node.castShadow=true;
    node.receiveShadow=true;
    for(const mat of [].concat(node.material||[])){
      mat.roughness=mat.roughness??.82;
      mat.envMapIntensity=.75;
      if(mat.map)mat.map.anisotropy=8;
    }
  });
  return gltf;
}
const carPaint=new THREE.MeshPhysicalMaterial({color:0x264e70,metalness:.8,roughness:.22,clearcoat:1,clearcoatRoughness:.17});
const carGlass=new THREE.MeshPhysicalMaterial({color:0x172e3e,metalness:.22,roughness:.13,transparent:true,opacity:.76,depthWrite:true});
const carRims=new THREE.MeshStandardMaterial({color:0xb5bbc1,metalness:.9,roughness:.3});
const carTrim=new THREE.MeshStandardMaterial({color:0x222a2d,metalness:.28,roughness:.54});

/** Replace only VISUAL mesh. Leave the genuine Sketchbook Car.glb seats,
 * collider, wheel transforms, camera anchors and entry points untouched. */
export function prepareUrbanCar(carGltf,bodyGltf){
  const original=carGltf.scene;
  const shell=clone(bodyGltf.scene);
  const names=[];
  shell.traverse(node=>{
    if(!node.isMesh)return;
    names.push(node.name);
    node.castShadow=true;node.receiveShadow=true;
    const n=node.name.toLowerCase();
    if(n==='body'||n.includes('body'))node.material=carPaint;
    else if(n.includes('glass')||n.includes('window'))node.material=carGlass;
    else if(n.includes('rim'))node.material=carRims;
    else if(n.includes('trim')||n.includes('grill'))node.material=carTrim;
  });
  if(names.length<3)throw new Error('Carrozzeria HD incompleta: '+names.length+' mesh');
  shell.name='City HD vehicle visual - Ferrari';
  shell.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(shell),size=bounds.getSize(new THREE.Vector3());
  if(size.x>size.z)shell.rotation.y=Math.PI/2;
  shell.updateMatrixWorld(true);
  new THREE.Box3().setFromObject(shell).getSize(size);
  if(!size.x||!size.y||!size.z)throw new Error('Carrozzeria HD senza geometria utilizzabile');
  const scale=Math.min(2.05/size.x,1.5/size.y,4.3/size.z);
  shell.scale.multiplyScalar(scale);
  shell.updateMatrixWorld(true);
  const fitted=new THREE.Box3().setFromObject(shell),center=fitted.getCenter(new THREE.Vector3());
  shell.position.x-=center.x;shell.position.z-=center.z;
  shell.position.y+=-.77-fitted.min.y;
  // The original Sketchbook shell remains in memory for controls and seats,
  // but MUST NEVER be rendered as the white blocky car.
  original.traverse(node=>{if(node.isMesh)node.visible=false;});
  original.add(shell);
  original.userData.cityHighDetailVehicle=true;
  original.userData.highDetailSource='three.js/examples/models/gltf/ferrari.glb';
  return carGltf;
}
