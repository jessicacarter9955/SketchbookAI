import {marketplaceParkingSlots,CAR_MARKETPLACES} from './urban-marketplace-slots.mjs';
import {MAX_BYTES} from './asset-store.mjs';
// Genuine licensed GLBs only. No downloaded object is stored on our server.
export function mountUrbanMarketplaceGarage(world,editor){
 const slots=marketplaceParkingSlots(world.levelRuntime.config,world.actorLayer.spawn.toArray());
 const panel=document.createElement('section');panel.className='urban-marketplace-garage';
 panel.style.cssText='position:fixed;right:12px;bottom:42px;z-index:21;max-width:min(345px,90vw);background:rgba(7,18,29,.92);color:white;border:1px solid #698fa1;border-radius:10px;padding:10px;font:12px system-ui';
 panel.innerHTML='<details><summary>🏎 Garage · 2 sportive · Sketchfab + Fab</summary><p>Due posteggi sulle corsie vicino allo spawn. Importazione GLB reale con il tuo accesso.</p><div data-showroom-cars></div><p data-showroom-status role="status" aria-live="polite">Le auto sono salvate privatamente nel browser.</p></details>';
 const list=panel.querySelector('[data-showroom-cars]'),status=panel.querySelector('[data-showroom-status]');
 const carFor=marketplace=>editor.items.find(i=>i.prefab==='vehicle'&&editor.assets.get(i.assetId)?.metadata?.marketplace===marketplace);
 async function addCar(marketplace,source,metadata){
  const idx=CAR_MARKETPLACES.indexOf(marketplace),slot=slots[idx];
  if(!slot)throw Error('Non ho trovato una corsia libera vicino allo spawn.');
  const previous=carFor(marketplace);
  const options={interactivePrefab:'vehicle',nearPlayer:true,position:[slot.x,world.levelRuntime.groundAt(slot.x,slot.z)+.04,slot.z],rotation:[0,slot.heading,0]};
  if(typeof source==='string')await editor.importURL(source,{...metadata,marketplace},options);
  else{
   if(source.size>MAX_BYTES)throw Error('Modello superiore al limite di 50 MB.');
   await editor.importBytes(await source.arrayBuffer(),{...metadata,marketplace},options);
  }
  if(previous){editor.destroyObject(previous.id);editor.items=editor.items.filter(x=>x.id!==previous.id);editor.commit();}
  if(!editor.active)world.actorLayer.start(editor.items);
  status.textContent='Auto '+marketplace+' importata e guidabile. Premi E vicino alla portiera.';
  refresh();
 }
 function refresh(){
  list.replaceChildren();
  CAR_MARKETPLACES.forEach((marketplace,i)=>{
   const row=document.createElement('div');row.style.cssText='display:flex;align-items:center;gap:8px;margin:5px 0';
   const button=document.createElement('button');button.type='button';
   button.textContent=(carFor(marketplace)?'✓ Sostituisci ':'+ Importa ')+(marketplace==='fab'?'Fab':'Sketchfab');
   const label=document.createElement('small');label.textContent=carFor(marketplace)?'Salvata':'In attesa del download originale';
   row.append(button,label);list.append(row);
   button.onclick=()=>{
    if(!slots[i]){status.textContent='Nessuna corsia adatta vicino allo spawn.';return;}
    if(!globalThis.picker?.openModelPicker){status.textContent='Libreria Sketchfab/Fab non caricata.';return;}
    globalThis.picker.openModelPicker(marketplace==='fab'?'@fab sports car':'sports car',
      (url,meta)=>addCar('sketchfab',url,meta).catch(e=>{status.textContent=e.message;throw e;}),
      (file,meta)=>addCar('fab',file,meta).catch(e=>{status.textContent=e.message;throw e;}));
   };
  });
 }
 refresh();document.body.append(panel);
 return {panel,slots,refresh};
}
