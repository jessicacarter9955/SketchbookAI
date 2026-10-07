/* Fab browser handoff: Fab does not expose a public download API equivalent to Sketchfab.
   We keep EULA acceptance and download on fab.com, then import the downloaded portable model locally. */
(function(){
  const client=new FabClient(), dialog=document.createElement('dialog');
  dialog.className='asset-picker'; dialog.setAttribute('aria-label','Libreria Fab');
  dialog.innerHTML=`<header><div><small>LIBRERIA MODELLI</small><h2>Fab · free assets</h2></div><button type="button" data-close aria-label="Chiudi libreria">×</button></header>
    <form class="asset-search"><input name="query" aria-label="Cerca su Fab" placeholder="vehicle, building, city, road…" maxlength="160"><button>Cerca su Fab ↗</button></form>
    <div class="asset-filters"><label><input type="checkbox" name="free" checked> Solo gratuiti</label><label>Categoria <select name="category"><option value="all">Tutto</option><option value="vehicles">Veicoli</option><option value="buildings">Edifici</option><option value="environments">Ambienti</option><option value="props">Props</option></select></label></div>
    <p>Fab richiede che licenza/EULA e download avvengano sul marketplace. Apri i risultati, scegli un asset compatibile e scarica GLB/glTF/ZIP; poi torna qui e importalo nella scena.</p>
    <div class="fab-shortcuts"><button type="button" data-vehicle>Veicoli gratis ↗</button><button type="button" data-city>Città/edifici gratis ↗</button><button type="button" data-road>Strade gratis ↗</button></div>
    <hr><label class="fab-drop">File scaricato da Fab<input type="file" data-file accept=".glb,.gltf,.zip"></label>
    <p role="status" aria-live="polite" data-status>Ricerca free attiva. Nessun asset viene redistribuito da Sketchbook.</p>`;
  document.body.appendChild(dialog);
  const $=s=>dialog.querySelector(s); let callback=null;
  const openSearch=(term=$('[name=query]').value)=>{
    const url=client.searchURL(term,{free:$('[name=free]').checked,category:$('[name=category]').value});
    const w=window.open(url,'_blank','noopener,noreferrer'); if(!w) $('[data-status]').textContent='Il browser ha bloccato la nuova scheda: consenti popup per aprire Fab.';
  };
  $('.asset-search').onsubmit=e=>{e.preventDefault();openSearch();};
  $('[data-vehicle]').onclick=()=>{ $('[name=query]').value='vehicle'; $('[name=category]').value='vehicles'; openSearch('vehicle'); };
  $('[data-city]').onclick=()=>{ $('[name=query]').value='city building'; $('[name=category]').value='buildings'; openSearch('city building'); };
  $('[data-road]').onclick=()=>{ $('[name=query]').value='road street'; $('[name=category]').value='environments'; openSearch('road street'); };
  $('[data-file]').onchange=async e=>{
    const file=e.target.files?.[0]; e.target.value=''; if(!file)return;
    try{
      client.supportedFile(file); $('[data-status]').textContent=`Importazione di “${file.name}”…`;
      await callback?.(file,{name:file.name,author:'',license:'Fab · verifica inserzione',source:'https://www.fab.com/'});
      dialog.close();
    }catch(error){$('[data-status]').textContent=error.message;}
  };
  $('[data-close]').onclick=()=>dialog.close();
  globalThis.fabPicker={open(query='',onPick=null){callback=onPick;$('[name=query]').value=query;if(!dialog.open)dialog.showModal();$('[name=query]').focus();}};
})();
