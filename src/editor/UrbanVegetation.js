import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {withUrbanLoadDeadline} from './urban-load-deadline.mjs';

// Exactly the original source mesh and material: GPU instances instead of
// cloning hundreds of glTF scene hierarchies every time an area comes into view.
let templatesPromise;
async function loadOriginalTreeLod(level){
 const url=`assets/urban-kits/tree_small_02/scene-lod${level}.gltf`;
 globalThis.cityDiagnostics?.activity('Vegetazione: caricamento GLTF originale '+url);
 try{
   const kit=await withUrbanLoadDeadline('Vegetazione LOD'+level,
     ()=>new GLTFLoader().loadAsync(url),55000);
   globalThis.cityDiagnostics?.activity('Vegetazione: GLTF LOD'+level+' pronto');
   return kit;
 }catch(error){
   globalThis.cityDiagnostics?.problem(error,'Vegetazione LOD'+level);
   // Retry only the same shipped CC0 asset, bypassing a broken HTTP cache;
   // do not replace it with a procedural tree or accept partial HD.
   globalThis.cityDiagnostics?.activity('Vegetazione: riprovo originale LOD'+level+' dalla stessa pubblicazione');
   return withUrbanLoadDeadline('Vegetazione LOD'+level+' secondo tentativo',
     ()=>new GLTFLoader().loadAsync(url+'?retry=1'),40000);
 }
}
async function templates(){
 if(!templatesPromise)templatesPromise=Promise.all([0,1].map(loadOriginalTreeLod))
 .then(kits=>kits.map(kit=>{
   const root=kit.scene;
   root.updateMatrixWorld(true);
   root.traverse(n=>{
    if(!n.isMesh)return;
    n.userData.sharedUrbanAsset=true;
    n.castShadow=n.receiveShadow=true;
    for(const mat of [].concat(n.material)){
     mat.alphaTest=/leaves/.test(mat.name)?.45:0;
     mat.transparent=false;mat.side=THREE.DoubleSide;
     mat.envMapIntensity=.7;mat.roughness=.85;
     if(mat.map)mat.map.anisotropy=8;
    }
   });
   const bounds=new THREE.Box3().setFromObject(root),height=bounds.getSize(new THREE.Vector3()).y;
   if(!Number.isFinite(height)||height<=0)throw Error('Albero fotorealistico originale senza dimensioni corrette');
   // An asymmetrical crown shifts the box center away from the trunk foot.
   // Anchor the lowest original mesh vertices at the planned tree position.
   const lowY=bounds.min.y+Math.max(.25,height*.09);
   const point=new THREE.Vector3(),base=new THREE.Vector3();
   let baseCount=0;
   root.traverse(mesh=>{
     const positions=mesh.isMesh&&mesh.geometry?.getAttribute('position');
     if(!positions)return;
     const stride=Math.max(1,Math.ceil(positions.count/7000));
     for(let i=0;i<positions.count;i+=stride){
       point.fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld);
       if(point.y<=lowY){base.x+=point.x;base.z+=point.z;baseCount++;}
     }
   });
   const center=baseCount>=3?base.multiplyScalar(1/baseCount):bounds.getCenter(new THREE.Vector3());
   root.position.set(-center.x,-bounds.min.y,-center.z);
   root.updateMatrixWorld(true);
   const meshes=[];
   root.traverse(mesh=>{
    if(mesh.isMesh&&mesh.geometry)meshes.push({
      geometry:mesh.geometry,material:mesh.material,
      matrix:mesh.matrixWorld.clone(),castShadow:mesh.castShadow
    });
   });
   if(!meshes.length)throw Error('Kit vegetazione originale senza mesh');
   return {height,meshes};
 })).catch(e=>{templatesPromise=null;throw e;});
 return templatesPromise;
}
export function selectUrbanTreeLods(items,camera,isVisible){
 const selected=[[],[]],direction=new THREE.Vector3();
 camera.getWorldDirection(direction);direction.y=0;direction.normalize();
 for(let i=0;i<items.length;i++){
  const t=items[i],dx=t.x-camera.position.x,dz=t.z-camera.position.z;
  const distance=Math.hypot(dx,dz);
  const front=distance<.01||(dx*direction.x+dz*direction.z)/distance>-.2;
  if((distance<60||(distance<210&&front))&&(distance<42||!isVisible||isVisible(t)))
   selected[distance<24?0:1].push(i);
 }
 return selected;
}
export async function createVegetation(items,seed=0){
 const sources=await templates(),layer=new THREE.Group();
 layer.name='CC0 photoreal vegetation';
 const batches=sources.map((source,level)=>source.meshes.map(mesh=>{
   const instance=new THREE.InstancedMesh(mesh.geometry,mesh.material,Math.max(1,items.length));
   instance.name='CC0 tree_small_02 LOD'+level+' GPU instances';
   instance.count=0;instance.frustumCulled=false;
   instance.castShadow=mesh.castShadow;instance.receiveShadow=true;
   instance.userData.sharedUrbanAsset=true;
   instance.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
   layer.add(instance);
   return {...mesh,instance};
 }));
 const rootTransforms=items.map((t,i)=>{
   const height=(t.kind==='median'?5:6.7)*(t.scale||1);
   const x=new THREE.Matrix4().compose(
     new THREE.Vector3(t.x,(t.y||0)+.17,t.z),
     new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),i*2.3999632297+seed*.17),
     new THREE.Vector3(1,1,1));
   return sources.map(source=>x.clone().multiply(new THREE.Matrix4().makeScale(
      height/source.height,height/source.height,height/source.height)));
 });
 layer.userData.prepareAll=async onProgress=>{
   onProgress?.('Vegetazione Poly Haven originale: preparo '+items.length+' alberi GPU instanced con due LOD');
   layer.userData.stream?.(globalThis.world?.camera);
   onProgress?.('Vegetazione HD pronta · '+items.length+' alberi indicizzati');
 };
 layer.userData.stream=(camera,isVisible)=>{
   if(!camera)return;
   const selections=selectUrbanTreeLods(items,camera,isVisible);
   for(let level=0;level<2;level++){
    const indices=selections[level];
    for(const mesh of batches[level]){
     mesh.instance.count=indices.length;
     for(let k=0;k<indices.length;k++){
      const matrix=new THREE.Matrix4().multiplyMatrices(rootTransforms[indices[k]][level],mesh.matrix);
      mesh.instance.setMatrixAt(k,matrix);
     }
     mesh.instance.instanceMatrix.needsUpdate=true;
    }
   }
   layer.userData.visibleTrees=selections[0].length+selections[1].length;
 };
 layer.userData.treeInstanceBatches=batches.flat().length;
 layer.userData.treeCount=items.length;
 return layer;
}
