// SA-inspired incident, pursuit and wanted-level logic. This state machine
// doesn't spawn fake police uniforms or vehicles: authentic police models
// will be attached to dispatched units when available.
const SERIOUS=new Set(['gunshot','vehicle-impact','damage']);
const POINTS={aim:0,gunshot:1,'vehicle-impact':2,damage:2};
export function createUrbanPoliceDispatch(){
  return {wanted:0,heat:0,lastIncidentAt:-Infinity,lastDecayAt:0,
    lastPosition:null,incidentCount:0,dispatchRadius:0};
}
export function recordUrbanPoliceIncident(state,event,now){
  if(!state||!event||!Number.isFinite(now)||!Number.isFinite(event.x)||!Number.isFinite(event.z))
    return state;
  const points=POINTS[event.type]??0;
  if(!points||!SERIOUS.has(event.type)||now-state.lastIncidentAt<1.2)return state;
  state.heat=Math.min(36,state.heat+points);
  state.wanted=Math.min(6,Math.ceil(state.heat/5));
  state.dispatchRadius=45+state.wanted*38;
  state.lastPosition={x:event.x,z:event.z};
  state.lastIncidentAt=now;state.lastDecayAt=now;state.incidentCount++;
  return state;
}
export function advanceUrbanPoliceDispatch(state,now){
  if(!state||!Number.isFinite(now))return state;
  // SA-style gradual de-escalation rather than clearing wanted on camera exit.
  if(!Number.isFinite(state.lastIncidentAt)||now-state.lastIncidentAt<40)return state;
  const elapsed=Math.max(0,now-(state.lastDecayAt||state.lastIncidentAt));
  const ticks=Math.floor(elapsed/18);
  if(ticks){
    state.heat=Math.max(0,state.heat-ticks*2);
    state.wanted=state.heat?Math.min(6,Math.ceil(state.heat/5)):0;
    state.lastDecayAt=(state.lastDecayAt||state.lastIncidentAt)+ticks*18;
  }
  return state;
}
export function urbanPolicePursuitTarget(state,officer,now){
  if(!state?.wanted||!state.lastPosition||!officer||!Number.isFinite(now))return null;
  if(Math.hypot(officer.x-state.lastPosition.x,officer.z-state.lastPosition.z)>state.dispatchRadius)
    return null;
  return {x:state.lastPosition.x,z:state.lastPosition.z,wanted:state.wanted,
    activeForSeconds:Math.max(0,now-state.lastIncidentAt)};
}
