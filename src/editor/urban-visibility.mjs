/** Conservative CPU-side building occlusion for streaming/render selection.
 * Only hides an object if EVERY sampled sightline is intercepted by an opaque
 * building which is not part of the target cluster. It NEVER affects physics.
 */
const EPS=1e-7;
export function segmentBoxEntry2D(from,to,building) {
  const x0=from.x-building.x,z0=from.z-building.z,x1=to.x-building.x,z1=to.z-building.z;
  const angle=building.rotation||0,c=Math.cos(angle),s=Math.sin(angle);
  const ax=c*x0-s*z0,az=s*x0+c*z0,bx=c*x1-s*z1,bz=s*x1+c*z1;
  const dx=bx-ax,dz=bz-az,halfW=building.w*.5,halfD=building.d*.5;
  let enter=0,exit=1;
  for(const [p,delta,min,max] of [[ax,dx,-halfW,halfW],[az,dz,-halfD,halfD]]) {
    if(Math.abs(delta)<EPS){if(p<min||p>max)return null;continue;}
    let first=(min-p)/delta,second=(max-p)/delta;
    if(first>second)[first,second]=[second,first];
    enter=Math.max(enter,first);exit=Math.min(exit,second);
    if(enter>exit)return null;
  }
  return enter>0.01&&enter<.985&&exit>enter?enter:null;
}
export function viewBlockedByBuilding(from,to,building) {
  if(!building||building.style==='glass')return false;
  const t=segmentBoxEntry2D(from,to,building);
  if(t===null)return false;
  const hitY=from.y+(to.y-from.y)*t;
  const base=building.ground||0;
  return hitY>base+.15&&hitY<base+(building.height||building.floors*3||0)-.25;
}
export function isHiddenBehindBuildings(from,targets,buildings,ignoreIndexes) {
  if(!from||!targets?.length)return false;
  const ignored=ignoreIndexes||new Set();
  return targets.every(to=>buildings.some((building,index)=>
    !ignored.has(index)&&viewBlockedByBuilding(from,to,building)));
}
export function isOccludedSector(from,cluster,buildings) {
  if(!cluster?.buildings?.length)return false;
  const x=cluster.x,z=cluster.z,size=cluster.size||42;
  if(Math.hypot(x-from.x,z-from.z)<75)return false; // no near-camera popping
  const height=Math.max(...cluster.buildings.map(({b})=>b.height||b.floors*3||8));
  const y=cluster.ground||0;
  const w=size*.36;
  const points=[
    {x,z,y:y+2},{x,z,y:y+height},
    {x:x-w,z:z-w,y:y+height*.8},{x:x+w,z:z-w,y:y+height*.8},
    {x:x-w,z:z+w,y:y+height*.8},{x:x+w,z:z+w,y:y+height*.8}
  ];
  return isHiddenBehindBuildings(from,points,buildings,
    new Set(cluster.buildings.map(x=>x.index)));
}
export function isOccludedTree(from,tree,buildings) {
  if(Math.hypot(from.x-tree.x,from.z-tree.z)<42)return false;
  const y=tree.y||0,h=(tree.kind==='median'?5:6.7)*(tree.scale||1);
  return isHiddenBehindBuildings(from,[
    {x:tree.x,z:tree.z,y:y+h*.5},
    {x:tree.x,z:tree.z,y:y+h},
    {x:tree.x-1.5,z:tree.z,y:y+h*.7},
    {x:tree.x+1.5,z:tree.z,y:y+h*.7}
  ],buildings);
}
/** Agent updates are frequent around the player, sparse at distance, and stop
 * entirely when too remote to interact with. Returned seconds are accumulated
 * wall-time, clamped to avoid huge movement after long stalls/background tabs.
 */
export function simulationCadence(distance,visible=false,interacting=false){
  if(interacting||distance<45)return 0;
  if(distance<100)return visible?.08:.16;
  if(distance<190)return visible?.20:.45;
  if(distance<285)return .8;
  return Infinity;
}
export function advanceSimulationClock(agent,dt,distance,visible,interacting=false){
  const interval=simulationCadence(distance,visible,interacting);
  if(!Number.isFinite(interval)){
    agent.lodClock=0;
    return 0;
  }
  agent.lodClock=Math.min(1.25,(agent.lodClock||0)+Math.max(0,dt));
  if(interval&&agent.lodClock<interval)return 0;
  const elapsed=Math.min(.8,agent.lodClock);
  agent.lodClock=0;
  return elapsed;
}
