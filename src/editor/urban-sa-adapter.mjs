import {stepOriginalPath} from './sa-agent-navigation.mjs';

// Keep the shortest sidewalk/crosswalk route chosen by Urban AI, but advance
// it with the SAME deterministic directed-link stepping as San Andreas.
// Every link comes from the city's legal pedestrian graph: never a straight
// cut across buildings or into vehicle lanes.
export function makeUrbanPedestrianSARoute(origin,path){
  if(!Number.isFinite(origin?.x)||!Number.isFinite(origin?.z)||!Array.isArray(path))return null;
  const positions=[{x:origin.x,z:origin.z},...path]
    .filter(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.z));
  const distinct=[];
  for(const p of positions){
    if(!distinct.length||Math.hypot(p.x-distinct.at(-1).x,p.z-distinct.at(-1).z)>.02)
      distinct.push({x:p.x,z:p.z,y:0});
  }
  if(distinct.length<2)return null;
  const nodes=distinct.map((p,i)=>({...p,key:String(i),
    edges:i<distinct.length-1?[{to:String(i+1),
      length:Math.hypot(distinct[i+1].x-p.x,distinct[i+1].z-p.z),type:'sidewalk'}]:[]}));
  return {network:{nodes,byKey:new Map(nodes.map(n=>[n.key,n]))},
    state:{key:'0',to:null,t:0,turns:0},lastKey:String(nodes.length-1)};
}
export function advanceUrbanPedestrianSA(route,dt,speed,seed=0){
  if(!route)return null;
  const pose=stepOriginalPath(route.network,route.state,dt,speed,seed);
  return pose?{...pose,finished:route.state.key===route.lastKey&&!route.state.to}:null;
}
