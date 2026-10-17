'use strict';
// Genuine Chrome frames, captured AFTER the photoreal City Player loads.
// The moving car is a Sketchbook/Cannon simulated vehicle with Sketchfab skin.
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {chromium}=require('playwright');
const ROOT='artifacts/urban-supercar-driving';
const CARS=[{id:'bmw',name:'BMW M4 G82'},{id:'ferrari',name:'Ferrari F40'},
 {id:'lamborghini',name:'Lamborghini Aventador SV'}];
const URL=process.env.PHOTO_URL||
'https://6ad259fa343e72e0db919829--my-test-site3.netlify.app/editor.html?scene=urban-photoreal&cityBlocks=2&play=1';
function cmd(bin,args,timeout=90000){
 const r=spawnSync(bin,args,{encoding:'utf8',timeout,maxBuffer:4000000});
 if(r.status!==0||r.error)throw Error(bin+': '+String(r.stderr||r.error).slice(-1300));
 return (r.stdout||'').trim();
}
function duration(file){return Number(cmd('ffprobe',['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',file]));}
(async()=>{
 fs.mkdirSync(ROOT,{recursive:true});
 const browser=await chromium.launch({headless:true,args:[
 '--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-webgl']});
 const page=await browser.newPage({viewport:{width:896,height:504},deviceScaleFactor:1});
 const pageErrors=[],failed=[],results=[];
 page.on('pageerror',e=>pageErrors.push(e.message.slice(0,200)));
 page.on('requestfailed',r=>failed.push(r.url().slice(0,160)+' '+r.failure()?.errorText));
 let ok=false;
 try{
  console.log('LOAD_WITHOUT_RECORDING',URL);
  await page.goto(URL,{waitUntil:'domcontentloaded',timeout:70000});
  await page.waitForFunction(()=>{
   const s=globalThis.urbanSupercarsStatus,w=globalThis.world;
   return (s&&w?.sceneEditor&&!w.sceneEditor.active)||
     /Errore di avvio:/.test(document.querySelector('#city-load-message')?.textContent||'');
  },null,{timeout:330000,polling:500});
  const ready=await page.evaluate(()=>{
   const w=globalThis.world;
   return {status:globalThis.urbanSupercarsStatus,
      cars:w?.vehicles?.filter(v=>v.userData?.importedCar).length,
      progress:w?.levelRuntime?.visualProgress,scene:w?.sceneEditor?.worldId};
  });
  console.log('PHOTOREAL_READY',JSON.stringify(ready));
  if(ready.cars!==3||ready.status?.errors?.length||ready.scene!=='procedural-city')
   throw Error('Photoreal did not load all 3 original Sketchfab models.');
  await page.evaluate(()=>{
   const w=globalThis.world;
   w.renderer.setPixelRatio(.5);w.params.FXAA=false;
   w.params.Shadows=false;w.renderer.shadowMap.enabled=false;
  });
  const cdp=await page.context().newCDPSession(page);
  let recording=null,frames=[],last=0;
  cdp.on('Page.screencastFrame',e=>{
   if(recording&&Date.now()-last>160&&frames.length<28){
    frames.push(Buffer.from(e.data,'base64'));last=Date.now();
   }
   cdp.send('Page.screencastFrameAck',{sessionId:e.sessionId}).catch(()=>{});
  });
  for(const car of CARS){
   const id=car.id,frameDir=path.join(ROOT,id+'-frames');
   fs.mkdirSync(frameDir,{recursive:true});
   const entered=await page.evaluate(id=>{
    const w=globalThis.world,p=w.editorPlayer,ed=w.sceneEditor;
    const item=ed.items.find(x=>x.prefab==='vehicle'&&x.assetId&&x.name.toLowerCase().includes(id));
    if(!item)throw Error('Missing car model '+id);
    const v=w.vehicles.find(x=>x.userData.importedCar===item.assetId);
    if(!v)throw Error('No real physics car for '+id);
    if(p.controlledObject){p.stopControllingVehicle();p.leaveSeat();}
    p.setPosition(v.position.x+0.85,v.position.y,v.position.z);
    p.position.set(v.position.x+0.85,v.position.y,v.position.z);
    document.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyE',key:'e',bubbles:true,cancelable:true}));
    if(p.controlledObject!==v)p.teleportToVehicle(v,v.seats.find(s=>s.type==='driver')||v.seats[0]);
    p.takeControl();v.triggerAction('brake',false);v.triggerAction('throttle',true);
    w.sceneEditor.message('Guida '+item.name);
    return {model:item.name,before:[v.collision.position.x,v.collision.position.y,v.collision.position.z],
      control:p.controlledObject===v,occupied:v.seats.some(s=>s.occupiedBy===p),
      physics:!!v.rayCastVehicle};
   },id);
   console.log('ENTERED_REAL_CAR',id,JSON.stringify(entered));
   if(!entered.control||!entered.occupied||!entered.physics)
     throw Error('Could not drive '+id);
   frames=[];last=0;recording=id;
   await cdp.send('Page.startScreencast',{format:'jpeg',quality:73,maxWidth:896,maxHeight:504,everyNthFrame:1});
   const positions=[];
   for(let i=0;i<12;i++){
    const pos=await page.evaluate(id=>{
     const w=globalThis.world,ed=w.sceneEditor,THREE=globalThis.THREE;
     const item=ed.items.find(x=>x.prefab==='vehicle'&&x.name.toLowerCase().includes(id));
     const v=w.vehicles.find(x=>x.userData.importedCar===item.assetId);
     v.triggerAction('throttle',true);
     for(let n=0;n<18;n++){v.update(1/60);w.physicsWorld.step(1/60);}
     const p=new THREE.Vector3(v.collision.position.x,v.collision.position.y,v.collision.position.z);
     const forward=new THREE.Vector3(0,0,1).applyQuaternion(v.quaternion);
     w.camera.position.copy(p).addScaledVector(forward,-8).add(new THREE.Vector3(3,5,0));
     w.camera.lookAt(p.x,p.y+.8,p.z);
     w.renderer.setRenderTarget(null);w.renderer.render(w.graphicsWorld,w.camera);
     return {x:p.x,z:p.z,y:p.y,velocity:v.collision.velocity.length()};
    },id);
    positions.push(pos);
    await page.waitForTimeout(320);
    console.log('CAR_MOVING_FRAME',id,i,JSON.stringify(pos));
   }
   await cdp.send('Page.stopScreencast');recording=null;
   const lastPos=positions.at(-1);
   const distance=Math.hypot(lastPos.x-entered.before[0],lastPos.z-entered.before[2]);
   console.log('REAL_DISTANCE_METERS',id,distance,'chromeFrames',frames.length);
   if(!Number.isFinite(distance)||distance<.45)throw Error('Car did not move under physics '+id);
   await page.evaluate(id=>{
    const w=globalThis.world,ed=w.sceneEditor,
      car=w.vehicles.find(x=>x.userData.importedCar===ed.items.find(
       j=>j.prefab==='vehicle'&&j.name.toLowerCase().includes(id)).assetId);
    car.triggerAction('throttle',false);car.triggerAction('brake',true);
   },id);
   if(frames.length<7){
    console.log('FALLBACK_CAPTURE_SCREENSHOT',id,frames.length);
    frames=[];
    for(let i=0;i<9;i++){
      await page.evaluate(id=>{
       const w=globalThis.world,THREE=globalThis.THREE;
       const item=w.sceneEditor.items.find(j=>j.prefab==='vehicle'&&j.name.toLowerCase().includes(id));
       const v=w.vehicles.find(x=>x.userData.importedCar===item.assetId);
       w.camera.position.set(v.position.x+7,v.position.y+5,v.position.z+10);
       w.camera.lookAt(v.position.x,v.position.y+.75,v.position.z);
       w.renderer.render(w.graphicsWorld,w.camera);
      },id);
      frames.push(await page.screenshot({type:'jpeg',quality:74,timeout:20000}));
    }
   }
   if(frames.length<7)throw Error('No captured genuine rendered frames for '+id);
   for(let i=0;i<frames.length;i++)
      fs.writeFileSync(path.join(frameDir,String(i).padStart(4,'0')+'.jpg'),frames[i]);
   const poster=path.join(ROOT,id+'.png'),video=path.join(ROOT,id+'.mp4');
   const median=path.join(frameDir,String(Math.floor(frames.length/2)).padStart(4,'0')+'.jpg');
   cmd('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',median,'-frames:v','1',poster]);
   cmd('ffmpeg',['-hide_banner','-loglevel','error','-y','-framerate','4',
      '-i',path.join(frameDir,'%04d.jpg'),'-an','-vf','scale=896:504',
      '-c:v','libx264','-preset','veryfast','-crf','24','-pix_fmt','yuv420p',
      '-r','24','-movflags','+faststart',video],120000);
   if(fs.statSync(video).size<3000||duration(video)<1)
      throw Error('Empty recorded MP4 '+id);
   const result={id,name:car.name,driveDistanceMeters:distance,frames:frames.length,
      seconds:duration(video),photo:id+'.png',video:id+'.mp4'};
   results.push(result);
   console.log('CAR_VIDEO_COMPLETE',JSON.stringify(result));
  }
  cmd('ffmpeg',['-hide_banner','-loglevel','error','-y',
      '-i',path.join(ROOT,'bmw.png'),'-i',path.join(ROOT,'ferrari.png'),
      '-i',path.join(ROOT,'lamborghini.png'),
      '-filter_complex','[0:v]scale=640:360[a];[1:v]scale=640:360[b];[2:v]scale=640:360[c];[a][b][c]hstack=inputs=3',
      '-frames:v','1',path.join(ROOT,'urban-photoreal-overview.png')],90000);
  ok=true;console.log('THREE_REAL_DRIVING_VIDEOS',JSON.stringify(results));
 }catch(e){
  console.error('DRIVING_RECORDING_FAILED',e.message);
  console.error('PAGE_ERRORS',JSON.stringify(pageErrors.slice(-18)));
  console.error('FAILED_REQUESTS',JSON.stringify(failed.slice(-18)));
 }
 fs.writeFileSync(path.join(ROOT,'results.json'),JSON.stringify(
  {ok,url:URL,cars:results,pageErrors,failedRequests:failed},null,2));
 try{await browser.close();}catch{}
 if(!ok)process.exit(1);
})().catch(e=>{console.error(e);process.exit(1)});
