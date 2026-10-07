import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

export async function photographicLighting(world,preset='day') {
  if(!world.urbanLightingPromise){
    world.urbanLightingPromise=(async()=>{
    const renderer=world.renderer,scene=world.graphicsWorld;
    renderer.useLegacyLights=false;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    const hdr=await new RGBELoader().loadAsync('assets/urban-kits/lighting/sky.hdr');
    hdr.mapping=THREE.EquirectangularReflectionMapping;
    const pmrem=new THREE.PMREMGenerator(renderer),environment=pmrem.fromEquirectangular(hdr);
    scene.environment=environment.texture;scene.background=hdr;
    world.sky.setPhotographic(true);
    const sun=new THREE.DirectionalLight(0xfff1df,3.2);sun.castShadow=true;
    sun.shadow.mapSize.set(4096,4096);Object.assign(sun.shadow.camera,{left:-45,right:45,top:45,bottom:-45,near:1,far:190});
    sun.shadow.camera.updateProjectionMatrix();sun.shadow.bias=-.00008;sun.shadow.normalBias=.025;
    const fill=new THREE.HemisphereLight(0xd1e2ee,0x655c47,.15);
    scene.add(sun,sun.target,fill);pmrem.dispose();
    world.urbanLighting={sun,hdr,environment,fill,update(){
      const p=world.camera.position;
      sun.target.position.set(Math.round(p.x/8)*8,0,Math.round(p.z/8)*8);
      sun.position.copy(sun.target.position).add(new THREE.Vector3(-50,65,55));
      sun.target.updateMatrixWorld();
    }};
    })();
  }
  await world.urbanLightingPromise;
  const {sun,fill}=world.urbanLighting;
  sun.color.set(preset==='sunset'?0xffc390:0xfff1df);sun.intensity=preset==='haze'?1.1:preset==='sunset'?2.1:3.2;
  fill.intensity=preset==='haze'?.35:.15;
  world.graphicsWorld.fog=new THREE.Fog(0xb8c6cc,180,700);
  world.urbanLighting.update();
  return 'HDR environment + directional contact shadows';
}

export async function loadSurface(id,tile=3,color=0xffffff) {
  const loader=new THREE.TextureLoader();
  const maps=await Promise.all(['diff','nor_gl','rough'].map(channel=>loader.loadAsync(`assets/urban-kits/${id}/${channel}.jpg`)));
  maps.forEach(map=>{map.wrapS=map.wrapT=THREE.RepeatWrapping;map.repeat.setScalar(1/tile);map.anisotropy=8;});
  maps[0].colorSpace=THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({color,map:maps[0],normalMap:maps[1],roughnessMap:maps[2],normalScale:new THREE.Vector2(.65,.65),roughness:.92,envMapIntensity:.7});
}

export function metricUV(mesh) {
  const p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal,uv=mesh.geometry.attributes.uv;
  for(let i=0;i<uv.count;i++){
    if(Math.abs(n.getY(i))>.5)uv.setXY(i,p.getX(i)+mesh.position.x,p.getZ(i)+mesh.position.z);
    else if(Math.abs(n.getX(i))>.5)uv.setXY(i,p.getZ(i)+mesh.position.z,p.getY(i)+mesh.position.y);
    else uv.setXY(i,p.getX(i)+mesh.position.x,p.getY(i)+mesh.position.y);
  }
  uv.needsUpdate=true;
}
