import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {batchUrbanPbrSurfaces} from '../src/editor/UrbanSurfaceBatch.js';
test('PBR surface merge keeps geometry, UVs, cast shadows and frustum culling',()=>{
  const group=new THREE.Group(),material=new THREE.MeshStandardMaterial();
  const original=[];
  for(let i=0;i<4;i++){
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(4,.2,8),material);
    mesh.position.set(i*7,.1,0);mesh.receiveShadow=true;
    const uv=mesh.geometry.attributes.uv;
    for(let v=0;v<uv.count;v++)uv.setXY(v,uv.getX(v)+i*7,uv.getY(v)+2);
    group.add(mesh);
    const p=mesh.geometry.attributes.position;
    original.push({uv0:[uv.getX(0),uv.getY(0)],position:[p.getX(0)+mesh.position.x,p.getY(0)+mesh.position.y,p.getZ(0)]});
  }
  const r=batchUrbanPbrSurfaces(group,new Set([material]),80);
  assert.equal(r.sourceMeshes,4);assert.equal(r.mergedMeshes,1);assert.equal(r.drawCallsSaved,3);
  const merged=group.children[0];
  assert.equal(merged.name,'Merged PBR urban surface');
  assert.equal(merged.receiveShadow,true);assert.equal(merged.frustumCulled,true);
  assert.equal(merged.geometry.attributes.position.count,4*24);
  const p=merged.geometry.attributes.position,uv=merged.geometry.attributes.uv;
  for(let i=0;i<4;i++){
    assert.ok(Math.abs(p.getX(i*24)-original[i].position[0])<1e-5);
    assert.ok(Math.abs(p.getY(i*24)-original[i].position[1])<1e-5);
    assert.equal(p.getZ(i*24),original[i].position[2]);
    assert.deepEqual([uv.getX(i*24),uv.getY(i*24)],original[i].uv0);
  }
});
