// Real browser acceptance of Unreal coastal integration + existing Sketchbook gameplay.
const {chromium}=require('playwright');
const fs=require('fs');
const base=(process.env.DISTRICT_BASE_URL||'http://127.0.0.1:8765').replace(/\/$/,'');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage',
  '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1280,height:800}});
 const errors=[],missing=[];
 page.on('pageerror',e=>errors.push(String(e.stack||e)));
 page.on('response',r=>{
  if(r.status()>=400&&new URL(r.url()).host===new URL(base).host&&
    !r.url().endsWith('/build/local-scenes/ue2three-districts/manifest.json') &&
    !r.url().endsWith('/.local/sketchfab.json'))
   missing.push(r.status()+' '+r.url());
 });
 let report={};
 try{
  await page.goto(base+'/editor.html?scene=coastal-districts&play=1&cars=0',{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>Boolean(window.world?.levelRuntime?.ready&&window.sceneEditor&&
    window.world?.districtTraffic&&window.coastalDistrictEvidence),null,{timeout:120000,polling:500});
  await page.waitForTimeout(1800);
  report=await page.evaluate(()=>{
   const w=window.world,r=w.levelRuntime,t=w.districtTraffic,ed=window.sceneEditor;
   return {ready:r.ready,scene:r.root.name,unreal:window.coastalDistrictEvidence,
    zones:r.plan.zones.map(x=>x.id),roads:r.plan.roads.length,buildings:r.plan.buildings.length,
    bridge:r.plan.roads.filter(x=>x.kind==='bridge').length,cars:t.cars.length,
    pedestrians:t.people.length,driveableCars:ed.items.filter(x=>x.prefab==='vehicle').length,
    activeActors:w.actorLayer?.actors?.length||0,
    activePhysicalCars:w.vehicles?.length||0,
    seatCars:(w.vehicles||[]).filter(c=>c.seats?.some(seat=>seat&&!seat.occupiedBy)).length,
    playerToClosestCar:w.editorPlayer&&w.vehicles?.length?Math.min(...w.vehicles.map(c=>c.position.distanceTo(w.editorPlayer.position))):null,
    dialogue:!!document.querySelector('#district-dialogue'),spawns:r.manifest.spawns.length,
    playing:!ed.active,physicsBodies:r.bodies.length};
  });
  report.pageErrors=errors;report.missingLocalAssets=missing;
  if(!report.ready||report.zones.join(',')!=='ny,sf,rio,miami'||report.roads<120||
     report.buildings<100||report.bridge!==1||report.cars<20||report.pedestrians<15||
     report.driveableCars<4||report.activePhysicalCars<4||report.seatCars<4||!report.dialogue||report.spawns!==5||!report.playing||
     report.pageErrors.length||report.missingLocalAssets.length)
    throw Error('City acceptance failed: '+JSON.stringify(report));
  console.log('REALISTIC CITY DDS UE2THREE COASTAL PASS '+JSON.stringify(report));
 }catch(error){
  report={error:String(error.stack||error),...report,pageErrors:errors,missingLocalAssets:missing,
   body:(await page.locator('body').innerText().catch(()=>'' )).slice(0,2200)};
  console.error(JSON.stringify(report));process.exitCode=1;
 }finally{
  fs.mkdirSync('artifacts',{recursive:true});
  fs.writeFileSync('artifacts/ue2three-coastal-browser.json',JSON.stringify(report,null,2));
  try {await page.screenshot({path:'artifacts/ue2three-coastal-browser.png',timeout:45000,animations:'disabled'});}
  catch(e){console.warn('Screenshot was not captured:',e.message)}
  await browser.close();
 }
})().catch(e=>{console.error(e);process.exitCode=1});
