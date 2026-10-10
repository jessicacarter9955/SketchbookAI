// Adapted for the Sketchbook City WebGL player from ideas in
// CK42BB/procedural-weather-threejs (MIT, Copyright 2026 Kingsley).
// Original authored implementation; no third-party APIs, subscriptions or assets.
// THREE is already exposed by Sketchbook's bundled game (browser-native ES module).
import {interpretWorldCommands} from './world-commands.mjs';

const TIMES={
  sunrise:{offset:[-75,22,-30],color:0xffa464,intensity:1.65,exposure:.91,fog:0xe1b8a3},
  noon:{offset:[-50,85,55],color:0xfff1df,intensity:3.2,exposure:1.08,fog:0xb8c6cc},
  sunset:{offset:[75,13,35],color:0xff9256,intensity:1.25,exposure:.87,fog:0xc8958d},
  night:{offset:[-35,55,-60],color:0xa4bff7,intensity:.46,exposure:.52,fog:0x16243b}
};
const SEASON_COLORS={spring:0x79bb63,summer:null,autumn:0xc07d30,winter:0xdbe8f0};
const PROFILES={
  clear:{rain:0,snow:0,dust:0,wind:.25,fog:0,clouds:0,lightning:0},
  cloudy:{rain:0,snow:0,dust:0,wind:.6,fog:.2,clouds:.6,lightning:0},
  drizzle:{rain:.35,snow:0,dust:0,wind:.4,fog:.14,clouds:.5,lightning:0},
  rain:{rain:.75,snow:0,dust:0,wind:.6,fog:.25,clouds:.65,lightning:0},
  heavyRain:{rain:1.0,snow:0,dust:0,wind:1.1,fog:.4,clouds:.87,lightning:.05},
  storm:{rain:1.0,snow:0,dust:0,wind:1.7,fog:.6,clouds:1,lightning:1},
  lightSnow:{rain:0,snow:.35,dust:0,wind:.35,fog:.22,clouds:.55,lightning:0},
  snow:{rain:0,snow:.75,dust:0,wind:.55,fog:.3,clouds:.72,lightning:0},
  blizzard:{rain:0,snow:1,dust:0,wind:1.75,fog:1,clouds:.98,lightning:0},
  fog:{rain:0,snow:0,dust:0,wind:.12,fog:1,clouds:.35,lightning:0},
  sandstorm:{rain:0,snow:0,dust:1,wind:1.7,fog:.9,clouds:.95,lightning:0},
  aurora:{rain:0,snow:0,dust:0,wind:.3,fog:.02,clouds:0,lightning:0},
  hail:{rain:.72,snow:.35,dust:0,wind:1.2,fog:.37,clouds:.9,lightning:.28}
};
export const WEATHER_PROFILES=Object.keys(PROFILES);
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const random=(n=1)=>Math.random()*n;

