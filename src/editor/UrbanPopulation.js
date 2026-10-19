import * as THREE from 'three';
import {clone} from 'three/examples/jsm/utils/SkeletonUtils';
import {urbanNetworks,shortestUrbanPath,safeFollowingSpeed} from './urban-navigation.mjs';
import {advanceSimulationClock,isHiddenBehindBuildings} from './urban-visibility.mjs';
import {reactToPedestrianEvent,advancePedestrianResponse} from './gta-ped-response.mjs';
import {trafficSignalSpeedLimit,URBAN_SIGNAL} from './urban-traffic-signals.mjs';
import {nextUrbanPedestrianRoute} from './urban-agent-recovery.mjs';
import {nextUrbanCarSegment} from './urban-car-routing.mjs';
export class UrbanPopulation {
  constructor(world,person,car){
    this.world=world;this.net=urbanNetworks(world.levelRuntime.config);this.group=new THREE.Group();
    this.group.name='Urban AI traffic';world.graphicsWorld.add(this.group);
    this.cars=[];this.pedestrians=[];this.elapsed=0;
    this.visibilityElapsed=0;this.forward=new THREE.Vector3();
    this.simulationStats={activeCars:0,activePedestrians:0,sleepingCars:0,sleepingPedestrians:0,occludedAgents:0};
    const road=this.net.roads,nodes=this.net.pedestrians.nodes;
    const trafficCanInstance=!car.getObjectByProperty('isSkinnedMesh',true);
    for(let i=0;i<20;i++){
      // Simulation agents are cheap transforms. Their repeating car geometry
      // becomes a single InstancedMesh for each original mesh part.
      const seg=(i*19+7)%road.length,o=trafficCanInstance?new THREE.Group():clone(car);
      const a={object:o,seg,t:(i*.19)%1,speed:0,maxSpeed:5+i%4,seed:i};
      const bounds=new THREE.Box3().setFromObject(car);
      a.groundOffset=Number.isFinite(bounds.min.y)?Math.max(0.03,-bounds.min.y+0.03):0.6;
      if(!trafficCanInstance)this.group.add(o);
      this.cars.push(a);this.placeCar(a);
    }
    this.trafficBatches=[];
    if(trafficCanInstance)this.buildTrafficBatches(car);

    for(let i=0;i<36;i++){
      const p=nodes[(i*11+3)%nodes.length],o=clone(person);
      const speed=1.1+(i%4)*.12;
       const a={object:o,x:p.x,z:p.z,path:[],index:0,speed,normalSpeed:speed,health:100,state:'walking',seed:i};
       o.userData.urbanPedSeed=i;
       o.traverse(child=>{if(child.isMesh)child.userData.urbanPedSeed=i;});
      const bounds=new THREE.Box3().setFromObject(o);
      a.groundOffset=Number.isFinite(bounds.min.y)?Math.max(0.02,-bounds.min.y+0.02):0.65;
      if(person.animations?.length) {
        const clip=person.animations.find(c=>c.name==='walk')||person.animations.find(c=>c.name==='run');
        if(clip) {a.mixer=new THREE.AnimationMixer(o);a.walkAction=a.mixer.clipAction(clip);a.walkAction.play();}
      }
      this.group.add(o);this.pedestrians.push(a);this.nextDestination(a);this.placePed(a);
    }
    this.conversations=[];this.createConversations();
    this.stats={cars:this.cars.length,pedestrians:this.pedestrians.length,conversations:this.conversations.length};
  }
  buildTrafficBatches(template){
    template.updateMatrixWorld(true);
    const inverse=template.matrixWorld.clone().invert();
    const count=this.cars.length;
    template.traverse(mesh=>{
      if(!mesh.isMesh||!mesh.geometry)return;
      const relative=inverse.clone().multiply(mesh.matrixWorld);
      const batch=new THREE.InstancedMesh(mesh.geometry,mesh.material,count);
      batch.name='Urban traffic GPU instancing';
      batch.castShadow=mesh.castShadow;batch.receiveShadow=mesh.receiveShadow;
      batch.frustumCulled=false; // matrices move as cars drive
      this.group.add(batch);
      this.trafficBatches.push({batch,relative});
    });
    this.refreshTrafficBatches();
  }
  refreshTrafficBatches(){
    if(!this.trafficBatches?.length)return;
    const camera=this.world.camera, matrix=new THREE.Matrix4(),hidden=new THREE.Matrix4().makeScale(0,0,0);
    for(const {batch,relative} of this.trafficBatches){
      for(let i=0;i<this.cars.length;i++){
        const obj=this.cars[i].object;
        const visible=obj.position.distanceToSquared(camera.position)<260*260 && this.cars[i].renderAllowed!==false;
        obj.updateMatrix();
        matrix.copy(obj.matrix).multiply(relative);
        batch.setMatrixAt(i,visible?matrix:hidden);
      }
      batch.instanceMatrix.needsUpdate=true;
    }
  }
  placeCar(a){
    const s=this.net.roads[a.seg],x=s.a.x+(s.b.x-s.a.x)*a.t,z=s.a.z+(s.b.z-s.a.z)*a.t;
    a.object.position.set(x,this.world.levelRuntime.groundAt(x,z)+a.groundOffset,z);
    a.object.rotation.y=Math.atan2(s.b.x-s.a.x,s.b.z-s.a.z);
  }
  placePed(a){
    a.object.position.set(a.x,this.world.levelRuntime.groundAt(a.x,a.z)+a.groundOffset,a.z);
  }
  nextDestination(a){
    a.routeLeg=(a.routeLeg||0)+1;
    a.path=nextUrbanPedestrianRoute(this.net.pedestrians,{x:a.x,z:a.z},a.seed,a.routeLeg);
    a.index=0;
  }
  nearCrosswalk(p){
    return this.net.crosswalks.some(s=>{
      const dx=s.b.x-s.a.x,dz=s.b.z-s.a.z,t=Math.max(0,Math.min(1,((p.x-s.a.x)*dx+(p.z-s.a.z)*dz)/(dx*dx+dz*dz)));
      return Math.hypot(p.x-s.a.x-t*dx,p.z-s.a.z-t*dz)<2;
    });
  }

