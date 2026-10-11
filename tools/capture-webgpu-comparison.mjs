import {chromium} from 'playwright';
import fs from 'node:fs/promises';
const base=process.env.URBAN_URL||'http://127.0.0.1:8401';
const out=process.env.URBAN_ARTIFACTS||'artifacts';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:[
  '--disable-dev-shm-usage','--enable-webgl','--use-gl=angle','--use-angle=swiftshader',
  '--enable-unsafe-swiftshader','--enable-unsafe-webgpu']});
const results=[];
try{
  for(const backend of ['webgl2','webgpu']){
    const page=await browser.newPage({viewport:{width:1160,height:720},deviceScaleFactor:1});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto(base+'/urban-webgpu.html?backend='+backend,{waitUntil:'domcontentloaded',timeout:45000});
    try{
      await page.waitForFunction(()=>globalThis.__sketchbookWebGpuBench?.ready===true ||
        globalThis.__sketchbookWebGpuBench?.errors?.length>0,null,{timeout:120000,polling:500});
    }catch(error){
      const detail=await page.evaluate(()=>({state:globalThis.__sketchbookWebGpuBench,
        loading:document.getElementById('boot')?.textContent}));
      throw new Error('GPU lab '+backend+' initialization timeout '+JSON.stringify({detail,errors}));
    }
    const state=await page.evaluate(()=>({
      ready:globalThis.__sketchbookWebGpuBench?.ready,
      requested:globalThis.__sketchbookWebGpuBench?.requested,
      actual:globalThis.__sketchbookWebGpuBench?.actual,
      errors:globalThis.__sketchbookWebGpuBench?.errors,
      missingAssets:globalThis.__sketchbookWebGpuBench?.missingAssets,
      objects:globalThis.__sketchbookWebGpuBench?.objects,
      threeRevision:globalThis.__sketchbookWebGpuBench?.threeRevision,
      renderedCanvas:!!document.querySelector('canvas')
    }));
    if(!state.ready||state.errors.length||state.objects<100||!state.renderedCanvas)
      throw new Error('GPU experiment failed '+backend+': '+JSON.stringify({state,errors}));
    if(backend==='webgl2'&&state.actual!=='WebGL2 fallback')
      throw new Error('Forced WebGL2 ignored: '+JSON.stringify(state));
    if(!['WebGPU','WebGL2 fallback'].includes(state.actual))
      throw new Error('Renderer backend not truthfully identified: '+JSON.stringify(state));
    // Rendering is asynchronous with WebGPU; a valid backend alone is not
    // proof that the canvas has actually displayed the city.
    await page.waitForFunction(()=>(
      (globalThis.__sketchbookWebGpuBench?.frames?.length||0)>=6 ||
      (globalThis.__sketchbookWebGpuBench?.errors?.length||0)>0
    ),null,{timeout:60000,polling:500});
    const frames=await page.evaluate(()=>({
      count:globalThis.__sketchbookWebGpuBench.frames.length,
      fps:globalThis.__sketchbookWebGpuBench.fps,
      p95:globalThis.__sketchbookWebGpuBench.p95,
      actual:globalThis.__sketchbookWebGpuBench.actual
    }));
    // Wait for shader compilation to finish, then fail on any GPU
    // validation error rather than reporting initialization as success.
    await page.waitForTimeout(1800);
    const fatal=errors.filter(x=>/createView|GPUTexture|WebGPU.*[Ee]rror|Validation Error|TypeError|uncaptured error|device lost|pipeline failed/i.test(x));
    if(fatal.length)throw new Error('WebGPU canvas has GPU validation errors ('+backend+'): '+JSON.stringify(fatal.slice(0,5)));
    if(!frames.count)throw new Error('No rendered animation frames: '+JSON.stringify({backend,frames}));
    const png=await page.locator('canvas').first().screenshot({type:'png',timeout:30000});
    if(png.length<5000)throw new Error('WebGPU canvas screenshot suspiciously empty: '+png.length+' bytes ('+backend+')');
    await fs.writeFile(out+'/urban-'+backend+'-canvas.png',png);
    results.push({backend,...state,frames,canvasPngBytes:png.length,consoleErrors:errors});
    console.log('GPU comparison rendered scene',JSON.stringify(results.at(-1)));
    await page.close();
  }
  await fs.writeFile(out+'/urban-webgpu-backend-proof.json',JSON.stringify(results,null,2));
}finally{
  await browser.close();
}