function precipitation(kind,count){
  const isRain=kind==='rain',isDust=kind==='dust';
  const geo=new THREE.BufferGeometry();
  const positions=new Float32Array(count*(isRain?6:3));
  const randoms=new Float32Array(count*(isRain?2:1));
  for(let i=0;i<count;i++){
    const x=random(46)-23,y=random(28),z=random(46)-23;
    if(isRain){
      positions.set([x,y,z,x,y,z],i*6);
      randoms[i*2]=Math.random();randoms[i*2+1]=randoms[i*2];
    }else{
      positions.set([x,y,z],i*3);
      randoms[i]=Math.random();
    }
  }
  geo.setAttribute('position',new THREE.BufferAttribute(positions,3));
  geo.setAttribute('aRandom',new THREE.BufferAttribute(randoms,isRain?1:1));
  // rain vertices need distinct endpoint attributes: 0=top, 1=tail.
  if(isRain){
    const tail=new Float32Array(count*2);
    for(let i=0;i<count;i++)tail[i*2+1]=1;
    geo.setAttribute('aTail',new THREE.BufferAttribute(tail,1));
  }
  const shaders={
    rain:[
      'uniform float uTime;uniform float uIntensity;uniform float uWind;',
      'attribute float aRandom;attribute float aTail;',
      'varying float vAlpha;',
      'void main(){',
      'float speed=16.0+uIntensity*11.0;',
      'float down=mod(position.y-uTime*speed*(0.8+aRandom*0.45),28.0)-11.0;',
      'vec3 p=vec3(position.x+sin(uTime*.5+aRandom*12.0)*uWind*1.0,down,position.z);',
      'p.x+=aTail*(.16+uWind*.33);p.y+=aTail*(.48+uIntensity*.8);',
      'vec4 mv=modelViewMatrix*vec4(p,1.0);gl_Position=projectionMatrix*mv;',
      'vAlpha=clamp((25.0-length(position.xz))*.1,.3,1.0);',
      '}'
    ],
    snow:[
      'uniform float uTime;uniform float uIntensity;uniform float uWind;',
      'attribute float aRandom;varying float vAlpha;',
      'void main(){',
      'float y=mod(position.y-uTime*(1.8+uIntensity*1.7)*(0.6+aRandom),28.0)-11.0;',
      'float flutter=sin(uTime*(.7+aRandom)+aRandom*29.0+y*.2);',
      'vec3 p=vec3(position.x+flutter*.85+sin(uTime*.18)*uWind*2.0,y,position.z+cos(uTime*.8+aRandom*26.0)*.6);',
      'vec4 mv=modelViewMatrix*vec4(p,1.0);gl_Position=projectionMatrix*mv;',
      'gl_PointSize=clamp((3.2+aRandom*4.2)*85.0/max(4.0,-mv.z),2.2,13.0);',
      'vAlpha=clamp((26.0-length(position.xz))*.11,.32,1.0);',
      '}'
    ],
    dust:[
      'uniform float uTime;uniform float uIntensity;uniform float uWind;',
      'attribute float aRandom;varying float vAlpha;',
      'void main(){',
      'float y=mod(position.y+sin(uTime*(.5+aRandom))*3.0,17.0)-5.0;',
      'vec3 p=vec3(mod(position.x+uTime*uWind*(3.0+aRandom*2.0)+23.0,46.0)-23.0,y,position.z+cos(uTime+aRandom*50.0)*1.6);',
      'vec4 mv=modelViewMatrix*vec4(p,1.0);gl_Position=projectionMatrix*mv;',
      'gl_PointSize=clamp((2.5+aRandom*4.0)*95.0/max(3.0,-mv.z),2.0,12.0);',
      'vAlpha=clamp((25.0-length(position.xz))*.09,.22,.85);',
      '}'
    ]
  };
  const fragments={
    rain:['uniform float uOpacity;varying float vAlpha;','void main(){gl_FragColor=vec4(.81,.91,1.0,uOpacity*vAlpha);}'],
    snow:['uniform float uOpacity;varying float vAlpha;','void main(){float d=length(gl_PointCoord-.5);float a=1.0-smoothstep(.23,.49,d);gl_FragColor=vec4(.96,.98,1.0,uOpacity*vAlpha*a);}'],
    dust:['uniform float uOpacity;varying float vAlpha;','void main(){float d=length(gl_PointCoord-.5);float a=1.0-smoothstep(.25,.50,d);gl_FragColor=vec4(.86,.66,.37,uOpacity*vAlpha*a);}']
  };
  const mat=new THREE.ShaderMaterial({
    uniforms:{uTime:{value:0},uIntensity:{value:1},uOpacity:{value:1},uWind:{value:.4}},
    vertexShader:shaders[kind].join('\n'),fragmentShader:fragments[kind].join('\n'),
    transparent:true,depthWrite:false,depthTest:false,
    blending:THREE.NormalBlending
  });
  const mesh=isRain?new THREE.LineSegments(geo,mat):new THREE.Points(geo,mat);
  mesh.name='Procedural weather '+kind;
  mesh.frustumCulled=false;mesh.renderOrder=isRain?15:16;mesh.visible=false;
  return mesh;
}

