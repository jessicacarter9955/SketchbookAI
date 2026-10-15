/**
 * SanAndreasUnity-inspired pedestrian states, translated to a pure JS sidewalk
 * graph. No Unity code copied: Three.js world owns animations and models.
 */
export const GTA_PED_RESPONSE={gunshotRadius:72,aimRadius:17,fleeSpeed:3.4,fleeSeconds:9};
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const blocked=(p,buildings)=>buildings.some(b=>Math.abs(p.x-b.x)<(b.w||0)/2+.65&&Math.abs(p.z-b.z)<(b.d||0)/2+.65);
export function clearPedestrianSegment(a,b,buildings=[]){
  for(let j=1,n=Math.max(1,Math.ceil(dist(a,b)/1.5));j<=n;j++){
    const t=j/n;
    if(blocked({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t},buildings))return false;
  }
  return true;
}
/** Dijkstra on sidewalk/crosswalk links only; check buildings before each hop. */
export function escapeSidewalkPath(graph,origin,threat,buildings=[],maxTravel=78){
  if(!graph?.nodes?.length||!Number.isFinite(origin?.x)||!Number.isFinite(threat?.x))return [];
  const nearest=graph.nodes.reduce((best,n)=>!best||dist(n,origin)<dist(best,origin)?n:best,null);
  const costs=new Map([[nearest.key,0]]),prev=new Map(),pending=new Set([nearest.key]);
  while(pending.size){
    let key=null;
    for(const next of pending)if(key===null||costs.get(next)<costs.get(key))key=next;
    pending.delete(key);
    const node=graph.byKey.get(key);
    for(const edge of node.edges){
      if(!['sidewalk','crosswalk'].includes(edge.type))continue;
      const target=graph.byKey.get(edge.to);
      if(!target||!clearPedestrianSegment(node,target,buildings))continue;
      const walk=costs.get(key)+edge.length;
      if(walk<=maxTravel&&walk<(costs.get(edge.to)??Infinity)){
        costs.set(edge.to,walk);prev.set(edge.to,key);pending.add(edge.to);
      }
    }
  }
  let winner=null,best=-Infinity;
  for(const [key,walk] of costs){
    if(walk<3)continue;
    const node=graph.byKey.get(key),away=dist(node,threat)-dist(nearest,threat);
    const score=away*2.5-walk*.35;
    if(away>=5&&score>best){winner=key;best=score;}
  }
  if(!winner)return [];
  const keys=[winner];
  while(keys[0]!==nearest.key&&keys.length<=graph.nodes.length){
    const parent=prev.get(keys[0]);if(!parent)return [];
    keys.unshift(parent);
  }
  return keys[0]===nearest.key?keys.map(key=>{const {x,z}=graph.byKey.get(key);return {x,z};}):[];
}
export function reactToPedestrianEvent(a,event,graph,buildings=[],now=0){
  if(!a||!event||!['gunshot','aim','damage','vehicle-impact'].includes(event.type)||a.state==='dead')return null;
  if(!Number.isFinite(event.x)||!Number.isFinite(event.z))return null;
  const distance=dist(a,event),targeted=event.type==='damage'&&a.seed===event.targetSeed;
  if(targeted&&Math.max(0,(a.health??100)-(event.damage??0))<=0)
    return {state:'dead',health:0,path:[],index:0,speed:0,until:Infinity,lastReactionAt:now};
  const radius=event.type==='aim'?GTA_PED_RESPONSE.aimRadius:event.type==='gunshot'?GTA_PED_RESPONSE.gunshotRadius:36;
  if(!targeted&&distance>radius)return null;
  if(event.type==='aim'){
    const d=event.direction,l=Math.hypot(d?.x??0,d?.z??0);
    if(!l||((a.x-event.x)*d.x+(a.z-event.z)*d.z)/(l*Math.max(distance,.001))<.82)return null;
  }
  // Damage always registers, even when repeated shots arrive before the AI cooldown.
  const health=targeted?Math.max(0,(a.health??100)-(event.damage??0)):a.health??100;
  if(!targeted&&(a.lastReactionAt??-Infinity)+1.2>now&&a.state!=='chatting')return null;
  if(event.type==='aim'&&distance<8)
    return {state:'surrender',health,path:[],index:0,speed:0,until:now+5,lastReactionAt:now};
  return {state:'fleeing',health,path:escapeSidewalkPath(graph,a,event,buildings),
    index:0,speed:GTA_PED_RESPONSE.fleeSpeed,until:now+GTA_PED_RESPONSE.fleeSeconds,lastReactionAt:now};
}
export function advancePedestrianResponse(a,now){
  if(!['fleeing','surrender'].includes(a.state)||now<(a.until??0))return false;
  a.state='walking';a.speed=a.normalSpeed??1.2;a.path=[];a.index=0;return true;
}
