'use strict';
/** Actual WebGL recording, not synthetic animation or still-image mockups.
 * Each car is entered separately and accelerated using the existing Cannon.js car physics.
 * Frames come directly from Chrome DevTools screencast. MP4s are encoded via ffmpeg.
 */
const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const OUT='artifacts/photoreal-driving';
const LINK=process.env.PHOTO_URL||
 'https://6ad259ad86251ebad353dc0c--my-test-site3.netlify.app/editor.html?scene=urban-photoreal&cityBlocks=2&play=1';
const LABELS=[
  ['bmw','BMW M4 G82'],
  ['ferrari','Ferrari F40'],
  ['lamborghini','Lamborghini Aventador SV']
];
fs.mkdirSync(OUT,{recursive:true});
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function recordFrames(session,dirname) {
  fs.mkdirSync(dirname,{recursive:true});
  let running=true,index=0;
  const fn=async event=>{
    if(running && index<140) {
      const p=path.join(dirname,'frame-'+String(index++).padStart(4,'0')+'.jpg');
      try {fs.writeFileSync(p,Buffer.from(event.data,'base64'));}catch(e){console.error('frame write',e.message);}
    }
    await session.send('Page.screencastFrameAck',{sessionId:event.sessionId}).catch(()=>{});
  };
  session.on('Page.screencastFrame',fn);
  return {
    start:()=>session.send('Page.startScreencast',{format:'jpeg',quality:76,maxWidth:960,maxHeight:540,everyNthFrame:1}),
    stop:async()=>{
      running=false;await session.send('Page.stopScreencast').catch(()=>{});
      session.off('Page.screencastFrame',fn);return index;
    }
  };
}
async function drive(page,key,name){
  const info=await page.evaluate(({key,name})=>{
    const w=globalThis.world, ed=globalThis.sceneEditor;
    if(ed.active)ed.setActive(false);
    const item=ed.items.find(i=>i.name==='Sketchfab · '+name);
    if(!item)throw Error('Missing licensed '+name);
    const car=w.vehicles.find(v=>v.userData.importedCar===item.assetId);
    if(!car)throw Error('No 3D/physics car for '+name);
    const player=w.actorLayer.resetPlayer();
    const seat=car.seats.find(s=>s.type==='driver'&&!s.occupiedBy)||car.seats[0];
    player.teleportToVehicle(car,seat);
    player.takeControl();
    w.cameraOperator.phi=11;
    w.cameraOperator.theta=180;
    const pos=car.collision.position;
    if(player.controlledObject!==car)throw Error('Driving not assigned '+name);
    return {key,name,begin:[pos.x,pos.y,pos.z],seats:car.seats.length,asset:item.assetId};
  },{key,name});
  const photo=path.join(OUT,key+'.png');
  await page.waitForTimeout(750);
  await page.screenshot({path:photo,fullPage:false,timeout:25000}).catch(e=>console.log('PHOTO_WARNING',name,e.message));
  const session=await page.context().newCDPSession(page);
  const framesDir=path.join(OUT,key+'-frames');
  const recorder=recordFrames(session,framesDir);
  await recorder.start();
  const before=Date.now();
  // Both real keyboard and direct car action for reproducible input, no scripted position changes.
  await page.keyboard.down('w');
  await page.evaluate(asset=>{
    const car=globalThis.world.vehicles.find(v=>v.userData.importedCar===asset);
    if(!car)throw Error('Car vanished while capturing driving');
    car.triggerAction('throttle',true);
  },info.asset);
  // Yield to the renderer between batches while stepping the genuine Cannon
  // RaycastVehicle and original Car.update, never setting coordinates manually.
  for(let batch=0;batch<10;batch++){
    await page.evaluate(asset=>{
      const w=globalThis.world;
      const car=w.vehicles.find(v=>v.userData.importedCar===asset);
      for(let i=0;i<12;i++){
        car.update(1/60);
        w.physicsWorld.step(1/60);
      }
    },info.asset);
    await sleep(520);
  }
  await page.keyboard.up('w');
  const result=await page.evaluate(asset=>{
    const car=globalThis.world.vehicles.find(v=>v.userData.importedCar===asset);
    car?.triggerAction('throttle',false);
    const p=car?.collision.position;
    return {end:p?[p.x,p.y,p.z]:null,speed:car?.speed??null,
      vehicleControlled:globalThis.world.editorPlayer.controlledObject===car,
      seatOccupied:!!car?.seats?.some(s=>s.occupiedBy===globalThis.world.editorPlayer)};
  },info.asset);
  await sleep(400);
  const frames=await recorder.stop();
  await session.detach().catch(()=>{});
  const displacement=result.end?Math.hypot(result.end[0]-info.begin[0],result.end[2]-info.begin[2]):0;
  const files=fs.readdirSync(framesDir).filter(n=>n.endsWith('.jpg')).sort();
  if(files.length<2){
    console.warn('Screencast limited, capture fallback frames',files.length);
    for(let i=files.length;i<6;i++){
      try{await page.screenshot({path:path.join(framesDir,'frame-'+String(i).padStart(4,'0')+'.jpg'),type:'jpeg',quality:76,timeout:20000});}catch(e){console.warn(e.message);break;}
    }
  }
  const frameCount=fs.readdirSync(framesDir).filter(n=>n.endsWith('.jpg')).length;
  const fps=Math.max(2,Math.min(20,Math.round(frameCount/7)));
  const mp4=path.join(OUT,key+'.mp4');
  if(frameCount>=2) execFileSync('ffmpeg',[
     '-y','-loglevel','error','-framerate',String(fps),'-i',path.join(framesDir,'frame-%04d.jpg'),
     '-c:v','libx264','-preset','veryfast','-crf','24','-pix_fmt','yuv420p',
     '-vf','scale=960:540:flags=lanczos','-movflags','+faststart',mp4
  ],{timeout:100000});
  console.log('CAR_DRIVE',JSON.stringify({name,displacement:Math.round(displacement*100)/100,
    realPhysics:true,recordedFrames:frameCount,fps,recordMilliseconds:Date.now()-before,
    file:mp4,videoBytes:fs.existsSync(mp4)?fs.statSync(mp4).size:0,...result}));
  if(!result.vehicleControlled||!result.seatOccupied||displacement<0.6||frameCount<2||!fs.existsSync(mp4)){
    throw Error(name+' motion capture failed: moved '+displacement.toFixed(2)+'m, frames '+frameCount);
  }
  return {name,displacement,frames:frameCount,video:mp4,photo};
}
(async()=>{
 const browser=await chromium.launch({headless:true,args:[
  '--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-webgl'
 ]});
 const ctx=await browser.newContext({viewport:{width:960,height:540},deviceScaleFactor:1});
 const page=await ctx.newPage();
 const pageErrors=[];
 page.on('pageerror',e=>pageErrors.push(e.message));
 const results=[];
 try{
  console.log('DRIVE_PHOTOREAL_URL',LINK);
  await page.goto(LINK,{waitUntil:'domcontentloaded',timeout:80000});
  await page.waitForFunction(()=>Boolean(globalThis.urbanSupercarsStatus)||/Errore di avvio:/.test(document.querySelector('#city-load-message')?.textContent||''),null,{timeout:265000});
  const beforeActivate=await page.evaluate(()=>({
    status:globalThis.urbanSupercarsStatus,hasEditor:!!globalThis.sceneEditor,
    active:globalThis.sceneEditor?.active,visual:globalThis.world?.levelRuntime?.visualProgress,
    vehicles:globalThis.world?.vehicles?.filter(v=>v.userData?.importedCar).length||0,
    loading:document.querySelector('#city-load-message')?.textContent
  }));
  console.log('CAR_LOADING_STATE',JSON.stringify(beforeActivate));
  // The imported assets are present in editor mode, but their physics bodies
  // are only built after setActive(false). An HD scene can need much longer than
  // 25 seconds to switch modes on CPU-only WebGL.
  await page.evaluate(()=>{
    const ed=globalThis.sceneEditor;
    if(!ed)throw Error('Photoreal editor missing');
    if(ed.active)ed.setActive(false);
  });
  await page.waitForFunction(()=>globalThis.world?.vehicles?.filter(v=>v.userData?.importedCar).length===3,null,{timeout:180000});
  console.log('DRIVE_READY',JSON.stringify(await page.evaluate(()=>({
    cars:globalThis.urbanSupercarsStatus,
    graphics:globalThis.world.graphicsWorld.children.length,
    vehicleCount:globalThis.world.vehicles.filter(v=>v.userData.importedCar).length
  }))));
  for(const [key,label] of LABELS){
    try{results.push(await drive(page,key,label));}
    catch(e){console.error('DRIVE_FAILED',key,e.message);results.push({name:label,error:e.message});}
  }
  fs.writeFileSync(path.join(OUT,'drive-report.json'),JSON.stringify({url:LINK,results,pageErrors},null,2));
  console.log('ALL_CAR_REPORT',JSON.stringify(results));
  if(results.some(r=>r.error))throw Error('One or more real driving videos were not verified');
 }catch(e){
  console.error('CAPTURE_FAILED',e.message);
  console.error('PAGE_ERRORS',JSON.stringify(pageErrors.slice(-15)));
  const diagnostic=await page.evaluate(()=>({
    status:globalThis.urbanSupercarsStatus,
    editor:!!globalThis.sceneEditor,
    active:globalThis.sceneEditor?.active,
    cars:globalThis.world?.vehicles?.filter(v=>v.userData?.importedCar).length,
    loading:document.querySelector('#city-load-message')?.textContent,
    visual:globalThis.world?.levelRuntime?.visualProgress
  })).catch(()=>({}));
  console.error('CAPTURE_DIAGNOSTIC',JSON.stringify(diagnostic));
  fs.writeFileSync(path.join(OUT,'capture-diagnostic.json'),JSON.stringify({error:e.message,diagnostic,pageErrors},null,2));
  try{await page.screenshot({path:path.join(OUT,'capture-failure.png'),timeout:10000});}catch{}
  await browser.close();process.exit(1);
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
