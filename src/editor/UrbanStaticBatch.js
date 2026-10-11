import * as THREE from 'three';

/** Collect adjacent static street meshes into tile-sized GPU batches.
 * One material and one reusable unit box per batch: preserve the old per-face
 * UV mapping, cast/receive shadows, colors and original positions.
 * Tile boundaries allow Three.js to frustum-cull each batch independently.
 */
export function batchUrbanStaticBoxes(group, excluded = new Set(), cellSize = 42) {
  const batches = new Map();
  for (const mesh of [...group.children]) {
    if (!mesh.isMesh || mesh.isInstancedMesh || mesh.geometry?.type !== 'BoxGeometry' ||
      excluded.has(mesh.material) || mesh.userData.urbanBuildingVisual ||
      mesh.userData.urbanBuilding || mesh.userData.primitiveLamp ||
      mesh.userData.editorSurface) continue;
    const dims = mesh.geometry.parameters;
    if (!dims || mesh.material.transparent) continue;
    const cx = Math.floor(mesh.position.x / cellSize);
    const cz = Math.floor(mesh.position.z / cellSize);
    const key = [cx,cz,mesh.material.uuid,Number(mesh.castShadow),Number(mesh.receiveShadow)].join(':');
    if (!batches.has(key)) batches.set(key,{items:[],material:mesh.material,
      castShadow:mesh.castShadow,receiveShadow:mesh.receiveShadow});
    batches.get(key).items.push({mesh,dims});
  }
  let original = 0, instanced = 0, callsRemoved = 0;
  const sharedCube = new THREE.BoxGeometry(1,1,1);
  for (const batch of batches.values()) {
    if (batch.items.length < 2) continue;
    const instances = new THREE.InstancedMesh(sharedCube,batch.material,batch.items.length);
    instances.castShadow = batch.castShadow;
    instances.receiveShadow = batch.receiveShadow;
    instances.name='Instanced street/curb tile';
    instances.userData.sharedUrbanAsset=true;
    instances.matrixAutoUpdate=false;
    const transform=new THREE.Matrix4(), scaling=new THREE.Matrix4();
    batch.items.forEach(({mesh,dims},index)=>{
      mesh.updateMatrix();
      transform.copy(mesh.matrix);
      scaling.makeScale(dims.width,dims.height,dims.depth);
      transform.multiply(scaling);
      instances.setMatrixAt(index,transform);
      group.remove(mesh);
      mesh.geometry.dispose();
    });
    instances.instanceMatrix.needsUpdate=true;
    instances.computeBoundingSphere();
    group.add(instances);
    original+=batch.items.length;instanced++;callsRemoved+=batch.items.length-1;
  }
  if (!instanced) sharedCube.dispose();
  return {originalMeshes:original,instancedBatches:instanced,drawCallsSaved:callsRemoved};
}
