import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {miamiCoastLayout} from './urban-coast-layout.mjs';
import {createUrbanIslandOcean,updateUrbanIslandOcean} from './urban-coast-water.mjs';
import {buildUrbanBeachGeometry,buildUrbanSandBlendGeometry,urbanSandHeight} from './urban-coast-sand.mjs';

// City shoreline uses FOUR real-sand PBR bands and an authored CC0 palm GLB.
// One reflective ocean plane fills the exterior, without covering city streets.
export function addUrbanMiamiCoast(group,plan,config,box){
  const layout=miamiCoastLayout(plan.bounds,config.seed);
  const sand=new THREE.MeshStandardMaterial({color:0xe8d0aa,roughness:1,metalness:0});
  const drySand=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.96,metalness:0,transparent:true,vertexColors:true,depthWrite:false});
  const wetSand=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.67,metalness:0,transparent:true,vertexColors:true,depthWrite:false});
  const sandLayers=[];
  for(const side of layout.sides){
    // The FOUR coastlines use a sculpted mesh with genuine photo-PBR sand.
    const beach=new THREE.Mesh(buildUrbanBeachGeometry(side,layout),sand);
    beach.receiveShadow=true;beach.castShadow=false;
    beach.name='Miami '+side.name+' · photo PBR sand relief';
    beach.userData.urbanCoast=true;
    group.add(beach);
    // Two additional independently photographed CC0 surfaces blended by
    // shoreline distance: pale wind-rippled dry beach and darker damp sand.
    for(const [type,material,order] of [['dry',drySand,1],['wet',wetSand,2]]){
      const layer=new THREE.Mesh(buildUrbanSandBlendGeometry(side,layout,type),material);
      layer.receiveShadow=true;layer.castShadow=false;layer.renderOrder=order;
      layer.visible=false; // do not show white overlays before photographic PBR is ready
      sandLayers.push(layer);
      layer.name='Miami '+side.name+' · '+type+' photographic sand CC0';
      layer.userData.urbanCoast=true;
      group.add(layer);
    }
    // Cannon support strips approximate the beach grade under the visible mesh.
    const sections=12,along=side.axis==='x'?side.size[1]:side.size[0];
    for(let i=0;i<sections;i++){
      const t=(i+.5)/sections,width=layout.beachWidth/sections+.15;
      const coord=side.shore-side.sign*layout.beachWidth+side.sign*layout.beachWidth*t;
      const x=side.axis==='x'?coord:side.center[0];
      const z=side.axis==='z'?coord:side.center[1];
      const surface=urbanSandHeight(t,x,z);
      const floor=box(side.axis==='x'?[width,.18,along]:[along,.18,width],
        [x,surface-.09,z],sand,true);
      floor.visible=false; // physical support only, not a geometric placeholder
    }
  }

  // Exact TWO-ISLAND Water shader and procedural normal sampler:
  // ONE reflective renderer on an ocean ring, not four expensive mirrors.
  const water=createUrbanIslandOcean(layout);
  group.add(water);
  layout.updateWater=(sunPosition,elapsedSeconds)=>
    updateUrbanIslandOcean(water,sunPosition,elapsedSeconds);

  const foamMat=new THREE.MeshStandardMaterial({color:0xc9e2d9,transparent:true,opacity:.65,roughness:.5,depthWrite:false});
  for(const side of layout.sides){
    for(const dist of [.9,2.5]){
      const alongX=side.axis==='z';
      const foam=new THREE.Mesh(new THREE.PlaneGeometry(alongX?side.size[0]:.52,alongX?.52:side.size[1]),foamMat);
      foam.rotation.x=-Math.PI/2;
      foam.position.set(alongX?layout.waterCenter[0]:side.shore+dist*side.sign,-.16,
        alongX?side.shore+dist*side.sign:layout.waterCenter[1]);
      foam.name='Miami · '+side.name+' shoreline surf';
      group.add(foam);
    }
  }

  const palms=new THREE.Group();
  palms.name='Miami · CC0 authored palm models (4 sides)';
  group.add(palms);
  let batches=[];
  layout.updateVisibility=camera=>{
    if(!camera||!batches.length)return;
    const near=layout.allPalms.filter(p=>Math.hypot(p.x-camera.position.x,p.z-camera.position.z)<235);
    for(const b of batches){
      b.instance.count=near.length;
      for(let i=0;i<near.length;i++){
        const palm=near[i],q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),i*1.76);
        const m=new THREE.Matrix4().compose(
          new THREE.Vector3(palm.x,.13,palm.z),q,
          new THREE.Vector3(palm.scale,palm.scale,palm.scale));
        m.multiply(b.base);
        b.instance.setMatrixAt(i,m);
      }
      b.instance.instanceMatrix.needsUpdate=true;
    }
  };

  layout.loadOriginalAssets=async()=>{
    const local='assets/urban-kits/miami-coast/';
    const loader=new THREE.TextureLoader();
    const [palm,diffuse,normal,rough,dryDiffuse,dryNormal,dryRough,wetDiffuse,wetNormal,wetRough]=await Promise.all([
      new GLTFLoader().loadAsync(local+'palm-detailed.glb'),
      loader.loadAsync(local+'sand-diff.jpg'),
      loader.loadAsync(local+'sand-nor_gl.jpg'),
      loader.loadAsync(local+'sand-rough.jpg'),
      loader.loadAsync(local+'dry-diff.jpg'),
      loader.loadAsync(local+'dry-nor_gl.jpg'),
      loader.loadAsync(local+'dry-rough.jpg'),
      loader.loadAsync(local+'wet-diff.jpg'),
      loader.loadAsync(local+'wet-nor_gl.jpg'),
      loader.loadAsync(local+'wet-rough.jpg')
    ]);
    for(const tex of [diffuse,normal,rough,dryDiffuse,dryNormal,dryRough,wetDiffuse,wetNormal,wetRough]){
      tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
      // Geometric UVs already use world-space meters / 2.7m.
      // Repeating again would make the photo texture visibly noisy/tiling.
      tex.repeat.set(1,1);
      tex.anisotropy=8;
    }
    diffuse.colorSpace=THREE.SRGBColorSpace;
    sand.color.set(0xffffff);sand.map=diffuse;
    sand.normalMap=normal;sand.normalScale.set(.78,.78);
    sand.roughnessMap=rough;sand.needsUpdate=true;
    for(const [material,albedo,bump,roughness,normalStrength] of [
      [drySand,dryDiffuse,dryNormal,dryRough,.69],
      [wetSand,wetDiffuse,wetNormal,wetRough,.84]
    ]){
      albedo.colorSpace=THREE.SRGBColorSpace;
      material.map=albedo;material.normalMap=bump;
      material.normalScale.set(normalStrength,normalStrength);
      material.roughnessMap=roughness;material.needsUpdate=true;
    }
    sandLayers.forEach(layer=>{layer.visible=true;});

    const model=palm.scene;model.updateMatrixWorld(true);
    const bb=new THREE.Box3().setFromObject(model);
    const height=bb.getSize(new THREE.Vector3()).y;
    if(!Number.isFinite(height)||height<1||!Number.isFinite(bb.min.y))
      throw Error('Palm CC0 original GLB has invalid bounds');
    const center=bb.getCenter(new THREE.Vector3());
    const normalize=new THREE.Matrix4().makeTranslation(-center.x,-bb.min.y,-center.z);
    // The authored model is ~8.9m tall. Preserve its real proportions.
    const size=new THREE.Matrix4().makeScale(9/height,9/height,9/height);
    let count=0;
    model.traverse(mesh=>{
      if(!mesh.isMesh||!mesh.geometry)return;
      const instance=new THREE.InstancedMesh(mesh.geometry,mesh.material,layout.allPalms.length);
      instance.castShadow=true;instance.receiveShadow=true;instance.frustumCulled=false;
      instance.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      instance.name='Original CC0 palm detailed · GPU instanced';
      palms.add(instance);
      batches.push({instance,base:size.clone().multiply(normalize).multiply(mesh.matrixWorld.clone())});
      count++;
    });
    if(count<1)throw Error('Palm GLB contains no authored geometry');
    palms.userData.license='CC0';palms.userData.source='https://www.innerscene.com/tools/library/3d-parts/palm-detailed-a8777b8c';
    layout.palmSource=palms.userData.source;
    layout.updateVisibility(globalThis.world?.camera||null);
    group.userData.miamiCoast={sides:4,palms:layout.allPalms.length,sandSource:'Poly Haven sand_03 + aerial_beach_01 + damp_sand (CC0, PBR)',palmSource:layout.palmSource};
    globalThis.cityDiagnostics?.activity('Costa HD: 4 lati · '+layout.allPalms.length+' palme CC0 autentiche · sabbia PBR Poly Haven');
    return {palms:layout.allPalms.length,sides:4,asset:'palm-detailed.glb',materials:'sand_03 + aerial_beach_01 + damp_sand · CC0 2K'};
  };
  return layout;
}
