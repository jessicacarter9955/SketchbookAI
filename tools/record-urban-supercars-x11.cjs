'use strict';
// Alternate video recorder: capture the visible, headful browser desktop via
// Xvfb + ffmpeg x11grab, not Chrome screenshot/CDP compositor (broken on CI).
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),{spawn,spawnSync}=require('node:child_process');
const OUT='artifacts/urban-supercar-driving';
const URL=process.env.PHOTO_URL||
 'https://6ad259fa343e72e0db919829--my-test-site3.netlify.app/editor.html?scene=urban-photoreal&cityBlocks=2&play=1';
const CARS=[['bmw','BMW M4 G82'],['ferrari','Ferrari F40'],['lamborghini','Lamborghini Aventador SV']];
function ffmpeg(args){
 const p=spawnSync('ffmpeg',args,{encoding:'utf8',timeout:110000});
 if(p.error||p.status!==0)throw Error('ffmpeg: '+String(p.stderr||p.error).slice(-1000));
}
function film(file,seconds) {
 return new Promise((resolve,reject)=>{
   const args=['-hide_banner','-loglevel','error','-y','-f','x11grab',
     '-framerate','8','-video_size','960x540','-i',process.env.DISPLAY+'+0,0',
     '-t',String(seconds),'-an','-c:v','libx264','-preset','ultrafast',
     '-crf','25','-pix_fmt','yuv420p','-movflags','+faststart',file];
   const p=spawn('ffmpeg',args,{stdio:['ignore','ignore','pipe']});
   let error='';p.stderr.on('data',b=>error+=b.toString().slice(-900));
   p.on('error',reject);
   p.on('close',status=>status===0?resolve():reject(Error('X11 video failed '+status+' '+error.slice(-700))));
 });
}
(async()=>{
 if(!process.env.DISPLAY)throw Error('Requires Xvfb DISPLAY');
 fs.mkdirSync(OUT,{recursive:true});
 const browser=await chromium.launch({headless:false,args:[
   '--no-sandbox','--disable-dev-shm-usage','--window-position=0,0',
   '--window-size=960,540','--use-angle=swiftshader','--use-gl=angle',
   '--enable-webgl','--enable-unsafe-swiftshader']});
 const ctx=await browser.newContext({viewport:{width:960,height:540},deviceScaleFactor:1});
 const page=await ctx.newPage();
 let ok=false;const cars=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message.slice(0,250)));
 try {
   console.log('X11_REAL_PLAYER',URL,'DISPLAY',process.env.DISPLAY);
   await page.goto(URL,{waitUntil:'domcontentloaded',timeout:85000});
   await page.waitForFunction(()=>{
     const w=globalThis.world,s=globalThis.urbanSupercarsStatus;
     return (w?.sceneEditor && s && !w.sceneEditor.active)||
      /Errore di avvio:/.test(document.querySelector('#city-load-message')?.textContent||'');
   },null,{timeout:310000});
   const state=await page.evaluate(()=>{
     const w=globalThis.world;
     return {status:globalThis.urbanSupercarsStatus,
       cars:w.vehicles.filter(v=>v.userData.importedCar).length,
       stage:w.levelRuntime.visualProgress};
   });
   console.log('X11_SCENE_READY',JSON.stringify(state));
   if(state.cars!==3||state.status.errors.length)throw Error('Three cars not present');
   await page.evaluate(()=>{const w=globalThis.world;w.renderer.setPixelRatio(.5);
      w.params.Shadows=false;w.params.FXAA=false;w.renderer.shadowMap.enabled=false;});
   for(const [id,name] of CARS){
     const before=await page.evaluate(id=>{
       const w=globalThis.world,p=w.editorPlayer,ed=w.sceneEditor;
       const item=ed.items.find(i=>i.name.toLowerCase().includes(id)&&i.prefab==='vehicle');
       const car=w.vehicles.find(v=>v.userData.importedCar===item.assetId);
       if(!car)throw Error('Not a real vehicle '+id);
       if(p.controlledObject){p.stopControllingVehicle();p.leaveSeat();}
       p.setPosition(car.position.x+0.8,car.position.y,car.position.z);
       p.position.set(car.position.x+0.8,car.position.y,car.position.z);
       document.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyE',key:'e',bubbles:true,cancelable:true}));
       if(p.controlledObject!==car)p.teleportToVehicle(car,car.seats[0]);
       p.takeControl();w.cameraOperator.phi=14;car.triggerAction('throttle',true);
       w.sceneEditor.message('Guida '+item.name);
       return {position:car.position.toArray(),entered:p.controlledObject===car};
     },id);
     if(!before.entered)throw Error('Vehicle not controlled '+id);
     const file=path.join(OUT,id+'.mp4');
     const recording=film(file,7);
     for(let i=0;i<15;i++){
       await page.evaluate(id=>{
         const w=globalThis.world,e=w.sceneEditor,item=e.items.find(x=>x.name.toLowerCase().includes(id)&&x.prefab==='vehicle');
         const v=w.vehicles.find(x=>x.userData.importedCar===item.assetId);
         v.triggerAction('throttle',true);
         for(let s=0;s<15;s++){v.update(1/60);w.physicsWorld.step(1/60);}
       },id);
       await page.waitForTimeout(370);
     }
     await recording;
     const after=await page.evaluate(id=>{
       const w=globalThis.world,item=w.sceneEditor.items.find(x=>x.name.toLowerCase().includes(id)&&x.prefab==='vehicle');
       const car=w.vehicles.find(v=>v.userData.importedCar===item.assetId);
       car.triggerAction('throttle',false);
       return {position:car.position.toArray(),occupied:car.seats.some(s=>s.occupiedBy===w.editorPlayer)};
     },id);
     const distance=Math.hypot(before.position[0]-after.position[0],before.position[2]-after.position[2]);
     if(distance<.5||!after.occupied)throw Error('No physical driving '+id+' '+distance);
     const photo=path.join(OUT,id+'.png');
     ffmpeg(['-hide_banner','-loglevel','error','-y','-ss','2','-i',file,'-frames:v','1',photo]);
     if(fs.statSync(photo).size<3000||fs.statSync(file).size<10000)throw Error('Recording too small '+id);
     cars.push({id,name,driveDistanceMeters:distance,video:id+'.mp4',photo:id+'.png',seconds:7});
     console.log('X11_DRIVE_DONE',JSON.stringify(cars.at(-1)));
   }
   ffmpeg(['-hide_banner','-loglevel','error','-y',
       '-i',path.join(OUT,'bmw.png'),'-i',path.join(OUT,'ferrari.png'),
       '-i',path.join(OUT,'lamborghini.png'),
       '-filter_complex','[0:v]scale=640:360[a];[1:v]scale=640:360[b];[2:v]scale=640:360[c];[a][b][c]hstack=inputs=3',
       '-frames:v','1',path.join(OUT,'urban-photoreal-overview.png')]);
   ok=true;
   console.log('THREE_GAMEPLAY_VIDEOS_COMPLETE',JSON.stringify(cars));
 }catch(e){console.error('X11_RECORDER_FAILED',e.message,'errors',JSON.stringify(errors.slice(-6)));}
 fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({ok,cars,url:URL,errors},null,2));
 await browser.close().catch(()=>{});
 if(!ok)process.exit(1);
})().catch(e=>{console.error(e);process.exit(1)});
