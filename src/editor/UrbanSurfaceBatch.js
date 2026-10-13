import * as THREE from 'three';
import { mergeBufferGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Combine coplanar static road/sidewalk/grass boxes into spatial cells.
 * Unlike unit-box instancing, merging after metricUV() retains every original
 * world-space PBR texture coordinate, normal, shadow receiver and geometry.
 * Built exactly once while the HD loading overlay is shown.
 */
export function batchUrbanPbrSurfaces(group,allowedMaterials,cellSize=42){
  const byCell=new Map();
  for(const mesh of [...group.children]){
    if(!mesh.isMesh||mesh.isInstancedMesh||
       !allowedMaterials.has(mesh.material)||
       mesh.geometry?.type!=='BoxGeometry'||mesh.material.transparent)continue;
    mesh.updateMatrix();
    const x=Math.floor(mesh.position.x/cellSize),z=Math.floor(mesh.position.z/cellSize);
    const key=[x,z,mesh.material.uuid,Number(mesh.castShadow),Number(mesh.receiveShadow)].join(':');
    if(!byCell.has(key))byCell.set(key,{material:mesh.material,castShadow:mesh.castShadow,
      receiveShadow:mesh.receiveShadow,meshes:[]});
    byCell.get(key).meshes.push(mesh);
  }
  const report={sourceMeshes:0,mergedMeshes:0,drawCallsSaved:0};
  for(const entry of byCell.values()){
    if(entry.meshes.length<2)continue;
    const geometries=entry.meshes.map(mesh=>{
      const geo=mesh.geometry.clone();
      geo.applyMatrix4(mesh.matrix); // Preserve original metric UVs exactly
      return geo;
    });
    const merged=mergeBufferGeometries(geometries,false);
    geometries.forEach(g=>g.dispose());
    if(!merged)continue;
    merged.computeBoundingSphere();merged.computeBoundingBox();
    const batch=new THREE.Mesh(merged,entry.material);
    batch.name='Merged PBR urban surface';
    batch.receiveShadow=entry.receiveShadow;batch.castShadow=entry.castShadow;
    batch.matrixAutoUpdate=false;
    group.add(batch);
    for(const mesh of entry.meshes){
      mesh.removeFromParent();mesh.geometry.dispose();
    }
    report.sourceMeshes+=entry.meshes.length;
    report.mergedMeshes++;
    report.drawCallsSaved+=entry.meshes.length-1;
  }
  group.userData.surfaceBatch=report;
  return report;
}
