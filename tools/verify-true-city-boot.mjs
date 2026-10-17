// Reproduce TRUE Realistic City boot with the exact packaged renderer, including
// selectable logs and the vegetation -> first-frame transition.
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
const base=process.env.URBAN_TEST_ORIGIN||'http://127.0.0.1:8401';
await fs.mkdir('artifacts',{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1240,height:800},deviceScaleFactor:1});
const errors=[],failures=[];
page.on('pageerror',e=>errors.push(String(e?.stack||e)));
page.on('requestfailed',r=>failures.push(r.url()+' '+r.failure()?.errorText));
await page.addInitScript(()=>{
  // Deterministic clipboard assertion, without OS clipboard permissions.
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
    writeText:async text=>{window.__cityCopiedLog=text;}
  }});
});
let proof={};
try{
  await page.goto(base+'/editor.html?scene=urban-photoreal&play=1&debug=1',{waitUntil:'domcontentloaded',timeout:45000});
  const button=page.locator('[data-city-copy-log]');
  await button.waitFor({state:'visible',timeout:15000});
  await button.click({timeout:12000});
  let clipboard=await page.evaluate(()=>globalThis.__cityCopiedLog||'');
  if(!clipboard.includes('Eventi in ordine cronologico:')||!clipboard.includes('Snapshot:'))
    throw Error('Copia log incompleto (cronologia/snapshot assenti)');
  const selectable=await page.evaluate(()=>{
    const log=document.querySelector('#city-debug-log');
    return log&&getComputedStyle(log).userSelect!=='none'&&getComputedStyle(log).pointerEvents!=='none';
  });
  if(!selectable)throw Error('Log cannot be selected with mouse/touch');
  await page.waitForFunction(()=>{
    const r=globalThis.world?.levelRuntime;
    return r?.visualState?.status==='ready'&&
      globalThis.getComputedStyle(document.getElementById('loading-screen')).display==='none'&&
      Boolean(globalThis.sceneEditor);
  },null,{timeout:150000,polling:800});
  // The log must continue working after the loading screen has closed.
  await button.click({timeout:12000});
  clipboard=await page.evaluate(()=>globalThis.__cityCopiedLog||'');
  const state=await page.evaluate(()=>{
    const r=globalThis.world?.levelRuntime;
    const root=r?.root?.getObjectByName('CC0 photoreal vegetation');
    return {status:r?.visualState?.status,vegetation:r?.visualState?.vegetation,
      loadedTrees:root?.children?.length||0,preparedTrees:root?.userData?.preparedCount,
      panelInsideLoader:document.querySelector('#loading-screen')?.contains(document.querySelector('.city-telemetry')),
      debugVisible:getComputedStyle(document.querySelector('.city-telemetry')).display!=='none'};
  });
  if(!clipboard.includes('VEGETAZIONE:')&&!clipboard.includes('Vegetazione'))
    throw Error('Log does not explain tree initialization');
  if(state.status!=='ready'||state.loadedTrees<15||!state.debugVisible||state.panelInsideLoader)
    throw Error('TRUE City HD / debug verification failed: '+JSON.stringify(state));
  proof={ok:true,state,copyCharacters:clipboard.length,errors,failures};
  console.log('TRUE CITY HD FIRST FRAME:',JSON.stringify(proof));
}catch(error){
  const snapshot=await Promise.race([
    page.evaluate(()=>({state:globalThis.world?.levelRuntime?.visualState,
      progress:globalThis.world?.levelRuntime?.visualProgress,
      phase:document.querySelector('#city-load-message')?.textContent,
      summary:document.querySelector('#city-debug-summary')?.textContent,
      timeline:globalThis.cityDiagnostics?.exportLog?.(),
      screen:document.querySelector('#loading-screen')?.textContent?.slice(0,2400)})),
    new Promise(resolve=>setTimeout(()=>resolve({unresponsive:'JS thread blocked during diagnostic snapshot'}),6000))
  ]).catch(e=>({error:String(e)}));
  proof={ok:false,error:String(error?.stack||error),snapshot,errors,failures};
  console.error('TRUE CITY BOOT FAILURE:',JSON.stringify(proof).slice(0,9000));
  process.exitCode=1;
}finally{
  await fs.writeFile('artifacts/true-city-boot-diagnostics.json',JSON.stringify(proof,null,2));
  await browser.close();
}