function makeAurora(){
  const geo=new THREE.PlaneGeometry(235,76,40,8);
  const mat=new THREE.ShaderMaterial({
    uniforms:{uTime:{value:0},uOpacity:{value:.73}},
    vertexShader:[
      'uniform float uTime;varying vec2 vUv;',
      'void main(){vUv=uv;vec3 p=position;',
      'p.y+=sin(p.x*.028+uTime*.4)*10.0+sin(p.x*.07+uTime*.6)*3.0;',
      'p.z+=sin(p.x*.045+uTime*.8)*4.0;',
      'gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}'
    ].join('\n'),
    fragmentShader:[
      'uniform float uOpacity;uniform float uTime;varying vec2 vUv;',
      'void main(){float w=sin(vUv.x*20.0+uTime*.38)*.17+.83;',
      'float alpha=sin(vUv.y*3.1415926)*sin(vUv.y*3.1415926)*w*uOpacity;',
      'vec3 a=vec3(.10,1.0,.65),b=vec3(.31,.22,.92);',
      'vec3 col=mix(a,b,smoothstep(.25,.9,vUv.y));',
      'gl_FragColor=vec4(col,alpha);}'
    ].join('\n'),
    transparent:true,depthTest:false,depthWrite:false,side:THREE.DoubleSide,
    blending:THREE.AdditiveBlending
  });
  const mesh=new THREE.Mesh(geo,mat);
  mesh.name='Aurora Borealis';mesh.frustumCulled=false;mesh.renderOrder=5;mesh.visible=false;
  return mesh;
}

function makeRainbow(){
  const root=new THREE.Group();
  root.name='Procedural rainbow';
  const colors=[0xeb3443,0xff872c,0xf4d54c,0x6cbf54,0x3995dc,0x5154ac,0x9654c9];
  for(let i=0;i<7;i++){
    const geo=new THREE.TorusGeometry(60-i*1.7,.55,5,90,Math.PI);
    const mat=new THREE.MeshBasicMaterial({color:colors[i],transparent:true,opacity:.60,side:THREE.DoubleSide,depthWrite:false,fog:false});
    const arc=new THREE.Mesh(geo,mat);root.add(arc);
  }
  root.visible=false;return root;
}

export class WorldWeather {
  constructor(world){
    this.world=world;this.enabled=false;this.intensity=1;
    this.snowing=false;this.snowIntensity=1;this.dusting=false;
    this.time='noon';this.season='summer';this.foggy=false;this.lightTone=null;this.direction=null;
    this.state='clear';this.wind=.4;this.baseColors=new WeakMap();this.surfaces=new WeakMap();
    const mobile=/Android|iPhone|iPad/i.test(navigator.userAgent);
    this.count=mobile?4500:9800;
    this.snowCount=mobile?3200:6500;
    this.streaks=precipitation('rain',this.count);
    this.snowflakes=precipitation('snow',this.snowCount);
    this.dust=precipitation('dust',mobile?2200:4500);
    this.aurora=makeAurora();this.rainbow=makeRainbow();
    world.graphicsWorld.add(this.streaks,this.snowflakes,this.dust,this.aurora,this.rainbow);
    this.moon=new THREE.Mesh(new THREE.SphereGeometry(7,20,14),new THREE.MeshBasicMaterial({color:0xf3f4d6,depthTest:false,fog:false}));
    this.moon.name='User commanded moon';this.moon.renderOrder=13;this.moon.visible=false;
    world.graphicsWorld.add(this.moon);
    this.lightning=new THREE.PointLight(0xcfe5ff,0,160);
    this.lightning.name='Procedural lightning flash';world.graphicsWorld.add(this.lightning);
    this.flashEnd=0;this.nextFlash=performance.now()+2300;
    this.snowCover=null;this.start=performance.now();
    this.draw=this.draw.bind(this);this.raf=requestAnimationFrame(this.draw);
  }

