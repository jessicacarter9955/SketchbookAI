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
  for(const [index,t] of items.entries()){
    const lod=new THREE.LOD(),height=(t.kind==='median'?5:6.7)*(t.scale||1);
    lod.position.set(t.x,(t.y||0)+.17,t.z);lod.rotation.y=index*2.3999632297+seed*.17;
    for(const [level,source]of sources.entries()){
      const wrapper=new THREE.Group(),tree=source.root.clone(true);wrapper.add(tree);wrapper.scale.setScalar(height/source.height);
      lod.addLevel(wrapper,level===0?0:24,.2);
    }
    layer.add(lod);
  }
  return layer;
}
