import * as THREE from 'three';
import {interpretWorldCommand} from './world-commands.mjs';

// Lightweight localized, animated rain: no third-party services or asset downloads.
export class WorldWeather {
  constructor(world) {
    this.world=world;this.enabled=false;this.intensity=1;
    this.count=480;this.positions=new Float32Array(this.count*6);
    this.seed=new Float32Array(this.count*3);
    for(let i=0;i<this.count;i++){
      this.seed[i*3]=Math.random()*42-21;
      this.seed[i*3+1]=Math.random()*24;
      this.seed[i*3+2]=Math.random()*42-21;
    }
    this.geometry=new THREE.BufferGeometry();
    this.geometry.setAttribute('position',new THREE.BufferAttribute(this.positions,3));
    this.material=new THREE.LineBasicMaterial({color:0xa5cdec,transparent:true,opacity:.51,depthWrite:false});
    this.streaks=new THREE.LineSegments(this.geometry,this.material);
    this.streaks.name='User commanded rain';
    this.streaks.frustumCulled=false;
    this.streaks.visible=false;
    this.world.graphicsWorld.add(this.streaks);
    this.start=performance.now();
    this.last=performance.now();
    this.raf=0;
    this.draw=this.draw.bind(this);
    this.raf=requestAnimationFrame(this.draw);
  }
  execute(text) {
    const result=interpretWorldCommand(text);
    if(result.type==='rain')this.setRain(result.enabled,result.intensity);
    return result;
  }
  setRain(enabled,intensity=1){
    this.enabled=Boolean(enabled);
    this.intensity=Math.max(.3,Math.min(1.7,Number(intensity)||1));
    this.streaks.visible=this.enabled;
    if(this.enabled)this.start=performance.now();
  }
  draw(now) {
    this.raf=requestAnimationFrame(this.draw);
    if(!this.enabled)return;
    const time=(now-this.start)/1000;
    const camera=this.world.camera;
    this.streaks.position.set(camera.position.x,camera.position.y+1,camera.position.z);
    const a=this.positions;
    for(let i=0;i<this.count;i++){
      const o=i*3,j=i*6;
      const x=this.seed[o],z=this.seed[o+2];
      const fall=(this.seed[o+1]-(time*(12+this.intensity*7)+i%9))%24;
      const y=((fall+24)%24)-12;
      a[j]=x;a[j+1]=y;a[j+2]=z;
      a[j+3]=x-.09*this.intensity;a[j+4]=y-.55*this.intensity;a[j+5]=z;
    }
    this.geometry.attributes.position.needsUpdate=true;
    this.geometry.computeBoundingSphere();
    this.material.opacity=this.intensity > 1 ? 0.7 : 0.5;
  }
  dispose(){
    cancelAnimationFrame(this.raf);
    this.streaks.removeFromParent();
    this.geometry.dispose();this.material.dispose();
  }
}
