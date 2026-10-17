// Real browser acceptance of Unreal coastal integration + existing Sketchbook gameplay.
const {chromium}=require('playwright');
const fs=require('fs');
const base=(process.env.DISTRICT_BASE_URL||'http://127.0.0.1:8765').replace(/\/$/,'');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage',
  '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1280,height:800}});
 const errors=[],missing=[];
 page.on('pageerror',e=>errors.push(String(e.stack||e)));
 page.on('response',r=>{
  if(r.status()>=400&&new URL(r.url()).host===new URL(base).host&&
    !r.url().endsWith('/build/local-scenes/ue2three-districts/manifest.json') &&
    !r.url().endsWith('/build/local-scenes/ue2three-districts/native-meshes.json') &&
    !r.url().endsWith('/.local/sketchfab.json'))
   missing.push(r.status()+' '+r.url());
 });
 let report={};
 try{
  await page.goto(base+'/editor.html?scene=coastal-districts&play=1&cars=0',{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>Boolean(window.world?.levelRuntime?.ready&&window.sceneEditor&&
    window.world?.districtTraffic&&window.coastalDistrictEvidence),null,{timeout:120000,polling:500});
  await page.waitForTimeout(1800);
  report=await page.evaluate(()=>{
   const w=window.world,r=w.levelRuntime,t=w.districtTraffic,ed=window.sceneEditor;
   return {ready:r.ready,scene:r.root.name,unreal:window.coastalDistrictEvidence,
    zones:r.plan.zones.map(x=>x.id),roads:r.plan.roads.length,buildings:r.plan.buildings.length,
    bridge:r.plan.roads.filter(x=>x.kind==='bridge').length,cars:t.cars.length,
    pedestrians:t.people.length,driveableCars:ed.items.filter(x=>x.prefab==='vehicle').length,
    activeActors:w.actorLayer?.actors?.length||0,
    activePhysicalCars:w.vehicles?.length||0,
    seatCars:(w.vehicles||[]).filter(c=>c.seats?.some(seat=>seat&&!seat.occupiedBy)).length,
    playerToClosestCar:w.editorPlayer&&w.vehicles?.length?Math.min(...w.vehicles.map(c=>c.position.distanceTo(w.editorPlayer.position))):null,
    playerPosition:w.editorPlayer?.position?.toArray(),actorSpawn:w.actorLayer?.spawn?.toArray(),
    savedCarSpawn:ed.items.filter(x=>x.prefab==='vehicle').map(x=>x.position),
    trackedCarPositions:w.actorLayer?.actors?.filter(x=>x.userData?.editorActor).map(x=>({p:x.position.toArray(),dormant:x.userData.dormant})),
    dialogue:!!document.querySelector('#district-dialogue'),spawns:r.manifest.spawns.length,
    playing:!ed.active,physicsBodies:r.bodies.length};
  });
  report.pageErrors=errors;report.missingLocalAssets=missing;
  // If the actual native Unreal GLB is present in the checkout, loading it
  // successfully in Chromium is a release gate, not merely a unit test.
  const expectedNative=fs.existsSync('build/local-scenes/ue2three-districts/native-meshes.json');
  if(expectedNative){
    const native=report.unreal?.nativeAssets;
    const live=await page.evaluate(()=>{
      const c=window.world?.levelRuntime?.native;
      if(!c?.scene)return null;
      const box=new window.THREE.Box3().setFromObject(c.scene);
      let good=0,total=0;
      c.scene.traverse(o=>{
        if(!o.isMesh)return;
        const a=o.geometry.getAttribute('normal');
        if(!a)return;
        for(let i=0;i<a.count;i+=Math.max(1,Math.floor(a.count/512))){
          total++;const len=Math.hypot(a.getX(i),a.getY(i),a.getZ(i));
          if(Number.isFinite(len)&&len>.98&&len<1.02)good++;
        }
      });
      return {meshes:c.meshes,textured:c.textured,bounds:box.getSize(new window.THREE.Vector3()).toArray(),
        source:c.manifest?.source_project,parts:c.manifest?.parts?.length,
        normalQuality:good/Math.max(1,total)};
    });
    report.nativeGeometry=live;
    if(!native||native.assetCount<5||native.fullUnrealLevel!==false||!live||live.parts<5||
       live.meshes<5||live.textured<1||live.normalQuality<.95||
       !live.bounds.every(x=>Number.isFinite(x)))
      throw Error('Genuine Unreal .uasset meshes are in Git but failed real-browser load: '+JSON.stringify(report));
  }
  if(!report.ready||report.zones.join(',')!=='ny,sf,rio,miami'||report.roads<120||
     report.buildings<100||report.bridge!==1||report.cars<20||report.pedestrians<15||
     report.driveableCars<4||report.activePhysicalCars<1||report.seatCars<1||
     !(Number.isFinite(report.playerToClosestCar)&&report.playerToClosestCar<18)||
     !report.dialogue||report.spawns!==5||!report.playing||
     report.pageErrors.length||report.missingLocalAssets.length)
    throw Error('City acceptance failed: '+JSON.stringify(report));
  // Check that this is an interactive game, not merely a rendered editor scene.
  // The conversation hint is local and works without an external LLM key.
  const spoken=await page.evaluate(()=>{
    const t=window.world?.districtTraffic;
    const npc=t?.nearest?.();
    if(!npc)return {near:false,dialogueOpen:false};
    t.interact();
    const opened=t.activeNpc===npc && t.dialogue?.style.display==='block';
    const text=t.dialogue?.querySelector('[data-line]')?.textContent;
    t.closeDialogue();
    return {near:true,dialogueOpen:opened,hasText:!!text};
  });
  report.conversationInteraction=spoken;
  if(spoken.near && (!spoken.dialogueOpen||!spoken.hasText))
    throw Error('District NPC dialogue failed to open or close');
  // Nearby original Sketchbook cars must use a real Cannon raycast suspension,
  // an occupied driver seat, and the original character control handoff.
  await page.evaluate(()=>{
    const button=document.querySelector('[data-board]');
    if(button?.disabled)throw Error('Nearby driveable car button is disabled');
    button.click();
  });
  await page.waitForFunction(()=>!!window.world?.editorPlayer?.controlledObject,null,{timeout:12000,polling:200});
  const vehicle=await page.evaluate(()=>{
    const player=window.world.editorPlayer,car=player.controlledObject;
    return {boarded:!!car,physicsRaycast:!!car?.rayCastVehicle?.chassisBody,
      wheels:car?.rayCastVehicle?.wheelInfos?.length||0,hasDriver:!!car?.seats?.find(s=>s.occupiedBy===player)};
  });
  report.vehicleInteraction=vehicle;
  if(!vehicle.boarded||!vehicle.physicsRaycast||vehicle.wheels<4)
    throw Error('Driveable car entry did not connect original physics rig');
  if(report.nativeGeometry){
    await page.evaluate(()=>{
      const w=window.world,ed=window.sceneEditor,visual=w.levelRuntime.native.scene;
      ed.setActive(true);
      const center=new window.THREE.Box3().setFromObject(visual).getCenter(new window.THREE.Vector3());
      ed.orbit.target.copy(center);
      w.camera.position.copy(center).add(new window.THREE.Vector3(8,4,11));
      ed.orbit.update();
      // Screenshot is actual native GLB geometry loaded by Three.js, not a mock.
      document.querySelector('#scene-editor')?.style.setProperty('opacity','.15');
    });
    await page.waitForTimeout(400);
    await page.screenshot({path:'artifacts/ue2three-native-newyork-browser.png',timeout:45000,animations:'disabled'});
  }
  if(report.nativeGeometry){
    // Isolated still uses the exact production UE-derived GLB. It is a
    // provenance/mesh close-up, not an invented Unreal level screenshot.
    // One WebGL page at a time on SwiftShader: two heavy scenes can starve the
    // Chromium renderer before DOMContentLoaded on the second tab.
    await page.screenshot({path:'artifacts/ue2three-coastal-browser.png',timeout:45000,animations:'disabled'});
    await page.goto(base+'/ue2three-native-newyork.html',{waitUntil:'commit',timeout:60000});
    await page.waitForFunction(()=>window.__unrealNativeViewer?.ready===true||
      !!window.__unrealNativeViewer?.error,null,{timeout:90000,polling:300});
    report.nativeIsolatedViewer=await page.evaluate(()=>window.__unrealNativeViewer);
    if(!report.nativeIsolatedViewer.ready||report.nativeIsolatedViewer.meshCount<5)
      throw Error('Authentic Unreal static-mesh close-up viewer failed: '+JSON.stringify(report.nativeIsolatedViewer));
    await page.waitForTimeout(300);
    await page.screenshot({path:'artifacts/ue2three-native-newyork-closeup.png',
      timeout:45000,animations:'disabled'});
  }
  console.log('REALISTIC CITY DDS UE2THREE COASTAL PASS '+JSON.stringify(report));
 }catch(error){
  report={error:String(error.stack||error),...report,pageErrors:errors,missingLocalAssets:missing,
   body:(await page.locator('body').innerText().catch(()=>'' )).slice(0,2200)};
  console.error(JSON.stringify(report));process.exitCode=1;
 }finally{
  fs.mkdirSync('artifacts',{recursive:true});
  fs.writeFileSync('artifacts/ue2three-coastal-browser.json',JSON.stringify(report,null,2));
  try {if(!fs.existsSync('artifacts/ue2three-coastal-browser.png'))
    await page.screenshot({path:'artifacts/ue2three-coastal-browser.png',timeout:45000,animations:'disabled'});}
  catch(e){console.warn('Screenshot was not captured:',e.message)}
  await browser.close();
 }
})().catch(e=>{console.error(e);process.exitCode=1});