  execute(text){
    const result=interpretWorldCommands(text);
    for(const action of result.actions||[]){
      if(action.type==='rain')this.setRain(action.enabled,action.intensity);
      if(action.type==='snow')this.setSnow(action.enabled,action.intensity);
      if(action.type==='state')this.setWeatherState(action.value);
      if(action.type==='fog'){this.foggy=action.enabled;this.updateLighting();}
      if(action.type==='time'){this.time=action.value;this.updateLighting();}
      if(action.type==='light'){this.lightTone=action.value;this.updateLighting();}
      if(action.type==='season')this.setSeason(action.value);
      if(action.type==='sun'){this.direction=action.value;this.updateLighting();}
      if(action.type==='wind'){this.wind=action.speed;this.updateParticles();}
      if(action.type==='rainbow')this.rainbow.visible=action.enabled;
    }
    return result;
  }

  setWeatherState(name){
    const preset=PROFILES[name]||PROFILES.clear;
    this.state=name;
    this.wind=preset.wind;
    this.enabled=preset.rain>0;this.intensity=preset.rain||1;
    this.snowing=preset.snow>0;this.snowIntensity=preset.snow||1;
    this.dust.visible=preset.dust>0;
    this.streaks.visible=this.enabled;this.snowflakes.visible=this.snowing;
    this.dust.material.uniforms.uOpacity.value=preset.dust;
    this.aurora.visible=name==='aurora';
    if(name==='aurora')this.time='night';
    this.foggy=name==='fog'||name==='blizzard'||name==='sandstorm';
    this.setSnowCover(this.snowing||this.season==='winter');
    this.updateParticles();this.updateSurfaces();this.updateLighting();
  }

  setRain(enabled,intensity=1){
    this.enabled=Boolean(enabled);
    this.intensity=clamp(Number(intensity)||1,.3,1.7);
    this.state=this.enabled?(this.intensity<.65?'drizzle':this.intensity>1.4?'heavyRain':'rain'):'clear';
    this.streaks.visible=this.enabled;
    this.updateParticles();this.updateSurfaces();this.updateLighting();
  }

  setSnow(enabled,intensity=1){
    this.snowing=Boolean(enabled);this.snowIntensity=clamp(Number(intensity)||1,.2,1.7);
    this.state=this.snowing?(this.snowIntensity>1.4?'blizzard':this.snowIntensity<.6?'lightSnow':'snow'):'clear';
    this.snowflakes.visible=this.snowing;
    this.setSnowCover(this.snowing||this.season==='winter');
    this.updateParticles();this.updateLighting();
  }

  updateParticles(){
    this.streaks.material.uniforms.uIntensity.value=this.intensity;
    this.streaks.material.uniforms.uWind.value=this.wind;
    this.streaks.material.uniforms.uOpacity.value=this.intensity<.6?.5:.88;
    this.snowflakes.material.uniforms.uIntensity.value=this.snowIntensity;
    this.snowflakes.material.uniforms.uWind.value=this.wind;
    this.snowflakes.material.uniforms.uOpacity.value=.94;
    this.dust.material.uniforms.uWind.value=this.wind;
  }

  // This modifies the actual city material, rather than only the sky.
  updateSurfaces(){
    const root=this.world.levelRuntime?.root;
    if(!root)return;
    const seen=new Set();
    root.traverse(node=>{
      if(!node.isMesh)return;
      for(const mat of [].concat(node.material||[])){
        if(!mat||seen.has(mat)||!mat.color)continue;
        const name=String(mat.name||'');
        if(!/^Urban (asphalt|pavement|lawns)$/i.test(name))continue;
        seen.add(mat);
        if(!this.surfaces.has(mat))this.surfaces.set(mat,{
          color:mat.color.clone(),roughness:mat.roughness,metalness:mat.metalness,
          envMapIntensity:mat.envMapIntensity
        });
        const original=this.surfaces.get(mat);
        mat.color.copy(original.color);mat.roughness=original.roughness;
        mat.metalness=original.metalness;mat.envMapIntensity=original.envMapIntensity;
        if(this.enabled){
          mat.color.multiplyScalar(name==='Urban asphalt'?.52:.74);
          mat.roughness=Math.min(.21,original.roughness);
          mat.metalness=Math.max(.15,original.metalness);
          mat.envMapIntensity=Math.max(1.2,original.envMapIntensity||0);
        }
        if(this.season==='winter'){
          mat.color.lerp(new THREE.Color(0xf0f5f9),name==='Urban asphalt'?.37:.72);
        }
        mat.needsUpdate=true;
      }
    });
  }

