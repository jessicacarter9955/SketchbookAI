'use strict';
const fs=require('node:fs');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,args:[
    '--no-sandbox','--disable-dev-shm-usage',
    '--use-gl=angle','--use-angle=swiftshader','--enable-webgl'
 ]});
 const page=await browser.newPage({viewport:{width:1280,height:830},deviceScaleFactor:1});
 const errors=[],failed=[];
 page.on('pageerror',e=>errors.push(e.message.slice(0,240)));
 page.on('requestfailed',r=>failed.push(r.url().slice(0,140)+' '+r.failure()?.errorText));
 const URL=process.env.PHOTO_URL || 'https://6ad254d0bfe5508f774ea6ce--my-test-site3.netlify.app/editor.html?scene=urban-photoreal&cityBlocks=2&play=1';
 console.log('Photoreal preview:',URL);
 fs.mkdirSync('artifacts/urban-supercars',{recursive:true});
 try{
  await page.goto(URL,{waitUntil:'domcontentloaded',timeout:70000});
  await page.waitForFunction(()=>
    Boolean(globalThis.urbanSupercarsStatus) ||
    /Errore di avvio:/.test(document.querySelector('#city-load-message')?.textContent||''),
    null,{timeout:235000}
  );
  await page.waitForTimeout(2500);
  const state=await page.evaluate(()=>{
    const ed=globalThis.sceneEditor,world=globalThis.world;
    const imported=ed?.items?.filter(i=>i.name?.startsWith('Sketchfab · '))||[];
    const cars=world?.vehicles?.filter(v=>v.userData?.importedCar).map(v=>({
        asset:v.userData.importedCar,position:v.position.toArray(),
        seats:v.seats?.length,physics:!!v.rayCastVehicle,
        totalMeshes:v.children.reduce((n,c)=>n+c.children.length,0)
    }))||[];
    const spawn=world?.actorLayer?.spawn?.toArray();
    return {status:globalThis.urbanSupercarsStatus,loading:document.querySelector('#city-load-message')?.textContent,
      editorReady:!!ed,scene:ed?.worldId,playing:ed&&!ed.active,spawn,imported:imported.map(i=>({
        name:i.name,assetId:i.assetId,position:i.position,prefab:i.prefab
      })),cars,urbanVisual:world?.levelRuntime?.visualProgress,
      worldGraphics:world?.graphicsWorld?.children?.length};
  });
  console.log('PHOTO_SCENE_RESULT',JSON.stringify(state));
  console.log('PAGE_ERRORS',JSON.stringify(errors.slice(0,12)));
  console.log('REQUEST_FAILURES',JSON.stringify(failed.slice(0,16)));
  await page.screenshot({path:'artifacts/urban-supercars/photoreal-scene.png',fullPage:false,timeout:18000}).catch(e=>console.warn('Screenshot optional:',e.message));
  if(!state.editorReady||state.scene!=='procedural-city'||state.imported.length!==3||
     state.cars.length!==3||!state.playing||state.status.errors.length)
      throw Error('Expected 3 licensed Sketchfab cars in playable photoreal city.');
  for(const v of state.cars) {
      const distance=Math.hypot(v.position[0]-state.spawn[0],v.position[2]-state.spawn[2]);
      if(distance>40||v.seats<1||!v.physics) throw Error('Supercar not driveable or too far from spawn: '+JSON.stringify(v));
  }
  const drive=await page.evaluate(()=>{
      const w=globalThis.world,player=w.editorPlayer,
        car=w.vehicles.find(v=>v.userData.importedCar);
      player.setPosition(car.position.x+0.9,car.position.y,car.position.z);
      player.position.set(car.position.x+0.9,car.position.y,car.position.z);
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'e',code:'KeyE',bubbles:true,cancelable:true}));
      return {occupied:car.seats.some(s=>s.occupiedBy===player),
              controlled:player.controlledObject===car,
              engine:!!car.actions?.throttle,
              enterE:player.controlledObject===car};
  });
  console.log('DRIVING_RESULT',JSON.stringify(drive));
  if(!drive.occupied||!drive.controlled||!drive.engine||!drive.enterE)
    throw Error('Driveable car should allow player to enter with E.');
  await page.evaluate(()=>{
     const ed=globalThis.sceneEditor,w=globalThis.world;
     ed.setActive(true);
     const points=ed.items.filter(i=>i.name.startsWith('Sketchfab · ')).map(i=>i.position);
     const x=points.reduce((s,p)=>s+p[0],0)/points.length,
           y=points.reduce((s,p)=>s+p[1],0)/points.length,
           z=points.reduce((s,p)=>s+p[2],0)/points.length;
     ed.orbit.target.set(x,y+1,z);
     w.camera.position.set(x+16,y+13,z+18);
     ed.orbit.update();
  });
  await page.waitForTimeout(1700);
  await page.screenshot({path:'artifacts/urban-supercars/photoreal-three-cars-overview.png',fullPage:false,timeout:18000}).catch(e=>console.warn('Overview screenshot optional:',e.message));
  console.log('PASS: 3 branded cars next to photoreal player and controllable physics with E.');
 }catch(error){
   console.error('PHOTO_SCENE_FAILED',error.message);
   console.error('PAGE_ERRORS',JSON.stringify(errors.slice(-20)));
   console.error('REQUEST_FAILURES',JSON.stringify(failed.slice(-20)));
   console.error('DOM',JSON.stringify(await page.evaluate(()=>({
       status:globalThis.urbanSupercarsStatus,
       loading:document.querySelector('#city-load-message')?.textContent,
       diagnostics:document.querySelector('#city-load-counter')?.textContent,
       editor:!!globalThis.sceneEditor,
       body:document.body.innerText.slice(0,700)
   })).catch(()=>({}))));
   try{await page.screenshot({path:'artifacts/urban-supercars/photoreal-failure.png',fullPage:false,timeout:8000});}catch{}
   await browser.close();process.exit(1);
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
