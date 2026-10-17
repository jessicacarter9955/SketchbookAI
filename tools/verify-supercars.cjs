'use strict';
const fs=require('fs');
const {chromium}=require('playwright');
(async()=>{
    const browser=await chromium.launch({headless:true,args:[
        '--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--no-sandbox','--disable-dev-shm-usage']});
    const page=await browser.newPage({viewport:{width:1280,height:850},deviceScaleFactor:1});
    const errors=[],failed=[];
    page.on('pageerror',e=>errors.push(e.message.slice(0,230)));
    page.on('requestfailed',req=>failed.push(req.url().slice(0,170)+' '+req.failure()?.errorText));
    const target='https://my-test-site3.netlify.app/editor.html?scene=sandbox&play=1';
    console.log('Browser test:',target);
    fs.mkdirSync('artifacts/supercars',{recursive:true});
    try {
        await page.goto(target,{waitUntil:'domcontentloaded',timeout:65000});
        await page.waitForFunction(()=>Boolean(globalThis.supercarsStatus) ||
            /Impossibile avviare la scena/.test(document.querySelector('#loading-screen')?.textContent||''),
            null,{timeout:140000});
        const loadState=await page.evaluate(()=>({loading:document.querySelector('#loading-screen')?.innerText?.slice(0,600),
            status:globalThis.supercarsStatus,active:!!globalThis.sceneEditor}));
        console.log('Loading status:',JSON.stringify(loadState));
        await page.waitForTimeout(2500);
        const data=await page.evaluate(()=>{
            const ed=globalThis.sceneEditor,world=globalThis.world;
            const names=ed?.items?.filter(x=>x.name?.startsWith('Sketchfab · ')).map(x=>({name:x.name,prefab:x.prefab,assetId:x.assetId,position:x.position}))||[];
            const actors=world?.vehicles?.filter(x=>x.userData?.editorActor).map(x=>({
                isCar:x.constructor?.name,position:x.position.toArray(),seats:x.seats?.length,
                branded:!!x.children?.some(c=>c.userData?.sketchfabBody),
                rig:x.userData.rigStatus||null,
                wheels:x.rayCastVehicle?.wheelInfos.map(w=>({
                    radius:w.radius,contact:w.isInContact,rotation:w.rotation,
                    height:w.worldTransform?.position?.y,
                    suspension:w.suspensionLength
                })),
                floor:x.userData.spawnGround,rideHeight:x.userData.chassisRideHeight
            }))||[];
            return {ready:!!ed,status:globalThis.supercarsStatus,names,actors,player:world?.editorPlayer?.position?.toArray(),
                playing:!!ed&&!ed.active,worldReady:world?.levelRuntime?.ready,
                message:ed?.root?.querySelector('[data-status]')?.textContent||''};
        });
        console.log('Result:',JSON.stringify(data));
        const nodeNames=await page.evaluate(()=>{
            const editor=globalThis.sceneEditor;
            return (editor?.items||[]).filter(x=>x.name.startsWith('Sketchfab · ')).map(item=>{
                const template=editor.templates.get(item.assetId),matches=[];
                template?.traverse(o=>{if(/wheel|plane08|object_3[789]|object_40/i.test(o.name))matches.push(o.name);});
                return {model:item.name,matchingNodes:matches.slice(0,55)};
            });
        });
        console.log('GLTFLoader wheel node names:',JSON.stringify(nodeNames));
        console.log('Page errors:',JSON.stringify(errors.slice(0,12)));
        console.log('Failed requests:',JSON.stringify(failed.slice(0,15)));
        await page.screenshot({path:'artifacts/supercars/sketchfab-three-cars.png',fullPage:true});
        if(data.names.length!==3 || data.actors.filter(x=>x.branded&&x.seats>0).length!==3 || !data.playing)
            throw Error('3 real licensed assets must be visible as drivable cars in browser.');
        if(data.actors.some(car=>car.rig?.ready!==true||car.rig.wheelCount!==4))
            throw Error('Not all branded cars have four independent wheel rig pivots.');
        if(data.actors.some(car=>car.wheels.some(w=>Math.abs(w.height-w.radius-car.floor)>0.085)))
            throw Error('A tire contact patch is clipping through or floating above the floor.');
        const entered=await page.evaluate(()=>{
            const world=globalThis.world,player=world.editorPlayer;
            const car=world.vehicles.find(x=>x.userData.editorActor&&x.children.some(c=>c.userData.sketchfabBody));
            player.teleportToVehicle(car,car.seats[0]);
            player.takeControl();
            return {occupied:car.seats[0].occupiedBy===player,control:player.controlledObject===car,
                throttle:!!car.actions?.throttle,engine:!!car.rayCastVehicle};
        });
        console.log('Vehicle driving:',JSON.stringify(entered));
        const before=await page.evaluate(()=>{
            const car=globalThis.world.editorPlayer.controlledObject;
            const initial=car.rayCastVehicle.wheelInfos.map(w=>w.rotation);
            car.userData.testInitialSpin=initial;
            car.triggerAction('throttle',true);
            car.triggerAction('right',true);
            return initial;
        });
        await page.waitForTimeout(1900);
        const animated=await page.evaluate(()=>{
            const car=globalThis.world.editorPlayer.controlledObject;
            const spins=car.rayCastVehicle.wheelInfos.map(w=>w.rotation);
            const steering=car.rayCastVehicle.wheelInfos.map(w=>w.steering);
            car.triggerAction('throttle',false);
            car.triggerAction('right',false);
            return {spins,steering,moved:car.collision.velocity.length(),rigs:car.userData.sketchfabWheelRig?.length};
        });
        console.log('Wheel spin and steering physics:',JSON.stringify({before,animated}));
        if(animated.rigs!==4 || !animated.spins.some((v,i)=>Math.abs(v-before[i])>0.05) ||
           !animated.steering.some(v=>Math.abs(v)>0.01))
            throw Error('Driving physics did not animate the real wheel spin and steering transforms.');
        const physics=await page.evaluate(()=>{
            const actor=globalThis.world.vehicles.find(x=>x.userData.rigStatus?.ready);
            return actor?{name:actor.userData.rigStatus?.source,
                wheeling:actor.userData.sketchfabWheelRig?.map(w=>({index:w.index,pos:w.pivot.position.toArray(),q:w.pivot.quaternion.toArray()})),
                wheels:actor.rayCastVehicle.wheelInfos.map(w=>({contact:w.isInContact,spin:w.rotation,suspension:w.suspensionLength,radius:w.radius,
                    centerY:w.worldTransform.position.y})),ground:actor.userData.spawnGround,chassis:actor.position.y
            }:null;
        });
        console.log('Rig details:',JSON.stringify(physics));
        if(!entered.occupied || !entered.control || !entered.throttle || !entered.engine)
            throw Error('Car seat driving controls not connected.');
        console.log('PASS: 3 Sketchfab branded cars and real driveable seat/controls.');
        await page.evaluate(()=>{
            const editor=globalThis.sceneEditor,world=globalThis.world;
            editor.setActive(true);
            const center=globalThis.supercarsStatus?.imported?.length ? editor.items.filter(x=>x.name.startsWith('Sketchfab · ')) : [];
            if(center.length) {
                const x=center.reduce((n,i)=>n+i.position[0],0)/center.length;
                const y=center.reduce((n,i)=>n+i.position[1],0)/center.length+1.1;
                const z=center.reduce((n,i)=>n+i.position[2],0)/center.length;
                editor.orbit.target.set(x,y,z);
                world.camera.position.set(x+15,y+11,z+17);
                editor.orbit.update();
            }
        });
        await page.waitForTimeout(1600);
        await page.screenshot({path:'artifacts/supercars/sketchfab-supercars-overview.png',fullPage:true});
    }catch(e){
        try {await page.screenshot({path:'artifacts/supercars/supercars-failure.png',fullPage:true});}catch{}
        console.error('Browser test failed:',e.message);
        console.error('Browser page errors:',JSON.stringify(errors.slice(0,20)));
        console.error('Browser failed requests:',JSON.stringify(failed.slice(0,20)));
        try {
            console.error('Browser DOM diagnostic:',JSON.stringify(await page.evaluate(()=>({
                title:document.title,loading:document.querySelector('#loading-screen')?.innerText?.slice(0,1100),
                status:globalThis.supercarsStatus,hasWorld:!!globalThis.world,
                hasEditor:!!globalThis.sceneEditor,body:document.body.innerText.slice(0,700)
            }))));
        }catch{}
        await browser.close();
        process.exit(1);
    }
    await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
