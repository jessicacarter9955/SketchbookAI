/* Isolate real wheel triangles from the 3 approved Sketchfab models.
   Keep source GLB untouched and fail safely if the hierarchy changes. */
const TARGETS = {
 bmw:['Front Wheels','Back Wheels'],
 ferrari:['Object_37','Object_38','Object_39','Object_40'],
 lamborghini:['Plane08_3','Plane08.001_4']
};
const CORNERS=['left:front','right:front','left:rear','right:rear'];
function extractMesh(mesh,container,THREE,buckets) {
 const input=mesh.geometry;
 if(!input?.getAttribute('position'))return;
 const geometry=input.index?input.toNonIndexed():input.clone();
 geometry.applyMatrix4(new THREE.Matrix4().copy(container.matrixWorld).invert().multiply(mesh.matrixWorld));
 const position=geometry.getAttribute('position');
 const attrs=Object.entries(geometry.attributes);
 const groups=geometry.groups.length?geometry.groups:[{start:0,count:position.count,materialIndex:0}];
 for (const group of groups) {
   const tables=new Map();
   const end=Math.min(position.count,group.start+group.count);
   for(let i=group.start;i+2<end;i+=3) {
     const x=(position.getX(i)+position.getX(i+1)+position.getX(i+2))/3;
     const z=(position.getZ(i)+position.getZ(i+1)+position.getZ(i+2))/3;
     const key=(x<0?'left':'right')+':'+(z>=0?'front':'rear');
     if(!tables.has(key))tables.set(key,Object.fromEntries(attrs.map(([name])=>[name,[]])));
     const table=tables.get(key);
     for(const [name,attr] of attrs)for(let v=i;v<i+3;v++)for(let j=0;j<attr.itemSize;j++)table[name].push(attr.isInterleavedBufferAttribute?attr.data.array[v*attr.data.stride+attr.offset+j]:attr.array[v*attr.itemSize+j]);
   }
   for(const [key,table] of tables) {
     const part=new THREE.BufferGeometry();
     for(const [name,attr] of attrs) {
       const array=attr.isInterleavedBufferAttribute?attr.data.array:attr.array;
       part.setAttribute(name,new THREE.BufferAttribute(new array.constructor(table[name]),attr.itemSize,attr.normalized));
     }
     part.computeBoundingBox();
     const material=Array.isArray(mesh.material)?mesh.material[group.materialIndex||0]:mesh.material;
     const view=new THREE.Mesh(part,material);
     view.name=mesh.name+' - '+key;
     view.castShadow=true;view.receiveShadow=true;
     if(!buckets.has(key))buckets.set(key,[]);
     buckets.get(key).push(view);
   }
 }
 geometry.dispose();
}
export function rigImportedWheels(shell,modelId,car,THREE) {
 const names=TARGETS[modelId];
 if(!names||car.wheels.length!==4)return {ready:false,reason:'Unsupported wheel layout.'};
 const targets=[];
 shell.traverse(o=>{if(names.includes(o.name))targets.push(o);});
 if(targets.length!==names.length)return {ready:false,reason:'Wheel subtrees not found.'};
 shell.updateMatrixWorld(true);
 const buckets=new Map();
 try {
   for(const target of targets)target.traverse(o=>{if(o.isMesh)extractMesh(o,shell,THREE,buckets);});
   const parts=[];
   for(const key of CORNERS) {
     const meshes=buckets.get(key)||[],box=new THREE.Box3();
     for(const mesh of meshes)box.union(mesh.geometry.boundingBox);
     const size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
     if(!meshes.length||size.y<0.22||size.y>1.35||size.x>1.45||size.z>1.5||
        Math.abs(center.x)<0.35||Math.abs(center.z)<0.5)
       throw Error('Uncertain wheel segmentation '+key+' ('+size.toArray().map(n=>n.toFixed(2)).join(',')+').');
     parts.push({key,meshes,center});
   }
   const mapped=[];
   for(const part of parts) {
     const candidates=car.wheels.map((w,index)=>({index,pos:w.position})).filter(w=>
       Math.sign(w.pos.x)===Math.sign(part.center.x)&&Math.sign(w.pos.z)===Math.sign(part.center.z));
     const all=candidates.length?candidates:car.wheels.map((w,index)=>({index,pos:w.position}));
     all.sort((a,b)=>Math.hypot(a.pos.x-part.center.x,a.pos.z-part.center.z)-
       Math.hypot(b.pos.x-part.center.x,b.pos.z-part.center.z));
     const index=all[0].index;
     if(mapped.some(w=>w.index===index))throw Error('Duplicate wheel binding');
     const pivot=new THREE.Group();
     pivot.name='Sketchfab physics wheel '+part.key;
     for(const mesh of part.meshes){
       mesh.geometry.translate(-part.center.x,-part.center.y,-part.center.z);
       pivot.add(mesh);
     }
     mapped.push({index,pivot});
   }
   for(const target of targets)target.visible=false;
   for(const wheel of mapped)car.add(wheel.pivot);
   for(const wheel of car.wheels)wheel.wheelObject.visible=false;
   car.userData.sketchfabWheelRig=mapped;
   return {ready:true,wheelCount:mapped.length,source:modelId};
 } catch(error) {
   for(const meshes of buckets.values())for(const mesh of meshes)mesh.geometry.dispose();
   return {ready:false,reason:String(error.message||error).slice(0,180),source:modelId};
 }
}
/* RaycastVehicle wheel center = connectionY - suspensionLength. At rest the
   tire contact is centerY-radius. Spawn from actual radius + travel. */
export function chassisHeightForGround(ground,infos,clearance=0.08) {
 if(!Number.isFinite(ground))throw Error('Invalid ground height');
 if(!infos?.length)return ground+0.9;
 return Math.max(...infos.map(w=>ground-w.chassisConnectionPointLocal.y+
     w.suspensionRestLength+w.radius+clearance));
}
