'use strict';
const {chromium,devices}=require('playwright');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true,args:[
   '--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-webgl'
 ]});
 const ctx=await browser.newContext({...devices['Pixel 7'],viewport:{width:412,height:915}});
 const page=await ctx.newPage(),errs=[];
 page.on('pageerror',e=>errs.push(e.message));
 fs.mkdirSync('artifacts/mobile-city',{recursive:true});
 const url=process.env.MOBILE_URL || 'https://my-test-site3.netlify.app/mobile.html';
 console.log('MOBILE_TEST_URL',url);
 try{
   await page.goto(url,{waitUntil:'domcontentloaded',timeout:90000});
   await page.waitForFunction(()=>Boolean(document.querySelector('.mobile-city-controls'))||
      /Errore di avvio:/.test(document.querySelector('#city-load-message')?.textContent||''),
      null,{timeout:275000});
   const state=await page.evaluate(()=>{
      const el=s=>document.querySelector(s);
      const style=s=>{const x=el(s);return x?getComputedStyle(x).display:'missing';};
      return {mobile:document.body.classList.contains('mobile-city-player'),
       loading:style('#loading-screen'),toolbar:style('.editor-toolbar'),
       hud:style('.city-hud'),player:!!globalThis.world?.editorPlayer,
       drivingControls:!!el('.mobile-city-joystick'),
       interaction:!!el('[data-mobile-car]'),
       carCount:globalThis.world?.vehicles?.filter(c=>c.userData?.importedCar).length,
       assetsCollapsed:style('.mobile-city-asset-search'),
       cars:globalThis.urbanSupercarsStatus
      };
   });
   console.log('MOBILE_CHECK',JSON.stringify(state));
   if(!state.mobile||state.toolbar!=='none'||state.hud!=='none'||
      !state.drivingControls||!state.interaction||state.carCount!==3||
      state.assetsCollapsed!=='none')throw Error('Mobile overlay did not show real photoreal cars and controls');
   await page.locator('[data-mobile-assets]').click();
   if(!(await page.locator('.mobile-city-asset-search').isVisible()))throw Error('3D asset toggle did not expand');
   await page.locator('[data-mobile-assets]').click();
   const carTest=await page.evaluate(()=>{
      const w=globalThis.world,p=w.editorPlayer;
      const car=w.vehicles.find(v=>v.userData?.importedCar);
      p.position.set(car.position.x+0.9,car.position.y,car.position.z);
      return {found:!!car};
   });
   await page.waitForTimeout(450);
   await page.locator('[data-mobile-car]').click();
   const entered=await page.evaluate(()=>({
      inCar:!!globalThis.world.editorPlayer.controlledObject,
      carAction:!!globalThis.world.editorPlayer.controlledObject?.actions?.throttle
   }));
   const joy=await page.locator('.mobile-city-joystick').boundingBox();
   await page.mouse.move(joy.x+joy.width/2,joy.y+joy.height/2);
   await page.mouse.down();
   await page.mouse.move(joy.x+joy.width/2,joy.y+joy.height*.18,{steps:3});
   const accelerated=await page.evaluate(()=>globalThis.world.editorPlayer.controlledObject?.actions?.throttle.isPressed);
   await page.mouse.up();
   const released=await page.evaluate(()=>globalThis.world.editorPlayer.controlledObject?.actions?.throttle.isPressed);
   await page.locator('[data-mobile-car]').click();
   const exited=await page.evaluate(()=>!globalThis.world.editorPlayer.controlledObject);
   console.log('MOBILE_DRIVE_INTERACTION',JSON.stringify({carTest,entered,accelerated,released,exited,errors:errs.slice(0,5)}));
   await page.screenshot({path:'artifacts/mobile-city/photoreal-mobile-joystick.png',timeout:18000,fullPage:false}).catch(e=>console.warn('Optional mobile screenshot',e.message));
   if(!entered.inCar||!entered.carAction||!accelerated||released||!exited)throw Error('Touch E enter/exit or joystick acceleration failed');
   console.log('MOBILE_PLAYABLE_PASS: fullscreen, joystick acceleration, E entry/exit, 3 original supercars');
 }catch(e){
   console.error('MOBILE_PLAYABLE_FAILURE',e.message);
   console.error('MOBILE_ERRORS',JSON.stringify(errs.slice(-12)));
   const d=await page.evaluate(()=>({
     mobile:document.body.className,
     status:globalThis.urbanSupercarsStatus,
     loading:document.querySelector('#city-load-message')?.textContent,
     scene:!!globalThis.sceneEditor
   })).catch(()=>({}));
   console.error('MOBILE_DIAGNOSTICS',JSON.stringify(d));
   await browser.close();process.exit(1);
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
