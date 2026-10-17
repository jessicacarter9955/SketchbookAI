'use strict';
// Real Android-style Chromium viewport and touch UI against released photoreal build.
const {chromium}=require('playwright');
(async()=>{
 const base=process.env.MOBILE_URL||'https://6ad3120297717e49ea613fd6--my-test-site3.netlify.app';
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-webgl']});
 const page=await browser.newPage({viewport:{width:412,height:915},deviceScaleFactor:1,
   isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message.slice(0,160)));
 try{
  await page.goto(base+'/mobile.html',{waitUntil:'domcontentloaded',timeout:70000});
  await page.waitForFunction(()=>document.body.classList.contains('mobile-city-player') ||
     /Errore di avvio:/.test(document.querySelector('#city-load-message')?.textContent||''),null,{timeout:330000});
  const boot=await page.evaluate(()=>{
   const body=document.body,world=globalThis.world;
   const $=q=>document.querySelector(q);
   const visible=el=>el && getComputedStyle(el).display!=='none';
   return {mobile:body.classList.contains('mobile-city-player'),playing:body.classList.contains('playing'),
     joystick:visible($('.mobile-city-joystick')),carButton:visible($('[data-mobile-car]')),
     desktopToolbar:visible($('.editor-toolbar')),topGarage:visible($('.urban-marketplace-garage')),
     extraBar:visible($('.mobile-city-asset-search')),models:globalThis.urbanSupercarsStatus,
     loaded:world?.levelRuntime?.visualProgress,carCount:world?.vehicles?.filter(v=>v.userData.importedCar).length,
     err:$('#city-load-message')?.textContent,errors:[]};
  });
  console.log('MOBILE_BOOT',JSON.stringify(boot));
  if(!boot.mobile||!boot.playing||!boot.joystick||!boot.carButton||boot.desktopToolbar||boot.topGarage||boot.extraBar||boot.carCount!==3)
    throw Error('Mobile HUD blocked or HD supercars missing');
  const joy=await page.locator('.mobile-city-joystick').boundingBox();
  await page.mouse.move(joy.x+joy.width/2,joy.y+joy.height/2);
  await page.mouse.down();await page.mouse.move(joy.x+joy.width/2,joy.y+joy.height*.10,{steps:4});
  const foot=await page.evaluate(()=>globalThis.world.editorPlayer?.actions.up.isPressed);
  await page.mouse.up();
  console.log('MOBILE_JOYSTICK_ON_FOOT',foot);
  if(!foot)throw Error('Joystick did not trigger walking');
  await page.evaluate(()=>{
    const w=globalThis.world,p=w.editorPlayer;
    const car=w.vehicles.find(v=>v.userData.importedCar);
    p.setPosition(car.position.x+.8,car.position.y,car.position.z);
    p.position.set(car.position.x+.8,car.position.y,car.position.z);
  });
  await page.waitForTimeout(450);
  await page.locator('[data-mobile-car]').click({timeout:15000});
  const entered=await page.evaluate(()=>Boolean(globalThis.world.editorPlayer?.controlledObject));
  if(!entered)throw Error('Touch E button did not enter car');
  const joy2=await page.locator('.mobile-city-joystick').boundingBox();
  await page.mouse.move(joy2.x+joy2.width/2,joy2.y+joy2.height/2);
  await page.mouse.down();await page.mouse.move(joy2.x+joy2.width/2,joy2.y+joy2.height*.10,{steps:4});
  const accelerate=await page.evaluate(()=>Boolean(globalThis.world.editorPlayer?.controlledObject?.actions.throttle?.isPressed));
  await page.mouse.up();
  console.log('MOBILE_ENTER_AND_THROTTLE',JSON.stringify({entered,accelerate}));
  if(!accelerate)throw Error('Joystick does not accelerate driving physics car');
  await page.locator('[data-mobile-brake]').dispatchEvent('pointerdown',{pointerId:88,clientX:1,clientY:1});
  const brakes=await page.evaluate(()=>Boolean(globalThis.world.editorPlayer?.controlledObject?.actions.brake?.isPressed));
  await page.locator('[data-mobile-brake]').dispatchEvent('pointerup',{pointerId:88,clientX:1,clientY:1});
  console.log('MOBILE_BRAKE',brakes);
  if(!brakes)throw Error('Brake did not activate');
  await page.locator('[data-mobile-car]').click({timeout:15000});
  const exited=await page.evaluate(()=>!globalThis.world.editorPlayer?.controlledObject);
  console.log('MOBILE_EXIT',exited);
  if(!exited)throw Error('Touch E button did not exit car');
  console.log('PASS_MOBILE_PHOTOREAL',{base,errors});
 }catch(e){
  console.error('MOBILE_SMOKE_FAILED',e.message,errors);
  const data=await page.evaluate(()=>({status:globalThis.urbanSupercarsStatus,loading:document.querySelector('#city-load-message')?.textContent,mobile:document.body.className})).catch(()=>({}));
  console.error('MOBILE_DIAGNOSTIC',JSON.stringify(data));
  await browser.close();process.exit(1);
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
