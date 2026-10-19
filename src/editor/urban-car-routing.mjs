
// Choose an actual drivable lane leaving the current intersection. A car must
// never silently wrap to t=0 on its current road if no continuation exists.
export function nextUrbanCarSegment(roads, current, seed=0, cars=[]) {
  const road=roads[current];
  if(!road)return null;
  const headingX=road.b.x-road.a.x,headingZ=road.b.z-road.a.z;
  const span=Math.hypot(headingX,headingZ)||1;
  const candidates=[];
  for(let i=0;i<roads.length;i++){
    if(i===current)continue;
    const r=roads[i],distance=Math.hypot(r.a.x-road.b.x,r.a.z-road.b.z);
    if(distance>6.5)continue;
    if(cars.some(c=>c.seg===i&&c.t<.19))continue;
    const len=Math.hypot(r.b.x-r.a.x,r.b.z-r.a.z)||1;
    const dot=(headingX*(r.b.x-r.a.x)+headingZ*(r.b.z-r.a.z))/(span*len);
    // Same heading first; then right/left turn; U-turn only on dead ends.
    const tier=dot>.7?0:dot>-.3?1:2;
    candidates.push({i,tier,distance});
  }
  if(!candidates.length)return null;
  const tier=Math.min(...candidates.map(c=>c.tier));
  const best=candidates.filter(c=>c.tier===tier).sort((a,b)=>a.distance-b.distance||a.i-b.i);
  return best[Math.abs(seed)%best.length].i;
}
