// node tools/import-sa-paths.mjs <folder-of-nodes-dat-files> [output.json]
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {parseSanAndreasNodeFile,buildSanAndreasNetwork} from '../src/editor/sa-paths.mjs';
const folder=process.argv[2];
if(!folder)throw Error('Usage: node tools/import-sa-paths.mjs <nodes-dat-directory> [out.json]');
const dir=resolve(folder),out=resolve(process.argv[3]||'build/local-scenes/sa-navigation/navigation.json');
const files=(await readdir(dir)).filter(f=>/^nodes(?:[0-9]|[1-5][0-9]|6[0-3])\.dat$/i.test(f));
if(!files.length)throw Error('No nodes*.dat. Supply your own legally obtained GTA San Andreas paths.');
const sectors=[];
for(const file of files)sectors.push(parseSanAndreasNodeFile(await readFile(join(dir,file)),Number(file.match(/\d+/)[0])));
const ped=buildSanAndreasNetwork(sectors),car=buildSanAndreasNetwork(sectors,'vehicle');
const compact=g=>g.nodes.map(n=>({key:n.key,x:n.x,y:n.y,z:n.z,
  pathWidth:n.pathWidth,emergencyOnly:n.emergencyOnly,edges:n.edges}));
await mkdir(dirname(out),{recursive:true});
await writeFile(out,JSON.stringify({schema:'sketchbook.sa-paths.v1',
  importedSectors:sectors.map(s=>s.sectorId).sort((a,b)=>a-b),
  pedestrians:compact(ped),vehicles:compact(car)}));
console.log('Imported '+sectors.length+' sectors, '+ped.nodes.length+' pedestrian and '+car.nodes.length+' car nodes → '+out);
