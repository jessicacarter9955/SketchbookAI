import * as THREE from 'three';
import {clone} from 'three/examples/jsm/utils/SkeletonUtils';
import {urbanNetworks,shortestUrbanPath,safeFollowingSpeed} from './urban-navigation.mjs';
export class UrbanPopulation {
  constructor(world,person,car){
    this.world=world;this.net=urbanNetworks(world.levelRuntime.config);this.group=new THREE.Group();
    this.group.name='Urban AI traffic';world.graphicsWorld.add(this.group);
    this.cars=[];this.pedestrians=[];this.elapsed=0;
    const road=this.net.roads,nodes=this.net.pedestrians.nodes;
    for(let i=0;i<8;i++){
      const seg=(i*19+7)%road.length,o=clone(car);
      const a={object:o,seg,t:(i*.19)%1,speed:0,maxSpeed:5+i%4,seed:i};
      this.group.add(o);this.cars.push(a);this.placeCar(a);
    }
    for(let i=0;i<12;i++){
      const p=nodes[(i*11+3)%nodes.length],o=clone(person);
      const a={object:o,x:p.x,z:p.z,path:[],index:0,speed:1.1+(i%4)*.12,seed:i};
      this.group.add(o);this.pedestrians.push(a);this.nextDestination(a);this.placePed(a);
    }
    this.stats={cars:this.cars.length,pedestrians:this.pedestrians.length};
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
  update(dt){
    dt=Math.max(0,Math.min(.05,dt||0));this.elapsed+=dt;
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
  destroy(){this.group.removeFromParent();this.cars=[];this.pedestrians=[];}
}
