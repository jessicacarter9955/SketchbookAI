'use strict';
/**
 * Record actual Three.js canvas output while each real Sketchfab/Sketchbook
 * vehicle drives under Cannon.js forces. Never render animations off-line.
 * Output: one PNG + MP4 per car, plus an establishing overview image.
 */
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {chromium} = require('playwright');

const ROOT = 'artifacts/urban-supercar-driving';
const CARS = [
    {id:'bmw',name:'BMW M4 G82'},
    {id:'ferrari',name:'Ferrari F40'},
    {id:'lamborghini',name:'Lamborghini Aventador SV'}
];
const URL = process.env.PHOTO_URL ||
    'https://6ad259fa343e72e0db919829--my-test-site3.netlify.app/editor.html?scene=urban-photoreal&cityBlocks=2&play=1';
const DURATION_MS = Number(process.env.DRIVE_MS || 7000);
function runBin(bin,args) {
    const output=spawnSync(bin,args,{encoding:'utf8',maxBuffer:1024*1024*4,timeout:120000});
    if(output.error || output.status!==0)
        throw Error(bin+' failed: '+(output.stderr||output.error||output.status).toString().slice(-1400));
    return (output.stdout||'').trim();
}
function convertVideo(id) {
    const source=path.join(ROOT,id+'.webm');
    const target=path.join(ROOT,id+'.mp4');
    runBin('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',source,
        '-an','-c:v','libx264','-preset','veryfast','-crf','24',
        '-pix_fmt','yuv420p','-movflags','+faststart',target]);
    const duration=Number(runBin('ffprobe',['-v','error','-show_entries','format=duration',
        '-of','default=noprint_wrappers=1:nokey=1',target]));
    if(!Number.isFinite(duration)||duration<3)
        throw Error(id+' MP4 video not valid (duration '+duration+').');
    return {filename:id+'.mp4',duration,bytes:fs.statSync(target).size};
}
function validatePhoto(file) {
    if(fs.statSync(file).size<15000)throw Error('Screenshot empty '+file);
}
(async()=>{
    fs.mkdirSync(ROOT,{recursive:true});
    const browser=await chromium.launch({headless:true,args:[
        '--no-sandbox','--disable-dev-shm-usage',
        '--use-gl=angle','--use-angle=swiftshader','--enable-webgl'
    ]});
    const page=await browser.newPage({viewport:{width:1152,height:648},deviceScaleFactor:1});
    page.setDefaultTimeout(30000);
    const errors=[],failures=[];
    page.on('pageerror',e=>errors.push(e.message.slice(0,250)));
    page.on('requestfailed',r=>failures.push(r.url().slice(0,140)+' '+r.failure()?.errorText));
    await page.exposeFunction('__writeSupercarRecording',async(id,base64)=>{
        if(!CARS.some(car=>car.id===id))throw Error('Unexpected car file.');
        fs.writeFileSync(path.join(ROOT,id+'.webm'),Buffer.from(base64,'base64'));
        return true;
    });
    const result={url:URL,cars:[],pageErrors:errors,requestFailures:failures};
    try{
        console.log('DRIVING_VISUAL_TEST_URL',URL);
        await page.goto(URL,{waitUntil:'domcontentloaded',timeout:70000});
        await page.waitForFunction(()=>{
            const status=globalThis.urbanSupercarsStatus;
            const ed=globalThis.sceneEditor;
            return (status && ed && !ed.active && globalThis.world?.vehicles?.filter(v=>v.userData.importedCar).length>=3)
                || /Errore di avvio/.test(document.querySelector('#city-load-message')?.textContent||'');
        },null,{timeout:470000});
        const startup=await page.evaluate(()=>{
            const w=globalThis.world,ed=globalThis.sceneEditor;
            return {supercars:globalThis.urbanSupercarsStatus,
                names:ed?.items?.filter(i=>i.name.startsWith('Sketchfab · ')).map(i=>i.name),
                spawned:w?.vehicles?.filter(v=>v.userData.importedCar).length,
                visual:w?.levelRuntime?.visualProgress,
                loading:document.querySelector('#city-load-message')?.textContent};
        });
        console.log('DRIVING_STARTUP',JSON.stringify(startup));
        if(startup.spawned!==3||startup.supercars?.errors?.length||startup.names?.length!==3)
            throw Error('The three licensed cars are not loaded before recording.');

        for(const car of CARS) {
            console.log('RECORDING_START',car.id,car.name);
            // Stop old controller safely, then enter the requested car using the real E handler.
            const enter=await page.evaluate(id=>{
                const w=globalThis.world,ed=globalThis.sceneEditor,player=w.editorPlayer;
                const item=ed.items.find(i=>i.name.startsWith('Sketchfab · ') &&
                    i.name.toLowerCase().includes(id==='lamborghini'?'lamborghini':id));
                if(!item)throw Error('Missing imported model for '+id);
                const target=w.vehicles.find(v=>v.userData.importedCar===item.assetId);
                if(!target)throw Error('No matching car physics body for '+id);
                const occupied=player.controlledObject;
                if(occupied){
                    occupied.triggerAction?.('throttle',false);
                    occupied.triggerAction?.('left',false);
                    occupied.triggerAction?.('right',false);
                    occupied.forceCharacterOut?.();
                }
                player.stopControllingVehicle?.();
                player.leaveSeat?.();
                player.setPosition(target.position.x+0.7,target.position.y,target.position.z);
                player.position.set(target.position.x+0.7,target.position.y,target.position.z);
                document.dispatchEvent(new KeyboardEvent('keydown',
                    {code:'KeyE',key:'e',bubbles:true,cancelable:true}));
                if(player.controlledObject!==target)
                    player.teleportToVehicle(target,target.seats.find(s=>s.type==='driver')||target.seats[0]);
                player.takeControl();
                w.cameraOperator.theta=180;
                w.cameraOperator.phi=15;
                w.renderer.domElement.focus();
                return {uid:item.assetId,occupied:target.seats.some(s=>s.occupiedBy===player),
                    control:player.controlledObject===target,seats:target.seats.length,
                    physics:!!target.rayCastVehicle,engine:!!target.actions?.throttle,
                    before:target.collision.position.toArray?.()||[target.position.x,target.position.y,target.position.z],
                    startSpeed:target.speed,startWheels:target.rayCastVehicle.numWheelsOnGround};
            },car.id);
            console.log('RECORDING_ENTER',car.id,JSON.stringify(enter));
            if(!enter.control||!enter.occupied||!enter.physics||!enter.engine)
                throw Error(car.id+' was not entered as driveable vehicle.');
            // A real viewport capture: no static photos, no synthetic 3D animation.
            await page.waitForTimeout(800);
            const png=path.join(ROOT,car.id+'.png');
            await page.evaluate(id=>{
                const w=globalThis.world,ed=globalThis.sceneEditor;
                const item=ed.items.find(i=>i.name.startsWith('Sketchfab · ') &&
                    i.name.toLowerCase().includes(id));
                const target=w.vehicles.find(v=>v.userData.importedCar===item.assetId);
                target.triggerAction('throttle',true);
                w.renderer.domElement.focus();
            },car.id);
            await page.keyboard.down('w');
            // The headless WebGL canvas is not capturable with MediaRecorder
            // (zero frames). Render to its real default buffer and read actual
            // pixels immediately, then encode them into an MP4 in ffmpeg.
            const footage=await page.evaluate(async(duration)=>{
                const w=globalThis.world, renderer=w.renderer,gl=renderer.getContext();
                const width=gl.drawingBufferWidth,height=gl.drawingBufferHeight;
                if(!width||!height)throw Error('WebGL default framebuffer unavailable');
                const canvas=document.createElement('canvas');
                canvas.width=width; canvas.height=height;
                const ctx=canvas.getContext('2d',{willReadFrequently:true});
                const image=ctx.createImageData(width,height);
                const pixel=new Uint8Array(width*height*4);
                const frames=[],started=performance.now();
                while(performance.now()-started<duration){
                    renderer.setRenderTarget(null);
                    renderer.render(w.graphicsWorld,w.camera);
                    gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
                    const error=gl.getError();
                    if(error!==gl.NO_ERROR)throw Error('WebGL readPixels error '+error);
                    for(let y=0;y<height;y++)
                        image.data.set(pixel.subarray((height-y-1)*width*4,
                            (height-y)*width*4),y*width*4);
                    ctx.putImageData(image,0,0);
                    frames.push(canvas.toDataURL('image/jpeg',0.74).split(',')[1]);
                    await new Promise(resolve=>setTimeout(resolve,160));
                }
                return {frames,width,height,elapsed:performance.now()-started};
            },DURATION_MS);
            await page.keyboard.up('w');
            const motion=await page.evaluate(id=>{
                const w=globalThis.world,ed=globalThis.sceneEditor;
                const item=ed.items.find(i=>i.name.startsWith('Sketchfab · ') &&
                    i.name.toLowerCase().includes(id));
                const target=w.vehicles.find(v=>v.userData.importedCar===item.assetId);
                target.triggerAction('throttle',false);
                target.triggerAction('brake',true);
                return {
                    end:[target.collision.position.x,target.collision.position.y,target.collision.position.z],
                    speed:target.speed,physicsVelocity:target.collision.velocity.length(),
                    groundedWheels:target.rayCastVehicle.numWheelsOnGround,
                    occupied:target.seats.some(seat=>seat.occupiedBy===w.editorPlayer)
                };
            },car.id);
            console.log('ACTUAL_WEBGL_FRAMES',car.id,footage.frames.length,
                'resolution',footage.width+'x'+footage.height,
                'elapsed_ms',footage.elapsed);
            if(footage.frames.length<4)throw Error('Too few actual WebGL frames for '+car.id);
            const framesDir=path.join(ROOT,car.id+'-frames');
            fs.mkdirSync(framesDir,{recursive:true});
            const hashes=new Set();
            for(const [i,data] of footage.frames.entries()){
                const bytes=Buffer.from(data,'base64');
                fs.writeFileSync(path.join(framesDir,'frame_'+String(i).padStart(4,'0')+'.jpg'),bytes);
                hashes.add(require('node:crypto').createHash('sha256').update(bytes).digest('hex'));
            }
            if(hashes.size<3)throw Error('WebGL rendered too few distinct frames for '+car.id);
            const frameRate=footage.frames.length/(footage.elapsed/1000);
            runBin('ffmpeg',['-hide_banner','-loglevel','error','-y',
                '-framerate',String(frameRate),'-start_number','0',
                '-i',path.join(framesDir,'frame_%04d.jpg'),
                '-an','-c:v','libx264','-preset','veryfast','-crf','23',
                '-pix_fmt','yuv420p','-r','24','-movflags','+faststart',
                path.join(ROOT,car.id+'.mp4')]);
            const target=path.join(ROOT,car.id+'.mp4');
            const duration=Number(runBin('ffprobe',['-v','error','-show_entries','format=duration',
                '-of','default=noprint_wrappers=1:nokey=1',target]));
            if(!Number.isFinite(duration)||duration<3)
                throw Error(car.id+' video duration was too short: '+duration);
            const encoded={filename:car.id+'.mp4',duration,
                bytes:fs.statSync(target).size,frames:footage.frames.length};
            const center=path.join(framesDir,'frame_'+
                String(Math.floor(footage.frames.length/2)).padStart(4,'0')+'.jpg');
            runBin('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',center,
                '-frames:v','1',png]);
            validatePhoto(png);
            console.log('REAL_DRIVING_VIDEO',car.id,JSON.stringify(encoded));
            const start=enter.before,end=motion.end;
            const distance=Math.hypot(start[0]-end[0],start[2]-end[2]);
            console.log('RECORDING_DRIVE',car.id,JSON.stringify({distance,motion,encoded}));
            if(!motion.occupied || distance<0.5)
                throw Error(car.id+' engine did not move vehicle (distance '+distance+' m).');
            result.cars.push({id:car.id,name:car.name,driveDistanceMeters:distance,
                start,finish:end,photo:car.id+'.png',video:encoded.filename,durationSeconds:encoded.duration});
            await page.evaluate(id=>{
                const w=globalThis.world,ed=globalThis.sceneEditor;
                const item=ed.items.find(i=>i.name.startsWith('Sketchfab · ') &&
                    i.name.toLowerCase().includes(id==='lamborghini'?'lamborghini':id));
                const v=w.vehicles.find(car=>car.userData.importedCar===item.assetId);
                v.triggerAction('brake',false);
            },car.id);
        }
        result.ok=true;
        // Compose a contact sheet from genuine recorded game frames.
        const overview=path.join(ROOT,'urban-photoreal-overview.png');
        runBin('ffmpeg',['-hide_banner','-loglevel','error','-y',
            '-i',path.join(ROOT,'bmw.png'),'-i',path.join(ROOT,'ferrari.png'),
            '-i',path.join(ROOT,'lamborghini.png'),
            '-filter_complex','[0:v]scale=640:360[a];[1:v]scale=640:360[b];[2:v]scale=640:360[c];[a][b][c]hstack=inputs=3',
            '-frames:v','1',overview]);
        validatePhoto(overview);
        fs.writeFileSync(path.join(ROOT,'results.json'),JSON.stringify(result,null,2));
        console.log('ALL_THREE_REAL_VEHICLE_VIDEOS_PASS',JSON.stringify(result.cars));
    }catch(error){
        result.ok=false;result.error=error.message;
        fs.writeFileSync(path.join(ROOT,'results.json'),JSON.stringify(result,null,2));
        console.error('RECORDING_FAILED',error.message);
        console.error('PAGE_ERRORS',JSON.stringify(errors.slice(-20)));
        console.error('FAILED_REQUESTS',JSON.stringify(failures.slice(-20)));
        try{await page.screenshot({path:path.join(ROOT,'failure.png'),timeout:9000});}catch{}
        await browser.close();
        process.exit(1);
    }
    await browser.close();
})().catch(err=>{console.error(err);process.exit(1);});
