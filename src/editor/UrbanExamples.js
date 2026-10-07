import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
const variant=new URLSearchParams(location.search).get('variant')||'residential';
const variants={residential:['01 · Strada residenziale','Kit appartamenti: muri, infissi, porte e cornici assemblati a scala reale.'],industrial:['02 · Quartiere industriale','Kit factory: mattoni, grandi finestre, cornici e accessi modulari.'],courtyard:['03 · Corte verde','Soluzione mista: residenziale + factory, giardino centrale e percorsi pedonali.']};
const [title,description]=variants[variant]||variants.residential;
document.querySelector('#title').textContent=title;document.querySelector('#description').textContent=description;
const scene=new THREE.Scene();scene.background=new THREE.Color('#b6cfdf');scene.fog=new THREE.Fog('#b6cfdf',100,230);
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.82;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;document.body.appendChild(renderer.domElement);
const camera=new THREE.PerspectiveCamera(50,innerWidth/innerHeight,.1,350);camera.position.set(variant==='courtyard'?23:7.5,variant==='courtyard'?12:2.05,variant==='courtyard'?36:39);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,variant==='courtyard'?5:2.6,-8);controls.update();
scene.add(new THREE.HemisphereLight(0xd4edff,0x766653,.4));const sun=new THREE.DirectionalLight(0xffe6c6,1.8);sun.position.set(-35,26,28);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-65;sun.shadow.camera.right=65;sun.shadow.camera.top=65;sun.shadow.camera.bottom=-65;sun.shadow.camera.far=140;sun.shadow.bias=-.0003;sun.shadow.normalBias=.025;scene.add(sun);
const sky=new Sky();sky.scale.setScalar(300);sky.material.uniforms.sunPosition.value.copy(sun.position).normalize();sky.material.uniforms.turbidity.value=3;sky.material.uniforms.rayleigh.value=1.4;scene.add(sky);
const pmrem=new THREE.PMREMGenerator(renderer);scene.environment=pmrem.fromScene(sky,.04).texture;
const loader=new GLTFLoader();
let modules=0,buildings=0;const architecture=new THREE.Group();scene.add(architecture);
function box(w,h,d,x,y,z,mat){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;scene.add(m);return m;}
const roadMat=new THREE.MeshStandardMaterial({color:0x383c40,roughness:.93}),paveMat=new THREE.MeshStandardMaterial({color:0xa5a194,roughness:.92}),curbMat=new THREE.MeshStandardMaterial({color:0xd3cdbd,roughness:.8}),greenMat=new THREE.MeshStandardMaterial({color:0x4a673c,roughness:1}),darkMat=new THREE.MeshStandardMaterial({color:0x303b40,metalness:.6,roughness:.5}),paintMat=new THREE.MeshStandardMaterial({color:0xe1dfcb,roughness:.8}),glassMat=new THREE.MeshPhysicalMaterial({color:0x8da5ad,roughness:.12,metalness:.08,transmission:.15,clearcoat:.65}),awningMat=new THREE.MeshStandardMaterial({color:0x273943,roughness:.72});
box(180,.3,180,0,-.25,0,paveMat);box(110,.12,12,0,-.04,12,roadMat);
for(const z of [4.4,19.6]){box(110,.16,3.1,0,.08,z,paveMat);box(110,.27,.22,0,.135,z+(z<12?1.55:-1.55),curbMat);}
for(let x=-48;x<52;x+=7)box(3,.015,.12,x,.028,12,paintMat);
for(let i=0;i<7;i++)box(.48,.02,7.8,-10+i*.85,.04,12,paintMat);
function texture(path,repeat){const t=new THREE.TextureLoader().load(path,render);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(...repeat);t.anisotropy=8;return t;}
roadMat.map=texture('assets/roadforge/T_RF_Asphalt_BC.png',[30,4]);roadMat.map.colorSpace=THREE.SRGBColorSpace;roadMat.roughnessMap=texture('assets/roadforge/T_RF_Asphalt_R.png',[30,4]);roadMat.color.set(0xffffff);
paveMat.map=texture('assets/roadforge/T_RF_Concrete_BC.png',[24,8]);paveMat.map.colorSpace=THREE.SRGBColorSpace;paveMat.roughnessMap=texture('assets/roadforge/T_RF_Concrete_R.png',[24,8]);paveMat.color.set(0xb7b3a5);
function lamp(x,z){box(.12,5,.12,x,2.6,z,darkMat);box(1.1,.12,.16,x+.5,5.05,z,darkMat);box(.6,.1,.32,x+.8,5,z,paintMat);}
for(let x=-42;x<=42;x+=14)lamp(x,4.6);
function storefront(x,z,w=5.2){box(w,2.75,.16,x,1.58,z,glassMat);box(w+.45,.22,1.15,x,3.02,z+.48,awningMat);box(.12,2.75,.24,x-w/2,1.58,z-.02,darkMat);box(.12,2.75,.24,x+w/2,1.58,z-.02,darkMat);}
for(const x of [-38,-25,-12,1,14,27,40])storefront(x,-.1,5.4);
for(let x=-45;x<=45;x+=5.5){box(.16,.82,.16,x,.49,3.25,darkMat);box(.34,.08,.34,x,.92,3.25,darkMat);}
for(const x of [-31,-3,25]){box(2.8,.16,.72,x,.55,3.05,paveMat);for(const dx of [-1.05,1.05])box(.09,.55,.52,x+dx,.28,3.05,darkMat);}
function module(kit,name,parent,x,y,z=0){const original=kit.getObjectByName(name);if(!original)throw Error('Missing module '+name);const m=original.clone(true);m.position.set(x,y,z);m.traverse(n=>{if(n.isMesh){n.castShadow=n.receiveShadow=true;for(const mat of [].concat(n.material)){mat.side=THREE.DoubleSide;if(mat.map)mat.map.anisotropy=8;}}});parent.add(m);modules++;return m;}
function building(kit,x,z,bays,floors,industrial=false,angle=0){
 const g=new THREE.Group();g.position.set(x,.2,z);g.rotation.y=angle;architecture.add(g);const width=bays*3,depth=12;
 // Every facade is assembled from 3 m modules. Keep the original module scale.
 const sides=[{x:width/2,z:depth/2,a:0,n:bays},{x:-width/2,z:-depth/2,a:Math.PI,n:bays},{x:width/2,z:-depth/2,a:Math.PI/2,n:4},{x:-width/2,z:depth/2,a:-Math.PI/2,n:4}];
 for(const side of sides){const face=new THREE.Group();face.position.set(side.x,0,side.z);face.rotation.y=side.a;g.add(face);
  for(let floor=0;floor<floors;floor++)for(let bay=0;bay<side.n;bay++){
   const door=floor===0&&bay===Math.floor(side.n/2);const wall=door?'wall_door_centered_large_01':'wall_window_centered_large_01';const trim=door?'door_centered_large_01':'window_centered_large_01';
   module(kit,wall,face,-bay*3,floor*3);module(kit,trim,face,-bay*3,floor*3);
   if(floor===floors-1)module(kit,industrial?'cornice02_standard_standard_01':'cornice_standard_standard_01',face,-bay*3,(floor+1)*3);
  }
 }
 const roof=new THREE.Mesh(new THREE.BoxGeometry(width+.25,.24,depth+.25),paveMat);roof.position.y=floors*3+.15;roof.receiveShadow=true;roof.castShadow=true;g.add(roof);
 const base=new THREE.Mesh(new THREE.BoxGeometry(width,.22,depth),curbMat);base.position.y=-.1;g.add(base);buildings++;
 return g;
}
try{
 const [apartments,factory,trees]=await Promise.all([loader.loadAsync('assets/urban-kits/modular_urban_apartments_facade/scene.gltf'),loader.loadAsync('assets/urban-kits/modular_factory_facade/scene.gltf').catch(()=>loader.loadAsync('assets/urban-kits/modular_urban_apartments_facade/scene.gltf')),loader.loadAsync('assets/urban-kits/tree_small_02/scene.gltf')]);
 if(variant==='industrial'){
  building(factory.scene,-27,-7,7,4,true);building(factory.scene,0,-7,7,5,true);building(factory.scene,27,-7,7,3,true);building(factory.scene,-27,-28,7,4,true);building(factory.scene,0,-28,7,4,true);building(factory.scene,27,-28,7,5,true);
 }else if(variant==='courtyard'){
  building(apartments.scene,-26,-10,6,5,false,Math.PI/2);building(apartments.scene,26,-10,6,5,false,-Math.PI/2);building(factory.scene,0,-34,8,3,true);
  box(32,.08,26,0,.04,-12,greenMat);box(2,.12,26,0,.12,-12,paveMat);box(32,.12,2,0,.12,-10,paveMat);
 }else{
  for(let i=0;i<5;i++){building(apartments.scene,(i-2)*21,-7,6,4+i%3);building(apartments.scene,(i-2)*21,-29,6,5);}
 }
 // Batch shared material geometry to reduce thousands of module draw calls.
 architecture.updateMatrixWorld(true);const batches=new Map();
 architecture.traverse(n=>{if(n.isMesh){const material=n.material;if(Array.isArray(material))throw Error('Unexpected multi-material module');const geo=n.geometry.index?n.geometry.toNonIndexed():n.geometry.clone();geo.applyMatrix4(n.matrixWorld);for(const key of Object.keys(geo.attributes))if(!['position','normal','uv'].includes(key))geo.deleteAttribute(key);if(!batches.has(material))batches.set(material,[]);batches.get(material).push(geo);}});
 scene.remove(architecture);for(const [material,geometries]of batches){const merged=mergeGeometries(geometries,false);if(!merged)throw Error('Cannot batch facade geometry');const m=new THREE.Mesh(merged,material);m.castShadow=m.receiveShadow=true;scene.add(m);geometries.forEach(g=>g.dispose());}
 // Clone whole imported trees with their hierarchy and embedded photographic leaf textures.
 trees.scene.updateMatrixWorld(true);const source=trees.scene;
 const template=new THREE.Group();source.traverse(n=>{if(n.isMesh){const m=n.clone();m.applyMatrix4(n.matrixWorld);template.add(m);}});template.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(template),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
 const positions=variant==='courtyard'?[[-11,-3],[11,-3],[-11,-17],[11,-17],[-10,-24],[10,-24],[-40,2],[40,2]]:[[-35,3],[-14,3],[9,3],[32,3],[-40,23],[-18,23],[8,23],[34,23]];
 for(const [i,[x,z]]of positions.entries()){const tree=template.clone(true),s=7/size.y;tree.scale.setScalar(s);tree.position.set(x-center.x*s,.2-bounds.min.y*s,z-center.z*s);tree.rotation.y=i*.73;tree.traverse(n=>{if(n.isMesh){n.castShadow=n.receiveShadow=true;for(const mat of [].concat(n.material)){mat.side=THREE.DoubleSide;mat.alphaTest=.45;mat.transparent=false;}}});scene.add(tree);box(2,.18,2,x,.06,z,greenMat);}
 for(const x of [-12,12]){box(2.2,.15,.6,x,.65,variant==='courtyard'?-10:4,paveMat);for(const dx of [-.8,.8])box(.08,.6,.45,x+dx,.3,variant==='courtyard'?-10:4,darkMat);}
 scene.userData.assetReport={variant,modules,buildings,trees:positions.length,localKits:2};window.__urbanExample={ready:true,report:scene.userData.assetReport};document.querySelector('#status').textContent=`${buildings} edifici · ${modules} moduli reali · ${positions.length} alberi importati`;
}catch(error){window.__urbanExample={ready:false,error:error.message};document.querySelector('#status').textContent=error.message;console.error(error);}
function render(){renderer.render(scene,camera);}controls.addEventListener('change',render);render();
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
