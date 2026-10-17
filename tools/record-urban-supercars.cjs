'use strict';
// Genuine frames read from the ACTUAL Sketchbook Three.js WebGL backbuffer,
// following original Sketchfab model atop Sketchbook's Cannon raycast car.
// This avoids Chrome screencast and page screenshots (both hang in SwiftShader).
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process'),{chromium}=require('playwright');
const DIR='artifacts/urban-supercar-driving';
const MODELS=[['bmw','BMW M4 G82'],['ferrari','Ferrari F40'],['lamborghini','Lamborghini Aventador SV']];
const URL=process.env.PHOTO_URL||'https://6ad259fa343e72e0db919829--my-test-site3.netlify.app/editor.html?scene=urban-photoreal&cityBlocks=2&play=1';
function run(bin,args,time=140000){
  const r=spawnSync(bin,args,{encoding:'utf8',timeout:time,maxBuffer:2e6});
  if(r.error||r.status!==0)throw Error(bin+': '+String(r.stderr||r.error).slice(-1400));
  return (r.stdout||'').trim();
}
(async()=>{
 fs.mkdirSync(DIR,{recursive:true});
 const browser=await chromium.launch({headless:true,args:[
    '--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader',
    '--use-gl=angle','--enable-webgl']});
 const page=await browser.newPage({viewport:{width:896,height:504},deviceScaleFactor:1});
 const failures=[],errors=[],cars=[];
 page.on('pageerror',e=>errors.push(e.message.slice(0,200)));
 page.on('requestfailed',r=>failures.push(r.url().slice(0,175)+' '+r.failure()?.errorText));
 let ok=false;
 try{
   console.log('LOAD_SCENE_WITHOUT_RECORDING',URL);
   await page.goto(URL,{waitUntil:'domcontentloaded',timeout:75000});
   await page.waitForFunction(()=>{
     const s=globalThis.urbanSupercarsStatus,w=globalThis.world;
     return (s&&w?.sceneEditor&&!w.sceneEditor.active)||
       /Errore di avvio:/.test(document.querySelector('#city-load-message')?.textContent||'');
   },null,{timeout:350000,polling:500});
   const ready=await page.evaluate(()=>{
     const w=globalThis.world;return {scene:w?.sceneEditor?.worldId,
        imported:globalThis.urbanSupercarsStatus,
        vehicles:w?.vehicles?.filter(x=>x.userData.importedCar).length,
        visual:w?.levelRuntime?.visualProgress};
   });
   console.log('SCENE_READY',JSON.stringify(ready));
   if(ready.scene!=='procedural-city'||ready.vehicles!==3||ready.imported?.errors?.length)
      throw Error('Expected 3 Sketchfab supercars in the photoreal city.');
   await page.evaluate(()=>{
     const w=globalThis.world;
     w.renderer.setPixelRatio(.35);
     w.renderer.shadowMap.enabled=false;w.params.Shadows=false;w.params.FXAA=false;
   });
   for(const [id,name] of MODELS){
     const initial=await page.evaluate(id=>{
       const w=globalThis.world,p=w.editorPlayer,ed=w.sceneEditor;
       const item=ed.items.find(x=>x.prefab==='vehicle'&&x.assetId&&x.name.toLowerCase().includes(id));
       if(!item)throw Error('No licensed car '+id);
       const v=w.vehicles.find(x=>x.userData.importedCar===item.assetId);
       if(!v)throw Error('No car physics '+id);
       if(p.controlledObject){p.stopControllingVehicle();p.leaveSeat();}
       p.setPosition(v.position.x+0.9,v.position.y,v.position.z);
       p.position.set(v.position.x+0.9,v.position.y,v.position.z);
       document.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyE',key:'e',bubbles:true,cancelable:true}));
       if(p.controlledObject!==v)p.teleportToVehicle(v,v.seats.find(s=>s.type==='driver')||v.seats[0]);
       p.takeControl();v.triggerAction('brake',false);v.triggerAction('throttle',true);
       w.sceneEditor.message('🏎 '+item.name+' · ripresa vera · Sketchbook');
       return {before:[v.collision.position.x,v.collision.position.y,v.collision.position.z],
          entered:p.controlledObject===v,occupied:v.seats.some(s=>s.occupiedBy===p),
          seats:v.seats.length,engine:!!v.rayCastVehicle};
     },id);
     console.log('ENTER_VEHICLE',id,JSON.stringify(initial));
     if(!initial.entered||!initial.occupied||!initial.engine)throw Error('Cannot control '+id);
     const pixels=path.join(DIR,id+'.rgba');
     try{fs.unlinkSync(pixels)}catch{}
     let count=0,dimensions=null,colors=0;
     const points=[];
     for(let i=0;i<12;i++){
       const frame=await page.evaluate(id=>{
         const w=globalThis.world,three=globalThis.THREE,ed=w.sceneEditor;
         const item=ed.items.find(x=>x.prefab==='vehicle'&&x.assetId&&x.name.toLowerCase().includes(id));
         const v=w.vehicles.find(x=>x.userData.importedCar===item.assetId);
         v.triggerAction('throttle',true);
         // Real drive force + raycast suspension + collision contacts.
         for(let j=0;j<15;j++){v.update(1/60);w.physicsWorld.step(1/60);}
         const p=new three.Vector3(v.collision.position.x,v.collision.position.y,v.collision.position.z);
         const forward=new three.Vector3(0,0,1).applyQuaternion(v.quaternion);
         w.camera.position.copy(p).addScaledVector(forward,-8).add(new three.Vector3(3,5.5,0));
         w.camera.lookAt(p.x,p.y+.75,p.z);
         w.renderer.setRenderTarget(null);
         w.renderer.render(w.graphicsWorld,w.camera);
         const gl=w.renderer.getContext(),width=gl.drawingBufferWidth,height=gl.drawingBufferHeight;
         if(width<240||height<135||width>1400||height>1100)throw Error('Unexpected framebuffer dimension.');
         const rgba=new Uint8Array(width*height*4);
         gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
         const sample=rgba[Math.floor(rgba.length*.21)] + rgba[Math.floor(rgba.length*.41)] +
                      rgba[Math.floor(rgba.length*.72)];
         let base64='';
         for(let k=0;k<rgba.length;k+=8192)
           base64+=String.fromCharCode(...rgba.subarray(k,k+8192));
         return {data:btoa(base64),width,height,sample,
             pos:[p.x,p.y,p.z],velocity:v.collision.velocity.length()};
       },id);
       const bytes=Buffer.from(frame.data,'base64');
       if(bytes.length!==frame.width*frame.height*4)throw Error('Incomplete WebGL readback');
       if(dimensions&&(dimensions[0]!==frame.width||dimensions[1]!==frame.height))
           throw Error('WebGL drawing buffer resized mid-recording');
       dimensions=[frame.width,frame.height];
       colors+=frame.sample;
       fs.appendFileSync(pixels,bytes);
       points.push(frame.pos);count++;
       console.log('RECORDED_WEBGL_FRAME',id,i+1,JSON.stringify({
           pos:frame.pos,velocity:frame.velocity,dim:dimensions,sample:frame.sample
       }));
       await page.waitForTimeout(90);
     }
     const end=points.at(-1);
     const distance=Math.hypot(end[0]-initial.before[0],end[2]-initial.before[2]);
     console.log('CAR_TRAVELLED_METRES',id,distance,'videoFrames',count,'colorScore',colors);
     if(distance<.5||!Number.isFinite(distance))throw Error('Physics did not move '+id);
     if(colors===0)throw Error('WebGL readback is black/empty');
     const [width,height]=dimensions;
     const video=path.join(DIR,id+'.mp4'),photo=path.join(DIR,id+'.png');
     run('ffmpeg',['-hide_banner','-loglevel','error','-y',
       '-f','rawvideo','-pixel_format','rgba','-video_size',width+'x'+height,
       '-framerate','4','-i',pixels,'-an','-vf','vflip,scale=896:504:flags=lanczos',
       '-c:v','libx264','-preset','veryfast','-crf','23','-pix_fmt','yuv420p',
       '-r','25','-movflags','+faststart',video],180000);
     run('ffmpeg',['-hide_banner','-loglevel','error','-y','-ss','1.4',
       '-i',video,'-frames:v','1',photo],75000);
     const seconds=Number(run('ffprobe',['-v','error','-show_entries','format=duration',
       '-of','default=nw=1:nk=1',video]));
     if(!fs.existsSync(photo)||fs.statSync(photo).size<3000||
       fs.statSync(video).size<7000||seconds<2.5)throw Error('Incomplete visual recording '+id);
     fs.unlinkSync(pixels);
     const item={id,name,video:id+'.mp4',photo:id+'.png',seconds,frames:count,driveDistanceMeters:distance,
         width,height};
     cars.push(item);
     console.log('VIDEO_COMPLETE',JSON.stringify(item));
     await page.evaluate(id=>{
        const w=globalThis.world,ed=w.sceneEditor;
        const item=ed.items.find(x=>x.prefab==='vehicle'&&x.name.toLowerCase().includes(id));
        const v=w.vehicles.find(x=>x.userData.importedCar===item.assetId);
        v.triggerAction('throttle',false);v.triggerAction('brake',true);
     },id);
   }
   run('ffmpeg',['-hide_banner','-loglevel','error','-y',
     '-i',path.join(DIR,'bmw.png'),'-i',path.join(DIR,'ferrari.png'),
     '-i',path.join(DIR,'lamborghini.png'),
     '-filter_complex','[0:v]scale=640:360[a];[1:v]scale=640:360[b];[2:v]scale=640:360[c];[a][b][c]hstack=inputs=3',
     '-frames:v','1',path.join(DIR,'urban-photoreal-overview.png')]);
   ok=true;
   console.log('SUCCESS_THREE_ACTUAL_GAMEPLAY_MP4S',JSON.stringify(cars));
 }catch(e){
   console.error('DRIVING_RECORDING_FAILED',e.message);
   console.error('PAGE_ERRORS',JSON.stringify(errors.slice(-20)));
   console.error('FAILED_REQUESTS',JSON.stringify(failures.slice(-20)));
 }
 fs.writeFileSync(path.join(DIR,'results.json'),JSON.stringify({ok,url:URL,cars,pageErrors:errors,
    failedRequests:failures},null,2));
 await browser.close().catch(()=>{});
 if(!ok)process.exit(1);
})().catch(e=>{console.error(e);process.exit(1)});
