import {urbanNetworks} from './urban-navigation.mjs';
export const CAR_MARKETPLACES=['sketchfab','fab'];
export function marketplaceParkingSlots(config,spawn){
 const roads=urbanNetworks(config).roads,candidates=[];
 for(const road of roads){
  const dx=road.b.x-road.a.x,dz=road.b.z-road.a.z,len=road.length;
  if(len<config.roadWidth+9)continue;
  const projection=((spawn[0]-road.a.x)*dx+(spawn[2]-road.a.z)*dz)/(len*len),trim=(config.roadWidth/2+4)/len;
  const t=Math.max(trim,Math.min(1-trim,projection)),x=road.a.x+t*dx,z=road.a.z+t*dz,d=Math.hypot(x-spawn[0],z-spawn[2]);
  if(d>3.5&&d<24)candidates.push({x,z,d,heading:Math.atan2(dx,dz)});
 }
 candidates.sort((a,b)=>a.d-b.d);
 const out=[];for(const c of candidates)if(out.every(p=>Math.hypot(p.x-c.x,p.z-c.z)>6)){out.push(c);if(out.length===2)break;}
 return out;
}
