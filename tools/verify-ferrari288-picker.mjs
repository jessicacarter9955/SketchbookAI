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
  // The user starts a Ferrari search from the live city, not the test-only picker.
  await page.evaluate(()=>globalThis.sceneEditor.openModelLibrary('ferrari'));
  const card=page.locator('.asset-results article[data-model="'+uid+'"]');
  await card.waitFor({state:'visible',timeout:45000});
  await card.getByRole('button',{name:'Aggiungi alla scena'}).click({timeout:20000});
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
      loadingState:globalThis.world.levelRuntime.visualState.status,
      tokenRequiredMessage:document.querySelector('[data-status]')?.textContent||''};
  });
  proof.responses=responses;proof.pageErrors=pageErrors;
  if(proof.assetUid!==uid||proof.meshCount<10||proof.sizeBytes<1000000||
     !proof.modelVisible||proof.loadingState!=='ready'||
     !responses.some(r=>r.status===200))
    throw Error('Ferrari GLB inserted incorrectly: '+JSON.stringify(proof));
  if(/inserisci il tuo token|poi premi riprova/i.test(proof.tokenRequiredMessage))
    throw Error('Picker still requires a browser token: '+proof.tokenRequiredMessage);
  await page.screenshot({path:'artifacts/ferrari-288-gto-in-true-city.png',timeout:30000});
  console.log('FERRARI 288 GTO REAL CITY IMPORT PASSED',JSON.stringify(proof));
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
