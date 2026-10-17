import {chromium} from 'playwright';
import fs from 'node:fs/promises';
const base=process.env.URBAN_URL||'http://127.0.0.1:8401';
const out=process.env.URBAN_ARTIFACTS||'artifacts';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:[
  '--no-sandbox','--disable-dev-shm-usage','--use-gl=angle',
  '--use-angle=swiftshader','--enable-unsafe-swiftshader'
]});
const errors=[],networkFailures=[];
const page=await browser.newPage({viewport:{width:1024,height:640},deviceScaleFactor:1});
page.on('pageerror',e=>errors.push(String(e.message)));
page.on('response',response=>{
  if(response.status()>=400&&/assets\/urban-kits|assets\/roadforge/.test(response.url()))
    networkFailures.push({status:response.status(),url:response.url()});
});
const started=Date.now();
try{
  await page.goto(base+'/editor.html?scene=urban-photoreal&play=1&perf=1',{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForFunction(()=>{
    const w=globalThis.world;
    return (w?.levelRuntime?.visualState?.status==='ready'&&
      globalThis.sceneEditor?.active===false&&w?.editorPlayer&&
      w?.actorLayer?.urbanPopulation?.pedestrians?.length>0)||
      w?.levelRuntime?.visualState?.status==='partial';
  },null,{timeout:300000,polling:500});
  // First frame must not wait for trees; full-HD evidence DOES wait for the
  // authentic GLTF decoder in the background. Keep these two checks separate.
  try {
    await page.waitForFunction(()=>{
      const v=globalThis.world?.levelRuntime?.visualState?.vegetation;
      return v?.ready===true||v?.status==='unavailable';
    },null,{timeout:90000,polling:500});
  } catch(error) {
    const info=await page.evaluate(()=>({
      vegetation:globalThis.world?.levelRuntime?.visualState?.vegetation,
      stage:globalThis.cityDiagnostics?.snapshot?.(),
      progress:globalThis.world?.levelRuntime?.visualProgress
    }));
    throw Error('HD TREE DECODER DID NOT FINISH: '+JSON.stringify(info)+' | '+error.message);
  }
    const report=await page.evaluate(()=>{
    const w=globalThis.world,r=w.levelRuntime,scene=r.root;
    const facade=r.facadeStreamer?.clusters||[];
    let pbrMeshes=0,pbrTextured=0,visiblePlaceholders=0;
    scene.traverse(node=>{
      if(node.userData?.urbanBuildingVisual&&node.visible)visiblePlaceholders++;
      if(!node.isMesh||!node.visible)return;
      if(node.material?.isMeshStandardMaterial||node.material?.isMeshPhysicalMaterial){
        pbrMeshes++;if(node.material?.map)pbrTextured++;
      }
    });
    const vegetation=scene.getObjectByName('CC0 photoreal vegetation');
    return {scene:'urban-photoreal',active:globalThis.sceneEditor?.active,
      status:r.visualState.status,errors:r.visualState.error,renderer:w.renderer.constructor.name,
      architecture:r.visualState.architecture,props:r.visualState.props,
      facadeCount:facade.length,hdFacadeCount:facade.filter(c=>c.node).length,
      visiblePlaceholders,pbrMeshes,pbrTextured,vegetationModels:vegetation?.children?.length||0,
      mobileLite:r.mobileLite,hdComplete:Boolean(scene.children[0]?.userData)||scene.children.length>0,
      actorSources:{person:w.actorLayer?.person?.scene?.name,car:w.actorLayer?.car?.scene?.name},
      playerReady:!!w.editorPlayer,cars:w.vehicles?.length||0,stats:w.renderer.info.memory,
      gpuCalls:w.renderer.info.render.calls};
  });
  const fail=(why)=>{throw new Error('Original photoreal visual regression: '+why+' '+JSON.stringify(report));};
  if(report.status!=='ready'||report.errors)fail('HD stage not ready');
  if(report.mobileLite)fail('unexpected forced low-quality mode');
  if(report.facadeCount<1||report.hdFacadeCount!==report.facadeCount)fail('missing imported facade sectors');
  if(report.visiblePlaceholders!==0)fail('primitive facades visible after HD ready');
  if(report.vegetationModels<15||report.pbrTextured<10)fail('missing high-detail trees or PBR textures');
  if(!Array.isArray(report.architecture)||report.architecture.length<2||!report.props?.instances)
    fail('missing original city facade or street furniture kits');
  if(!report.playerReady||report.cars<2)fail('original game interactive vehicles not ready');
  if(networkFailures.length)fail('local urban glTF/texture files unavailable');
  // Render the ACTUAL original City Player, not a simplified comparison world.
  const png=await page.evaluate(()=>{
    const w=globalThis.world;
    w.renderer.setRenderTarget(null);
    w.renderer.render(w.graphicsWorld,w.camera);
    return w.renderer.domElement.toDataURL('image/png').split(',')[1];
  });
  const bytes=Buffer.from(png,'base64');
  if(bytes.length<25000)fail('renderer produced an empty screenshot');
  await fs.writeFile(out+'/urban-original-hd-smoke.png',bytes);
  await fs.writeFile(out+'/urban-original-hd-smoke.json',
    JSON.stringify({...report,readinessSeconds:(Date.now()-started)/1000,screenshotBytes:bytes.length,networkFailures,errors},null,2));
  console.log('ORIGINAL PHOTOREAL CITY SMOKE: PASS',JSON.stringify({
    readinessSeconds:(Date.now()-started)/1000,facades:report.hdFacadeCount,
    pbrTextures:report.pbrTextured,trees:report.vegetationModels,
    placeholders:report.visiblePlaceholders,screenshotBytes:bytes.length}));
}finally{await browser.close();}
