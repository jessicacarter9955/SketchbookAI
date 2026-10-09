import * as THREE from 'three';
import {clone} from 'three/examples/jsm/utils/SkeletonUtils';
import {urbanNetworks,shortestUrbanPath,safeFollowingSpeed} from './urban-navigation.mjs';
export class UrbanPopulation {
  constructor(world,person,car){
    this.world=world;this.net=urbanNetworks(world.levelRuntime.config);this.group=new THREE.Group();
    this.group.name='Urban AI traffic';world.graphicsWorld.add(this.group);
    this.cars=[];this.pedestrians=[];this.elapsed=0;
    const road=this.net.roads,nodes=this.net.pedestrians.nodes;
    for(let i=0;i<20;i++){
      const seg=(i*19+7)%road.length,o=clone(car);
      const a={object:o,seg,t:(i*.19)%1,speed:0,maxSpeed:5+i%4,seed:i};
      this.group.add(o);this.cars.push(a);this.placeCar(a);
    }
    for(let i=0;i<36;i++){
      const p=nodes[(i*11+3)%nodes.length],o=clone(person);
      const a={object:o,x:p.x,z:p.z,path:[],index:0,speed:1.1+(i%4)*.12,seed:i};
      this.group.add(o);this.pedestrians.push(a);this.nextDestination(a);this.placePed(a);
    }
    this.conversations=[];this.createConversations();
    this.stats={cars:this.cars.length,pedestrians:this.pedestrians.length,conversations:this.conversations.length};
  }
  placeCar(a){
    const s=this.net.roads[a.seg],x=s.a.x+(s.b.x-s.a.x)*a.t,z=s.a.z+(s.b.z-s.a.z)*a.t;
    a.object.position.set(x,this.world.levelRuntime.groundAt(x,z)+.6,z);
    a.object.rotation.y=Math.atan2(s.b.x-s.a.x,s.b.z-s.a.z);
  }
  placePed(a){
    a.object.position.set(a.x,this.world.levelRuntime.groundAt(a.x,a.z)+.65,a.z);
  }
  nextDestination(a){
    const nodes=this.net.pedestrians.nodes;
    const n=nodes[(a.seed*31+Math.floor(this.elapsed/18)*17+nodes.length/3|0)%nodes.length];
    a.path=shortestUrbanPath(this.net.pedestrians,{x:a.x,z:a.z},n);a.index=0;
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
  update(dt){
    dt=Math.max(0,Math.min(.05,dt||0));this.elapsed+=dt;this.updateConversations(dt);
    const player=this.world.editorPlayer;
    for(const a of this.cars){
      const s=this.net.roads[a.seg],len=s.length;
      let ahead=Infinity;
      for(const b of this.cars)if(b!==a&&b.seg===a.seg&&b.t>a.t)ahead=Math.min(ahead,(b.t-a.t)*len);
      const p=a.object.position;
      if(player){const d=Math.hypot(p.x-player.position.x,p.z-player.position.z);if(d<7)ahead=Math.min(ahead,d);}
      for(const b of this.pedestrians)if(this.nearCrosswalk(b)&&Math.hypot(p.x-b.x,p.z-b.z)<7)ahead=Math.min(ahead,Math.hypot(p.x-b.x,p.z-b.z));
      const target=safeFollowingSpeed(ahead,a.maxSpeed);
      a.speed+=Math.max(-5*dt,Math.min(2*dt,(target-a.speed)*dt*3));
      a.t+=Math.max(0,a.speed)*dt/len;
      if(a.t>=1){
        const options=this.net.roads.map((r,i)=>({i,d:Math.hypot(r.a.x-s.b.x,r.a.z-s.b.z)})).filter(o=>o.i!==a.seg&&o.d<this.net.config.roadWidth+3).sort((x,y)=>x.d-y.d);
        if(options.length)a.seg=options[(a.seed+Math.floor(this.elapsed/12))%Math.min(2,options.length)].i;
        a.t=0;
      }
      this.placeCar(a);
    }
    for(const a of this.pedestrians){
      if(a.state==='chatting')continue;
      if(a.index>=a.path.length)this.nextDestination(a);
      const t=a.path[a.index];if(!t)continue;
      const dx=t.x-a.x,dz=t.z-a.z,d=Math.hypot(dx,dz);
      if(d<.35){a.index++;continue;}
      if(this.nearCrosswalk(a)&&this.cars.some(c=>Math.hypot(c.object.position.x-a.x,c.object.position.z-a.z)<7))continue;
      if(this.pedestrians.some(b=>b!==a&&b.seed<a.seed&&Math.hypot(a.x-b.x,a.z-b.z)<.9))continue;
      const step=Math.min(d,a.speed*dt);a.x+=dx/d*step;a.z+=dz/d*step;
      a.object.rotation.y=Math.atan2(dx,dz);this.placePed(a);
    }
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
    const chosen=this.cars.reduce((best,c)=>!best||c.object.position.distanceToSquared(this.pedestrians[0].object.position)<best.object.position.distanceToSquared(this.pedestrians[0].object.position)?c:best,null);
    return {anchor:{x:anchor.x,z:anchor.z},cars:this.cars.length,pedestrians:this.pedestrians.length,conversations:this.conversations.length,nearestCar:chosen.object.position.toArray()};
  }
  destroy(){this.group.removeFromParent();this.cars=[];this.pedestrians=[];}
}
