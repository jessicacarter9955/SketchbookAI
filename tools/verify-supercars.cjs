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
                branded:!!x.children?.some(c=>c.userData?.sketchfabBody)
            }))||[];
            return {ready:!!ed,status:globalThis.supercarsStatus,names,actors,player:world?.editorPlayer?.position?.toArray(),
                playing:!!ed&&!ed.active,worldReady:world?.levelRuntime?.ready,
                message:ed?.root?.querySelector('[data-status]')?.textContent||''};
        });
        console.log('Result:',JSON.stringify(data));
        console.log('Page errors:',JSON.stringify(errors.slice(0,12)));
        console.log('Failed requests:',JSON.stringify(failed.slice(0,15)));
        await page.screenshot({path:'artifacts/supercars/sketchfab-three-cars.png',fullPage:true});
        if(data.names.length!==3 || data.actors.filter(x=>x.branded&&x.seats>0).length!==3 || !data.playing)
            throw Error('3 real licensed assets must be visible as drivable cars in browser.');
        const entered=await page.evaluate(()=>{
            const world=globalThis.world,player=world.editorPlayer;
            const car=world.vehicles.find(x=>x.userData.editorActor&&x.children.some(c=>c.userData.sketchfabBody));
            player.teleportToVehicle(car,car.seats[0]);
            player.takeControl();
            return {occupied:car.seats[0].occupiedBy===player,control:player.controlledObject===car,
                throttle:!!car.actions?.throttle,engine:!!car.rayCastVehicle};
        });
        console.log('Vehicle driving:',JSON.stringify(entered));
        if(!entered.occupied || !entered.control || !entered.throttle || !entered.engine)
            throw Error('Car seat driving controls not connected.');
        console.log('PASS: 3 Sketchfab branded cars and real driveable seat/controls.');
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
