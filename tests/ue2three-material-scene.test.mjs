import test from 'node:test';
import assert from 'node:assert/strict';
import {Group,Mesh,BoxGeometry,MeshStandardMaterial} from 'three';
import {bindSourceSceneMaterials,loadSourceSceneMaterials} from '../tools/ue2three/material-scene-runtime.mjs';
const sha='a'.repeat(64),source='b'.repeat(64),snapshot='c'.repeat(64),pkg='/Game/Original/Material';
function fixture() {
 const original=new MeshStandardMaterial();original.name='OriginalMaterial';
 const scene=new Group(),mesh=new Mesh(new BoxGeometry(),original);scene.add(mesh);
 const gltf={scene,parser:{associations:new Map([[original,{materials:0}]])}};
 const manifest={schema_version:1,project:'Original.uproject',glb_sha256:sha,source_snapshot_hash:snapshot,
  bindings:[{material_index:0,source_package:pkg,source_sha256:source,source_class:'Material',material_name:original.name,parameter_overrides:{}}]};
 const report={schema_version:1,source_project:'Original.uproject',source_snapshot_hash:snapshot,materials:{[pkg]:{
  schema_version:1,shader_execution:'not_integrated',source_sha256:source,
  translated_roots:{BaseColor:{glsl:'vec3(0.2,0.3,0.4)',width:3}},blocked_roots:{},uniforms:{}}}};
 return {gltf,mesh,original,manifest,report};
}
test('exact source identity binds the exported slot and disposal restores original material',()=>{
 const f=fixture(),audit=bindSourceSceneMaterials(f.gltf,f.manifest,f.report,{assetSHA256:sha});
 assert.equal(audit.bound_materials,1);assert.notEqual(f.mesh.material,f.original);
 assert.equal(audit.visual_parity_verified,false);assert.equal(audit.gpu_compilation_verified,false);
 audit.dispose();assert.equal(f.mesh.material,f.original);
});
test('wrong source hashes, unsupported instance identities and existing texture bakes are preserved or rejected',()=>{
 let f=fixture();f.manifest.bindings[0].source_sha256='d'.repeat(64);
 assert.equal(bindSourceSceneMaterials(f.gltf,f.manifest,f.report,{assetSHA256:sha}).bound_materials,0);
 assert.equal(f.mesh.material,f.original);
 f=fixture();f.manifest.bindings[0].source_class='MaterialInstanceConstant';
 assert.throws(()=>bindSourceSceneMaterials(f.gltf,f.manifest,f.report,{assetSHA256:sha}),/material slot/);
 f=fixture();f.original.map={isTexture:true};
 assert.equal(bindSourceSceneMaterials(f.gltf,f.manifest,f.report,{assetSHA256:sha}).bound_materials,0);
 f=fixture();f.manifest.project='Other.uproject';
 assert.throws(()=>bindSourceSceneMaterials(f.gltf,f.manifest,f.report,{assetSHA256:sha}),/inventory/);
});
test('nested parallel map exports find exact adjacent material slots and the project shader report',async()=>{
 const f=fixture(),requests=[];
 const result=await loadSourceSceneMaterials(f.gltf,
  '/build/local-scenes/ue2three/projects/Original/dds-assets/maps/maps/Level.glb?revision='+sha,
  {fetchJSON:async url=>{requests.push(url);return {ok:true,json:async()=>url.endsWith('.materials.json')?f.manifest:f.report};}});
 assert.equal(result.bound_materials,1);
 assert.deepEqual(requests,['/build/local-scenes/ue2three/projects/Original/dds-assets/maps/maps/Level.materials.json',
  '/build/local-scenes/ue2three/projects/Original/material-glsl-report.json']);
});
test('missing or malformed optional bindings do not prevent loading a valid map',async()=>{
 const f=fixture();let requests=0;
 const fetchJSON=async()=>{requests++;return {ok:false};};
 assert.equal((await loadSourceSceneMaterials(f.gltf,'/build/local-scenes/ue2three/projects/Original/maps/Level.glb',{fetchJSON})).bound_materials,0);
 assert.equal((await loadSourceSceneMaterials(f.gltf,'/outside.glb',{fetchJSON})).status,'source_bindings_rejected');
 assert.equal(requests,2);assert.equal(f.mesh.material,f.original);
});
