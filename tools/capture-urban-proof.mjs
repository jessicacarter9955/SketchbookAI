import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import {URBAN_CAPTURE_VIEWS,validateUrbanCaptureViews} from './urban-camera-presets.mjs';

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


async function captureFreeRoam(){
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  const consoleErrors=[];
  page.on('console',msg=>{if(msg.type()==='error')consoleErrors.push(msg.text());});
  await page.goto(`${base}/editor.html?scene=urban-photoreal&play=1`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>{
    const world=globalThis.world,state=world?.levelRuntime?.visualState;
    return state?.status==='ready'&&globalThis.sceneEditor?.active===false&&world?.editorPlayer&&world?.vehicles?.length>=2;
  },null,{timeout:120000,polling:500});
  const initial=await page.evaluate(()=>{
    const world=globalThis.world,player=world.editorPlayer,skyline=world.levelRuntime.root.getObjectByName('Distant skyline');
    const nearest=world.vehicles.slice().sort((a,b)=>a.position.distanceTo(player.position)-b.position.distanceTo(player.position))[0];
    return {
      vehicles:world.vehicles.length,
      nearestVehicle:nearest?.position.distanceTo(player.position)??null,
      nearestVehicleSeats:nearest?.seats?.map(seat=>({type:seat.type,occupied:Boolean(seat.occupiedBy)}))||[],
      playerPosition:player.position.toArray(),
      nearestVehiclePosition:nearest?.position.toArray()||null,
      playing:globalThis.sceneEditor.active===false,
      prompt:document.querySelector('[data-vehicle-prompt]')?.textContent||'',
      skyline:skyline?.userData||null
    };
  });
  console.log('free roam initial',initial);
  await fs.writeFile(`${out}/urban-free-roam-initial.json`,JSON.stringify(initial,null,2));
  if(!initial.playing||initial.vehicles<2||!initial.skyline?.distantSkyline||initial.skyline.buildingCount<100)
    throw new Error(`Free-roam setup incomplete: ${JSON.stringify(initial)}`);

  const vehicleState=()=>page.evaluate(()=>({
    controlled:Boolean(globalThis.world?.editorPlayer?.controlledObject),
    occupyingSeat:globalThis.world?.editorPlayer?.occupyingSeat?.type||null,
    prompt:document.querySelector('[data-vehicle-prompt]')?.textContent||'',
    focusedElement:document.activeElement?.tagName||null
  }));
  // Read actual state before waiting: under software WebGL, Playwright's
  // waitForFunction polling can time out even after the requested transition.
  async function checkVehicleControl(expected,phase){
    let state=await vehicleState();
    if(state.controlled!==expected){
      let pollingError=null;
      try{
        await page.waitForFunction(expected=>Boolean(globalThis.world?.editorPlayer?.controlledObject)===expected,
          expected,{timeout:30000,polling:250});
      }catch(error){pollingError=error;}
      state=await vehicleState();
      if(state.controlled!==expected){
        const debug={phase,expected,initial,state,consoleErrors,pollingError:String(pollingError||'none')};
        await fs.writeFile(`${out}/urban-free-roam-FAILED.json`,JSON.stringify(debug,null,2));
        throw new Error(`Urban vehicle ${phase} failed: ${JSON.stringify(debug)}`);
      }
    }
    console.log(`urban vehicle ${phase}`,state);
    return state;
  }

  await page.evaluate(()=>{ globalThis.world?.renderer?.domElement?.focus?.(); });
  await page.keyboard.press('f');
  await checkVehicleControl(true,'boarding');
  await page.waitForTimeout(700);
  const driving=await page.evaluate(()=>{
    const world=globalThis.world,player=world.editorPlayer;
    return {
      controlled:Boolean(player.controlledObject),
      vehicleCount:world.vehicles.length,
      prompt:document.querySelector('[data-vehicle-prompt]')?.textContent||'',
      speedKmh:Math.round((player.controlledObject?.collision?.velocity?.length?.()||0)*3.6)
    };
  });
  // Playwright page.screenshot can stall waiting for a composited frame with
  // software WebGL in CI. Capture the actual game WebGL canvas directly, as
  // already done by captureRuntime(), and keep the output as a plain PNG.
  const drivingFrame=await page.evaluate(()=>{
    const world=globalThis.world;
    world.composer.render();
    return world.renderer.domElement.toDataURL('image/png');
  });
  const drivingPngBytes=await writeDataUrl(`${out}/urban-free-roam-driving.png`,drivingFrame);
  console.log('urban-free-roam-driving',{pngBytes:drivingPngBytes});

  // An additional dedicated close-up makes the tested vehicle easy to inspect.
  const vehicleCloseup=await page.evaluate(()=>{
    const world=globalThis.world,car=world.editorPlayer?.controlledObject;
    if(!car)throw new Error('Cannot photograph vehicle: character has no controlled car');
    const camera=world.camera,position=camera.position.clone(),quaternion=camera.quaternion.clone();
    const carPosition=car.getWorldPosition(new camera.position.constructor());
    try{
      camera.position.set(carPosition.x+7,carPosition.y+3.5,carPosition.z+9);
      camera.lookAt(carPosition.x,carPosition.y+1,carPosition.z);
      camera.updateMatrixWorld(true);
      world.composer.render();
      return world.renderer.domElement.toDataURL('image/png');
    }finally{
      camera.position.copy(position);camera.quaternion.copy(quaternion);camera.updateMatrixWorld(true);
    }
  });
  const closeupPngBytes=await writeDataUrl(`${out}/urban-vehicle-closeup.png`,vehicleCloseup);
  console.log('urban-vehicle-closeup',{pngBytes:closeupPngBytes});

  // Take all requested viewpoints with ONE loaded WebGL scene, from known
  // street/sidewalk positions. Do not teleport the camera into a facade.
  validateUrbanCaptureViews();
  const frames=await page.evaluate((views)=>{
    const world=globalThis.world,pop=world.actorLayer?.urbanPopulation;
    if(!pop||pop.cars.length<16||pop.pedestrians.length<24||pop.conversations.length<4)
      throw new Error('Missing genuine population: '+JSON.stringify({cars:pop?.cars.length,pedestrians:pop?.pedestrians.length}));
    const scenario=pop.prepareCaptureScenario();
    // Repeatable AI warmup without loading the city, switching tabs or waiting
    // for wall-clock time. Physics-driven player vehicle is unaffected.
    for(let step=0;step<45;step++)pop.update(1/60);
    const camera=world.camera,restore={
      position:camera.position.clone(),rotation:camera.quaternion.clone(),fov:camera.fov
    };
    const ped=pop.conversations[0]?.members[0]||pop.pedestrians[0],car=pop.cars.reduce((best,c)=>
      !best||c.object.position.distanceToSquared(ped.object.position)<best.object.position.distanceToSquared(ped.object.position)?c:best,null);
    const segment=pop.net.roads[car.seg];
    // Stand over the roadway, not above surrounding buildings.
    const dx=segment.b.x-segment.a.x,dz=segment.b.z-segment.a.z;
    const length=Math.hypot(dx,dz)||1,along={x:dx/length,z:dz/length},side={x:-dz/length,z:dx/length};
    const midpoint=car.object.position.clone().lerp(ped.object.position,.5);
    const results=[];
    try{
      for(const view of views){
        const subject=view.kind==='car'?car.object.position:
          view.kind==='pedestrian'||view.kind==='dialogue'?ped.object.position:
          view.kind==='anchor'?midpoint:midpoint;
        // The camera origin is anchored on a DRIVABLE lane. Its lateral
        // variation is bounded to a lane so no camera starts inside a building.
        const longitudinal=view.offset[2],height=view.offset[1],lateral=Math.min(2,Math.abs(view.offset[0])*.14);
        const basePoint=view.kind==='dialogue'?subject:car.object.position;
        camera.position.set(basePoint.x+along.x*longitudinal+side.x*lateral,
          Math.max(basePoint.y,subject.y)+height,
          basePoint.z+along.z*longitudinal+side.z*lateral);
        camera.fov=view.fov;camera.updateProjectionMatrix();
        camera.lookAt(subject.x,subject.y+(view.kind==='pedestrian'?1:1.2),subject.z);
        camera.updateMatrixWorld(true);
        world.composer.render();
        results.push({name:view.name,png:world.renderer.domElement.toDataURL('image/png'),
          camera:camera.position.toArray(),target:subject.toArray()});
      }
    }finally{
      camera.position.copy(restore.position);camera.quaternion.copy(restore.rotation);
      camera.fov=restore.fov;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
    }
    return {scenario,counts:{cars:pop.cars.length,pedestrians:pop.pedestrians.length,conversations:pop.conversations.length},
      pedestrian:ped.object.position.toArray(),vehicle:car.object.position.toArray(),views:results};
  },URBAN_CAPTURE_VIEWS);
  for(const frame of frames.views){
    const bytes=await writeDataUrl(`${out}/${frame.name}.png`,frame.png);
    console.log('NPC capture',frame.name,{pngBytes:bytes,camera:frame.camera});
  }
  await fs.writeFile(`${out}/urban-population-proof.json`,
    JSON.stringify({scenario:frames.scenario,counts:frames.counts,
      pedestrian:frames.pedestrian,vehicle:frames.vehicle,
      views:frames.views.map(({name,camera,target})=>({name,camera,target}))},null,2));

  await page.keyboard.press('f');
  await checkVehicleControl(false,'exit');
  const exited=await page.evaluate(()=>({
    controlled:Boolean(globalThis.world?.editorPlayer?.controlledObject),
    prompt:document.querySelector('[data-vehicle-prompt]')?.textContent||''
  }));
  await fs.writeFile(`${out}/urban-free-roam.json`,JSON.stringify({initial,driving,exited,consoleErrors},null,2));
  console.log('free roam proof',{initial,driving,exited});
  await page.close();
}

let runtimeError=null;
try{
  // Always produce the environment-only evidence first. These pages use the downloaded,
  // checksum-verified CC0 kits directly and never show the Sketchbook player.
  const mode=process.env.URBAN_CAPTURE_MODE||'full';
  if(!['full','population'].includes(mode))throw new Error('Unknown urban capture mode: '+mode);
  // Population-only captures still load the production photoreal scene in
  // captureFreeRoam(), but do not regenerate unrelated environment proofs.
  if(mode==='full'){
    await captureEnvironment();
    try{await captureRuntime();}catch(error){runtimeError=error;console.error(error);}
  }
  if(!runtimeError)try{await captureFreeRoam();}catch(error){runtimeError=error;console.error(error);}
}finally{
  await browser.close();
}
if(runtimeError)throw runtimeError;
