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
        },null,{timeout:260000});
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
        // Render an overview with all three original model meshes.
        const overview=path.join(ROOT,'urban-photoreal-overview.png');
        await page.screenshot({path:overview,timeout:25000});
        validatePhoto(overview);

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
            await page.screenshot({path:png,timeout:30000});
            validatePhoto(png);
            const capture=await page.evaluate(()=>{
                const canvas=globalThis.world?.renderer?.domElement;
                if(!canvas || !canvas.captureStream)throw Error('WebGL canvas captureStream unavailable');
                const mime=['video/webm;codecs=vp8','video/webm;codecs=vp9','video/webm']
                    .find(m=>MediaRecorder.isTypeSupported(m));
                if(!mime)throw Error('MediaRecorder WebM encoder unavailable');
                const stream=canvas.captureStream(18);
                if(!stream.getVideoTracks().length)throw Error('Canvas did not provide video track');
                const blobs=[];
                const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:1600000});
                recorder.ondataavailable=e=>{if(e.data.size)blobs.push(e.data);};
                const finished=new Promise((resolve,reject)=>{
                    recorder.onerror=e=>reject(Error('Video recorder: '+e.error?.message));
                    recorder.onstop=async()=>{
                        try{
                            const blob=new Blob(blobs,{type:mime});
                            if(blob.size<5000)throw Error('Recorded video empty');
                            const reader=new FileReader();
                            reader.onload=()=>resolve(reader.result.split(',')[1]);
                            reader.onerror=()=>reject(Error('Cannot read video'));
                            reader.readAsDataURL(blob);
                        }catch(e){reject(e);}
                    };
                });
                recorder.start(800);
                globalThis.__urbanRecording={recorder,finished,stream};
                return {mime,width:canvas.width,height:canvas.height};
            });
            console.log('CANVAS_CAPTURE',car.id,JSON.stringify(capture));
            await page.evaluate(id=>{
                const w=globalThis.world,ed=globalThis.sceneEditor;
                const item=ed.items.find(i=>i.name.startsWith('Sketchfab · ') &&
                    i.name.toLowerCase().includes(id==='lamborghini'?'lamborghini':id));
                const target=w.vehicles.find(v=>v.userData.importedCar===item.assetId);
                // Inject throttle into Sketchbook's actual drive input, never
                // animate transforms directly or replace the Cannon engine.
                target.triggerAction('throttle',true);
                w.renderer.domElement.focus();
            },car.id);
            await page.keyboard.down('w');
            await page.waitForTimeout(DURATION_MS);
            await page.keyboard.up('w');
            const motion=await page.evaluate(id=>{
                const w=globalThis.world,ed=globalThis.sceneEditor;
                const item=ed.items.find(i=>i.name.startsWith('Sketchfab · ') &&
                    i.name.toLowerCase().includes(id==='lamborghini'?'lamborghini':id));
                const target=w.vehicles.find(v=>v.userData.importedCar===item.assetId);
                target.triggerAction('throttle',false);
                target.triggerAction('brake',true);
                const result={end:[target.collision.position.x,target.collision.position.y,target.collision.position.z],
                    speed:target.speed,physicsVelocity:target.collision.velocity.length(),
                    groundedWheels:target.rayCastVehicle.numWheelsOnGround,
                    occupied:target.seats.some(seat=>seat.occupiedBy===w.editorPlayer)};
                return result;
            },car.id);
            const b64=await page.evaluate(async()=>{
                const r=globalThis.__urbanRecording;
                r.recorder.stop();
                const result=await r.finished;
                r.stream.getTracks().forEach(t=>t.stop());
                delete globalThis.__urbanRecording;
                return result;
            });
            fs.writeFileSync(path.join(ROOT,car.id+'.webm'),Buffer.from(b64,'base64'));
            const encoded=convertVideo(car.id);
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
