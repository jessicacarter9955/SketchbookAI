// Pure SA sector selection and render-scale policy, for reproducible CI tests.
export function saSectorDistanceXZ(point,b){
 if(!Array.isArray(b)||b.length!==6)return Infinity;
 const x=Math.max(b[0]-point.x,0,point.x-b[3]);
 const z=Math.max(b[2]-point.z,0,point.z-b[5]);
 return Math.hypot(x,z);
}
export function nearestSanAndreasSectors(sectors,point,radius=500,limit=10){
 const ordered=sectors.map(x=>({...x,distance:saSectorDistanceXZ(point,x.bounds)}))
   .filter(x=>Number.isFinite(x.distance))
   .sort((a,b)=>a.distance-b.distance);
 const within=ordered.filter(x=>x.distance<=radius);
 return (within.length?within:ordered.slice(0,1)).slice(0,limit);
}
export function sanAndreasResolutionStep(fps,current,min,max){
 if(!Number.isFinite(fps)||!Number.isFinite(current))return current;
 if(fps<43)return Math.max(min,Math.round((current-.08)*100)/100);
 if(fps>57)return Math.min(max,Math.round((current+.04)*100)/100);
 return current;
}
