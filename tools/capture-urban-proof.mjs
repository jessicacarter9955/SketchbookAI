import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const base=process.env.URBAN_URL||'http://127.0.0.1:8401';
const out=process.env.URBAN_ARTIFACTS||'artifacts';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.URBAN_CHROME_PATH?{executablePath:process.env.URBAN_CHROME_PATH,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--single-process','--no-zygote']}:{})});

async function writeDataUrl(path,dataUrl){
  const match=/^data:image\/png;base64,(.+)$/.exec(dataUrl||'');
  if(!match)throw new Error(`Invalid PNG data URL for ${path}`);
  const bytes=Buffer.from(match[1],'base64');
  if(bytes.length<20000)throw new Error(`Suspiciously small PNG for ${path}: ${bytes.length} bytes`);
  await fs.writeFile(path,bytes);
  return bytes.length;
}

async function captureEnvironment(){
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  await page.goto(`${base}/urban-examples.html?variant=residential`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>globalThis.__urbanExample?.ready===true&&typeof globalThis.__urbanExampleCapture==='function',null,{timeout:90000,polling:500});
  const report=await page.evaluate(()=>globalThis.__urbanExample.report);
  if(!report||report.localKits<2||report.buildings<10||report.trees<8)
    throw new Error(`residential proof failed ${JSON.stringify(report)}`);

  const shots=[
    ['urban-environment-overview',[56,22,52],[0,6,-14]],
    ['urban-environment-street',[7,4.8,34],[0,3,-10]],
    ['urban-environment-vegetation',[-34,6.8,18],[-16,4,-8]]
  ];
  for(const [name,camera,target] of shots){
    const dataUrl=await page.evaluate(({camera,target})=>globalThis.__urbanExampleCapture(camera,target),{camera,target});
    const bytes=await writeDataUrl(`${out}/${name}.png`,dataUrl);
    console.log(name,{pngBytes:bytes});
  }
  await fs.writeFile(`${out}/urban-environment-proof.json`,JSON.stringify(report,null,2));
  await page.close();
}

async function captureRuntime(){
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  const consoleErrors=[];
  page.on('console',msg=>{if(msg.type()==='error')consoleErrors.push(msg.text());});
  // Freeze animation for repeatable captures; render the same production composer explicitly.
  await page.addInitScript(()=>{window.requestAnimationFrame=()=>0;});
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
      return state?.status==='error'||(state?.status==='ready'&&globalThis.sceneEditor&&globalThis.world.levelRuntime.config.maxFloors===7);
    },null,{timeout:120000,polling:500});
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
    world.render=()=>{};
    editor.items.filter(i=>['vehicle','pedestrian'].includes(i.prefab)).forEach(i=>{editor.objects.get(i.id).visible=false;});
    if(world.editorPlayer)world.editorPlayer.visible=false;
    world.actorLayer?.actors?.forEach(actor=>actor.visible=false);
    world.vehicles?.forEach(vehicle=>vehicle.visible=false);
    const style=document.createElement('style');
    style.textContent='.editor-toolbar,.editor-panel,.editor-footer,.editor-help,.city-hud,#ui-container,.dg,.dds-hud,.dds-crosshair{display:none!important}';
    document.head.append(style);
    const root=world.levelRuntime.root,vegetation=root.getObjectByName?.('CC0 photoreal vegetation');
    let facadeGroups=0;
    root.traverse?.(node=>{if(node.userData?.photorealArchitecture)facadeGroups++;});
    return {
      state:world.levelRuntime.visualState,
      assets:world.levelRuntime.visualState?.architecture||[],
      vegetation:world.levelRuntime.visualState?.vegetation||null,
      cc0TreeCount:vegetation?.children?.length||world.levelRuntime.visualState?.vegetation?.count||0,
      facadeGroups,
      buildings:world.levelRuntime.plan?.buildings?.length||0,
      trees:world.levelRuntime.plan?.trees?.length||0
    };
  });
  if(proof.assets.length<2||!proof.vegetation||proof.cc0TreeCount<8||proof.state.assembledBuildings!==proof.buildings||proof.state.props?.instances<10)
    throw new Error(`Photoreal proof incomplete: ${JSON.stringify(proof)}`);

  const shots=[
    ['urban-proof-overview',[58,31,-38],[7,7,6]],
    ['urban-proof-street',[9,1.85,-18],[23,4,13]],
    ['urban-proof-vegetation',[15,2.4,33],[12,2.2,18]]
  ];
  for(const [name,camera,target] of shots){
    const dataUrl=await page.evaluate(({camera,target})=>{
      const world=globalThis.world;
      world.camera.fov=48;world.camera.updateProjectionMatrix();
      world.camera.position.set(...camera);world.camera.lookAt(...target);world.camera.updateMatrixWorld(true);
      world.levelRuntime.update();
      world.composer.render();
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
  await captureEnvironment();
  try{await captureRuntime();}catch(error){runtimeError=error;console.error(error);}
}finally{
  await browser.close();
}
if(runtimeError)throw runtimeError;
