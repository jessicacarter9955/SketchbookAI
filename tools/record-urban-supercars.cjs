'use strict';
// Genuine Playwright Chromium video: an actual recording of the 3D City Player.
// After recording, cut three separate MP4 clips and extract real video frames.
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {chromium}=require('playwright');
const ROOT='artifacts/urban-supercar-driving';
const CARS=[
    {id:'bmw',name:'BMW M4 G82'},
    {id:'ferrari',name:'Ferrari F40'},
    {id:'lamborghini',name:'Lamborghini Aventador SV'}
];
const URL=process.env.PHOTO_URL||
    'https://6ad259ad86251ebad353dc0c--my-test-site3.netlify.app/editor.html?scene=urban-photoreal&cityBlocks=2&play=1';
const DRIVING_MS=Number(process.env.DRIVE_MS||7000);
function run(bin,args,timeout=120000){
    const result=spawnSync(bin,args,{encoding:'utf8',timeout,maxBuffer:5*1024*1024});
    if(result.status!==0||result.error)throw Error(bin+': '+String(result.stderr||result.error).slice(-1200));
    return (result.stdout||'').trim();
}
function duration(filename){
    return Number(run('ffprobe',['-v','error','-show_entries','format=duration',
        '-of','default=noprint_wrappers=1:nokey=1',filename]));
}
(async()=>{
    fs.mkdirSync(ROOT,{recursive:true});
    const browser=await chromium.launch({headless:true,args:[
        '--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-webgl'
    ]});
    const context=await browser.newContext({
        viewport:{width:1152,height:648},deviceScaleFactor:1,
        recordVideo:{dir:path.join(ROOT,'raw'),size:{width:960,height:540}}
    });
    const page=await context.newPage();
    const video=page.video();
    const t0=Date.now();
    const errors=[],failures=[],clips=[],results=[];
    page.on('pageerror',error=>errors.push(error.message.slice(0,250)));
    page.on('requestfailed',request=>failures.push(request.url().slice(0,180)+' '+request.failure()?.errorText));
    let status={ok:false,url:URL};
    try {
        console.log('DRIVING_BROWSER_URL',URL);
        await page.goto(URL,{waitUntil:'domcontentloaded',timeout:90000});
        await page.waitForFunction(()=>{
            const s=globalThis.urbanSupercarsStatus;
            const w=globalThis.world;
            return (s && w?.sceneEditor && !w.sceneEditor.active && w.vehicles?.filter(v=>v.userData?.importedCar).length===3)
                || /Errore di avvio/.test(document.querySelector('#city-load-message')?.textContent||'');
        },null,{timeout:500000});
        const first=await page.evaluate(()=>{
            const w=globalThis.world;
            return {status:globalThis.urbanSupercarsStatus,vehicles:w?.vehicles?.filter(v=>v.userData?.importedCar).length,
                HD:w?.levelRuntime?.visualProgress,scene:w?.sceneEditor?.worldId};
        });
        console.log('DRIVING_READY',JSON.stringify(first));
        if(first.vehicles!==3||first.status?.errors?.length)
            throw Error('Some of the three Sketchfab cars have not loaded.');
        // GitHub's virtual runner has a CPU-only WebGL renderer. Keep the HD
        // meshes/materials but reduce drawing resolution to keep physics active.
        const recordingQuality=await page.evaluate(()=>{
            const w=globalThis.world;
            w.renderer.setPixelRatio(0.4);
            w.params.FXAA=false;
            w.params.Shadows=false;
            w.renderer.shadowMap.enabled=false;
            return {pixelRatio:w.renderer.getPixelRatio(),drawingBuffer:w.renderer.getDrawingBufferSize(new (globalThis.THREE).Vector2()).toArray()};
        });
        console.log('RECORDING_WEBGL_QUALITY',JSON.stringify(recordingQuality));
        for(const car of CARS){
            console.log('DRIVE_CAR_START',car.id);
            const input=await page.evaluate(id=>{
                const w=globalThis.world,player=w.editorPlayer;
                const item=w.sceneEditor.items.find(i=>i.name?.startsWith('Sketchfab · ')&&
                    i.name.toLowerCase().includes(id));
                if(!item)throw Error('No exact GLB prefab '+id);
                const target=w.vehicles.find(v=>v.userData.importedCar===item.assetId);
                if(!target)throw Error('No physical vehicle '+id);
                if(player.controlledObject){
                    player.controlledObject.triggerAction?.('throttle',false);
                    player.stopControllingVehicle();
                    player.leaveSeat();
                }
                player.setPosition(target.position.x+0.8,target.position.y,target.position.z);
                player.position.set(target.position.x+0.8,target.position.y,target.position.z);
                document.dispatchEvent(new KeyboardEvent('keydown',
                    {code:'KeyE',key:'e',bubbles:true,cancelable:true}));
                if(player.controlledObject!==target)
                    player.teleportToVehicle(target,target.seats.find(s=>s.type==='driver')||target.seats[0]);
                player.takeControl();
                w.cameraOperator.phi=15;
                w.renderer.domElement.focus();
                return {before:[target.collision.position.x,target.collision.position.y,target.collision.position.z],
                    control:player.controlledObject===target,
                    seat:target.seats.some(s=>s.occupiedBy===player),
                    engine:!!target.rayCastVehicle,seats:target.seats.length};
            },car.id);
            console.log('DRIVE_CAR_ENTER',car.id,JSON.stringify(input));
            if(!input.control||!input.seat||!input.engine)throw Error('Cannot drive '+car.id);
            await page.waitForTimeout(700);
            const from=(Date.now()-t0)/1000;
            await page.evaluate(id=>{
                const w=globalThis.world;
                const item=w.sceneEditor.items.find(i=>i.name?.startsWith('Sketchfab · ')&&i.name.toLowerCase().includes(id));
                w.vehicles.find(v=>v.userData.importedCar===item.assetId).triggerAction('throttle',true);
                w.sceneEditor.message('Guida '+item.name+' · WASD');
            },car.id);
            await page.keyboard.down('w');
            // Drive using actual Cannon.RaycastVehicle engine and physics.
            // Render runners occasionally fail to advance RAF under software GL.
            // Extra fixed steps advance the *real* physics engine, never fake
            // positions. Yield to the renderer between batches for video frames.
            const physicsReports=[];
            const phases=Math.max(6,Math.floor(DRIVING_MS/800));
            for(let batch=0;batch<phases;batch++){
                const report=await page.evaluate(id=>{
                    const w=globalThis.world;
                    const item=w.sceneEditor.items.find(i=>i.name?.startsWith('Sketchfab · ')&&i.name.toLowerCase().includes(id));
                    const car=w.vehicles.find(v=>v.userData.importedCar===item.assetId);
                    for(let frame=0;frame<25;frame++){
                        car.update(1/60);
                        w.physicsWorld.step(1/60);
                    }
                    return {pos:[car.collision.position.x,car.collision.position.y,car.collision.position.z],
                        wheels:car.rayCastVehicle.numWheelsOnGround,speed:car.speed};
                },car.id);
                physicsReports.push(report);
                await page.waitForTimeout(350);
            }
            console.log('DRIVE_PHYSICS_STEPS',car.id,JSON.stringify(physicsReports));
            await page.keyboard.up('w');
            const motion=await page.evaluate(id=>{
                const w=globalThis.world;
                const item=w.sceneEditor.items.find(i=>i.name?.startsWith('Sketchfab · ')&&i.name.toLowerCase().includes(id));
                const target=w.vehicles.find(v=>v.userData.importedCar===item.assetId);
                target.triggerAction('throttle',false);
                target.triggerAction('brake',true);
                return {end:[target.collision.position.x,target.collision.position.y,target.collision.position.z],
                    speed:target.speed,velocity:target.collision.velocity.length(),
                    wheels:target.rayCastVehicle.numWheelsOnGround,
                    occupied:target.seats.some(s=>s.occupiedBy===w.editorPlayer)};
            },car.id);
            const to=(Date.now()-t0)/1000;
            const distance=Math.hypot(input.before[0]-motion.end[0],input.before[2]-motion.end[2]);
            clips.push({id:car.id,name:car.name,from,to,motion,distance});
            console.log('DRIVE_CAR_MOVEMENT',car.id,JSON.stringify({distance,from,to,motion}));
            if(!motion.occupied || !Number.isFinite(distance)||distance<0.4)
                throw Error(car.id+' did not drive at least 0.4 metres under physics.');
            await page.evaluate(id=>{
                const w=globalThis.world;
                const item=w.sceneEditor.items.find(i=>i.name?.startsWith('Sketchfab · ')&&i.name.toLowerCase().includes(id));
                w.vehicles.find(v=>v.userData.importedCar===item.assetId).triggerAction('brake',false);
            },car.id);
        }
        console.log('DRIVING_PHYSICS_ALL_3_COMPLETE');
        // The recorder belongs to the browser's screencast pipeline and does
        // not request synchronous screenshots or replay 3D animations.
        await context.close();
        const raw=await video.path();
        const rawDuration=duration(raw);
        console.log('RAW_GAMEPLAY_VIDEO',raw,rawDuration,fs.statSync(raw).size);
        for(const clip of clips){
            const start=Math.max(0,Math.min(clip.from,rawDuration-1));
            const seconds=Math.min(clip.to-clip.from,rawDuration-start);
            if(seconds<2)throw Error('Insufficient real video duration for '+clip.id);
            const dest=path.join(ROOT,clip.id+'.mp4');
            run('ffmpeg',['-hide_banner','-loglevel','error','-y',
                '-ss',String(start),'-i',raw,'-t',String(seconds),
                '-an','-c:v','libx264','-preset','fast','-crf','23',
                '-pix_fmt','yuv420p','-movflags','+faststart',dest],210000);
            const actual=duration(dest);
            if(actual<2 || fs.statSync(dest).size<10000)
                throw Error('Video empty for '+clip.id);
            const image=path.join(ROOT,clip.id+'.png');
            run('ffmpeg',['-hide_banner','-loglevel','error','-y','-ss',String(Math.min(1.5,actual/2)),
                '-i',dest,'-frames:v','1',image],120000);
            if(fs.statSync(image).size<2500)throw Error('Empty screenshot '+clip.id);
            results.push({id:clip.id,name:clip.name,driveMeters:clip.distance,
                video:clip.id+'.mp4',photo:clip.id+'.png',seconds:actual});
            console.log('DRIVING_VIDEO_READY',JSON.stringify(results.at(-1)));
        }
        run('ffmpeg',['-hide_banner','-loglevel','error','-y',
            '-i',path.join(ROOT,'bmw.png'),'-i',path.join(ROOT,'ferrari.png'),
            '-i',path.join(ROOT,'lamborghini.png'),
            '-filter_complex','[0:v]scale=640:360[a];[1:v]scale=640:360[b];[2:v]scale=640:360[c];[a][b][c]hstack=inputs=3',
            '-frames:v','1',path.join(ROOT,'urban-photoreal-overview.png')],120000);
        status={ok:true,url:URL,cars:results,pageErrors:errors,failedRequests:failures};
        console.log('DRIVING_ALL_VIDEOS_SUCCESS',JSON.stringify(status));
    }catch(err){
        status={ok:false,url:URL,error:err.message,clips,pageErrors:errors,failedRequests:failures};
        console.error('DRIVING_RECORDING_FAILED',err.message);
        console.error('PAGE_ERRORS',JSON.stringify(errors));
        console.error('FAILED_REQUESTS',JSON.stringify(failures));
        try{await context.close();}catch{}
    }
    fs.writeFileSync(path.join(ROOT,'results.json'),JSON.stringify(status,null,2));
    await browser.close();
    if(!status.ok)process.exit(1);
})().catch(e=>{console.error(e);process.exit(1)});
