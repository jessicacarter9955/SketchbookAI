import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
let templatesPromise;
async function templates(){
  if(!templatesPromise)templatesPromise=Promise.all([0,1].map(level=>new GLTFLoader().loadAsync(`assets/urban-kits/tree_small_02/scene-lod${level}.gltf`))).then(kits=>kits.map(kit=>{
    const root=kit.scene;root.updateMatrixWorld(true);
    root.traverse(n=>{if(n.isMesh){n.userData.sharedUrbanAsset=true;n.castShadow=n.receiveShadow=true;for(const mat of [].concat(n.material)){mat.alphaTest=/leaves/.test(mat.name)?.45:0;mat.transparent=false;mat.side=THREE.DoubleSide;mat.envMapIntensity=.7;mat.roughness=.85;if(mat.map)mat.map.anisotropy=8;}}});
    const bounds=new THREE.Box3().setFromObject(root),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
    root.position.set(-center.x,-bounds.min.y,-center.z);
    return {root,height:size.y};
  }));
  return templatesPromise;
}
export async function createVegetation(items,seed=0){
  const sources=await templates(),layer=new THREE.Group();layer.name='CC0 photoreal vegetation';
  const loaded=new Map(),forward=new THREE.Vector3(),point=new THREE.Vector3();
  const addTree=(index,t)=>{
    const lod=new THREE.LOD(),height=(t.kind==='median'?5:6.7)*(t.scale||1);
    lod.position.set(t.x,(t.y||0)+.17,t.z);lod.rotation.y=index*2.3999632297+seed*.17;
    for(const [level,source] of sources.entries()){
      const wrapper=new THREE.Group(),tree=source.root.clone(true);wrapper.add(tree);wrapper.scale.setScalar(height/source.height);
      lod.addLevel(wrapper,level===0?0:24,.2);
    }
    layer.add(lod);loaded.set(index,lod);
  };
  // Precreate authentic photoreal trees during the loading screen, not during
  // sprinting through the city. Geometry and textures remain shared.
  layer.userData.prepareAll=async (onProgress,camera)=>{
    // Only the nearest authentic PBR LOD trees must be ready for the first frame.
    // Cloning every distant tree here blocks the main thread and WebGL upload.
    const origin=camera?.position || new THREE.Vector3();
    const queue=items.map((t,i)=>({i,t,distance:Math.hypot(t.x-origin.x,t.z-origin.z)}))
      .sort((a,b)=>a.distance-b.distance);
    const initialCount=Math.min(items.length,48);
    for(let j=0;j<initialCount;j++){
      const {i,t}=queue[j];
      if(!loaded.has(i))addTree(i,t);
      loaded.get(i).visible=false;
      if(j%6===5){
        onProgress?.(`Alberi HD vicini ${j+1}/${initialCount}; gli altri in streaming`);
        await new Promise(resolve=>setTimeout(resolve,0));
      }
    }
    onProgress?.(`Vegetazione HD pronta: ${initialCount} alberi autentici vicini; ${Math.max(0,items.length-initialCount)} in streaming`);
    layer.userData.preparedCount=initialCount;
  };
  // Streaming density is unchanged at the camera: the full LOD models are
  // still used, but off-screen trees are not cloned or uploaded to the GPU.
  layer.userData.stream=(camera,isVisible)=>{
    camera.getWorldDirection(forward);forward.y=0;forward.normalize();
    const desired=[];
    for(const [i,t] of items.entries()){
      const dx=t.x-camera.position.x,dz=t.z-camera.position.z;
      const distance=Math.hypot(dx,dz);
      const front=distance<.01||((dx*forward.x+dz*forward.z)/distance)>-.2;
      if((distance<60 || (distance<210&&front)) && (distance<42||!isVisible||isVisible(t)))desired.push({i,t,distance});
    }
    desired.sort((a,b)=>a.distance-b.distance);
    const wanted=new Set(desired.map(x=>x.i));
    let created=0;
    for(const {i,t} of desired){
      if(!loaded.has(i)&&created<7){addTree(i,t);created++;}
      if(loaded.has(i))loaded.get(i).visible=true;
    }
    for(const [i,node] of loaded){
      if(wanted.has(i))continue;
      node.visible=false;
      const tree=items[i],distance=Math.hypot(tree.x-camera.position.x,tree.z-camera.position.z);
      if(distance>270&&!layer.userData.keepLoaded){node.removeFromParent();loaded.delete(i);}
    }
  };
  return layer;
}
