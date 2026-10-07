import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { instanceArchitecture } from './UrbanArchitecture.js';
import { urbanGroundHeight } from './urban-data.mjs';
const assets=['street_lamp_01','painted_wooden_bench','metal_trash_can'];
let promise;
export async function createStreetProps(plan,config){
  if(!promise)promise=Promise.all(assets.map(id=>new GLTFLoader().loadAsync(`assets/urban-kits/${id}/scene.gltf`)));
  const sources=await promise,assembly=new THREE.Group();
  const bounds=sources.map(s=>{s.scene.updateMatrixWorld(true);return new THREE.Box3().setFromObject(s.scene);});
  function place(index,x,z,height,rotation=0){
    const source=sources[index].scene,box=bounds[index],center=box.getCenter(new THREE.Vector3());
    const scale=height/(box.max.y-box.min.y),asset=source.clone(true),wrapper=new THREE.Group();
    asset.position.set(-center.x,-box.min.y,-center.z);wrapper.add(asset);wrapper.scale.setScalar(scale);
    wrapper.position.set(x,urbanGroundHeight(x,z,config)+.18,z);wrapper.rotation.y=rotation;
    wrapper.traverse(n=>{if(n.isMesh){n.castShadow=n.receiveShadow=true;for(const mat of [].concat(n.material)){if(mat.map)mat.map.anisotropy=8;mat.envMapIntensity=.6;}}});
    assembly.add(wrapper);
  }
  for(const lamp of plan.lamps)place(0,lamp.x,lamp.z,5.4,lamp.x%config.blockSize===0?Math.PI/2:0);
  // Place furniture within the actual sidewalk band, leaving doorways and crossings clear.
  for(const b of plan.buildings.filter((b,i)=>i%2===0)){
    const z=b.z+b.d/2+1.3;
    place(1,b.x-2,z,.95,Math.PI);place(2,b.x+1,z,.8);
  }
  const layer=instanceArchitecture(assembly);layer.name='Scanned street furniture';
  return {layer,assets,instances:assembly.children.length};
}
