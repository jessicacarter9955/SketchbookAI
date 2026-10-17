// Minimal touch HUD for the real Sketchbook City Player.
// Separate weather/world and model search fields; joystick and drag-to-look.
// No third-party credentials are bundled into the mobile player.
export function mountMobileCityPlayer(world,editor){
  document.body.classList.add('mobile-city-player');
  const canvas=world.renderer.domElement;
  const layer=document.createElement('div');
  layer.className='mobile-city-controls';
  layer.innerHTML=`<form class="mobile-city-command" autocomplete="off" aria-label="Comando per il mondo"><input name="instruction" aria-label="Crea o cambia la scena" maxlength="160" enterkeyhint="go" placeholder="Comando: pioggia, tramonto, neve…"><button type="button" data-mobile-assets aria-label="Apri modelli Sketchfab e Fab" aria-expanded="false">3D</button><span class="mobile-city-message" role="status" aria-live="polite"></span></form>
    <form class="mobile-city-asset-search" autocomplete="off" aria-label="Ricerca modelli 3D" hidden><input name="query" aria-label="Cerca modelli Sketchfab o Fab" maxlength="200" enterkeyhint="search" placeholder="Modelli 3D: car, @fab tree…"><button type="submit">Cerca</button><button type="button" data-mobile-place>Posiziona</button><span role="status" aria-live="polite" data-asset-status></span></form>
    <div class="mobile-city-joystick" role="group" aria-label="Joystick movimento"><div class="mobile-city-thumb"></div></div>
    <div class="mobile-city-actions"><button type="button" data-mobile-talk hidden>💬 Parla</button><button type="button" data-mobile-brake hidden aria-label="Frena il veicolo">🛑 Freno</button><button type="button" data-mobile-car aria-label="Tasto E: entra o esci dal veicolo">E · Entra</button></div><span class="mobile-city-help" data-mobile-help>🕹 Muoviti · tocca E vicino all’auto</span>`;
  document.body.append(layer);
  const form=layer.querySelector('.mobile-city-command'),input=form.elements.namedItem('instruction'),status=layer.querySelector('.mobile-city-message');
  const assetForm=layer.querySelector('.mobile-city-asset-search');
  const assetToggle=layer.querySelector('[data-mobile-assets]');
  assetToggle.onclick=()=>{
    assetForm.hidden=!assetForm.hidden;
    assetToggle.setAttribute('aria-expanded',String(!assetForm.hidden));
    if(!assetForm.hidden)assetForm.elements.namedItem('query').focus();
  };
  const assetStatus=assetForm.querySelector('[data-asset-status]');
  assetForm.onsubmit=e=>{
    e.preventDefault();
    try{editor.openModelLibrary(assetForm.elements.namedItem('query').value);
      assetStatus.textContent='Scegli un modello e apri l’anteprima 3D.';
    }catch(error){assetStatus.textContent=error.message;}
  };
  assetForm.querySelector('[data-mobile-place]').onclick=()=>{
    try{editor.placeSelectedAsset();assetStatus.textContent='Seleziona il terreno nell’editor.';}
    catch(error){assetStatus.textContent=error.message;}
  };
  let messageTimeout;
  function showMessage(message){
    status.textContent=message;
    clearTimeout(messageTimeout);
    messageTimeout=setTimeout(()=>{status.textContent='';},5500);
  }
  form.onsubmit=e=>{
    e.preventDefault();
    const command=input.value.trim();if(!command)return;
    const normalized=command.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const kinds=[
      ['tree',/\b(?:alber[oi]|tree)\b/,'Albero'],
      ['lamp',/\b(?:lampione|lampada|streetlight|street lamp)\b/,'Lampione'],
      ['building',/\b(?:edificio|palazzo|building|casa)\b/,'Edificio'],
      ['road',/\b(?:strada|road)\b/,'Strada']
    ];
    const kind=kinds.find(([,pattern])=>pattern.test(normalized));
    if(kind&&/\b(?:aggiungi|crea|inserisci|metti|posiziona|add|create|place|spawn)\b/.test(normalized)){
      try{
        if(editor.items.length>=500)throw new Error('Limite di 500 oggetti raggiunto');
        const player=world.editorPlayer;
        const p=player?.position||world.camera.position;
        const theta=world.cameraOperator.theta*Math.PI/180;
        const x=p.x-Math.sin(theta)*8;
        const z=p.z-Math.cos(theta)*8;
        const y=world.levelRuntime?.groundAt(x,z)??0;
        const item={id:crypto.randomUUID(),prefab:kind[0],name:kind[2],
          position:[x,y+.1,z],rotation:[0,0,0],scale:[1,1,1],collider:false};
        editor.items.push(item);
        editor.create(item);
        editor.commit();
        showMessage(kind[2]+' aggiunto davanti al giocatore.');
      }catch(error){showMessage('Impossibile aggiungere: '+error.message);}
    }else{
      const result=world.worldWeather?.execute(command);
      showMessage(result?.message||'Comando non disponibile');
    }
    input.value='';input.blur();
  };
  const talk=layer.querySelector('[data-mobile-talk]');
  const carButton=layer.querySelector('[data-mobile-car]');
  const brakeButton=layer.querySelector('[data-mobile-brake]');
  const help=layer.querySelector('[data-mobile-help]');
  const nearestCar=()=>{
    const player=world.editorPlayer;if(!player||player.controlledObject)return null;
    const cars=(world.vehicles||[]).filter(car=>car.seats?.some(seat=>seat&&!seat.occupiedBy));
    return cars.sort((a,b)=>a.position.distanceTo(player.position)-b.position.distanceTo(player.position)).find(car=>car.position.distanceTo(player.position)<8)||null;
  };
  talk.onclick=()=>{
    const dialogue=world.urbanDialogue;
    if(!dialogue)return;
    if(dialogue.active){dialogue.close();return;}
    const npc=dialogue.nearest(6);if(npc)dialogue.open(npc);
  };
  carButton.onclick=()=>{
    const player=world.editorPlayer;if(!player)return;
    if(player.controlledObject){
      stopStick();
      player.controlledObject.forceCharacterOut?.();
      player.takeControl?.();
      showMessage('Sei sceso dall’auto.');
      return;
    }
    const target=nearestCar();
    const seat=target?.seats?.find(s=>s?.type==='driver'&&!s.occupiedBy)||target?.seats?.find(s=>s&&!s.occupiedBy);
    if(!seat){showMessage('Avvicinati a un’auto, poi premi E.');return;}
    stopStick();
    player.teleportToVehicle(target,seat);player.takeControl();
    showMessage('Al volante! Usa il joystick per accelerare e sterzare.');
  };
  const updateActions=()=>{
    if(!layer.isConnected)return;
    const dialogue=world.urbanDialogue,player=world.editorPlayer;
    const hasNpc=!!dialogue?.nearest(6);
    talk.hidden=!(dialogue?.active||hasNpc);
    talk.textContent=dialogue?.active?'Chiudi dialogo':'Parla';
    const driving=!!player?.controlledObject;
    const nearest=nearestCar();
    carButton.hidden=false;
    carButton.disabled=!driving&&!nearest;
    carButton.textContent=driving?'E · Esci':nearest?'E · Entra':'E · Avvicinati';
    brakeButton.hidden=!driving;
    help.textContent=driving?'🕹 Su accelera · giù retro · lati sterzano':'🕹 Cammina e guarda trascinando · avvicinati alle auto';
  };
  updateActions();const actionsInterval=setInterval(()=>{updateActions();if(joyPointer!==null)act();},250);
  const joy=layer.querySelector('.mobile-city-joystick');
  const thumb=joy.querySelector('.mobile-city-thumb');
  let joyPointer=null,joyX=0,joyY=0,lastActions={},lastReceiver=null;
  const names=['up','down','left','right','run'];
  function act(){
    const player=world.editorPlayer;
    if(!player?.triggerAction)return;
    const vehicle=player.controlledObject;
    const receiver=vehicle||player;
    const next={up:joyY<-.22,down:joyY>.22,left:joyX<-.22,right:joyX>.22,run:!vehicle&&Math.hypot(joyX,joyY)>.82};
    if(lastReceiver&&lastReceiver!==receiver) {
      for(const [name,value] of Object.entries(lastActions))if(value){
        const action=lastReceiver===player?name:{up:'throttle',down:'reverse',left:'left',right:'right'}[name];
        if(action&&lastReceiver.actions?.[action])lastReceiver.triggerAction(action,false);
      }
      lastActions={};
    }
    lastReceiver=receiver;
    for(const name of names){
      const action=vehicle?{up:'throttle',down:'reverse',left:'left',right:'right'}[name]:name;
      if(!action)continue;
      const value=!!next[name];
      if(lastActions[name]!==value){receiver.triggerAction(action,value);lastActions[name]=value;}
    }
  }
  let brakePressed=false;
  function brake(pressed){
    brakePressed=pressed;
    world.editorPlayer?.controlledObject?.triggerAction?.('brake',pressed);
  }
  brakeButton.addEventListener('pointerdown',e=>{e.preventDefault();brake(true);brakeButton.setPointerCapture(e.pointerId);});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])brakeButton.addEventListener(type,()=>brake(false));
  function moveStick(e){
    const rect=joy.getBoundingClientRect();
    const cx=rect.left+rect.width/2,cy=rect.top+rect.height/2;
    const radius=rect.width*.33;
    let dx=(e.clientX-cx)/radius,dy=(e.clientY-cy)/radius;
    const mag=Math.hypot(dx,dy);if(mag>1){dx/=mag;dy/=mag;}
    joyX=dx;joyY=dy;
    thumb.style.transform=`translate(${dx*radius}px,${dy*radius}px)`;
    act();
  }
  function stopStick(){
    joyPointer=null;joyX=joyY=0;thumb.style.transform='translate(0px,0px)';act();
  }
  joy.addEventListener('pointerdown',e=>{if(joyPointer!==null)return;joyPointer=e.pointerId;joy.setPointerCapture(e.pointerId);moveStick(e);e.preventDefault();});
  joy.addEventListener('pointermove',e=>{if(e.pointerId===joyPointer){moveStick(e);e.preventDefault();}});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])joy.addEventListener(type,e=>{if(joyPointer===e.pointerId)stopStick();});
  let lookPointer=null,lastX=0,lastY=0;
  canvas.style.touchAction='none';
  canvas.addEventListener('pointerdown',e=>{
    if(e.pointerType!=='touch'||lookPointer!==null||editor.active)return;
    lookPointer=e.pointerId;lastX=e.clientX;lastY=e.clientY;
    canvas.setPointerCapture(e.pointerId);e.preventDefault();
  });
  canvas.addEventListener('pointermove',e=>{
    if(e.pointerId!==lookPointer)return;
    const dx=e.clientX-lastX,dy=e.clientY-lastY;lastX=e.clientX;lastY=e.clientY;
    world.cameraOperator.move(dx*.45,dy*.45);e.preventDefault();
  });
  for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,e=>{if(e.pointerId===lookPointer)lookPointer=null;});
  const releaseControls=()=>{stopStick();brake(false);};
  window.addEventListener('blur',releaseControls);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)releaseControls();});
  // Prevent accidental scrolling/zoom during simultaneous touch movement.
  document.addEventListener('contextmenu',e=>{if(e.target===canvas||joy.contains(e.target))e.preventDefault();});
  return {layer,showMessage,stopStick,dispose(){clearInterval(actionsInterval);releaseControls();window.removeEventListener('blur',releaseControls);layer.remove();}};
}