  setSnowCover(enabled){
    const runtime=this.world.levelRuntime;
    if(enabled&&!this.snowCover&&runtime?.plan&&runtime?.config){
      const group=new THREE.Group();group.name='Winter snow cover';
      const geo=new THREE.PlaneGeometry(1,1);geo.rotateX(-Math.PI/2);
      const mat=new THREE.MeshStandardMaterial({
        color:0xe4eef9,roughness:.93,transparent:true,opacity:.84,
        depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1
      });
      const add=(x,z,w,d,y)=>{
        if(w<=.1||d<=.1)return;
        const mesh=new THREE.Mesh(geo,mat);
        mesh.position.set(x,y,z);mesh.scale.set(w,1,d);mesh.receiveShadow=true;
        group.add(mesh);
      };
      const plan=runtime.plan,config=runtime.config;
      const road=config.roadWidth,block=config.blockSize;
      for(let ix=0;ix<config.blocksX;ix++)for(let iz=0;iz<config.blocksZ;iz++){
        const x=plan.bounds.minX+road/2+(ix+.5)*block;
        const z=plan.bounds.minZ+road/2+(iz+.5)*block;
        const size=Math.max(0,block-road-.6);
        add(x,z,size,size,.202);
      }
      for(const park of plan.parks||[]){
        if(park.kind==='lawn')add(park.x,park.z,park.w*.94,park.d*.94,.15);
      }
      for(const street of plan.roads||[]){
        const length=street.length;
        if(street.axis==='x'){
          for(const side of [-1,1])add(0,street.z+side*(street.width/2-.25),length,.52,.118);
        }else{
          for(const side of [-1,1])add(street.x+side*(street.width/2-.25),0,.52,length,.118);
        }
      }
      this.snowCover=group;this.snowCoverResources={mat,geo};
      this.world.graphicsWorld.add(group);
    }
    if(this.snowCover)this.snowCover.visible=!!enabled;
  }

  setSeason(name){
    this.season=name;
    const root=this.world.levelRuntime?.root,color=SEASON_COLORS[name];
    if(root)for(const layerName of ['CC0 photoreal vegetation','Procedural vegetation fallback','Detailed lawns']){
      const group=root.getObjectByName(layerName);if(!group)continue;
      group.traverse(node=>{
        if(!node.isMesh)return;
        for(const material of [].concat(node.material||[])){
          if(!material?.color||/trunk|bark|wood|branch/i.test(material.name||''))continue;
          if(!this.baseColors.has(material))this.baseColors.set(material,material.color.clone());
          material.color.copy(this.baseColors.get(material));
          if(color!==null)material.color.lerp(new THREE.Color(color),name==='winter'?.8:name==='autumn'?.72:.45);
        }
      });
    }
    this.snowing=name==='winter';
    this.snowflakes.visible=this.snowing;
    this.setSnowCover(this.snowing);
    this.updateSurfaces();this.updateLighting();
  }

