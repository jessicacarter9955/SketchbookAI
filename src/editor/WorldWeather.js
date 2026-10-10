import * as THREE from 'three';
import {interpretWorldCommands} from './world-commands.mjs';

// Free, local, deterministic world controls: the Sketchfab/Fab asset search remains separate.
const SEASON_COLORS={spring:0x76b664,summer:null,autumn:0xb77b35,winter:0xcbd8db};
const TIMES={
 sunrise:{angle:[-75,22,-30],sun:0xffa769,power:1.75,fill:0.42,exposure:0.96,fog:0xd1adb0},
 noon:{angle:[-50,85,55],sun:0xfff1df,power:3.2,fill:0.2,exposure:1.08,fog:0xb8c6cc},
 sunset:{angle:[75,13,35],sun:0xff9256,power:1.45,fill:0.38,exposure:0.94,fog:0xd19d84},
 night:{angle:[-35,55,-60],sun:0xa4bff7,power:0.52,fill:0.11,exposure:0.55,fog:0x111c36}
};
export class WorldWeather {
  constructor(world) {
    this.world=world;this.enabled=false;this.intensity=1;
    this.time='noon';this.season='summer';this.foggy=false;this.lightTone=null;this.direction=null;
    this.baseColors=new WeakMap();
    this.count=650;this.positions=new Float32Array(this.count*6);
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
    this.streaks.name='User commanded rain';this.streaks.frustumCulled=false;
    this.streaks.visible=false;this.world.graphicsWorld.add(this.streaks);
    this.moon=new THREE.Mesh(new THREE.SphereGeometry(7,20,14),new THREE.MeshBasicMaterial({color:0xf3f4d6,depthTest:false,fog:false}));
    this.moon.name='User commanded moon';this.moon.renderOrder=100;this.moon.visible=false;
    this.world.graphicsWorld.add(this.moon);
    this.start=performance.now();this.raf=0;
    this.draw=this.draw.bind(this);this.raf=requestAnimationFrame(this.draw);
  }
  execute(text) {
    const result=interpretWorldCommands(text);
    for(const action of result.actions||[]){
      if(action.type==='rain')this.setRain(action.enabled,action.intensity);
      else if(action.type==='fog'){this.foggy=action.enabled;this.updateLighting();}
      else if(action.type==='time'){this.time=action.value;this.updateLighting();}
      else if(action.type==='light'){this.lightTone=action.value;this.updateLighting();}
      else if(action.type==='season')this.setSeason(action.value);
      else if(action.type==='sun'){this.direction=action.value;this.updateLighting();}
    }
    return result;
  }
  setRain(enabled,intensity=1){
    this.enabled=Boolean(enabled);
    this.intensity=Math.max(.3,Math.min(1.7,Number(intensity)||1));
    this.streaks.visible=this.enabled;
    if(this.enabled)this.start=performance.now();
  }
  updateLighting(){
    const lighting=this.world.urbanLighting;
    const graphics=this.world.graphicsWorld;
    const preset=TIMES[this.time]||TIMES.noon;
    if(lighting){
      const sun=lighting.sun;
      sun.intensity=preset.power;
      sun.color.setHex(preset.sun);
      if(this.lightTone==='warm')sun.color.lerp(new THREE.Color(0xff9a52),.38);
      if(this.lightTone==='cool')sun.color.lerp(new THREE.Color(0x9cc9f5),.40);
      lighting.fill.intensity=preset.fill;
      const p=preset.angle;
      let offset=new THREE.Vector3(...p);
      if(this.direction){
        const mag=Math.hypot(p[0],p[2]);
        const directions={east:[mag,0],west:[-mag,0],north:[0,-mag],south:[0,mag]};
        const v=directions[this.direction];if(v)offset.set(v[0],p[1],v[1]);
      }
      lighting.sunOffset=offset;
      lighting.update();
    }
    const night=this.time==='night';
    this.world.renderer.toneMappingExposure=preset.exposure;
    graphics.background=night?new THREE.Color(0x07142c):(lighting?.hdr||null);
    graphics.fog=this.foggy?new THREE.FogExp2(night?0x17223a:preset.fog,.018):new THREE.Fog(preset.fog,night?65:180,night?350:700);
    this.moon.visible=night;
  }
  setSeason(name){
    this.season=name;
    const root=this.world.levelRuntime?.root;
    if(!root)return;
    const color=SEASON_COLORS[name];
    for(const layerName of ['CC0 photoreal vegetation','Procedural vegetation fallback','Detailed lawns']){
      const group=root.getObjectByName(layerName);if(!group)continue;
      group.traverse(object=>{
        if(!object.isMesh) return;
        for(const material of [].concat(object.material||[])){
          if(!material?.color)continue;
          const n=String(material.name||'').toLowerCase();
          // Keep trunks and branches their original bark color.
          if(/trunk|bark|wood|branch/.test(n))continue;
          if(!this.baseColors.has(material))this.baseColors.set(material,material.color.clone());
          material.color.copy(this.baseColors.get(material));
          if(color!==null)material.color.lerp(new THREE.Color(color),name==='winter'?.76:name==='autumn'?.65:.3);
        }
      });
    }
    // A warm/cool world tint signals season even where a photoreal tree is absent.
    if(name==='winter')this.world.renderer.toneMappingExposure=Math.min(this.world.renderer.toneMappingExposure,1.0);
  }
  draw(now) {
    this.raf=requestAnimationFrame(this.draw);
    const camera=this.world.camera;
    if(this.moon.visible)this.moon.position.copy(camera.position).add(new THREE.Vector3(-110,92,-170));
    if(!this.enabled)return;
    const time=(now-this.start)/1000;
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
    this.material.opacity=this.intensity>1?.70:.53;
  }
  dispose(){
    cancelAnimationFrame(this.raf);
    this.streaks.removeFromParent();this.moon.removeFromParent();
    this.geometry.dispose();this.material.dispose();
    this.moon.geometry.dispose();this.moon.material.dispose();
  }
}
