import * as THREE from 'three';
import { createDetails } from './UrbanDetails.js';

const roofMaterial=new THREE.MeshStandardMaterial({color:0x4b4c46,roughness:.95});
// The source files are catalogues of separate 3 m modules, not whole buildings.
// Preserve their local geometry and assemble openings, corners and all four sides.
export function prepareFacadeKit(root) {
  root.traverse(node => {
    if (!node.isMesh) return;
    for (const mat of [].concat(node.material)) {
      if (mat.map) mat.map.anisotropy = 8;
      mat.envMapIntensity = .6;
      if (/glass/.test(mat.name)) {
        mat.map = mat.normalMap = mat.metalnessMap = mat.roughnessMap = null;
        mat.color.set(0x8b9b9a); mat.roughness = .14; mat.metalness = .65;
        mat.opacity = .38; mat.transparent = true; mat.depthWrite = false;
        mat.envMapIntensity = 1.2;
      } else { mat.roughness = .88; mat.metalness = 0; }
    }
  });
  return root;
}

export function buildModularBuilding(kit, building, seed = 0, industrial = false) {
  const {x, z, w, d, floors} = building;
  const baysX = Math.max(2, Math.round(w / 3)), baysZ = Math.max(2, Math.round(d / 3));
  const width = baysX * 3, depth = baysZ * 3;
  const group = new THREE.Group();
  group.name = `PBR building ${seed}`;
  group.position.set(x, (building.ground || 0) + .18, z);
  group.scale.set(w / width, 1, d / depth);
  group.userData.photorealArchitecture = true;
  const details = createDetails(group, group);
  const addModule = (name, parent, px, py) => {
    const original = kit.getObjectByName(name);
    if (!original) throw new Error(`Missing facade module: ${name}`);
    const module = original.clone(true);
    module.position.set(px, py, 0);
    module.traverse(node => { if (node.isMesh) { node.castShadow = !/glass/.test(node.material.name); node.receiveShadow = true; } });
    parent.add(module);
  };
  const sides = [[width/2,depth/2,0,baysX],[-width/2,-depth/2,Math.PI,baysX],[width/2,-depth/2,Math.PI/2,baysZ],[-width/2,depth/2,-Math.PI/2,baysZ]];
  for (const [sx,sz,angle,bays] of sides) {
    const face = new THREE.Group(); face.position.set(sx,0,sz); face.rotation.y = angle; group.add(face);
    for (let floor=0;floor<floors;floor++) for (let bay=0;bay<bays;bay++) {
      const door = floor===0 && bay===Math.floor(bays/2);
      addModule(door?'wall_door_centered_large_01':'wall_window_centered_large_01',face,-bay*3,floor*3);
      addModule(door?'door_centered_large_01':'window_centered_large_01',face,-bay*3,floor*3);
      details.facade(face,bay,floor,floors,seed,door,industrial);
      if (floor===floors-1) addModule(industrial?'cornice02_standard_standard_01':'cornice_standard_standard_01',face,-bay*3,(floor+1)*3);
    }
  }
  // A recessed roof and a solid base close the shell without covering the openings.
  const roofMat = roofMaterial;
  details.box(group,width-.15,.15,depth-.15,0,floors*3-.1,0,roofMat);
  details.box(group,width,.2,depth,0,-.1,0);
  details.buildingTrim(group,width,depth,floors*3,seed);
  return group;
}

// Instance repeated modules instead of submitting thousands of independent meshes.
// Keep every original UV channel (including the foliage / glTF secondary UVs).
export function instanceArchitecture(source) {
  source.updateMatrixWorld(true);
  const batches = new Map(), result = new THREE.Group();
  result.name = 'Assembled PBR architecture';
  result.userData.photorealArchitecture = true;
  source.traverse(node => {
    if (!node.isMesh) return;
    const key = `${node.geometry.uuid}:${node.material.uuid}:${node.castShadow}`;
    if (!batches.has(key)) batches.set(key,{geometry:node.geometry,material:node.material,shadow:node.castShadow,matrices:[]});
    batches.get(key).matrices.push(node.matrixWorld.clone());
  });
  for (const batch of batches.values()) {
    const mesh = new THREE.InstancedMesh(batch.geometry,batch.material,batch.matrices.length);
    batch.matrices.forEach((matrix,i)=>mesh.setMatrixAt(i,matrix));
    mesh.instanceMatrix.needsUpdate = true; mesh.userData.sharedUrbanAsset=true;
    mesh.castShadow = batch.shadow; mesh.receiveShadow = true;
    mesh.computeBoundingSphere(); result.add(mesh);
  }
  return result;
}
