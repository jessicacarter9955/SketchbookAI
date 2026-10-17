'use strict';
// Read-only GLB inspection. Never bundles downloaded licensed originals into GitHub.
const ids=['bmw','ferrari','lamborghini'];
function details(buffer){
 const jsonLength=buffer.readUInt32LE(12);
 if(buffer.toString('ascii',0,4)!=='glTF')throw Error('Not GLB');
 const model=JSON.parse(buffer.toString('utf8',20,20+jsonLength));
 const nodes=model.nodes||[],meshes=model.meshes||[],accessors=model.accessors||[];
 const lines=nodes.map((node,i)=>{
   const mesh=meshes[node.mesh],primitives=mesh?.primitives||[];
   const bbox=primitives.flatMap(x=>{let a=accessors[x.attributes?.POSITION];return a?[{min:a.min,max:a.max,material:x.material}]:[]});
   return {index:i,name:node.name||'',mesh:node.mesh,meshName:mesh?.name||'',parent:nodes.findIndex(x=>(x.children||[]).includes(i)),
     childCount:(node.children||[]).length,translation:node.translation||null,rotation:node.rotation||null,scale:node.scale||null,
     bbox:bbox.slice(0,4)};
 });
 const likely=lines.filter(x=>/wheel|tire|tyre|rim|hub|brake|chassis|body|front|rear|left|right/i.test(x.name+' '+x.meshName));
 return {generator:model.asset?.generator,nodeCount:nodes.length,meshCount:meshes.length,scenes:model.scenes,
   names:lines.slice(0,110),likely,materials:(model.materials||[]).map(x=>x.name)};
}
(async()=>{
 const local=require('fs').readFileSync('build/assets/car.glb');
 const localMeta=details(local);
 console.log('=== MODEL native bytes '+local.length+' ===');
 console.log(JSON.stringify({...localMeta,extras:JSON.parse(local.toString('utf8',20,20+local.readUInt32LE(12))).nodes?.map((n,i)=>({index:i,name:n.name,extras:n.extras,translation:n.translation,rotation:n.rotation,scale:n.scale})).filter(n=>n.extras||/wheel|seat|collision/i.test(n.name))},null,2));
 for(const name of ids) {
  const res=await fetch('https://sketchbook-fab-bridge.onrender.com/sketchfab/cars/'+name,{signal:AbortSignal.timeout(120000)});
  if(!res.ok)throw Error(name+' HTTP '+res.status+' '+(await res.text()).slice(0,220));
  const bytes=Buffer.from(await res.arrayBuffer());
  const info=details(bytes);
  console.log('=== MODEL',name,'bytes',bytes.length,'===');
  console.log(JSON.stringify(info,null,2));
 }
})().catch(e=>{console.error(e);process.exit(1)});
