'use strict';
/** Record actual Three.js WebGL framebuffer pixels of three separate simulated
 * cars. Uses real Car.update and Cannon.step, never synthetic object translation.
 * This avoids CDP screencast (which yields zero frames under SwiftShader).
 */
const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
const {chromium}=require('playwright');
const ROOT='artifacts/photoreal-driving';
const URL=process.env.PHOTO_URL||
  'https://6ad259ad86251ebad353dc0c--my-test-site3.netlify.app/editor.html?scene=urban-photoreal&cityBlocks=2&play=1';
const CARS=[['bmw','BMW M4 G82'],['ferrari','Ferrari F40'],['lamborghini','Lamborghini Aventador SV']];
const sleep=t=>new Promise(r=>setTimeout(r,t));
fs.mkdirSync(ROOT,{recursive:true});
async function capture(page,asset){
  // This works even when Playwright screenshot and CDP screencast hang on the GL compositor.
  const result=await page.evaluate(asset=>{
    const w=globalThis.world,T=globalThis.THREE,car=w.vehicles.find(v=>v.userData.importedCar===asset);
    if(!car||!w.renderer)throw Error('Rendering vehicle missing');
    const r=w.renderer,p=car.collision.position;
    const q=car.quaternion;
    const forward=new T.Vector3(0,0,1).applyQuaternion(q);
    const target=new T.Vector3(p.x,p.y+0.65,p.z);
    const camera=w.camera;
    camera.position.copy(target).addScaledVector(forward,-7).add(new T.Vector3(2.7,3.7,0));
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
    r.setPixelRatio(0.5);
    r.setRenderTarget(null);
    r.render(w.graphicsWorld,camera);
    const gl=r.getContext(),width=gl.drawingBufferWidth,height=gl.drawingBufferHeight;
    if(width<100||height<80||width*height>1200000)throw Error('Invalid framebuffer size '+width+'x'+height);
    const pixels=new Uint8Array(width*height*4);
    gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    if(gl.getError()!==gl.NO_ERROR)throw Error('WebGL readPixels error');
    const frame=document.createElement('canvas');
    frame.width=width;frame.height=height;
    const ctx=frame.getContext('2d'),data=ctx.createImageData(width,height);
    let sample=0;
    // WebGL rows are bottom-to-top; correct orientation on 2D output.
    for(let y=0;y<height;y++) {
      const row=pixels.subarray((height-y-1)*width*4,(height-y)*width*4);
      data.data.set(row,y*width*4);
      if(y%12===0)for(let x=0;x<width;x+=20){
        const i=x*4;
        sample+=(row[i]+row[i+1]+row[i+2])>60?1:0;
      }
    }
    if(sample<40)throw Error('Blank WebGL screenshot ('+sample+' lit pixels)');
    ctx.putImageData(data,0,0);
    return {jpeg:frame.toDataURL('image/jpeg',0.82).split(',')[1],
            width,height,lit:sample,position:[p.x,p.y,p.z]};
  },asset);
  return {jpg:Buffer.from(result.jpeg,'base64'),
          width:result.width,height:result.height,lit:result.lit,pos:result.position};
}
async function film(page,key,label){
  const prep=await page.evaluate(label=>{
    const w=globalThis.world,ed=globalThis.sceneEditor;
    if(ed.active)ed.setActive(false);
    const item=ed.items.find(i=>i.name==='Sketchfab · '+label);
    if(!item)throw Error('Missing original '+label+' GLB');
    const car=w.vehicles.find(v=>v.userData.importedCar===item.assetId);
    if(!car)throw Error('Missing actual physics vehicle '+label);
    const player=w.actorLayer.resetPlayer();
    player.teleportToVehicle(car,car.seats.find(s=>s.type==='driver')||car.seats[0]);
    player.takeControl();
    if(player.controlledObject!==car)throw Error('Driver seat cannot be entered');
    const p=car.collision.position;
    return {asset:item.assetId,start:[p.x,p.y,p.z],physics:!!car.rayCastVehicle,seat:true};
  },label);
  const framesDir=path.join(ROOT,key+'-frames');
  fs.mkdirSync(framesDir,{recursive:true});
  const positions=[];
  const save=async i=>{
    const x=await capture(page,prep.asset);
    const file=path.join(framesDir,'frame-'+String(i).padStart(4,'0')+'.jpg');
    fs.writeFileSync(file,x.jpg);
    positions.push(x.pos);
    console.log('GL_FRAME',key,i,x.width+'x'+x.height,'lit='+x.lit);
  };
  await save(0);
  await page.evaluate(asset=>{
    const car=globalThis.world.vehicles.find(v=>v.userData.importedCar===asset);
    car.triggerAction('throttle',true);
  },prep.asset);
  for(let frame=1;frame<=12;frame++){
    await page.evaluate(asset=>{
      const w=globalThis.world,car=w.vehicles.find(v=>v.userData.importedCar===asset);
      for(let n=0;n<14;n++){car.update(1/60);w.physicsWorld.step(1/60);}
    },prep.asset);
    await sleep(260);
    await save(frame);
  }
  const end=await page.evaluate(asset=>{
    const w=globalThis.world,car=w.vehicles.find(v=>v.userData.importedCar===asset);
    car.triggerAction('throttle',false);
    return {position:[car.collision.position.x,car.collision.position.y,car.collision.position.z],
      occupied:car.seats.some(s=>s.occupiedBy===w.editorPlayer),
      controlled:w.editorPlayer.controlledObject===car};
  },prep.asset);
  const distance=Math.hypot(end.position[0]-prep.start[0],end.position[2]-prep.start[2]);
  const photo=path.join(ROOT,key+'.png');
  execFileSync('ffmpeg',['-y','-loglevel','error','-i',
     path.join(framesDir,'frame-0000.jpg'),'-frames:v','1',photo],{timeout:50000});
  const mp4=path.join(ROOT,key+'.mp4');
  execFileSync('ffmpeg',['-y','-loglevel','error','-framerate','4',
     '-i',path.join(framesDir,'frame-%04d.jpg'),
     '-c:v','libx264','-preset','fast','-crf','22','-pix_fmt','yuv420p',
     '-vf','scale=960:540:flags=lanczos','-movflags','+faststart',mp4],{timeout:120000});
  const record={car:label,distance:Number(distance.toFixed(2)),frames:13,
    mp4,photo,videoBytes:fs.statSync(mp4).size,...end};
  console.log('FILMED_CAR',JSON.stringify(record));
  if(!end.occupied||!end.controlled||distance<0.8||record.videoBytes<2000)
    throw Error('Driving video verification failed for '+label);
  return record;
}
(async()=>{
  const browser=await chromium.launch({headless:true,args:[
    '--no-sandbox','--disable-dev-shm-usage','--use-gl=angle',
    '--use-angle=swiftshader','--enable-webgl'
  ]});
  const page=await browser.newPage({viewport:{width:960,height:540},deviceScaleFactor:1});
  const result=[],pageErrors=[];
  page.on('pageerror',err=>pageErrors.push(err.message));
  try{
    console.log('VIDEO_URL',URL);
    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:80000});
    await page.waitForFunction(()=>Boolean(globalThis.urbanSupercarsStatus)||
      /Errore di avvio:/.test(document.querySelector('#city-load-message')?.textContent||''),
      null,{timeout:270000});
    console.log('MODEL_LOADING',JSON.stringify(await page.evaluate(()=>globalThis.urbanSupercarsStatus)));
    await page.evaluate(()=>{
      if(globalThis.sceneEditor?.active)globalThis.sceneEditor.setActive(false);
    });
    await page.waitForFunction(()=>globalThis.world?.vehicles?.filter(v=>v.userData?.importedCar).length===3,
      null,{timeout:180000});
    const worldState=await page.evaluate(()=>({
      modelStatus:globalThis.urbanSupercarsStatus,
      scene:globalThis.sceneEditor.worldId,
      lighting:globalThis.world.levelRuntime.visualProgress
    }));
    console.log('VIDEO_READY',JSON.stringify(worldState));
    if(worldState.modelStatus.errors.length)throw Error('Some cars failed to load');
    await page.evaluate(()=>{
      const w=globalThis.world,r=w.renderer;
      r.setPixelRatio(0.5);
      w.params.FXAA=false;w.params.Shadows=false;r.shadowMap.enabled=false;
    });
    for(const [key,label] of CARS) {
      try{result.push(await film(page,key,label));}
      catch(e){result.push({car:label,error:e.message});console.error('VIDEO_CAR_FAILED',label,e.message);}
    }
    fs.writeFileSync(path.join(ROOT,'report.json'),JSON.stringify({url:URL,result,pageErrors},null,2));
    if(result.some(x=>x.error))throw Error('Some car filming failed; inspect captured frames');
    console.log('THREE_CAR_VIDEOS_COMPLETE',JSON.stringify(result));
  }catch(e){
    console.error('VIDEO_CAPTURE_FAILED',e.message);
    console.error('VIDEO_PAGE_ERRORS',JSON.stringify(pageErrors.slice(-8)));
    const diag=await page.evaluate(()=>({
      models:globalThis.urbanSupercarsStatus,
      cars:globalThis.world?.vehicles?.filter(v=>v.userData?.importedCar).length,
      ready:globalThis.world?.levelRuntime?.visualProgress
    })).catch(()=>({}));
    fs.writeFileSync(path.join(ROOT,'error-report.json'),JSON.stringify({error:e.message,diag,result,pageErrors},null,2));
    await browser.close();process.exit(1);
  }
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
