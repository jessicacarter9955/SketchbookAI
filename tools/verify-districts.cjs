// Browser-level proof of editor boot, autonomous traffic and physical viaduct.
const {chromium}=require('playwright');
const fs=require('fs');
const base=(process.env.DISTRICT_BASE_URL||'http://127.0.0.1:8401').replace(/\\/$/,'');
const host=new URL(base).host;
(async()=>{
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[],requests=[];
page.on('pageerror',e=>errors.push(String(e.stack||e)));
page.on('response',r=>{if(r.status()>=400&&new URL(r.url()).host===host)requests.push(r.url()+' '+r.status());});
let result;
try{
 await page.goto(base+'/editor.html?scene=coastal-districts&play=1&cars=0',
    {waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>Boolean(window.world?.levelRuntime?.ready&&window.sceneEditor&&window.districtTraffic),null,
   {timeout:120000,polling:800});
 await page.waitForTimeout(4000);
 result=await page.evaluate(()=>{
   const runtime=world.levelRuntime;
   return {ready:runtime.ready,districts:runtime.plan.zones.map(x=>x.id),
     buildingCount:runtime.plan.buildings.length,roadCount:runtime.plan.roads.length,
     bridgeCount:runtime.plan.roads.filter(x=>x.kind==='bridge').length,
     trafficCars:window.districtTraffic.cars.length,sidewalkWalkers:window.districtTraffic.people.length,
     defaultCarCount:sceneEditor.items.filter(x=>x.prefab==='vehicle').length,
     dialogue:!!document.querySelector('#district-dialogue'),
     cityMenu:!!document.querySelector('select[aria-label="Punto di partenza"]'),
     playing:!sceneEditor.active,waterVisible:!!runtime.water,
     physicsBodies:runtime.bodies.length};
 });
 result.pageErrors=errors;result.missingLocalAssets=requests;
 if(!result.playing||!result.waterVisible||result.districts.length!==4||
    result.trafficCars<10||result.sidewalkWalkers<15||result.defaultCarCount<4||
    !result.dialogue||result.bridgeCount!==1||!result.cityMenu||requests.length||errors.length)
  throw Error('Multi-district browser smoke failed: '+JSON.stringify(result));
 console.log('MULTIDISTRICT BROWSER PASS '+JSON.stringify(result));
}catch(e){
 result={error:String(e.stack||e),pageErrors:errors,missingLocalAssets:requests,
  content:(await page.locator('body').innerText().catch(()=>'' )).slice(0,1200)};
 console.error('MULTIDISTRICT BROWSER FAIL '+JSON.stringify(result));process.exitCode=1;
}finally{
 fs.mkdirSync('artifacts',{recursive:true});
 fs.writeFileSync('artifacts/district-browser-report.json',JSON.stringify(result,null,2));
 await page.screenshot({path:'artifacts/district-browser.png',fullPage:false,timeout:10000}).catch(()=>{});
 await browser.close();
}
})().catch(e=>{console.error(e);process.exitCode=1});