  updateLighting(){
    const lighting=this.world.urbanLighting,p=TIMES[this.time]||TIMES.noon;
    const stormy=this.state==='storm'||this.state==='heavyRain';
    const sand=this.state==='sandstorm';
    const precipitation=this.enabled||this.snowing;
    if(lighting){
      lighting.sun.color.setHex(p.color);
      if(this.lightTone==='warm')lighting.sun.color.lerp(new THREE.Color(0xff954c),.4);
      if(this.lightTone==='cool')lighting.sun.color.lerp(new THREE.Color(0x9cc9ef),.4);
      lighting.sun.intensity=p.intensity*(stormy?.24:precipitation?.61:sand?.29:1);
      lighting.fill.intensity=(this.time==='night'?.15:.23)*(precipitation?1.55:1);
      const v=p.offset,offset=new THREE.Vector3(...v);
      if(this.direction){
        const magnitude=Math.hypot(v[0],v[2]);
        const d={east:[magnitude,0],west:[-magnitude,0],north:[0,-magnitude],south:[0,magnitude]}[this.direction];
        if(d)offset.set(d[0],v[1],d[1]);
      }
      lighting.sunOffset=offset;lighting.update();
    }
    const graphics=this.world.graphicsWorld;
    const night=this.time==='night';
    const bgcolor=sand?0xa8875b:stormy?0x485464:this.snowing?0xa0aebe:
      this.enabled?0x869aaa:night?0x07142c:null;
    graphics.background=bgcolor===null?(lighting?.hdr||new THREE.Color(0x8daec7)):new THREE.Color(bgcolor);
    const fogColor=sand?0xa8875b:stormy?0x485464:this.snowing?0xb5c3d1:
      this.enabled?0x8298aa:p.fog;
    const heavyFog=this.foggy||sand;
    graphics.fog=heavyFog?new THREE.FogExp2(fogColor,sand?.037:this.state==='blizzard'?.040:.018):
      new THREE.Fog(fogColor,night?70:stormy?60:this.enabled?90:165,night?360:stormy?300:this.enabled?410:690);
    this.world.renderer.toneMappingExposure=p.exposure*(stormy?.68:precipitation?.81:sand?.74:1);
    this.moon.visible=night;
    this.rainbow.visible=this.rainbow.visible&&(!stormy&&!sand);
  }

  draw(now){
    this.raf=requestAnimationFrame(this.draw);
    const elapsed=(now-this.start)/1000,camera=this.world.camera;
    for(const mesh of [this.streaks,this.snowflakes,this.dust]){
      if(!mesh.visible)continue;
      mesh.position.copy(camera.position);
      mesh.material.uniforms.uTime.value=elapsed;
    }
    if(this.moon.visible)this.moon.position.copy(camera.position).add(new THREE.Vector3(-105,90,-170));
    if(this.aurora.visible){
      const dir=new THREE.Vector3();camera.getWorldDirection(dir);dir.y=0;dir.normalize();
      this.aurora.position.copy(camera.position).addScaledVector(dir,150).add(new THREE.Vector3(0,42,0));
      this.aurora.lookAt(camera.position);
      this.aurora.material.uniforms.uTime.value=elapsed;
    }
    if(this.rainbow.visible){
      const dir=new THREE.Vector3();camera.getWorldDirection(dir);dir.y=0;dir.normalize();
      this.rainbow.position.copy(camera.position).addScaledVector(dir,155).add(new THREE.Vector3(0,-9,0));
      this.rainbow.lookAt(camera.position);
    }
    if(this.state==='storm'){
      if(now>this.nextFlash){
        this.flashEnd=now+130;
        this.nextFlash=now+2600+random(2800);
      }
      this.lightning.intensity=now<this.flashEnd?9:0;
      this.lightning.position.copy(camera.position).add(new THREE.Vector3(32,35,-45));
    }else this.lightning.intensity=0;
  }

  dispose(){
    cancelAnimationFrame(this.raf);
    for(const mesh of [this.streaks,this.snowflakes,this.dust,this.aurora,this.moon]){
      mesh.removeFromParent();mesh.geometry.dispose();mesh.material.dispose();
    }
    this.lightning.removeFromParent();this.lightning.dispose?.();
    this.rainbow.removeFromParent();
    this.rainbow.traverse(node=>{node.geometry?.dispose();node.material?.dispose();});
    this.snowCover?.removeFromParent();
    this.snowCoverResources?.geo.dispose();this.snowCoverResources?.mat.dispose();
  }
}
