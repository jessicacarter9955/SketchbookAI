// A separate, real playable San Andreas GLB/Sketchfab/Fab import lab.
// External marketplace licenses and author attribution must be respected.
export const STREETLAB_SOURCES=Object.freeze([
 {type:'vehicle',name:'BMW M4 · Cosmo · CC BY · 21k triangoli',
  url:'https://sketchfab.com/3d-models/bmw-m4-low-poly-225b190bcaa5496ea9059162f01571f0'},
 {type:'vehicle',name:'Porsche 911 · Philipp Busse · CC BY · 22k triangoli',
  url:'https://sketchfab.com/3d-models/porsche-911-e5d5f35870344bd4a005ef5599a63313'},
 {type:'vehicle',name:'Ferrari 458 · amogusstrikesback2 · CC BY · 28k triangoli',
  url:'https://sketchfab.com/3d-models/ferrari-458-italia-c28798f250b544e98d4a10a78de6cbb9'},
 {type:'pedestrian',name:'Walking Character · loganbro · CC BY · 34k triangoli',
  url:'https://sketchfab.com/3d-models/walking-character-245a8bcfddf44122b1f2e8dfa883c544'},
 {type:'pedestrian',name:'Old Man Walk · Moh1993 · CC BY · 21k triangoli',
  url:'https://sketchfab.com/3d-models/old-man-walk-6954274464154b9085ade2097c3aa949'}
]);
export function mountStreetLabGarage(world,editor){
 const section=document.createElement('section');
 section.className='sa-streetlab-garage';
 section.style.cssText='position:fixed;right:12px;top:66px;z-index:20;background:rgba(6,14,25,.9);color:white;padding:12px;border:1px solid #79abb5;border-radius:12px;max-width:min(370px,90vw);font:13px system-ui;max-height:65vh;overflow:auto';
 section.innerHTML='<strong>🏎 STREETLAB · SAN ANDREAS</strong><p>Auto sportive guidabili e NPC reali: scarica il GLB dalle fonti e importalo. Nessun asset viene pubblicato su server.</p>'+
  '<details><summary>BMW · Porsche · Ferrari · NPC Sketchfab</summary><div data-garage-sources></div></details>'+
  '<label>Tipo di asset <select data-garage-type><option value="vehicle">Auto sportiva guidabile</option><option value="pedestrian">NPC / pedone</option><option value="avatar">Aspetto del protagonista (CJ-like)</option></select></label>'+
  '<p><button type="button" data-garage-search>Ricerca su Sketchfab / Fab</button></p>'+
  '<label>Importa GLB scaricato <input data-garage-import type="file" accept=".glb,.gltf,.zip"></label>'+
  '<p data-garage-status role="status" aria-live="polite">Scarica un modello con licenza adatta; massimo 50 MB per file.</p>'+
  '<button type="button" data-garage-hide>Nascondi pannello</button>';
 const list=section.querySelector('[data-garage-sources]');
 for(const source of STREETLAB_SOURCES){
  const a=document.createElement('a');a.href=source.url;a.target='_blank';a.rel='noopener noreferrer';
  a.textContent=source.name;a.dataset.role=source.type;
  a.style.cssText='display:block;padding:5px;color:#9fe8ff';
  list.append(a);
 }
 const role=section.querySelector('[data-garage-type]');
 const status=section.querySelector('[data-garage-status]');
 let source=null;
 list.onclick=event=>{const link=event.target.closest('a');if(link){source=STREETLAB_SOURCES.find(s=>s.url===link.href)||null;if(source)role.value=source.type;}};
 section.querySelector('[data-garage-search]').onclick=()=>{
  if(role.value==='avatar'){status.textContent='Per cambiare il protagonista scarica un GLB e selezionalo qui sotto.';return;}
  editor.openModelLibrary(role.value==='vehicle'?'sports car':'walking person',role.value);
  status.textContent='Usa la ricerca del catalogo e importa un modello scaricabile.';
 };
 section.querySelector('[data-garage-import]').onchange=async event=>{
  const file=event.target.files[0];event.target.value='';if(!file)return;
  if(file.size>50*1024*1024){status.textContent='GLB oltre 50 MB. Usa una versione ottimizzata.';return;}
  status.textContent='Importazione e verifica del modello originale…';
  try{
   const metadata={name:file.name,source:source?.url||'File locale',
    author:source?.name.split(' · ')[1]||'Autore indicato sulla fonte',
    license:source?.name.includes('CC BY')?'CC BY 4.0 (verificare la scheda originale)':'Verificare licenza',
    licenseUrl:source?.url||''};
   if(role.value==='avatar'){
      await editor.importPlayerAvatar(await file.arrayBuffer(),metadata);
      status.textContent='Protagonista aggiornato (aspetto visivo). WASD cammina, F sale sull’auto. I GLB senza animazioni compatibili non avranno il movimento delle articolazioni.';
   }else{
      await editor.importBytes(await file.arrayBuffer(),metadata,{nearPlayer:true,interactivePrefab:role.value});
      status.textContent=(role.value==='vehicle'?'Auto guidabile':'NPC')+' importato in scena, premi F2/▶ Prova per usarlo. Premi F vicino all’auto.';
   }
   source=null;
  }catch(e){status.textContent='Errore: '+e.message;}
 };
 section.querySelector('[data-garage-hide]').onclick=()=>{
   const hidden=section.querySelector('details').hidden;
   for(const child of [...section.children])if(child.tagName!=='STRONG'&&child.dataset.garageHide===undefined)child.hidden=!hidden;
   section.querySelector('[data-garage-hide]').hidden=false;
   section.querySelector('[data-garage-hide]').textContent=hidden?'Nascondi pannello':'Apri pannello';
 };
 document.body.append(section);
 return section;
}
