// Mobile gamepad supplement: Sketchbook already has a touch joystick and
// swipe-camera support in InputManager. Add accessible RPG and scene buttons.
export function installAndroidPlaytestControls(world, editor) {
  if(!(navigator.maxTouchPoints>0||/Android|iPhone|iPad/i.test(navigator.userAgent)||new URLSearchParams(location.search).has('touch')))return;
  const panel=document.createElement('nav');
  panel.className='android-playtest-controls';
  panel.setAttribute('aria-label','Comandi gioco touch');
  const make=(label,code)=>{
    const b=document.createElement('button');b.type='button';b.textContent=label;
    b.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();try{b.setPointerCapture(e.pointerId);}catch{} document.dispatchEvent(new KeyboardEvent('keydown',{key:code==='KeyE'?'e':code==='KeyF'?'f':code==='Escape'?'Escape':'F2',code,bubbles:true}));});
    b.addEventListener('pointerup',e=>{e.preventDefault();document.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true}));});
    b.addEventListener('pointercancel',()=>document.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true})));
    panel.append(b);
  };
  make('Parla · E','KeyE');
  make('Auto · F','KeyF');
  make('Chiudi','Escape');
  const menu=document.createElement('a');menu.textContent='Scene';menu.href='index.html';menu.className='android-scenes-link';panel.append(menu);
  document.body.append(panel);
  const update=()=>{
    const talking=Boolean(world.urbanDialogue?.active);
    panel.classList.toggle('in-dialogue',talking);
    panel.hidden=Boolean(editor.active);
  };
  update();setInterval(update,250);
}
