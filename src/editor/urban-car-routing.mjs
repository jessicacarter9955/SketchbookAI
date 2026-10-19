import {nextSanAndreasEdge} from './sa-agent-navigation.mjs';

// GTA-SA directed-node turn selection, applied to this city's *own* lanes.
// No Rockstar map nodes or assets are relabeled as the Urban Photoreal map.
export function nextUrbanCarSegment(roads,current,seed=0,cars=[]){
  const road=roads?.[current];if(!road)return null;
  const headingX=road.b.x-road.a.x,headingZ=road.b.z-road.a.z;
  const span=Math.hypot(headingX,headingZ)||1,candidates=[];
  for(let i=0;i<roads.length;i++){
    if(i===current)continue;
    const r=roads[i],distance=Math.hypot(r.a.x-road.b.x,r.a.z-road.b.z);
    if(distance>6.5)continue;
    // SA traffic cannot enter a blocked junction/occupied lane.
    if(cars.some(c=>c.seg===i&&c.t<.19))continue;
    const length=Math.hypot(r.b.x-r.a.x,r.b.z-r.a.z)||1;
    const dot=(headingX*(r.b.x-r.a.x)+headingZ*(r.b.z-r.a.z))/(span*length);
    const tier=dot>.7?0:dot>-.3?1:2;
    candidates.push({i,tier,distance,length});
  }
  if(!candidates.length)return null;
  const tier=Math.min(...candidates.map(c=>c.tier));
  const best=candidates.filter(c=>c.tier===tier).sort((a,b)=>a.distance-b.distance||a.i-b.i);
  // Reuse SA edge chooser's seeded, directed, no-impossible-edge routing.
  const source={key:String(current),edges:best.map(c=>({to:String(c.i),length:c.length}))};
  const byKey=new Map([[source.key,source]]);
  for(const c of best)byKey.set(String(c.i),{key:String(c.i),x:roads[c.i].a.x,z:roads[c.i].a.z});
  const edge=nextSanAndreasEdge({byKey},source,seed);
  return edge?Number(edge.to):null;
}
