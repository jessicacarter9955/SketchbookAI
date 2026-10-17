// Browser proof: the real Ferrari 288 GTO must be insertable into TRUE City
// without typing any Sketchfab browser token. Uses the actual Render-sourced GLB
// and the actual SceneEditor importer, not a fake cube or JSON-only test.
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
const base=process.env.URBAN_TEST_ORIGIN||'http://127.0.0.1:8401';
const uid='e83da098149746b5a3ba6f1661645b09';
await fs.mkdir('artifacts',{recursive:true});
const browser=await chromium.launch({headless:true,args:[
  '--no-sandbox','--disable-dev-shm-usage','--use-gl=angle',
  '--use-angle=swiftshader','--enable-unsafe-swiftshader'
]});
const page=await browser.newPage({viewport:{width:1260,height:800}});
const pageErrors=[],responses=[];
page.on('pageerror',err=>pageErrors.push(String(err?.stack||err)));
page.on('response',response=>{
  if(/sketchbook-fab-bridge\.onrender\.com\/sketchfab\/cars\//.test(response.url()))
    responses.push({status:response.status(),url:response.url()});
});
let proof={};
try{
  await page.goto(base+'/editor.html?scene=urban-photoreal&play=1&debug=1',
    {waitUntil:'domcontentloaded',timeout:50000});
  await page.waitForFunction(()=>{
    const world=globalThis.world,editor=globalThis.sceneEditor;
    return world?.levelRuntime?.visualState?.status==='ready'&&
      !!editor&&!!world?.editorPlayer&&
      getComputedStyle(document.getElementById('loading-screen')).display==='none';
  },null,{timeout:180000,polling:700});
  const before=await page.evaluate(()=>globalThis.sceneEditor.items.length);
  // A server-side token must never be copied into the visitor's personal field.
  await page.waitForFunction(()=>{
    const access=document.querySelector('[name=server-access]');
    return !!access&&access.value.includes('Connesso');
  },null,{timeout:30000});
  const access=await page.evaluate(()=>({
    server:document.querySelector('[name=server-access]').value,
    personal:document.querySelector('[name=token]').value,
    manual:document.querySelector('[name=tokens-json]').value
  }));
  if(access.personal||access.manual||!access.server.includes('token protetto'))
    throw Error('Protected server access UI is not correctly separated: '+JSON.stringify(access));
  // The user starts a Ferrari search from the live city, not the test-only picker.
  await page.evaluate(()=>globalThis.sceneEditor.openModelLibrary('ferrari'));
  const card=page.locator('.asset-results article[data-model="'+uid+'"]');
  await card.waitFor({state:'visible',timeout:45000});
  // On SwiftShader the 8M-triangle photoreal city can prevent Playwright's
  // actionability (stable-pixel) detector from settling. Dispatch the actual
  // DOM button's click event after confirming it is visible and enabled.
  await page.evaluate(modelUid=>{
    const card=document.querySelector('.asset-results article[data-model="'+modelUid+'"]');
    const button=[...card?.querySelectorAll('button')||[]].find(b=>b.textContent.startsWith('Aggiungi alla scena'));
    if(!button||button.disabled||getComputedStyle(button).visibility==='hidden')
      throw Error('Ferrari Add button missing or disabled');
    button.click();
  },uid);
  await page.waitForFunction(expected=>{
    const editor=globalThis.sceneEditor;
    return editor.items.length>expected&&editor.items.some(item=>
      item.name==='Ferrari 288 GTO'&&item.assetId&&
      editor.templates.has(item.assetId)&&editor.objects.has(item.id));
  },before,{timeout:120000,polling:400});
  proof=await page.evaluate(()=>{
    const editor=globalThis.sceneEditor;
    const item=editor.items.find(x=>x.name==='Ferrari 288 GTO'&&x.assetId);
    const model=editor.templates.get(item.assetId);
    let meshCount=0;model.traverse(o=>{if(o.isMesh)meshCount++;});
    const asset=editor.assets.get(item.assetId);
    return {success:true,name:item.name,assetUid:asset?.metadata?.uid,
      sceneId:item.id,meshCount,source:asset?.metadata?.source,
      sizeBytes:asset?.bytes?.byteLength||0,
      modelVisible:!!editor.objects.get(item.id),
      driveable:item.prefab==='vehicle',
      carPresent:globalThis.world.vehicles.some(car=>car.userData.importedModel===item.assetId),
      carWheels:globalThis.world.vehicles.find(car=>car.userData.importedModel===item.assetId)?.rayCastVehicle?.wheelInfos?.length||0,
      carSeats:globalThis.world.vehicles.find(car=>car.userData.importedModel===item.assetId)?.seats?.length||0,
      loadingState:globalThis.world.levelRuntime.visualState.status,
      tokenRequiredMessage:document.querySelector('[data-status]')?.textContent||''};
  });
  proof.responses=responses;proof.pageErrors=pageErrors;
  if(proof.assetUid!==uid||proof.meshCount<10||proof.sizeBytes<1000000||
     !proof.modelVisible||!proof.driveable||!proof.carPresent||
     proof.carWheels!==4||proof.carSeats<1||proof.loadingState!=='ready'||
     !responses.some(r=>r.status===200))
    throw Error('Ferrari GLB inserted incorrectly: '+JSON.stringify(proof));
  // Verify the existing character can sit in the new physics vehicle.
  proof.driver=await page.evaluate(()=>{
    const world=globalThis.world,item=world.sceneEditor.items.find(i=>i.name==='Ferrari 288 GTO');
    const car=world.vehicles.find(v=>v.userData.importedModel===item.assetId);
    const seat=car.seats.find(s=>s?.type==='driver'&&!s.occupiedBy)||car.seats.find(s=>!s.occupiedBy);
    if(!seat)throw Error('Ferrari physically instantiated but driver seat missing');
    const player=world.editorPlayer;
    player.teleportToVehicle(car,seat);player.takeControl();
    return {inCar:player.controlledObject===car,seatOccupied:seat.occupiedBy===player,
      chassisMass:car.collision.mass,raycast:car.rayCastVehicle.wheelInfos.length};
  });
  if(!proof.driver.inCar||!proof.driver.seatOccupied||proof.driver.chassisMass<=0)
    throw Error('Ferrari cannot be entered and controlled: '+JSON.stringify(proof.driver));
  if(/inserisci il tuo token|poi premi riprova/i.test(proof.tokenRequiredMessage))
    throw Error('Picker still requires a browser token: '+proof.tokenRequiredMessage);
  // The 10M-triangle photoreal scene can make SwiftShader screenshot/readback
  // much slower than asset verification; never misreport an already-verified
  // model insertion as a download or import failure due only to screenshot IO.
  console.log('FERRARI 288 GTO REAL CITY IMPORT PASSED',JSON.stringify(proof));
  try {
    await page.screenshot({path:'artifacts/ferrari-288-gto-in-true-city.png',timeout:9000,animations:'disabled'});
  }catch(error){
    console.warn('OPTIONAL SCREENSHOT NOT CAPTURED (SwiftShader readback):',String(error.message).slice(0,220));
  }
}catch(error){
  const state=await Promise.race([
    page.evaluate(()=>({status:document.querySelector('[data-status]')?.textContent,
      loading:document.querySelector('#city-load-message')?.textContent,
      preview:document.querySelector('.asset-results')?.textContent?.slice(0,800),
      logs:globalThis.cityDiagnostics?.exportLog?.()?.slice(-5500),
      modelCount:globalThis.sceneEditor?.items?.length,
      stage:globalThis.world?.levelRuntime?.visualState})),
    new Promise(resolve=>setTimeout(()=>resolve({unresponsive:true}),5000))
  ]).catch(e=>({error:String(e)}));
  proof={success:false,error:String(error?.stack||error),state,responses,pageErrors};
  console.error('FERRARI 288 GTO IMPORT FAILED',JSON.stringify(proof).slice(0,10000));
  process.exitCode=1;
}finally{
  await fs.writeFile('artifacts/ferrari-288-gto-import.json',JSON.stringify(proof,null,2));
  await browser.close();
}
