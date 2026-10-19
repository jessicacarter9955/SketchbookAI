import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {createVegetation} from './UrbanVegetation.js';
import {stylescapeHeight,stylescapePlacement,stylescapeTileAt} from './stylescape-study-data.mjs';

// NOT the commercial Stylescape HD assets. CC0 landscape study with matching
// biome vocabulary, verified Poly Haven photo-scanned materials and meshes.
const SEGMENTS=52;
const TEXTURES={
  leafy_grass:'assets/urban-kits/leafy_grass/',
  grass_ground:'assets/urban-kits/grass_ground/',
  forrest_ground_01:'assets/stylescape-study/forrest_ground_01/',
  mossy_rock:'assets/stylescape-study/mossy_rock/',
  snow_02:'assets/stylescape-study/snow_02/',
  sand_03:'assets/urban-kits/miami-coast/'
};
function urlFor(tile,channel){
  const folder=TEXTURES[tile.texture];
  if(!folder)throw Error('Unknown CC0 terrain texture '+tile.texture);
  return folder+(tile.texture==='sand_03'?'sand-':'')+channel+'.jpg';
}
export function buildStylescapeTerrainMesh(tile,segments=SEGMENTS){
  const positions=[],uv=[],indices=[];
  const loX=tile.x-tile.size/2,loZ=tile.z-tile.size/2,step=tile.size/segments;
  for(let ix=0;ix<=segments;ix++)for(let iz=0;iz<=segments;iz++){
    const x=loX+ix*step,z=loZ+iz*step;
    positions.push(x,stylescapeHeight(tile,x,z),z);
    // World-space UVs: continuous metric PBR scale across adjoining tiles.
    uv.push(x/3.1,z/3.1);
    if(ix<segments&&iz<segments){
      const a=ix*(segments+1)+iz,b=a+segments+1;
      indices.push(a,a+1,b,b,a+1,b+1);
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geometry.setIndex(indices);geometry.computeVertexNormals();
  geometry.userData={biome:tile.id,source:'CC0 Poly Haven materials',originalStylescapeAsset:false};
  return geometry;
}
export function createStylescapeTerrainBody(tile,segments=SEGMENTS){
  const step=tile.size/segments,loX=tile.x-tile.size/2,hiZ=tile.z+tile.size/2;
  const samples=Array.from({length:segments+1},(_,ix)=>
    Array.from({length:segments+1},(_,iz)=>
      stylescapeHeight(tile,loX+ix*step,hiZ-iz*step)));
  const shape=new CANNON.Heightfield(samples,{elementSize:step});
  const body=new CANNON.Body({mass:0,shape});
  body.position.set(loX,0,hiZ);
  // Cannon Heightfield grows in local X/Y, height is local Z.
  // -PI/2 around X maps the height to the world's vertical Y.
  body.quaternion.setFromEuler(-Math.PI/2,0,0);
  body.userData={stylescapeBiome:tile.id,walkable:true};
  return body;
}
async function terrainMaterial(tile){
  const loader=new THREE.TextureLoader();
  const [diff,nor,rough]=await Promise.all(['diff','nor_gl','rough'].map(c=>loader.loadAsync(urlFor(tile,c))));
  for(const tex of [diff,nor,rough]){
    tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.anisotropy=8;tex.repeat.set(1,1);
  }
  diff.colorSpace=THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({
    map:diff,normalMap:nor,roughnessMap:rough,
    normalScale:new THREE.Vector2(.78,.78),color:0xffffff,roughness:.94,metalness:0,
    envMapIntensity:.68
  });
}
function instancedAuthenticGLTF(source,points,targetHeight,name){
  const root=source.scene;root.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(root),center=bounds.getCenter(new THREE.Vector3());
  const height=bounds.getSize(new THREE.Vector3()).y;
  if(!Number.isFinite(height)||height<=0)throw Error(name+' invalid GLTF mesh');
  const size=new THREE.Matrix4().makeScale(targetHeight/height,targetHeight/height,targetHeight/height);
  const normalize=new THREE.Matrix4().makeTranslation(-center.x,-bounds.min.y,-center.z);
  const group=new THREE.Group();group.name=name;
  const transforms=[];
  for(let i=0;i<points.length;i++){
    const p=points[i];
    const position=new THREE.Vector3(p.x,p.y+.12,p.z);
    const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),i*2.399963229728653);
    transforms.push(new THREE.Matrix4().compose(position,q,
      new THREE.Vector3(p.scale,p.scale,p.scale)));
  }
  const batches=[];
  root.traverse(mesh=>{
    if(!mesh.isMesh||!mesh.geometry)return;
    const batch=new THREE.InstancedMesh(mesh.geometry,mesh.material,Math.max(1,points.length));
    batch.count=0;batch.castShadow=false;batch.receiveShadow=true;batch.frustumCulled=false;
    batch.name=name+' · scanned CC0 instances';
    batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(batch);
    batches.push({batch,base:size.clone().multiply(normalize).multiply(mesh.matrixWorld.clone())});
  });
  if(!batches.length)throw Error('No genuine meshes in '+name);
  group.userData.stream=camera=>{
    if(!camera)return;
    // Only materialize nearby original geometry, not all 6 biomes.
    const nearby=points.filter(p=>Math.hypot(camera.position.x-p.x,camera.position.z-p.z)<140);
    for(const {batch,base} of batches){
      batch.count=nearby.length;
      nearby.forEach((p,i)=>{
        const sourceIndex=points.indexOf(p);
        batch.setMatrixAt(i,new THREE.Matrix4().multiplyMatrices(transforms[sourceIndex],base));
      });
      batch.instanceMatrix.needsUpdate=true;
    }
  };
  group.userData.source=name;
  group.userData.instances=points.length;
  return group;
}
function fieldSign(label,x,y,z){
  // Clearly labels this reconstruction as a CC0 preview, not premium UE meshes.
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=256;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='rgba(18,35,38,.87)';ctx.fillRect(0,0,1024,256);
  ctx.strokeStyle='#e4d6ad';ctx.lineWidth=7;ctx.strokeRect(9,9,1006,238);
  ctx.fillStyle='#ffffff';ctx.font='bold 62px Arial';ctx.textAlign='center';
  ctx.fillText(label,512,109);
  ctx.fillStyle='#bed0c4';ctx.font='30px Arial';
  ctx.fillText('CC0 BIOME STUDY · NOT THE COMMERCIAL UE KIT',512,175);
  const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;
  const board=new THREE.Mesh(new THREE.PlaneGeometry(9,2.25),
    new THREE.MeshBasicMaterial({map:tex,transparent:true,side:THREE.DoubleSide}));
  board.position.set(x,y+3.8,z+13);
  board.rotation.y=Math.PI;
  return board;
}
export class StylescapeStudy{
  constructor(world,layout){
    this.world=world;this.layout=layout;this.group=new THREE.Group();
    this.group.name='Stylescape-inspired · six biomes (CC0 preview)';
    this.group.userData={stylescapeStudy:true,commercialKitImported:false,
      source:layout.source,biomes:layout.tiles.map(t=>t.id)};
    this.bodies=[];this.loaded=false;this.vegetation=null;this.scenery=[];
  }
  async build(onProgress){
    if(this.loaded)return this;
    const log=msg=>{onProgress?.(msg);globalThis.cityDiagnostics?.activity(msg);};
    log('Stylescape study: verified CC0 photographic grounds for 6 biomes…');
    const materials=await Promise.all(this.layout.tiles.map(terrainMaterial));
    this.layout.tiles.forEach((tile,i)=>{
      const terrain=new THREE.Mesh(buildStylescapeTerrainMesh(tile),materials[i]);
      terrain.receiveShadow=true;terrain.castShadow=false;
      terrain.name='CC0 '+tile.name+' · physically walkable heightfield';
      this.group.add(terrain);
      this.bodies.push(createStylescapeTerrainBody(tile));
      const sign=fieldSign(tile.name,tile.x,stylescapeHeight(tile,tile.x,tile.z),tile.z);
      this.group.add(sign);
    });
    log('Stylescape study: loading genuine scanned rock GLTF and existing HD trees…');
    const treeItems=this.layout.tiles.flatMap(t=>
      stylescapePlacement(t,t.trees,1337).map(p=>({...p,kind:'park'})));
    // Genuine tree_small_02 CC0 LODs; avoids 950MB pine_tree_01 original.
    const [trees,rock, palm]=await Promise.all([
      treeItems.length?createVegetation(treeItems,237):Promise.resolve(null),
      new GLTFLoader().loadAsync('assets/stylescape-study/namaqualand_cliff_01/scene.gltf'),
      new GLTFLoader().loadAsync('assets/urban-kits/miami-coast/palm-detailed.glb')
    ]);
    if(trees){trees.name='Stylescape study · verified trees CC0 LOD0 / LOD1';this.group.add(trees);this.vegetation=trees;}
    for(const item of treeItems){
      const height=6.7*(item.scale||1);
      // Walk into a real trunk collider, not through a visual tree.
      const body=new CANNON.Body({mass:0,shape:new CANNON.Cylinder(.27,.4,height,8)});
      body.position.set(item.x,item.y+height/2,item.z);this.bodies.push(body);
    }
    const rocks=this.layout.tiles.flatMap(tile=>stylescapePlacement(tile,tile.rocks,612));
    const rockLayer=instancedAuthenticGLTF(rock,rocks,3.6,'Namaqualand cliff 01 · Poly Haven CC0');
    this.group.add(rockLayer);this.scenery.push(rockLayer);
    // A few rock bumpers, independent of dense render mesh triangles.
    for(const r of rocks){
      const b=new CANNON.Body({mass:0,shape:new CANNON.Sphere(1.35*r.scale)});
      b.position.set(r.x,r.y+1.3*r.scale,r.z);this.bodies.push(b);
    }
    const tropical=this.layout.tiles.find(t=>t.id==='tropical');
    const palms=stylescapePlacement(tropical,22,918);
    const palmLayer=instancedAuthenticGLTF(palm,palms,8.8,'Miami palm detailed · CC0');
    this.group.add(palmLayer);this.scenery.push(palmLayer);
    for(const p of palms){
      const body=new CANNON.Body({mass:0,shape:new CANNON.Cylinder(.2,.3,7,8)});
      body.position.set(p.x,p.y+3.5,p.z);this.bodies.push(body);
    }
    this.world.levelRuntime.root.add(this.group);
    this.bodies.forEach(b=>this.world.physicsWorld.addBody(b));
    this.loaded=true;
    this.stream(this.world.camera);
    log('Stylescape study ready: 6 walkable biomes, '+treeItems.length+' trees, '+rocks.length+
      ' scanned cliff instances, '+palms.length+' authentic palm instances.');
    return this;
  }
  stream(camera){
    this.vegetation?.userData.stream?.(camera);
    for(const item of this.scenery)item.userData.stream?.(camera);
  }
}
