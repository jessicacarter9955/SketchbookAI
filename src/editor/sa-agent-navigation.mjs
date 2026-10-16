// Spatially bounded original SanAndreasUnity networks. Never invent road edges.
const TILE=100;
export function createSanAndreasSpatialIndex(network,cellSize=TILE){
 const cells=new Map(),nodes=network?.nodes||[];
 for(const node of nodes){
   if(!Number.isFinite(node.x)||!Number.isFinite(node.z))continue;
   const key=Math.floor(node.x/cellSize)+':'+Math.floor(node.z/cellSize);
   if(!cells.has(key))cells.set(key,[]);
   cells.get(key).push(node);
 }
 return {cells,cellSize,network};
}
export function nodesNear(index,x,z,radius=200,limit=32){
 if(!index?.network?.nodes?.length)return [];
 const {cells,cellSize}=index;
 const result=[],loX=Math.floor((x-radius)/cellSize),hiX=Math.floor((x+radius)/cellSize),
   loZ=Math.floor((z-radius)/cellSize),hiZ=Math.floor((z+radius)/cellSize),r2=radius*radius;
 for(let i=loX;i<=hiX;i++)for(let j=loZ;j<=hiZ;j++)for(const node of cells.get(i+':'+j)||[]){
   const d=(node.x-x)**2+(node.z-z)**2;
   if(d<=r2&&!node.roadBlock&&!node.emergencyOnly&&!(node.isWater))result.push({node,d});
 }
 result.sort((a,b)=>a.d-b.d);
 return result.slice(0,limit).map(x=>x.node);
}
export function nextSanAndreasEdge(graph,node,seed=0,previous=null){
 if(!graph?.byKey?.has(node?.key))return null;
 const options=(node.edges||[]).filter(e=>graph.byKey.has(e.to)&&e.length>.01&&
  !graph.byKey.get(e.to).roadBlock&&!graph.byKey.get(e.to).emergencyOnly);
 if(!options.length)return null;
 const allowed=options.filter(e=>e.to!==previous);
 const candidates=allowed.length?allowed:options;
 const index=(Math.imul((seed|0)+1,2654435761)>>>0)%candidates.length;
 return candidates[index];
}
export function stepOriginalPath(graph,state,dt,speed,seed){
 let travel=Math.max(0,Math.min(dt,.18))*Math.max(0,speed),hops=0;
 if(!graph?.byKey?.has(state.key))return null;
 while(travel>0&&hops++<6){
   const from=graph.byKey.get(state.key);
   if(!state.to||!graph.byKey.has(state.to)){
     const edge=nextSanAndreasEdge(graph,from,seed+hops+state.turns,state.previous);
     if(!edge)break;
     state.to=edge.to;state.t=0;state.turns++;
   }
   const to=graph.byKey.get(state.to),dist=Math.max(.01,Math.hypot(to.x-from.x,to.z-from.z));
   const remaining=(1-state.t)*dist;
   if(travel<remaining){state.t+=travel/dist;travel=0;break;}
   travel-=remaining;state.previous=state.key;state.key=state.to;state.to=null;state.t=0;
 }
 const a=graph.byKey.get(state.key),b=graph.byKey.get(state.to)||a;
 const t=Math.min(1,Math.max(0,state.t||0));
 return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t,
  heading:Math.atan2(b.x-a.x,b.z-a.z)};
}
