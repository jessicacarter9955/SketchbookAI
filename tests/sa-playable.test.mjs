import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {saFileSector} from '../src/editor/sa-local-map.mjs';
import {WORLD_IDS} from '../src/editor/island-data.mjs';
import {BUILTIN_SCENES} from '../src/editor/scene-catalog.mjs';
const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('GTA SA local scene can be opened after importing real assets, not placeholders',()=>{
 assert.ok(WORLD_IDS.includes('san-andreas'));
 assert.ok(BUILTIN_SCENES.some(scene=>scene.id==='san-andreas-local'&&scene.world==='san-andreas'));
 assert.match(source('sa-navigation.html'),/id="sa-play"/);
 assert.match(source('src/editor/start.js'),/new SanAndreasRuntime\(world\)/);
 assert.match(source('src/editor/SanAndreasRuntime.js'),/Nessuna geometria San Andreas importata/);
 assert.doesNotMatch(source('src/editor/SanAndreasRuntime.js'),/BoxGeometry|SphereGeometry|mockSector/);
});
test('GTA SA binary node file naming validation does not accept other files or sectors',()=>{
 for(let i=0;i<64;i++)assert.equal(saFileSector('nodes'+i+'.dat'),i);
 for(const x of ['nodes64.dat','nodes-1.dat','nodes.txt','nodes1.dat.exe','other1.dat'])assert.equal(saFileSector(x),null);
});
test('original GLB geometry is used for rendering, raycast ground and Cannon collision',()=>{
 const s=source('src/editor/SanAndreasRuntime.js');
 assert.match(s,/GLTFLoader/);assert.match(s,/CANNON.Trimesh/);
 assert.match(s,/new THREE.Raycaster/);assert.match(s,/MAX_ACTIVE_COLLIDERS/);
 assert.match(s,/buildSanAndreasNetwork/);
 assert.match(source('src/editor/sa-viewer.js'),/saveSanAndreasFiles\('geometry',files\)/);
});

test('San Andreas missing local sectors are recovered by same-origin importer rather than a fatal boot',async()=>{
  const source=await import('../src/editor/sa-import-recovery.mjs');
  assert.equal(typeof source.requireSaGeometry,'function');
  assert.equal(typeof source.importSaGeometryFromBrowser,'function');
  assert.equal(typeof source.importSaNodesFromBrowser,'function');
  assert.throws(()=>source.validateSaGeometryInput([]),/Seleziona/);
  assert.throws(()=>source.validateSaGeometryInput([{name:'map.zip',size:128}]),/GLB/);
  assert.throws(()=>source.validateSaGeometryInput([{name:'sector.glb',size:512},{name:'SECTOR.GLB',size:512}]),/duplicato/);
  assert.equal(source.validateSaGeometryInput([{name:'sector_01.glb',size:512}]).length,1);
  const start=sourceFile('src/editor/start.js');
  assert.match(start,/await requireSaGeometry\(/);
  assert.ok(start.indexOf('await requireSaGeometry(')<start.indexOf('await world.levelRuntime.initialize(report);',start.indexOf("current.world === 'san-andreas'")));
  const viewer=sourceFile('src/editor/sa-viewer.js');
  assert.match(viewer,/san-andreas-streetlab/);
  assert.match(viewer,/returnScene/);
  const monitor=sourceFile('src/editor/city-telemetry.js');
  assert.match(monitor,/waitingForUser\(/);
  assert.match(monitor,/resumeUser\(/);
});
function sourceFile(p){return readFileSync(new URL('../'+p,import.meta.url),'utf8');}

test('StreetLab automatically bootstraps honest Sketchbook demo from already bundled geometry, never labeling it original SA',async()=>{
 const {isSketchbookSaDemo,tryAutoLoadSketchbookDemo}=await import('../src/editor/sa-import-recovery.mjs');
 assert.equal(isSketchbookSaDemo(['sketchbook-demo-world.glb']),true);
 assert.equal(isSketchbookSaDemo(['los-santos-original.glb']),false);
 assert.equal(typeof tryAutoLoadSketchbookDemo,'function');
 const recovery=source('src/editor/sa-import-recovery.mjs');
 assert.match(recovery,/const DEMO_URL='build\/assets\/world\.glb'/);
 assert.match(recovery,/sceneId!=='san-andreas-streetlab'/);
 assert.match(recovery,/NON|non è un asset|NOT a Rockstar/i);
 assert.match(recovery,/importSaGeometryFromBrowser\(\[file\]/);
 const {statSync,openSync,readSync,closeSync}=await import('node:fs');
 const file=new URL('../build/assets/world.glb',import.meta.url);
 const stats=statSync(file);
 assert.ok(stats.size>1_000_000,'Sketchbook demo GLB is included in the repo');
 const descriptor=openSync(file,'r'),header=Buffer.alloc(12);
 try{readSync(descriptor,header,0,12,0);}finally{closeSync(descriptor);}
 assert.equal(header.toString('ascii',0,4),'glTF');
 assert.equal(header.readUInt32LE(8),stats.size);
});

test('StreetLab Mesh surface array never activates Liberty City exclusive SurfaceTool',()=>{
  const editor=source('src/editor/SceneEditor.js');
  assert.match(editor,/worldId==='liberty-city' && typeof world\.levelRuntime\?\.surfaces\?\.setEdits==='function'/);
  assert.match(editor,/typeof this\.world\.levelRuntime\?\.surfaces\?\.setEdits==='function'/);
});
