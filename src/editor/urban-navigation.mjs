// Pure, deterministic street networks for Sketchbook's procedural city.
// Cars use right-hand lanes; pedestrians stay on block perimeters and cross at corners.
export function urbanNetworks(config) {
  const {blocksX:nx,blocksZ:nz,blockSize:s,roadWidth:w,sidewalkWidth:sw}=config;
  const x0=-nx*s/2,z0=-nz*s/2,lane=Math.min(2.4,w*.24);
  const roads=[],walks=[],crossings=[];
  const key=(x,z)=>`${Math.round(x*100)}:${Math.round(z*100)}`;
  const add=(graph,a,b,type)=>graph.push({a,b,type,length:Math.hypot(b.x-a.x,b.z-a.z)});
  // Directed two-way road segments. Right-hand lane placement is tied to direction.
  for(let iz=0;iz<=nz;iz++)for(let ix=0;ix<nx;ix++){
    const z=z0+iz*s,x=x0+ix*s;
    add(roads,{x,z:z+lane},{x:x+s,z:z+lane},'lane');
    add(roads,{x:x+s,z:z-lane},{x,z:z-lane},'lane');
  }
  for(let ix=0;ix<=nx;ix++)for(let iz=0;iz<nz;iz++){
    const x=x0+ix*s,z=z0+iz*s;
    add(roads,{x:x-lane,z},{x:x-lane,z:z+s},'lane');
    add(roads,{x:x+lane,z:z+s},{x:x+lane,z},'lane');
  }
  // Walk on the inner sidewalk edge of each city block, safely clear of buildings.
  const inset=w/2+Math.max(.85,sw*.42),half=s/2-inset;
  for(let ix=0;ix<nx;ix++)for(let iz=0;iz<nz;iz++){
    const cx=x0+(ix+.5)*s,cz=z0+(iz+.5)*s;
    const a={x:cx-half,z:cz-half},b={x:cx+half,z:cz-half},c={x:cx+half,z:cz+half},d={x:cx-half,z:cz+half};
    for(const [p,q] of [[a,b],[b,c],[c,d],[d,a]]){add(walks,p,q,'sidewalk');add(walks,q,p,'sidewalk');}
  }
  // Crosswalk connectors are restricted to the gaps between adjacent blocks.
  for(let ix=0;ix<nx;ix++)for(let iz=0;iz<nz;iz++){
    const cx=x0+(ix+.5)*s,cz=z0+(iz+.5)*s;
    if(ix<nx-1)for(const side of [-1,1]){
      const z=cz+side*half,x=cx+half;
      add(crossings,{x,z},{x:x+s-2*half,z},'crosswalk');
    }
    if(iz<nz-1)for(const side of [-1,1]){
      const x=cx+side*half,z=cz+half;
      add(crossings,{x,z},{x,z:z+s-2*half},'crosswalk');
    }
  }
  // For traffic and pedestrian paths, reuse graph nodes by position, not object identity.
  const build=(segments,bidirectional=false)=>{
    const nodes=new Map();
    const node=p=>{const k=key(p.x,p.z);if(!nodes.has(k))nodes.set(k,{...p,key:k,edges:[]});return nodes.get(k);};
    for(const seg of segments){const a=node(seg.a),b=node(seg.b);a.edges.push({to:b.key,length:seg.length,type:seg.type});if(bidirectional)b.edges.push({to:a.key,length:seg.length,type:seg.type});}
    return {nodes:[...nodes.values()],byKey:nodes};
  };
  const ped=build([...walks,...crossings],true);
  return {roads,sidewalks:walks,crosswalks:crossings,pedestrians:ped,config};
}

export function shortestUrbanPath(graph,from,to){
  if(!graph?.nodes?.length)return [];
  const nearest=p=>graph.nodes.reduce((best,n)=>!best||Math.hypot(n.x-p.x,n.z-p.z)<Math.hypot(best.x-p.x,best.z-p.z)?n:best,null);
  const start=nearest(from),end=nearest(to),dist=new Map([[start.key,0]]),parent=new Map(),pending=new Set([start.key]);
  while(pending.size){
    let id=null;for(const k of pending)if(id===null||dist.get(k)<dist.get(id))id=k;
    pending.delete(id);if(id===end.key)break;
    for(const edge of graph.byKey.get(id).edges){
      const cost=dist.get(id)+edge.length;
      if(cost<(dist.get(edge.to)??Infinity)){dist.set(edge.to,cost);parent.set(edge.to,id);pending.add(edge.to);}
    }
  }
  if(start.key!==end.key&&!parent.has(end.key))return [];
  const ids=[end.key];while(ids[0]!==start.key)ids.unshift(parent.get(ids[0]));
  return ids.map(k=>{const n=graph.byKey.get(k);return {x:n.x,z:n.z};});
}

// Route a car on road segments only, with precise lane coordinates (not sidewalks).
// Segments are traversed in the given direction; traffic selects a destination segment
// with consistent heading at the next road junction.
export function chooseRoadSegment(network,point,previous=-1){
  let best=-1,score=Infinity;
  network.roads.forEach((r,i)=>{
    if(i===previous)return;
    const d=Math.hypot(r.a.x-point.x,r.a.z-point.z);
    if(d<score){best=i;score=d;}
  });
  return best;
}

export function safeFollowingSpeed(distance,speedLimit=8){
  if(distance<=4)return 0;
  return Math.min(speedLimit,Math.max(0,(distance-4)*.75));
}
