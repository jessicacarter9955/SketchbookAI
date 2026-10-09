import * as THREE from 'three';

// Experimental, native Three.js articulated mannequin. This builds NEW
// articulated geometry; it does not pretend to automatically skin a GLB.
export function createProceduralHumanoid({color=0xdde5e9,accent=0x7b96aa}={}) {
  const root=new THREE.Group();root.name='Experimental procedural humanoid';
  const skin=new THREE.MeshStandardMaterial({color,roughness:.83});
  const jointMaterial=new THREE.MeshStandardMaterial({color:accent,roughness:.92});
  const ball=new THREE.SphereGeometry(.085,10,8);
  const parts={};
  function piece(parent,name,w,h,d,y,material=skin) {
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);
    mesh.name=name;mesh.position.y=y;mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }
  function joint(parent,name,x,y,z=0) {
    const pivot=new THREE.Group();pivot.name=name;pivot.position.set(x,y,z);
    const marker=new THREE.Mesh(ball,jointMaterial);marker.castShadow=true;pivot.add(marker);
    parent.add(pivot);parts[name]=pivot;return pivot;
  }
  const pelvis=joint(root,'hips',0,.95);
  piece(pelvis,'hipsMesh',.43,.24,.24,.05);
  const spine=joint(pelvis,'spine',0,.15);
  piece(spine,'torso',.69,.76,.34,.37);
  const neck=joint(spine,'neck',0,.81);
  piece(neck,'head',.35,.40,.34,.25);
  for(const [side,sign] of [['left',-1],['right',1]]) {
    const shoulder=joint(spine,side+'Shoulder',sign*.39,.68);
    piece(shoulder,side+'UpperArm',.22,.43,.23,-.23);
    const elbow=joint(shoulder,side+'Elbow',0,-.46);
    piece(elbow,side+'Forearm',.19,.39,.2,-.20);
    const wrist=joint(elbow,side+'Wrist',0,-.42);
    piece(wrist,side+'Hand',.21,.20,.17,-.12);
    const hip=joint(pelvis,side+'Hip',sign*.19,-.13);
    piece(hip,side+'Thigh',.29,.43,.30,-.24);
    const knee=joint(hip,side+'Knee',0,-.48);
    piece(knee,side+'Shin',.25,.44,.26,-.23);
    const ankle=joint(knee,side+'Ankle',0,-.46);
    piece(ankle,side+'Foot',.30,.15,.45,-.07).position.z=.10;
  }
  return {object:root,joints:parts,materials:[skin,jointMaterial],pose:(time=0,mode='talk')=>{
    const t=Number.isFinite(time)?time:0,p=parts;
    const wave=mode==='talk'?1:0,point=mode==='point'?1:0;
    p.spine.rotation.z=Math.sin(t*1.3)*.035;p.spine.rotation.x=.025*Math.sin(t*.7);
    p.neck.rotation.z=Math.sin(t*.9)*.07;
    p.neck.rotation.x=Math.sin(t*1.8)*(.07*wave+.025);
    p.rightShoulder.rotation.z=-wave*(.55+.19*Math.sin(t*2.8))-point*1.35;
    p.rightShoulder.rotation.x=-wave*.38-point*.5;
    p.rightElbow.rotation.z=wave*(.38+.15*Math.sin(t*2.1))+point*.12;
    p.leftShoulder.rotation.z=wave*(.13+.12*Math.sin(t*1.6));
    p.leftElbow.rotation.z=-wave*.14;
    for(const name of ['leftHip','rightHip','leftKnee','rightKnee'])p[name].rotation.x=0;
  },dispose(){
    root.traverse(obj=>{if(obj.isMesh)obj.geometry.dispose();});
    ball.dispose();skin.dispose();jointMaterial.dispose();root.removeFromParent();
  }};
}
