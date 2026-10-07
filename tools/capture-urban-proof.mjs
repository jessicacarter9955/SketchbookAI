import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const base=process.env.URBAN_URL||'http://127.0.0.1:8401';
const out=process.env.URBAN_ARTIFACTS||'artifacts';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});

async function writeDataUrl(path,dataUrl){
  const match=/^data:image\/png;base64,(.+)$/.exec(dataUrl||'');
  if(!match)throw new Error(`Invalid PNG data URL for ${path}`);
  const bytes=Buffer.from(match[1],'base64');
  if(bytes.length<20000)throw new Error(`Suspiciously small PNG for ${path}: ${bytes.length} bytes`);
  await fs.writeFile(path,bytes);
  return bytes.length;
}

async function exampleShot(variant){
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  await page.goto(`${base}/urban-examples.html?variant=${variant}`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>globalThis.__urbanExample?.ready===true,null,{timeout:60000});
  const report=await page.evaluate(()=>globalThis.__urbanExample.report);
  if(!report||report.localKits<2||report.buildings<1||report.trees<1)
    throw new Error(`${variant}: imported-kit proof failed ${JSON.stringify(report)}`);
  await page.waitForTimeout(800);
  const dataUrl=await page.evaluate(()=>document.querySelector('canvas')?.toDataURL('image/png'));
  const bytes=await writeDataUrl(`${out}/urban-example-${variant}.png`,dataUrl);
  await fs.writeFile(`${out}/urban-example-${variant}.json`,JSON.stringify({...report,pngBytes:bytes},null,2));
  console.log('example',variant,{...report,pngBytes:bytes});
  await page.close();
}

async function captureRuntime(){
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  const consoleErrors=[];
  page.on('console',msg=>{if(msg.type()==='error')consoleErrors.push(msg.text());});
  await page.goto(`${base}/editor.html?scene=urban-photoreal`,{waitUntil:'domcontentloaded'});

  const collectDebug=()=>page.evaluate(()=>({
    visualState:globalThis.world?.levelRuntime?.visualState||null,
    runtimeReady:globalThis.world?.levelRuntime?.ready||false,
    loadingText:document.querySelector('#loading-screen')?.textContent||'',
    title:document.title,
    resources:performance.getEntriesByType('resource')
      .filter(r=>/urban-kits|roadforge|gltf|png/i.test(r.name))
      .map(r=>({name:r.name,duration:Math.round(r.duration),transferSize:r.transferSize}))
  }));

  try{
    await page.waitForFunction(()=>{
      const state=globalThis.world?.levelRuntime?.visualState;
      return state?.status==='ready'||state?.status==='error';
    },null,{timeout:60000});
  }catch(error){
    const debug=await collectDebug();
    await fs.writeFile(`${out}/urban-runtime-FAILED.json`,JSON.stringify({debug,consoleErrors,error:String(error)},null,2));
    throw new Error(`Photoreal readiness timeout: ${JSON.stringify(debug.visualState)}`);
  }

  const state=await page.evaluate(()=>globalThis.world?.levelRuntime?.visualState||null);
  if(state?.status!=='ready'){
    const debug=await collectDebug();
    await fs.writeFile(`${out}/urban-runtime-FAILED.json`,JSON.stringify({debug,consoleErrors},null,2));
    throw new Error(`Photoreal runtime error: ${state?.error||'unknown'}`);
  }

  const proof=await page.evaluate(()=>{
    const world=globalThis.world,editor=globalThis.sceneEditor;
    editor?.setActive?.(true);
    if(editor?.orbit)editor.orbit.enabled=false;
    if(world.editorPlayer)world.editorPlayer.visible=false;
    world.actorLayer?.actors?.forEach(actor=>actor.visible=false);
    world.vehicles?.forEach(vehicle=>vehicle.visible=false);
    const style=document.createElement('style');
    style.textContent='.editor-toolbar,.editor-panel,.editor-footer,.editor-help,.city-hud,#ui-container,.dg,.dds-hud,.dds-crosshair{display:none!important}';
    document.head.append(style);
    const group=world.levelRuntime.root.children.find(g=>g.userData?.photorealReady);
    const vegetation=group?.getObjectByName?.('CC0 photoreal vegetation');
    return {
      state:world.levelRuntime.visualState,
      assets:group?.userData?.photorealAssets||[],
      vegetation:group?.userData?.photorealVegetation||null,
      cc0TreeCount:vegetation?.children?.length||0,
      buildings:world.levelRuntime.plan?.buildings?.length||0,
      trees:world.levelRuntime.plan?.trees?.length||0
    };
  });
  if(proof.assets.length<1||!proof.vegetation||proof.cc0TreeCount<1)
    throw new Error(`Photoreal proof incomplete: ${JSON.stringify(proof)}`);

  const shots=[
    ['urban-proof-overview',[88,58,92],[0,12,-8]],
    ['urban-proof-street',[9,6.2,46],[0,5,-18]],
    ['urban-proof-vegetation',[-34,7.5,24],[-18,5,-6]]
  ];
  for(const [name,camera,target] of shots){
    const dataUrl=await page.evaluate(({camera,target})=>{
      const world=globalThis.world;
      world.camera.fov=48;world.camera.updateProjectionMatrix();
      world.camera.position.set(...camera);world.camera.lookAt(...target);world.camera.updateMatrixWorld(true);
      world.renderer.render(world.graphicsWorld,world.camera);
      return world.renderer.domElement.toDataURL('image/png');
    },{camera,target});
    const bytes=await writeDataUrl(`${out}/${name}.png`,dataUrl);
    console.log(name,{pngBytes:bytes});
  }
  await fs.writeFile(`${out}/urban-proof.json`,JSON.stringify({proof,consoleErrors},null,2));
  console.log('runtime proof',proof);
  await page.close();
}

let runtimeError=null;
try{
  // Always produce the environment-only evidence first. These pages use the downloaded,
  // checksum-verified CC0 kits directly and never show the Sketchbook player.
  for(const variant of ['residential','industrial','courtyard'])await exampleShot(variant);
  try{await captureRuntime();}catch(error){runtimeError=error;console.error(error);}
}finally{
  await browser.close();
}
if(runtimeError)throw runtimeError;
