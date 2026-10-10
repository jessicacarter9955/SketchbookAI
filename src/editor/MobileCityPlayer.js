// Minimal touch HUD for the real Sketchbook City Player.
// One command field, one analog joystick and drag-to-look. No API keys.
export function mountMobileCityPlayer(world,editor){
  document.body.classList.add('mobile-city-player');
  const canvas=world.renderer.domElement;
  const layer=document.createElement('div');
  layer.className='mobile-city-controls';
  layer.innerHTML=`<form class="mobile-city-command" autocomplete="off" aria-label="Comando per il mondo"><input name="instruction" aria-label="Crea o cambia la scena" maxlength="160" enterkeyhint="go" placeholder="Scrivi: tramonto, neve, nebbia…"><span class="mobile-city-message" role="status" aria-live="polite"></span></form>
    <div class="mobile-city-joystick" role="group" aria-label="Joystick movimento"><div class="mobile-city-thumb"></div></div>`;
  document.body.append(layer);
  const form=layer.querySelector('form'),input=form.elements.namedItem('instruction'),status=layer.querySelector('.mobile-city-message');
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
  const joy=layer.querySelector('.mobile-city-joystick');
  const thumb=joy.querySelector('.mobile-city-thumb');
  let joyPointer=null,joyX=0,joyY=0,lastActions={};
  const names=['up','down','left','right','run'];
  function act(){
    const player=world.editorPlayer;
    if(!player?.triggerAction)return;
    const next={up:joyY<-.24,down:joyY>.24,left:joyX<-.24,right:joyX>.24,run:Math.hypot(joyX,joyY)>.86};
    for(const name of names){
      const value=!!next[name];
      if(lastActions[name]!==value){player.triggerAction(name,value);lastActions[name]=value;}
    }
  }
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
  window.addEventListener('blur',stopStick);
  // Prevent accidental scrolling/zoom during simultaneous touch movement.
  document.addEventListener('contextmenu',e=>{if(e.target===canvas||joy.contains(e.target))e.preventDefault();});
  return {layer,showMessage,stopStick};
}
