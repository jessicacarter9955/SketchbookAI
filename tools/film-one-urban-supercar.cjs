'use strict';
// One GitHub Actions runner per vehicle; real Three.js WebGL frames + Cannon physics.
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process'),{chromium}=require('playwright');
const car=process.env.CAR_ID||'bmw';
if(!['bmw','ferrari','lamborghini'].includes(car))throw Error('Unknown car');
const root='artifacts/car-shots',dest=path.join(root,car);
fs.mkdirSync(dest,{recursive:true});
const url=process.env.PHOTO_URL||'https://6ad259fa343e72e0db919829--my-test-site3.netlify.app/editor.html?scene=urban-photoreal&cityBlocks=2&play=1';
function call(bin,args,timeout=120000){const r=spawnSync(bin,args,{encoding:'utf8',timeout});if(r.error||r.status!==0)throw Error(String(r.stderr||r.error).slice(-800));return (r.stdout||'').trim()}
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-webgl']});
 const page=await browser.newPage({viewport:{width:720,height:405},deviceScaleFactor:1});
 const errors=[],failures=[];page.on('pageerror',e=>errors.push(e.message.slice(0,120)));
 page.on('requestfailed',r=>failures.push(r.url().slice(0,110)+' '+r.failure()?.errorText));
 let status={ok:false,car};
 try{
  console.log('UNRECORDED_LOAD',url,'car',car);
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:80000});
  await page.waitForFunction(()=>{
    const s=globalThis.urbanSupercarsStatus,w=globalThis.world;
    return (s&&w?.sceneEditor&&!w.sceneEditor.active)||/Errore di avvio:/.test(document.querySelector('#city-load-message')?.textContent||'');
  },null,{timeout:285000,polling:400});
  const initialized=await page.evaluate(id=>{
    const w=globalThis.world,ed=w.sceneEditor;
    const item=ed.items.find(i=>i.prefab==='vehicle'&&i.assetId&&i.name.toLowerCase().includes(id));
    const v=w.vehicles.find(x=>x.userData.importedCar===item?.assetId);
    if(!v||globalThis.urbanSupercarsStatus.errors.length)throw Error('Car not loaded');
    w.renderer.setPixelRatio(1);
    w.renderer.setSize(448,252,false);
    w.renderer.shadowMap.enabled=false;w.params.Shadows=false;w.params.FXAA=false;
    const p=w.editorPlayer;
    if(p.controlledObject){p.stopControllingVehicle();p.leaveSeat();}
    p.setPosition(v.position.x+0.85,v.position.y,v.position.z);
    p.position.set(v.position.x+0.85,v.position.y,v.position.z);
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'e',code:'KeyE',bubbles:true,cancelable:true}));
    if(p.controlledObject!==v)p.teleportToVehicle(v,v.seats.find(s=>s.type==='driver')||v.seats[0]);
    p.takeControl();v.triggerAction('throttle',true);
    return {id,name:item.name,assetId:item.assetId,control:p.controlledObject===v,
      occupant:v.seats.some(s=>s.occupiedBy===p),wheels:v.rayCastVehicle.wheelInfos.length,
      begin:[v.collision.position.x,v.collision.position.y,v.collision.position.z],
      totalVehicles:w.vehicles.filter(x=>x.userData.importedCar).length};
  },car);
  console.log('INITIAL',JSON.stringify(initialized));
  if(initialized.totalVehicles!==3||!initialized.control||!initialized.occupant)
      throw Error('Three cars not loaded / not controlling car');
  const frames=8;
  const raw=path.join(dest,car+'.rgba');try{fs.unlinkSync(raw)}catch{}
  const traces=[],colorSamples=[];
  for(let n=0;n<frames;n++){
    const data=await page.evaluate(id=>{
      const w=globalThis.world,ed=w.sceneEditor,THREE=globalThis.THREE;
      const item=ed.items.find(i=>i.prefab==='vehicle'&&i.name.toLowerCase().includes(id));
      const v=w.vehicles.find(x=>x.userData.importedCar===item.assetId);
      v.triggerAction('throttle',true);
      for(let step=0;step<18;step++){v.update(1/60);w.physicsWorld.step(1/60);}
      const p=new THREE.Vector3(v.collision.position.x,v.collision.position.y,v.collision.position.z);
      const forward=new THREE.Vector3(0,0,1).applyQuaternion(v.quaternion);
      w.camera.position.copy(p).addScaledVector(forward,-7).add(new THREE.Vector3(2.7,4.5,0));
      w.camera.lookAt(p.x,p.y+0.85,p.z);
      w.renderer.setRenderTarget(null);w.renderer.render(w.graphicsWorld,w.camera);
      const gl=w.renderer.getContext(),width=gl.drawingBufferWidth,height=gl.drawingBufferHeight;
      if(width!==448||height!==252)throw Error('Resized buffer '+width+'x'+height);
      const bytes=new Uint8Array(width*height*4);
      gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
      let binary='';
      for(let start=0;start<bytes.length;start+=8192)
        binary+=String.fromCharCode(...bytes.subarray(start,start+8192));
      return {pixel:btoa(binary),x:p.x,y:p.y,z:p.z,speed:v.speed,
        colors:bytes[Math.floor(bytes.length*.2)]+bytes[Math.floor(bytes.length*.37)]};
    },car);
    const buf=Buffer.from(data.pixel,'base64');
    if(buf.length!==448*252*4)throw Error('Frame size wrong');
    fs.appendFileSync(raw,buf);
    traces.push({x:data.x,y:data.y,z:data.z,speed:data.speed});
    colorSamples.push(data.colors);
    console.log('REAL_RENDERED_FRAME',car,n+1,JSON.stringify(traces.at(-1)));
    await page.waitForTimeout(40);
  }
  const end=traces.at(-1),beg=initialized.begin;
  const distance=Math.hypot(end.x-beg[0],end.z-beg[2]);
  if(distance<0.5||colorSamples.every(c=>c===0))throw Error('No real car motion or empty frames.');
  const mp4=path.join(dest,car+'.mp4'),image=path.join(dest,car+'.png');
  call('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','rawvideo','-pixel_format','rgba',
    '-video_size','448x252','-framerate','3','-i',raw,'-an',
    '-vf','vflip,scale=896:504:flags=lanczos','-c:v','libx264','-preset','veryfast',
    '-crf','22','-pix_fmt','yuv420p','-r','24','-movflags','+faststart',mp4]);
  call('ffmpeg',['-hide_banner','-loglevel','error','-y','-ss','1','-i',mp4,'-frames:v','1',image]);
  const seconds=Number(call('ffprobe',['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',mp4]));
  if(seconds<2||fs.statSync(mp4).size<4000||fs.statSync(image).size<3000)throw Error('Invalid film');
  fs.unlinkSync(raw);
  status={ok:true,name:initialized.name,car,seconds,frames,meters:distance,
    image:car+'.png',video:car+'.mp4',trace:traces};
  console.log('COMPLETE_DRIVING_VIDEO',JSON.stringify(status));
 }catch(e){
  status.error=e.message;console.error('VIDEO_FAILED',car,e.message);
  console.error('PAGE_ERRORS',JSON.stringify(errors));
  console.error('FETCH_FAILURES',JSON.stringify(failures));
 }
 fs.writeFileSync(path.join(dest,'report.json'),JSON.stringify(status,null,2));
 await browser.close().catch(()=>{});
 if(!status.ok)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
