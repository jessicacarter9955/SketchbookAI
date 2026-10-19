import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {miamiCoastLayout} from './urban-coast-layout.mjs';

// City shoreline uses FOUR real-sand PBR bands and an authored CC0 palm GLB.
// One reflective ocean plane fills the exterior, without covering city streets.
export function addUrbanMiamiCoast(group,plan,config,box){
  const layout=miamiCoastLayout(plan.bounds,config.seed);
  const sand=new THREE.MeshStandardMaterial({color:0xe8d0aa,roughness:1,metalness:0});
  for(const side of layout.sides){
    const [x,z]=side.center,[w,d]=side.size;
    const beach=box([w,.24,d],[x,-.09,z],sand,true);
    beach.name='Miami '+side.name+' · original PBR beach sand';
    beach.userData.urbanCoast=true;
  }

  const waterGeo=new THREE.PlaneGeometry(...layout.waterSize,96,96);
  const vertices=waterGeo.getAttribute('position');
  for(let i=0;i<vertices.count;i++){
    const x=vertices.getX(i),z=vertices.getY(i);
    vertices.setZ(i,.05*Math.sin(x*.055+z*.071)+.025*Math.sin(z*.12-x*.035));
  }
  waterGeo.computeVertexNormals();
  const water=new THREE.Mesh(waterGeo,new THREE.MeshPhysicalMaterial({
    color:0x51aabb,roughness:.18,metalness:.05,clearcoat:.68,clearcoatRoughness:.14,envMapIntensity:1.15,
    side:THREE.DoubleSide
  }));
  water.rotation.x=-Math.PI/2;water.position.set(layout.waterCenter[0],-.24,layout.waterCenter[1]);
  water.receiveShadow=true;water.name='Miami · surrounding Atlantic water';
  group.add(water);

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
    const [palm,diffuse,normal,rough]=await Promise.all([
      new GLTFLoader().loadAsync(local+'palm-detailed.glb'),
      loader.loadAsync(local+'sand-diff.jpg'),
      loader.loadAsync(local+'sand-nor_gl.jpg'),
      loader.loadAsync(local+'sand-rough.jpg')
    ]);
    for(const tex of [diffuse,normal,rough]){
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
    group.userData.miamiCoast={sides:4,palms:layout.allPalms.length,sandSource:'Poly Haven sand_03',palmSource:layout.palmSource};
    globalThis.cityDiagnostics?.activity('Costa HD: 4 lati · '+layout.allPalms.length+' palme CC0 autentiche · sabbia PBR Poly Haven');
    return {palms:layout.allPalms.length,sides:4,asset:'palm-detailed.glb',materials:'sand_03 CC0'};
  };
  return layout;
}
