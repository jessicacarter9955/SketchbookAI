import * as THREE from 'three';
import {miamiCoastLayout} from './urban-coast-layout.mjs';

// Lightweight Miami-style shoreline at the EAST edge of Urban Photoreal.
// This is a clearly procedural extension, not a converted Unreal level.
export function addUrbanMiamiCoast(group,plan,config,box){
  const coast=miamiCoastLayout(plan.bounds,config.seed);
  const sand=new THREE.MeshStandardMaterial({color:0xe6cca0,roughness:.96,metalness:0});
  const waterMat=new THREE.MeshStandardMaterial({color:0x218ba5,roughness:.27,metalness:.16,side:THREE.DoubleSide});
  // A physical beach floor connects the last road to the shoreline.
  const beach=box([coast.beachWidth,.24,coast.beachDepth],
    [coast.beachCenter,-.09,0],sand,true);
  beach.name='Miami beach · walkable sand';
  beach.userData.urbanCoast=true;

  const waterGeo=new THREE.PlaneGeometry(coast.seaWidth,coast.seaDepth,48,36);
  const a=waterGeo.getAttribute('position');
  for(let i=0;i<a.count;i++){
    const x=a.getX(i),z=a.getY(i);
    a.setZ(i,.045*Math.sin(x*.09+z*.035)+.025*Math.sin(z*.16-x*.075));
  }
  waterGeo.computeVertexNormals();
  const sea=new THREE.Mesh(waterGeo,waterMat);
  sea.rotation.x=-Math.PI/2;
  sea.position.set(coast.seaCenter,-.19,0);
  sea.receiveShadow=true;sea.name='Miami Atlantic coast · ocean';
  group.add(sea);

  // Two subtle surf lines; all palms share one trunk and one leaf draw call.
  const surfMat=new THREE.MeshStandardMaterial({color:0xb4e1d9,transparent:true,opacity:.72,roughness:.54});
  for(const shift of [1.2,3.4]){
    const foam=new THREE.Mesh(new THREE.PlaneGeometry(.55,coast.beachDepth),surfMat);
    foam.rotation.x=-Math.PI/2;foam.position.set(coast.shoreX+shift,-.115,0);
    foam.name='Miami beach · shore foam';group.add(foam);
  }
  const trunkGeo=new THREE.CylinderGeometry(.17,.33,5.6,7);
  const trunkMat=new THREE.MeshStandardMaterial({color:0x886247,roughness:.97});
  const trunks=new THREE.InstancedMesh(trunkGeo,trunkMat,Math.max(1,coast.palms.length));
  trunks.name='Miami palms · trunks (GPU instanced)';
  const leafGeo=new THREE.BufferGeometry(),vertices=[],triangles=[];
  for(let k=0;k<=8;k++){
    const t=k/8,spread=.48*Math.pow(Math.sin(Math.PI*t),.8);
    const elevation=Math.sin(Math.PI*t)*.75-t*1.15;
    vertices.push(t*3.7,elevation,-spread,t*3.7,elevation,spread);
    if(k<8){const n=k*2;triangles.push(n,n+1,n+2,n+1,n+3,n+2);}
  }
  leafGeo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  leafGeo.setIndex(triangles);leafGeo.computeVertexNormals();
  const leafMat=new THREE.MeshStandardMaterial({color:0x397958,side:THREE.DoubleSide,roughness:.92});
  const leavesPerTree=8,leaves=new THREE.InstancedMesh(leafGeo,leafMat,Math.max(1,coast.palms.length*leavesPerTree));
  leaves.name='Miami palms · fronds (GPU instanced)';
  const matrix=new THREE.Matrix4(),quat=new THREE.Quaternion(),pos=new THREE.Vector3(),scale=new THREE.Vector3();
  const up=new THREE.Vector3(0,1,0);
  for(let i=0;i<coast.palms.length;i++){
    const palm=coast.palms[i],s=palm.scale;
    matrix.compose(pos.set(palm.x,2.8*s,palm.z),quat.identity(),scale.set(s,s,s));
    trunks.setMatrixAt(i,matrix);
    for(let j=0;j<leavesPerTree;j++){
      quat.setFromAxisAngle(up,j*Math.PI*2/leavesPerTree+i*.21);
      matrix.compose(pos.set(palm.x,5.6*s,palm.z),quat,scale.set(s,s,s));
      leaves.setMatrixAt(i*leavesPerTree+j,matrix);
    }
  }
  trunks.instanceMatrix.needsUpdate=true;leaves.instanceMatrix.needsUpdate=true;
  trunks.castShadow=true;trunks.receiveShadow=true;leaves.castShadow=false;
  group.add(trunks,leaves);
  group.userData.miamiCoast={palms:coast.palms.length,shoreX:coast.shoreX,beachWidth:coast.beachWidth};
  return coast;
}
