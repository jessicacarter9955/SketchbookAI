// Preserve the photographic materials/UVs while removing subpixel leaf tessellation.
// Run after the checksum-verified original asset download. No Blender dependency.
import fs from 'node:fs';
import path from 'node:path';
import { MeshoptSimplifier } from 'meshoptimizer';
const folder=path.resolve('assets/urban-kits/tree_small_02');
const original=JSON.parse(fs.readFileSync(path.join(folder,'scene.gltf')));
const buffer=fs.readFileSync(path.join(folder,original.buffers[0].uri));
await MeshoptSimplifier.ready;
const types={5126:Float32Array,5125:Uint32Array,5123:Uint16Array,5121:Uint8Array};
const widths={SCALAR:1,VEC2:2,VEC3:3,VEC4:4};
function accessor(index){
  const a=original.accessors[index],view=original.bufferViews[a.bufferView],Type=types[a.componentType];
  if(view.byteStride)throw Error('Interleaved glTF needs explicit deinterleaving');
  const start=buffer.byteOffset+(view.byteOffset||0)+(a.byteOffset||0);
  return new Type(buffer.buffer,start,a.count*widths[a.type]);
}
for(const [level,ratio,error] of [[0,.18,.0007],[1,.035,.004]]){
  const gltf=structuredClone(original),chunks=[];
  gltf.accessors=[];gltf.bufferViews=[];let offset=0,total=0;
  function add(array,type,componentType,min,max){
    const bytes=Buffer.from(array.buffer,array.byteOffset,array.byteLength);
    const view=gltf.bufferViews.push({buffer:0,byteOffset:offset,byteLength:bytes.length})-1;
    chunks.push(bytes);offset+=bytes.length;
    const pad=(4-offset%4)%4;if(pad){chunks.push(Buffer.alloc(pad));offset+=pad;}
    return gltf.accessors.push({bufferView:view,componentType,count:array.length/widths[type],type,...(min?{min,max}:{})})-1;
  }
  for(let m=0;m<original.meshes.length;m++)for(let i=0;i<original.meshes[m].primitives.length;i++){
    const p=original.meshes[m].primitives[i],out=gltf.meshes[m].primitives[i];
    const indices=Uint32Array.from(accessor(p.indices)),positions=accessor(p.attributes.POSITION);
    const [reduced,actualError]=MeshoptSimplifier.simplify(indices,positions,3,Math.floor(indices.length*ratio/3)*3,error);
    const [remap,count]=MeshoptSimplifier.compactMesh(reduced);
    for(const [name,index] of Object.entries(p.attributes)){
      const a=original.accessors[index],data=accessor(index),dim=widths[a.type],packed=new data.constructor(count*dim);
      for(let v=0;v<remap.length;v++)if(remap[v]!==0xffffffff)for(let c=0;c<dim;c++)packed[remap[v]*dim+c]=data[v*dim+c];
      out.attributes[name]=add(packed,a.type,a.componentType,a.min,a.max);
    }
    out.indices=add(reduced,'SCALAR',5125);total+=reduced.length/3;
    console.log(`LOD${level} ${original.materials[p.material].name}: ${indices.length/3} -> ${reduced.length/3} triangles; error ${actualError}`);
  }
  gltf.buffers=[{uri:`lod${level}.bin`,byteLength:offset}];
  fs.writeFileSync(path.join(folder,`lod${level}.bin`),Buffer.concat(chunks));
  fs.writeFileSync(path.join(folder,`scene-lod${level}.gltf`),JSON.stringify(gltf));
  console.log(`LOD${level}: ${total} triangles, ${offset} bytes`);
}
