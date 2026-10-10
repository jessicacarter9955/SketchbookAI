import {chromium} from 'playwright';
import fs from 'node:fs/promises';
const out=process.env.URBAN_ARTIFACTS||'artifacts';
const base=process.env.URBAN_URL||'http://127.0.0.1:8401';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--single-process','--no-zygote']});
async function writeDataUrl(path,dataUrl){
  const match=/^data:image\/png;base64,(.+)$/.exec(dataUrl||'');
  if(!match)throw new Error('Invalid screenshot: '+path);
  const bytes=Buffer.from(match[1],'base64');
  if(bytes.length<20000)throw new Error('Blank screenshot: '+path);
  await fs.writeFile(path,bytes);return bytes.length;
}
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
try{
  await page.goto(`${base}/editor.html?scene=urban-photoreal&play=1`,{waitUntil:'domcontentloaded'});
  try{await page.waitForFunction(()=>globalThis.sceneEditor?.active===false&&globalThis.world?.levelRuntime?.visualState?.status==='ready'&&globalThis.world?.actorLayer?.urbanPopulation?.pedestrians?.length>0&&globalThis.world?.editorPlayer&&globalThis.world?.urbanDialogue,null,{timeout:230000,polling:400});}
  catch(error){
    const state=await page.evaluate(()=>({loading:document.querySelector('#loading-screen')?.textContent,visual:globalThis.world?.levelRuntime?.visualState,player:!!globalThis.world?.editorPlayer,editor:!!globalThis.sceneEditor,dialogue:!!globalThis.world?.urbanDialogue}));
    await fs.writeFile(`${out}/dialogue-startup-errors.json`,JSON.stringify({state,errors},null,2));throw error;
  }
  const setup=await page.evaluate(()=>{
    const world=globalThis.world,system=world.urbanDialogue,pop=world.actorLayer?.urbanPopulation;
    if(!system||!pop?.pedestrians?.length)throw new Error('RPG dialogue runtime missing');
    const npc=pop.conversations[0]?.members[0]||pop.pedestrians[0];
    const other=pop.conversations[0]?.members[1];
    const point=npc.object.position;
    const candidate={x:point.x+.3,z:point.z-2.5};
    const y=world.levelRuntime.groundAt(candidate.x,candidate.z)+1.2;
    world.editorPlayer.setPosition(candidate.x,y,candidate.z);
    world.editorPlayer.position.set(candidate.x,y,candidate.z);
    world.editorPlayer.resetVelocity();
    return {npcPosition:point.toArray(),playerPosition:world.editorPlayer.position.toArray(),partnerPosition:other?.object.position.toArray()||null};
  });
  await page.keyboard.press('e');
  const first=await page.evaluate(()=>{
    const d=globalThis.world.urbanDialogue;
    if(!d.active||d.node!=='intro'||d.choices.length!==4)
      throw new Error('RPG dialogue E interaction did not start: '+JSON.stringify({active:d.active,node:d.node}));
    for(let i=0;i<20;i++)d.frameCamera();
    return {active:d.active,node:d.node,choices:d.choices.length};
  });

  async function captureDialogue(name){
    const shot=await page.evaluate(()=>{
      const world=globalThis.world,d=world.urbanDialogue;
      d.frameCamera();world.composer.render();
      const frame=world.renderer.domElement;
      const canvas=document.createElement('canvas');canvas.width=frame.width;canvas.height=frame.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(frame,0,0);
      // UI text is read directly from the active interactive DOM; composing on
      // canvas avoids unreliable headless Chromium compositor screenshots.
      const scale=canvas.width/1440,w=canvas.width,h=canvas.height;
      const r=(x)=>x*scale;
      const x=r(75),y=h-r(245),bw=w-r(150),bh=r(210);
      ctx.fillStyle='rgba(10,18,31,.87)';ctx.fillRect(x,y,bw,bh);
      ctx.strokeStyle='#668ba7';ctx.lineWidth=r(2);ctx.strokeRect(x,y,bw,bh);
      ctx.fillStyle='#314f67';ctx.fillRect(x+r(20),y-r(22),r(235),r(43));
      ctx.font=`bold ${r(21)}px sans-serif`;ctx.fillStyle='#fff';
      ctx.fillText(d.root.querySelector('.urban-rpg-name').textContent,x+r(35),y+r(7));
      const line=d.root.querySelector('.urban-rpg-line').textContent;
      ctx.font=`${r(23)}px sans-serif`;
      const wrap=(text,maxWidth)=>{
        const words=text.split(' '),lines=[];let line='';
        for(const word of words){const next=line?line+' '+word:word;if(ctx.measureText(next).width>maxWidth&&line){lines.push(line);line=word;}else line=next;}
        lines.push(line);return lines;
      };
      wrap(line,r(680)).forEach((l,i)=>ctx.fillText(l,x+r(35),y+r(92+i*35)));
      const choices=[...d.root.querySelectorAll('.urban-rpg-choice')];
      choices.forEach((el,i)=>{
        const bx=x+r(765),by=y+r(27+i*42),cw=bw-r(797);
        ctx.fillStyle=i===d.selected?'rgba(37,95,139,.95)':'rgba(16,29,43,.93)';
        ctx.fillRect(bx,by,cw,r(35));
        ctx.strokeStyle=i===d.selected?'#6ed1ff':'#62778b';ctx.lineWidth=r(2);ctx.strokeRect(bx,by,cw,r(35));
        ctx.font=`${r(17)}px sans-serif`;ctx.fillStyle='#fff';ctx.fillText(el.textContent,bx+r(14),by+r(24));
      });
      return {png:canvas.toDataURL('image/png'),node:d.node,selected:d.selected,line,choices:d.choices.map(c=>c[0])};
    });
    const bytes=await writeDataUrl(`${out}/${name}.png`,shot.png);
    console.log('RPG dialogue screenshot',{name,bytes,node:shot.node});
    return {node:shot.node,selected:shot.selected,line:shot.line,choices:shot.choices};
  }
  const rigDiagnostics=await page.evaluate(()=>{
    const world=globalThis.world,d=world.urbanDialogue;
    const playerBones=[];
    world.editorPlayer?.modelContainer?.traverse?.(o=>{if(o.isBone)playerBones.push(o.name||'(unnamed)');});
    const population=world.actorLayer.urbanPopulation;
    const animatedArm=d.gesture;
    const initialRotation=animatedArm?.rotation.z??d.fallbackArm?.rotation.z??null;
    d.tick+=1.1;d.frameCamera();
    const nextRotation=animatedArm?.rotation.z??d.fallbackArm?.rotation.z??null;
    if(initialRotation===null||nextRotation===null||Math.abs(nextRotation-initialRotation)<.015)
      throw new Error('NPC gesture did not animate: '+JSON.stringify({initialRotation,nextRotation,rig:d.rigReport}));
    return {npc:d.rigReport,player:{boneCount:playerBones.length,bones:playerBones},gesture:{mode:animatedArm?'real-bone':'procedural-fallback',initialRotation,nextRotation},population:population?.stats};
  });
  await fs.writeFile(`${out}/urban-humanoid-rig-inspection.json`,JSON.stringify(rigDiagnostics,null,2));
  console.log('3D character skeleton and arm animation',JSON.stringify({npcBones:rigDiagnostics.npc.boneCount,playerBones:rigDiagnostics.player.boneCount,gesture:rigDiagnostics.gesture}));
  const opening=await captureDialogue('urban-rpg-dialogue-options');

  await page.keyboard.press('2');
  const response=await page.evaluate(()=>{
    const d=globalThis.world.urbanDialogue;
    if(d.node!=='traffic'||!d.active)throw new Error('NPC reply did not branch after pressing 2');
    for(let i=0;i<12;i++)d.frameCamera();
    return {node:d.node,text:d.root.querySelector('.urban-rpg-line').textContent};
  });
  const reply=await captureDialogue('urban-rpg-dialogue-reply');
  await fs.writeFile(`${out}/urban-rpg-dialogue-proof.json`,JSON.stringify({setup,first,opening,response,reply},null,2));
  await page.keyboard.press('Escape');
  if(await page.evaluate(()=>globalThis.world.urbanDialogue.active))throw new Error('Escape failed to close RPG dialogue');


  // Real WebGL frame of locally generated rain, not a synthetic illustration.
  const weatherProof=await page.evaluate(()=>{
    const weather=globalThis.worldWeather;
    if(!weather)throw new Error('Free city command engine not attached');
    const rain=weather.execute('fai piovere');
    if(rain.type!=='rain'||!weather.enabled||!weather.streaks.visible)
      throw new Error('Rain command did not start real weather effect');
    weather.draw(performance.now()+200);
    globalThis.world.composer.render();
    const png=globalThis.world.renderer.domElement.toDataURL('image/png');
    const clear=weather.execute('stop rain');
    if(clear.type!=='rain'||weather.enabled||weather.streaks.visible)
      throw new Error('Stopping rain did not remove weather');
    return {rain,clear,png,particles:weather.count};
  });
  const rainBytes=await writeDataUrl(`${out}/urban-weather-rain.png`,weatherProof.png);
  await fs.writeFile(`${out}/urban-weather-proof.json`,JSON.stringify({rain:weatherProof.rain,clear:weatherProof.clear,particles:weatherProof.particles,pngBytes:rainBytes},null,2));
  console.log('Free rain command verified in rendered city',{rainBytes,particles:weatherProof.particles});

  // Capture actual WebGL canvas after applying environment instructions through
  // the SAME visible city textbox the player can use. Never render mockups.
  const worldEffects=[];
  for(const [command,label] of [
    ['tramonto','urban-weather-sunset'],
    ['notte','urban-weather-night-moon'],
    ['mezzogiorno con nebbia','urban-weather-fog'],
    ['togli la nebbia e autunno','urban-weather-autumn'],
    ['inverno','urban-weather-winter']
  ]){
    const shot=await page.evaluate(command=>{
      const form=document.querySelector('.city-world-command');
      if(!form)throw new Error('Visible city command textbox missing');
      form.elements.namedItem('instruction').value=command;
      form.requestSubmit();
      const weather=globalThis.worldWeather;
      const message=form.querySelector('[data-command-result]').textContent;
      if(message.includes('non riconosciuto'))throw new Error('Environment command unrecognized: '+command);
      weather.draw(performance.now()+150);
      const world=globalThis.world;
      world.urbanLighting?.update();
      world.composer.render();
      return {png:world.renderer.domElement.toDataURL('image/png'),message,
        state:{time:weather.time,season:weather.season,foggy:weather.foggy,moonVisible:weather.moon.visible,
          rain:weather.enabled,sunOffset:world.urbanLighting?.sunOffset?.toArray()}};
    },command);
    const pngBytes=await writeDataUrl(`${out}/${label}.png`,shot.png);
    worldEffects.push({command,label,pngBytes,message:shot.message,state:shot.state});
    console.log('City environment screenshot',label,pngBytes,shot.message);
  }
  await fs.writeFile(`${out}/urban-weather-effects-proof.json`,JSON.stringify(worldEffects,null,2));

  console.log('RPG dialogue captured; error count:',errors.length);
  if(errors.length)await fs.writeFile(`${out}/dialogue-console-errors.json`,JSON.stringify(errors,null,2));
}finally{await page.close();await browser.close();}
