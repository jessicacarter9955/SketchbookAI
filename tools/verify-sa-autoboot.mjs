// Standalone real-browser proof: StreetLab opens without file picker or file upload,
// uses the bundled Sketchbook GLB demo, and tells the truth about its origin.
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
await fs.mkdir('artifacts',{recursive:true});
const browser=await chromium.launch({headless:true,args:[
 '--no-sandbox','--disable-dev-shm-usage','--use-gl=angle',
 '--use-angle=swiftshader','--enable-unsafe-swiftshader'
]});
const page=await browser.newPage({viewport:{width:1180,height:760}});
const browserErrors=[],assets=[];
page.on('pageerror',e=>browserErrors.push(String(e?.stack||e)));
page.on('response',r=>{if(r.url().includes('build/assets/world.glb'))assets.push({url:r.url(),status:r.status()});});
let report={};
try{
 await page.goto('http://127.0.0.1:8401/editor.html?scene=san-andreas-streetlab&play=1&debug=1',
  {waitUntil:'domcontentloaded',timeout:40000});
 await page.waitForFunction(()=>{
   const runtime=globalThis.world?.levelRuntime;
   const editor=globalThis.sceneEditor;
   return Boolean(runtime?.ready&&editor&&runtime.sectors?.size>0&&
     document.getElementById('sa-demo-notice')&&
     getComputedStyle(document.getElementById('loading-screen')).display==='none');
 },null,{timeout:180000,polling:800});
 report=await page.evaluate(()=>({
   ready:globalThis.world.levelRuntime.ready,
   loadedSectors:globalThis.world.levelRuntime.sectors.size,
   mapNames:globalThis.world.levelRuntime.sectorInfo.map(x=>x.name),
   message:document.querySelector('#sa-demo-notice')?.textContent,
   filePrompt:!!document.querySelector('[data-sa-glb]'),
   playerReady:!!globalThis.world.editorPlayer,
   loadedFrom:globalThis.cityDiagnostics?.exportLog?.()?.slice(-2200)
 }));
 report.assets=assets;report.browserErrors=browserErrors;
 if(report.filePrompt||!report.playerReady||report.loadedSectors<1||
    !report.mapNames.includes('sketchbook-demo-world.glb')||
    !report.message.includes('non disponibile')||
    !assets.some(a=>a.status===200))
   throw Error('StreetLab auto-launch incorrect: '+JSON.stringify(report));
 console.log('SA STREETLAB NO-UPLOAD AUTOBOOT PASSED',JSON.stringify(report).slice(0,2800));
}catch(error){
 const failure=await Promise.race([
   page.evaluate(()=>({lastLogs:globalThis.cityDiagnostics?.exportLog?.()?.slice(-5500),
       html:document.getElementById('loading-screen')?.textContent?.slice(0,1800),
       runtimeReady:globalThis.world?.levelRuntime?.ready,
       notice:document.getElementById('sa-demo-notice')?.textContent})),
   new Promise(ok=>setTimeout(()=>ok({unresponsive:true}),6500))
 ]).catch(e=>({error:String(e)}));
 report={error:String(error?.stack||error),failure,assets,browserErrors};
 console.error('SA STREETLAB AUTOBOOT FAILED',JSON.stringify(report).slice(0,10500));
 process.exitCode=1;
}finally{
 await fs.writeFile('artifacts/sa-streetlab-autoboot.json',JSON.stringify(report,null,2));
 await browser.close();
}
