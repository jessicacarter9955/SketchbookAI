import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const base=process.env.URBAN_URL||'http://127.0.0.1:8401';
const out=process.env.URBAN_ARTIFACTS||'artifacts';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});

async function runtimeShot(name,camera,target){
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  const errors=[];
  page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
  await page.goto(`${base}/editor.html?scene=urban-photoreal`,{waitUntil:'domcontentloaded'});
  try{
    await page.waitForFunction(()=>{
      const state=globalThis.world?.levelRuntime?.visualState;
      return state?.status==='ready'||state?.status==='error';
    },null,{timeout:90000});
  }catch(waitError){
    const debug=await page.evaluate(()=>({
      visualState:globalThis.world?.levelRuntime?.visualState||null,
      runtimeReady:globalThis.world?.levelRuntime?.ready||false,
      loadingText:document.querySelector('#loading-screen')?.textContent||'',
      title:document.title,
      resources:performance.getEntriesByType('resource').filter(r=>/urban-kits|roadforge|gltf|png/i.test(r.name)).map(r=>({name:r.name,duration:r.duration,transferSize:r.transferSize}))
    }));
    await page.screenshot({path:`${out}/${name}-FAILED.png`,fullPage:false});
    await fs.writeFile(`${out}/${name}-FAILED.json`,JSON.stringify({debug,consoleErrors:errors,error:String(waitError)},null,2));
    throw new Error(`${name}: photoreal readiness timeout ${JSON.stringify(debug.visualState)}`);
  }
  const state=await page.evaluate(()=>globalThis.world?.levelRuntime?.visualState||null);
  if(state?.status==='error'){
    await page.screenshot({path:`${out}/${name}-FAILED.png`,fullPage:false});
    await fs.writeFile(`${out}/${name}-FAILED.json`,JSON.stringify({state,consoleErrors:errors},null,2));
    throw new Error(`${name}: photoreal runtime error ${state.error}`);
  }
  const proof=await page.evaluate(({camera,target})=>{
    const world=globalThis.world,editor=globalThis.sceneEditor;
    editor?.setActive?.(true);
    if(editor?.orbit)editor.orbit.enabled=false;
    if(world.editorPlayer)world.editorPlayer.visible=false;
    world.actorLayer?.actors?.forEach(actor=>actor.visible=false);
    world.vehicles?.forEach(vehicle=>{if(vehicle!==world.editorPlayer?.controlledObject)vehicle.visible=false;});
    const style=document.createElement('style');
    style.textContent='.editor-toolbar,.editor-panel,.editor-footer,.editor-help,.city-hud,#ui-container,.dg,.dds-hud,.dds-crosshair{display:none!important} body{background:#000!important}';
    document.head.append(style);
    world.camera.fov=48;world.camera.updateProjectionMatrix();
    world.camera.position.set(...camera);world.camera.lookAt(...target);world.camera.updateMatrixWorld(true);
    const group=world.levelRuntime.root.children.find(g=>Array.isArray(g.userData?.photorealAssets));
    const vegetation=group?.getObjectByName?.('CC0 photoreal vegetation');
    return {
      assets:group?.userData?.photorealAssets||[],
      vegetation:group?.userData?.photorealVegetation||null,
      cc0TreeCount:vegetation?.children?.length||0,
      buildings:world.levelRuntime.plan?.buildings?.length||0,
      trees:world.levelRuntime.plan?.trees?.length||0
    };
  },{camera,target});
  if(proof.assets.length<2||!proof.vegetation||proof.cc0TreeCount<1)throw new Error(`${name}: photoreal layer missing ${JSON.stringify(proof)}`);
  await page.waitForTimeout(1200);
  await page.screenshot({path:`${out}/${name}.png`,fullPage:false});
  await fs.writeFile(`${out}/${name}.json`,JSON.stringify({proof,consoleErrors:errors},null,2));
  console.log(name,proof);
  await page.close();
}

async function exampleShot(variant){
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  await page.goto(`${base}/urban-examples.html?variant=${variant}`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>globalThis.__urbanExample?.ready===true,null,{timeout:45000});
  const report=await page.evaluate(()=>globalThis.__urbanExample.report);
  if(!report||report.localKits<3||report.buildings<1||report.trees<1)throw new Error(`${variant}: imported-kit proof failed ${JSON.stringify(report)}`);
  await page.screenshot({path:`${out}/urban-example-${variant}.png`,fullPage:false});
  await fs.writeFile(`${out}/urban-example-${variant}.json`,JSON.stringify(report,null,2));
  console.log('example',variant,report);
  await page.close();
}

await runtimeShot('urban-proof-overview',[88,58,92],[0,12,-8]);
await runtimeShot('urban-proof-street',[9,6.2,46],[0,5,-18]);
await runtimeShot('urban-proof-vegetation',[-34,7.5,24],[-18,5,-6]);
for(const variant of ['residential','industrial','courtyard'])await exampleShot(variant);
await browser.close();
