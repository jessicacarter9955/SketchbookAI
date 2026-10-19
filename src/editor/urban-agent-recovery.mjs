import {shortestUrbanPath} from './urban-navigation.mjs';

// Select a reachable destination DIFFERENT from the current graph node.
// The previous modulo-time choice often returned a one-node route, leaving
// a ped's walk animation running indefinitely without any world displacement.
export function nextUrbanPedestrianRoute(graph, from, seed, journey = 0) {
  const nodes=graph?.nodes||[];
  if(nodes.length<2)return [];
  const start=((seed*29+journey*43)%nodes.length+nodes.length)%nodes.length;
  for(let attempt=0;attempt<Math.min(nodes.length,24);attempt++){
    const target=nodes[(start+attempt*31+attempt)%nodes.length];
    if(Math.hypot(target.x-from.x,target.z-from.z)<8)continue;
    const path=shortestUrbanPath(graph,from,target);
    if(path.length>1)return path;
  }
  // Stay on the real graph even if the desired long-distance node is isolated.
  const nearest=nodes.reduce((best,n)=>!best||Math.hypot(n.x-from.x,n.z-from.z)<Math.hypot(best.x-from.x,best.z-from.z)?n:best);
  const edge=nearest?.edges?.[journey%(nearest.edges?.length||1)];
  const target=edge&&graph.byKey.get(edge.to);
  return target?shortestUrbanPath(graph,from,target):[];
}