  // Ambient social encounters. Groups are positioned ON sidewalk segments,
  // face one another and alternate turn-taking with lightweight speech markers.
  createConversations(){
    const edges=this.net.sidewalks.filter((s,i)=>i%2===0&&s.length>8);
    const central=edges.sort((a,b)=>{
      const mid=s=>({x:(s.a.x+s.b.x)/2,z:(s.a.z+s.b.z)/2});
      const p=mid(a),q=mid(b);return p.x*p.x+p.z*p.z-q.x*q.x-q.z*q.z;
    });
    const canvas=document.createElement('canvas');canvas.width=128;canvas.height=80;
    const ctx=canvas.getContext('2d');ctx.fillStyle='rgba(23,35,48,.93)';
    ctx.beginPath();ctx.roundRect(6,6,116,54,18);ctx.fill();
    ctx.fillStyle='white';ctx.font='bold 40px sans-serif';ctx.textAlign='center';ctx.fillText('···',64,44);
    const material=new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),transparent:true,depthWrite:false});
    for(let g=0;g<Math.min(6,Math.floor(this.pedestrians.length/2));g++){
      const s=central[g*3%central.length],a=this.pedestrians[g*2],b=this.pedestrians[g*2+1];
      const dx=s.b.x-s.a.x,dz=s.b.z-s.a.z,mag=Math.hypot(dx,dz)||1;
      const x=(s.a.x+s.b.x)*.5,z=(s.a.z+s.b.z)*.5;
      const gap=1.35;
      const members=[a,b];
      members.forEach((ped,i)=>{
        ped.x=x+(i===0?-gap:gap)*dx/mag;
        ped.z=z+(i===0?-gap:gap)*dz/mag;
        ped.state='chatting';ped.chatGroup=g;ped.path=[];ped.index=0;
        ped.object.rotation.y=Math.atan2((i===0?1:-1)*dx,(i===0?1:-1)*dz);
        this.placePed(ped);
      });
      const bubble=new THREE.Sprite(material);bubble.scale.set(1.15,.72,1);
      this.group.add(bubble);
      this.conversations.push({members,bubble,elapsed:g*.83,location:{x,z}});
    }
  }
  updateConversations(dt){
    for(const group of this.conversations){
      if(group.members.some(member=>member.dialoguePaused||member.state!=='chatting')){group.bubble.visible=false;continue;}
      group.elapsed+=dt;
      const speaker=Math.floor(group.elapsed/2.8)%2;
      const p=group.members[speaker],q=group.members[1-speaker];
      group.bubble.position.set(p.x,this.world.levelRuntime.groundAt(p.x,p.z)+3.25,p.z);
      group.bubble.visible=true;
      for(const member of group.members){
        member.object.rotation.y=Math.atan2((member===p?q.x-p.x:p.x-q.x),(member===p?q.z-p.z:p.z-q.z));
        // Tiny conversational sway, without leaving the sidewalk.
        member.object.rotation.z=Math.sin(group.elapsed*2+(member===p?0:1.1))*.035;
      }
    }
  }
  /** Route world threats to real animated civilians and interrupt conversations. */
  onWorldEvent(event){
    const buildings=this.world.levelRuntime?.plan?.buildings||[];
    let count=0;
    for(const npc of this.pedestrians){
      const response=reactToPedestrianEvent(npc,event,this.net.pedestrians,buildings,this.elapsed);
      if(!response)continue;
      Object.assign(npc,response);count++;
      npc.object.rotation.z=0;
      if(npc.state==='dead'){
        npc.walkAction?.stop();
        npc.object.rotation.x=Math.PI/2;
      }
      if(npc.chatGroup!==undefined){
        const group=this.conversations[npc.chatGroup];
        if(group){
          group.bubble.visible=false;
          for(const partner of group.members)
            if(partner!==npc&&partner.state==='chatting'){partner.state='walking';partner.path=[];partner.index=0;}
        }
      }
      if(this.world.urbanDialogue?.active&&this.world.urbanDialogue.npc===npc)
        this.world.urbanDialogue.close();
    }
    if(count)this.lastGtaEvent={type:event.type,count,at:this.elapsed};
    return count;
  }
  /** Simulation LOD: full-rate near player; sparse updates in distant districts.
   * The active dialogue character, nearby cars and collision-related checks
   * retain full-rate updates regardless of what is visible on camera.
   */
  update(dt){
    dt=Math.max(0,Math.min(.1,dt||0));
    this.elapsed+=dt;
    const camera=this.world.camera;
    const player=this.world.editorPlayer;
    const focus=player?.controlledObject?.position||player?.position||camera.position;
    camera.getWorldDirection(this.forward);
    const buildings=this.world.levelRuntime?.plan?.buildings||[];
    this.visibilityElapsed+=dt;
    const refreshVisuals=this.visibilityElapsed>=.26;
    if(refreshVisuals)this.visibilityElapsed=0;
    if(player?.aiming&&player?.weaponName&&this.elapsed-(this.lastAimThreat??-Infinity)>.9){
      this.lastAimThreat=this.elapsed;
      const dir=camera.getWorldDirection(new THREE.Vector3());
      this.onWorldEvent({type:'aim',x:player.position.x,z:player.position.z,direction:{x:dir.x,z:dir.z}});
    }
    this.updateConversations(dt);
    const sim={activeCars:0,activePedestrians:0,sleepingCars:0,sleepingPedestrians:0,occludedAgents:0};
    const isFacing=(x,z)=>{
      const dx=x-camera.position.x,dz=z-camera.position.z;
      return (dx*this.forward.x+dz*this.forward.z)>-.15*Math.hypot(dx,dz);
    };
    const isObstructed=(x,y,z,height)=>{
      const from=camera.position;
      if(Math.hypot(from.x-x,from.z-z)<60)return false;
      return isHiddenBehindBuildings(from,[{x,y:y+height*.25,z},{x,y:y+height*.95,z}],buildings);
    };
    for(const a of this.cars){
      const p=a.object.position;
      const distance=Math.hypot(p.x-focus.x,p.z-focus.z);
      const facing=isFacing(p.x,p.z);
      const detailDt=advanceSimulationClock(a,dt,distance,facing,distance<55);
      if(refreshVisuals||a.renderAllowed===undefined){
        a.renderAllowed=p.distanceToSquared(camera.position)<260*260 &&
          !isObstructed(p.x,p.y-a.groundOffset,p.z,2.5);
        if(!a.renderAllowed)sim.occludedAgents++;
        if(!this.trafficBatches?.length)a.object.visible=a.renderAllowed;
      }
      if(!detailDt){sim.sleepingCars++;continue;}
      sim.activeCars++;
      const s=this.net.roads[a.seg],len=s.length;
      // Detailed vehicle separation and crosswalk checks only matter near
      // the active player; distant traffic remains moving using cheap lanes.
      let ahead=Infinity;
      if(distance<110){
        for(const b of this.cars)if(b!==a&&b.seg===a.seg&&b.t>a.t)
          ahead=Math.min(ahead,(b.t-a.t)*len);
        if(player&&distance<7)ahead=Math.min(ahead,distance);
        for(const ped of this.pedestrians){
          const d=Math.hypot(p.x-ped.x,p.z-ped.z);
          if(d<7&&this.nearCrosswalk(ped))ahead=Math.min(ahead,d);
        }
      }
      const signal=trafficSignalSpeedLimit(s,a.t,this.net.config,this.elapsed,a.maxSpeed);
      const stopT=Math.max(0,1-URBAN_SIGNAL.stopDistance/Math.max(1,len));
      // If a light turns red after the car passed its stop line, let it clear
      // the crossing; already waiting cars remain stopped until their green.
      const mustStop=signal.state.controlled&&!signal.state.green&&(a.waitingSignal||a.t<=stopT);
      if(!mustStop)a.waitingSignal=false;
      const target=Math.min(safeFollowingSpeed(ahead,a.maxSpeed),mustStop?signal.limit:a.maxSpeed);
      a.speed+=Math.max(-5*detailDt,Math.min(2*detailDt,(target-a.speed)*detailDt*3));
      const nextT=a.t+Math.max(0,a.speed)*detailDt/Math.max(1,len);
      if(mustStop){
        a.t=Math.min(nextT,stopT);
        if(a.t>=stopT-.0001){a.speed=0;a.waitingSignal=true;}
      }else a.t=nextT;
      if(a.t>=1){
        const next=nextUrbanCarSegment(this.net.roads,a.seg,a.seed+Math.floor(this.elapsed/12),this.cars.filter(car=>car!==a));
        if(next===null){a.t=.985;a.speed=0;} // Wait for a free physical lane, never snap back to the start.
        else {a.seg=next;a.t=0;}
      }
      this.placeCar(a);
    }
    this.refreshTrafficBatches();
    for(const a of this.pedestrians){
      const distance=Math.hypot(a.x-focus.x,a.z-focus.z);
      const facing=isFacing(a.x,a.z);
      const interacting=Boolean(a.dialoguePaused||distance<48);
      // Conversation groups stay at their fixed sidewalk location.
      if(refreshVisuals||a.renderAllowed===undefined){
        a.renderAllowed=a.object.position.distanceToSquared(camera.position)<220*220 &&
          !isObstructed(a.x,a.object.position.y-a.groundOffset,a.z,2);
        a.object.visible=a.renderAllowed;
        if(!a.renderAllowed)sim.occludedAgents++;
      }
      if(a.walkAction)a.walkAction.paused=a.state==='chatting'||a.state==='surrender'||!!a.dialoguePaused||!!a.waitingSince;
      if(a.mixer&&a.renderAllowed&&distance<95&&facing&&a.state!=='dead')a.mixer.update(dt);
      if(a.state==='dead'){sim.sleepingPedestrians++;continue;}
       if(advancePedestrianResponse(a,this.elapsed))this.nextDestination(a);
       if(a.state==='chatting'||a.state==='surrender'||a.dialoguePaused){if(interacting)sim.activePedestrians++;continue;}
      const detailDt=advanceSimulationClock(a,dt,distance,facing,interacting);
      if(!detailDt){sim.sleepingPedestrians++;continue;}
      sim.activePedestrians++;
      if(a.index>=a.path.length){if(a.state==='fleeing')continue;this.nextDestination(a);}
      const target=a.path[a.index];if(!target)continue;
      const dx=target.x-a.x,dz=target.z-a.z,d=Math.hypot(dx,dz);
      if(d<.35){a.index++;continue;}
      if(distance<110){
        const blocked=(this.nearCrosswalk(a)&&this.cars.some(c=>Math.hypot(c.object.position.x-a.x,c.object.position.z-a.z)<7))||
          this.pedestrians.some(b=>b!==a&&b.seed<a.seed&&Math.hypot(a.x-b.x,a.z-b.z)<.9);
        if(blocked){
          if(!a.waitingSince)a.waitingSince=this.elapsed;
          if(a.walkAction)a.walkAction.paused=true;
          if(this.elapsed-a.waitingSince>3.5){this.nextDestination(a);a.waitingSince=this.elapsed;}
          continue;
        }
      }
      a.waitingSince=0;
      if(a.walkAction)a.walkAction.paused=false;
      const step=Math.min(d,a.speed*detailDt);
      a.x+=dx/d*step;a.z+=dz/d*step;
      a.object.rotation.y=Math.atan2(dx,dz);this.placePed(a);
    }
    this.simulationStats=sim;
    this.stats.simulation=sim;
  }

  // Deterministic visual QA scene: positions come from the actual lane and
  // sidewalk graphs. No fake props; the same AI agents remain simulated.
  prepareCaptureScenario(){
    const nodes=this.net.pedestrians.nodes;
    const anchor=nodes.reduce((best,n)=>!best||n.x*n.x+n.z*n.z<best.x*best.x+best.z*best.z?n:best,null);
    const nearRoad=this.net.roads.map((r,i)=>({i,d:Math.hypot((r.a.x+r.b.x)/2-anchor.x,(r.a.z+r.b.z)/2-anchor.z)})).sort((a,b)=>a.d-b.d);
    const selected=[];
    for(const candidate of nearRoad){
      const segment=this.net.roads[candidate.i];
      const center={x:(segment.a.x+segment.b.x)/2,z:(segment.a.z+segment.b.z)/2};
      if(selected.every(item=>Math.hypot(item.center.x-center.x,item.center.z-center.z)>8))selected.push({i:candidate.i,center});
      if(selected.length>=this.cars.length)break;
    }
    this.cars.forEach((car,i)=>{car.seg=selected[i%selected.length].i;car.t=.5;car.speed=0;this.placeCar(car);});
    const ordered=nodes.slice().sort((a,b)=>Math.hypot(a.x-anchor.x,a.z-anchor.z)-Math.hypot(b.x-anchor.x,b.z-anchor.z));
    this.pedestrians.forEach((ped,i)=>{
      const node=ordered[i%ordered.length];
      if(ped.state==='chatting')return;
      ped.x=node.x;ped.z=node.z;ped.path=[];ped.index=0;this.nextDestination(ped);this.placePed(ped);
    });
    this.elapsed=0;this.conversations.forEach(g=>g.elapsed=0);
    this.refreshTrafficBatches();
    const chosen=this.cars.reduce((best,c)=>!best||c.object.position.distanceToSquared(this.pedestrians[0].object.position)<best.object.position.distanceToSquared(this.pedestrians[0].object.position)?c:best,null);
    return {anchor:{x:anchor.x,z:anchor.z},cars:this.cars.length,pedestrians:this.pedestrians.length,conversations:this.conversations.length,nearestCar:chosen.object.position.toArray()};
  }
  destroy(){this.group.removeFromParent();this.cars=[];this.pedestrians=[];}
}
