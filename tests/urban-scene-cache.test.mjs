import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {urbanCacheKey,restoreUrbanFacades,saveUrbanFacades} from '../src/editor/UrbanSceneCache.js';

test('urban facade disk keys change with model geometry and density',()=>{
 const first={seed:1847,blocksX:4,blocksZ:4,blockSize:42,buildingDensity:.9};
 assert.equal(urbanCacheKey(first),urbanCacheKey({...first}));
 assert.notEqual(urbanCacheKey(first),urbanCacheKey({...first,seed:2}));
 assert.notEqual(urbanCacheKey(first),urbanCacheKey({...first,buildingDensity:.7}));
});
test('r152 serializes and restores real GPU instanced facades at full fidelity',async()=>{
 const geo=new THREE.BoxGeometry(4,7,2),mat=new THREE.MeshStandardMaterial({roughness:.22,metalness:.55});
 const mesh=new THREE.InstancedMesh(geo,mat,3),transform=new THREE.Matrix4();
 for(let i=0;i<3;i++){transform.makeTranslation(i*10,4,i);mesh.setMatrixAt(i,transform);}
 mesh.instanceMatrix.needsUpdate=true;
 const sector=new THREE.Group();sector.name='PBR city sector 0:0';sector.add(mesh);
 const parent=new THREE.Group();parent.add(sector);
 const payload=parent.toJSON();
 const restored=await new THREE.ObjectLoader().parseAsync(payload);
 const node=restored.getObjectByName('PBR city sector 0:0'),copy=node.children[0];
 assert.equal(copy.isInstancedMesh,true);assert.equal(copy.count,3);
 assert.equal(copy.geometry.attributes.position.count,geo.attributes.position.count);
 assert.equal(copy.material.roughness,.22);
 assert.equal(copy.material.metalness,.55);
 copy.getMatrixAt(2,transform);
 assert.equal(transform.elements[12],20);
 assert.equal(transform.elements[13],4);
 assert.equal(transform.elements[14],2);
});
test('IndexedDB unavailable falls back cleanly to original glTF assembly',async()=>{
 assert.equal(await restoreUrbanFacades({seed:1847}),null);
 assert.equal(await saveUrbanFacades({seed:1847},[]),false);
});
