// Read the real imported GLTF hierarchy: Three.js cannot infer joints from
// one merged static mesh. This diagnostic deliberately reports that case.
const ARM_PATTERN=/(?:right|r)[_. -]?(?:upperarm|upper_arm|arm)|(?:upperarm|upper_arm|arm)[_. -]?(?:right|r)/i;
const HEAD_PATTERN=/(?:^|[_ .-])(head|neck)(?:$|[_ .-])/i;
export function inspectHumanoidRig(root){
  const nodes=[],bones=[],skinned=[];
  root?.traverse?.(node=>{
    const entry={name:node.name||'(unnamed)',type:node.type,children:node.children?.length||0};
    if(node.isBone){bones.push(entry);nodes.push(node);}
    if(node.isSkinnedMesh)skinned.push({name:node.name||'(unnamed)',bones:node.skeleton?.bones?.map(b=>b.name)||[]});
  });
  const arms=nodes.filter(n=>ARM_PATTERN.test(n.name));
  const heads=nodes.filter(n=>HEAD_PATTERN.test(n.name));
  return {hasSkeleton:bones.length>0||skinned.length>0,boneCount:bones.length,skinnedMeshCount:skinned.length,bones,skinned,armNames:arms.map(n=>n.name),headNames:heads.map(n=>n.name),
    supportsRealArmGesture:arms.length>0};
}
export function findHumanoidJoint(root,type='rightArm'){
  let best=null;
  root?.traverse?.(node=>{
    if(!node.isBone||best)return;
    if(type==='rightArm'&&ARM_PATTERN.test(node.name))best=node;
    else if(type==='head'&&HEAD_PATTERN.test(node.name))best=node;
  });
  return best;
}
