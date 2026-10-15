/**
 * Deterministic four-way signal controllers for existing procedural city lanes.
 * No new geometry, extra vehicles or per-frame raycasting.
 */
export const URBAN_SIGNAL=Object.freeze({
  cycle:24,eastWestGreen:10,allRed:2,northSouthGreen:10,stopDistance:4.5
});
const close=(a,b)=>Math.abs(a-b)<0.0001;
export function intersectionForSegment(segment,config){
  if(!segment?.a||!segment?.b||!config)return null;
  const {blocksX:nx,blocksZ:nz,blockSize:s,roadWidth:w}=config;
  if(!(nx>1&&nz>1&&s>0&&w>0))return null;
  const x0=-nx*s/2,z0=-nz*s/2;
  const eastWest=close(segment.a.z,segment.b.z),northSouth=close(segment.a.x,segment.b.x);
  if(!eastWest&&!northSouth)return null;
  const ix=Math.round((segment.b.x-x0)/s),iz=Math.round((segment.b.z-z0)/s);
  // Only inner four-way junctions: outer intersections are uncontrolled.
  if(ix<=0||ix>=nx||iz<=0||iz>=nz)return null;
  const lane=Math.min(2.4,w*.24);
  if(eastWest){
    if(!close(segment.b.x,x0+ix*s)||!close(Math.abs(segment.b.z-(z0+iz*s)),lane))return null;
  }else{
    if(!close(segment.b.z,z0+iz*s)||!close(Math.abs(segment.b.x-(x0+ix*s)),lane))return null;
  }
  return {key:ix+':'+iz,axis:eastWest?'eastWest':'northSouth'};
}
export function trafficSignalState(segment,config,seconds){
  const intersection=intersectionForSegment(segment,config);
  if(!intersection)return {controlled:false,green:true,phase:'uncontrolled'};
  const phase=((seconds%URBAN_SIGNAL.cycle)+URBAN_SIGNAL.cycle)%URBAN_SIGNAL.cycle;
  const greenEW=phase<URBAN_SIGNAL.eastWestGreen;
  const greenNS=phase>=URBAN_SIGNAL.eastWestGreen+URBAN_SIGNAL.allRed &&
    phase<URBAN_SIGNAL.eastWestGreen+URBAN_SIGNAL.allRed+URBAN_SIGNAL.northSouthGreen;
  return {...intersection,controlled:true,
    green:intersection.axis==='eastWest'?greenEW:greenNS,
    phase:greenEW?'eastWest':greenNS?'northSouth':'allRed'};
}
export function trafficSignalSpeedLimit(segment,t,config,seconds,maxSpeed=8){
  const state=trafficSignalState(segment,config,seconds);
  if(state.green||!state.controlled)return {state,limit:maxSpeed,stop:false};
  const distance=Math.max(0,1-Math.max(0,Math.min(1,t)))*segment.length;
  const available=distance-URBAN_SIGNAL.stopDistance;
  if(available<=0)return {state,limit:0,stop:true};
  return {state,limit:Math.min(maxSpeed,Math.sqrt(2*3.5*available)),stop:false};
}
