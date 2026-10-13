import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { GammaCorrectionShader } from 'three/examples/jsm/shaders/GammaCorrectionShader.js';
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
    sun.shadow.mapSize.set(new URLSearchParams(location.search).get('quality')==='ultra'?4096:2048,new URLSearchParams(location.search).get('quality')==='ultra'?4096:2048);Object.assign(sun.shadow.camera,{left:-45,right:45,top:45,bottom:-45,near:1,far:190});
    sun.shadow.camera.updateProjectionMatrix();sun.shadow.bias=-.00008;sun.shadow.normalBias=.025;
    const fill=new THREE.HemisphereLight(0xd1e2ee,0x655c47,.15);
    scene.add(sun,sun.target,fill);pmrem.dispose();
    const composer=new EffectComposer(renderer);
    const ultra=new URLSearchParams(location.search).get('quality')==='ultra';
    // The old always-on 4x MSAA SSAO produced several full-screen passes.
    // Retain HDR, physically based lighting, shadows, and FXAA in performance mode.
    if(ultra){
      const ao=new SSAOPass(scene,world.camera,innerWidth,innerHeight);
      ao.kernelRadius=.7;ao.minDistance=.002;ao.maxDistance=.018;
      ao.beautyRenderTarget.samples=2;
      composer.addPass(ao);
    } else composer.addPass(new RenderPass(scene,world.camera));
    const fxaa=new ShaderPass(FXAAShader);composer.addPass(fxaa);composer.addPass(new ShaderPass(GammaCorrectionShader));
    globalThis.cityDiagnostics?.activity('GPU: '+(ultra?'SSAO 2x + ombre 4K':'HDR PBR + FXAA + ombre 2K, SSAO multi-pass disattivato'));
    const resize=()=>{const ratio=renderer.getPixelRatio();composer.setSize(innerWidth,innerHeight);fxaa.uniforms.resolution.value.set(1/(innerWidth*ratio),1/(innerHeight*ratio));};
    resize();addEventListener('resize',resize);world.composer.dispose();world.composer=composer;
    // WebGLRenderer already uses MSAA, ACES tone mapping, sRGB output and the
    // original PBR textures. Drawing directly eliminates the extra full-screen
    // colour-copy, FXAA and gamma post-process in normal quality without
    // reducing geometry, texture resolution or lighting fidelity.
    world.useDirectUrbanRender=!ultra;
    // High-resolution shadow maps are expensive when rebuilt every frame.
    // Keep the 2048px map but refresh at controlled intervals while the
    // photoreal scene / player is moving. Ultra preserves per-frame shadows.
    if(!ultra)renderer.shadowMap.autoUpdate=false;
    let lastShadowRefresh=-Infinity;
    const lastShadowCenter=new THREE.Vector3(Infinity,0,Infinity);
    world.urbanLighting={sun,hdr,environment,fill,sunOffset:new THREE.Vector3(-50,65,55),update(){
      const p=world.camera.position,now=performance.now();
      sun.target.position.set(Math.round(p.x/8)*8,0,Math.round(p.z/8)*8);
      sun.position.copy(sun.target.position).add(world.urbanLighting.sunOffset);
      sun.target.updateMatrixWorld();
      if(!ultra && renderer.shadowMap.enabled &&
          (now-lastShadowRefresh>185 || lastShadowCenter.distanceToSquared(sun.target.position)>1)){
        renderer.shadowMap.needsUpdate=true;
        lastShadowCenter.copy(sun.target.position);
        lastShadowRefresh=now;
      }
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

export function captureStreetReflections(world,root) {
  const scene=world.graphicsWorld,renderer=world.renderer,glass=new Set(),hidden=[];
  root.traverse(node=>{
    if(node.isMesh&&/glass/.test(node.material?.name||'')){
      glass.add(node.material);hidden.push([node,node.visible]);node.visible=false;
    }
  });
  const trees=root.getObjectByName('CC0 photoreal vegetation');
  if(trees){hidden.push([trees,trees.visible]);trees.visible=false;}
  const target=new THREE.WebGLCubeRenderTarget(256,{type:THREE.HalfFloatType});
  const camera=new THREE.CubeCamera(.3,300,target);camera.position.set(0,5,0);
  const tone=renderer.toneMapping,shadows=renderer.shadowMap.enabled;
  try{
    renderer.toneMapping=THREE.NoToneMapping;renderer.shadowMap.enabled=false;
    scene.updateMatrixWorld(true);camera.update(renderer,scene);
    const pmrem=new THREE.PMREMGenerator(renderer),reflection=pmrem.fromCubemap(target.texture);
    world.urbanReflection?.dispose();world.urbanReflection=reflection;
    for(const mat of glass){mat.envMap=reflection.texture;mat.envMapIntensity=1;mat.opacity=.78;mat.metalness=.9;mat.roughness=.11;mat.needsUpdate=true;}
    pmrem.dispose();
  }finally{target.dispose();renderer.toneMapping=tone;renderer.shadowMap.enabled=shadows;hidden.forEach(([node,visible])=>{node.visible=visible;});}
}
