/* Shared by the AI sandbox and the scene editor. No bundled credentials. */
(function () {
    const client = new SketchfabClient();
    const fabClient = typeof FabClient === 'function' ? new FabClient() : null;
    const localAccess = client.loadLocalToken();
    const dialog = document.createElement('dialog');
    dialog.className = 'asset-picker';
    dialog.setAttribute('aria-label', 'Libreria modelli Sketchfab e Fab');
    dialog.innerHTML = `<header><div><small>LIBRERIA MODELLI</small><h2>Sketchfab + Fab</h2></div><button type="button" data-close aria-label="Chiudi libreria">×</button></header>
        <form class="asset-search asset-unified-search"><select name="source" aria-label="Fonte dei modelli"><option value="sketchfab">Sketchfab</option><option value="fab">Fab</option></select><input name="query" aria-label="Cerca modelli" placeholder="car, house oppure @fab medieval house" maxlength="200"><button>Cerca</button></form>
        <p class="asset-source-hint">Scrivi <strong>@fab</strong> per cercare su Fab, oppure scegli la fonte dal menu. Esempio: <code>@fab medieval house</code>.</p>
        <section class="asset-fab-tools" hidden><div class="asset-filters"><label><input type="checkbox" name="fab-free" checked> Solo gratuiti</label><label>Categoria <select name="fab-category"><option value="all">Tutte</option><option value="vehicles">Veicoli</option><option value="buildings">Edifici</option><option value="environments">Ambienti</option><option value="props">Oggetti</option></select></label></div><p>Fab apre il marketplace per scegliere il modello e accettare la licenza. Scarica il file GLB/ZIP compatibile, poi importalo qui.</p><button type="button" data-fab-open>Apri risultati su Fab ↗</button><label class="fab-drop">Importa un file scaricato da Fab<input type="file" name="fab-file" accept=".glb,.zip"></label></section>
        <div class="asset-filters asset-sketchfab-filters"><label><input type="checkbox" name="animated"> Animati</label><label>Geometria <select name="faces"><option value="">Tutti</option><option value="10000">≤ 10.000 facce</option><option value="50000">≤ 50.000 facce</option></select></label><button type="button" data-favorites>Preferiti</button></div>
        <details class="asset-sketchfab-access"><summary>Accesso ai download</summary><label>API token Sketchfab <input type="password" name="token" autocomplete="off" placeholder="Solo per questa sessione"></label><p data-access>La ricerca è pubblica. Puoi usare la configurazione locale oppure inserire un token valido qui, solo per questa sessione. <a href="https://sketchfab.com/settings/password" target="_blank" rel="noopener noreferrer">Impostazioni Sketchfab ↗</a></p><button type="button" data-retry hidden>Riprova modello selezionato</button></details>
        <p role="status" aria-live="polite" data-status>Cerca un modello scaricabile o apri i preferiti.</p><div class="asset-results"></div><button type="button" data-more hidden>Altri risultati</button>`;
    document.body.appendChild(dialog);
    const $ = selector => dialog.querySelector(selector);
    let models = [], next = null, controller, generation = 0, callback = null, fabCallback = null, busy = false, pendingModel = null;
    const normalizedQuery = value => {
        const valueString=String(value||'').trim();
        const fab=/^@fab(?:\\s+|$)/i.test(valueString);
        const sketchfab=/^@sketchfab(?:\\s+|$)/i.test(valueString);
        return {source:fab?'fab':sketchfab?'sketchfab':$('[name=source]').value, query:valueString.replace(/^@(?:fab|sketchfab)(?=\\s|$)\\s*/i,'').trim()};
    };
    function switchSource(source) {
        $('[name=source]').value=source;
        const isFab=source==='fab';
        $('.asset-fab-tools').hidden=!isFab;
        $('.asset-sketchfab-filters').hidden=isFab;
        $('.asset-sketchfab-access').hidden=isFab;
        $('.asset-results').hidden=isFab;
        $('[data-more]').hidden=isFab||!next;
        if(isFab) status('Fab: apri i risultati sul marketplace e importa il GLB/ZIP scaricato. Il download diretto non è disponibile.');
        else status('Sketchfab: scegli un modello scaricabile, oppure apri i preferiti.');
    }
    function openFab() {
        const {query}=normalizedQuery($('[name=query]').value);
        if(!query)return status('Scrivi una ricerca per Fab, ad esempio @fab medieval house.');
        if(!fabClient)return status('Fab non disponibile in questa pagina. Apri l’editor per utilizzare Fab.');
        const link=fabClient.searchURL(query,{free:$('[name=fab-free]').checked,category:$('[name=fab-category]').value});
        const opened=window.open(link,'_blank','noopener,noreferrer');
        if(!opened) {
            const a=document.createElement('a');a.href=link;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Apri Fab in una nuova scheda ↗';
            const element=$('[data-status]');element.replaceChildren(document.createTextNode('Se Fab non si apre, usa questo link: '),a);
        }else status('Fab aperto. Dopo il download torna qui e importa il GLB/ZIP.');
    }
    const errors = new Map();
    let favorites;
    try { favorites = JSON.parse(localStorage.getItem('sketchbook.favorites') || '[]'); if (!Array.isArray(favorites)) favorites = []; } catch { favorites = []; }
    const status = message => $('[data-status]').textContent = message;
    const safeURL = value => { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };
    function render() {
        const container = $('.asset-results'); container.replaceChildren();
        for (const model of models) {
            const card = document.createElement('article');
            card.dataset.model = model.uid;
            const img = document.createElement('img'); img.alt = ''; img.loading = 'lazy';
            const thumbnail = model.thumbnails?.images?.find(i => i.width >= 320) || model.thumbnails?.images?.[0];
            if (safeURL(thumbnail?.url)) img.src = safeURL(thumbnail.url);
            const title = document.createElement('h3'); title.textContent = model.name;
            const info = document.createElement('p'); info.textContent = `${model.user?.displayName || model.user?.username || 'Autore sconosciuto'} · ${model.license?.label || 'Verifica licenza'} · ${(model.faceCount || 0).toLocaleString()} facce`;
            const link = document.createElement('a'); link.textContent = 'Modello e licenza ↗'; link.href = safeURL(model.viewerUrl) || `https://sketchfab.com/models/${encodeURIComponent(model.uid)}`; link.target = '_blank'; link.rel = 'noopener noreferrer';
            const add = document.createElement('button'); add.textContent = callback ? 'Aggiungi alla scena' : 'Scarica modello'; add.disabled = busy;
            add.onclick = () => pick(model);
            const star = document.createElement('button'); star.textContent = favorites.some(f => f.uid === model.uid) ? '★ Salvato' : '☆ Preferito';
            star.onclick = () => { favorites = favorites.some(f => f.uid === model.uid) ? favorites.filter(f => f.uid !== model.uid) : [...favorites, model];
                try { localStorage.setItem('sketchbook.favorites', JSON.stringify(favorites)); } catch { status('Spazio preferiti esaurito.'); } render(); };
            const feedback = document.createElement('p'); feedback.className = 'asset-feedback'; feedback.setAttribute('role', 'alert'); feedback.textContent = errors.get(model.uid) || '';
            card.append(img, title, info, link, add, star, feedback); container.append(card);
        }
        $('[data-more]').hidden = !next;
    }
    async function search(more = false) {
        if (busy) return;
        const parsed=normalizedQuery($('[name=query]').value);
        switchSource(parsed.source);
        if(parsed.source==='fab'){openFab();return;}
        const query=parsed.query; if (!query) return status('Scrivi cosa vuoi cercare.');
        controller?.abort(); controller = new AbortController(); const request = ++generation;
        status('Ricerca in corso…'); $('[data-more]').hidden = true;
        try {
            const data = await client.search(query, { animated: $('[name=animated]').checked, maxFaces: $('[name=faces]').value, next: more ? next : null, signal: controller.signal });
            if (request !== generation) return;
            models = more ? [...models, ...data.results] : data.results; next = data.next;
            render(); status(models.length ? `${models.length} modelli. Controlla autore e licenza prima dell’uso.` : 'Nessun risultato. Prova anche termini inglesi: tree, car, building.');
        } catch (error) { if (request === generation && error.name !== 'AbortError') status(error.message); }
    }
    async function pick(model) {
        if (busy) return;
        pendingModel = model; errors.delete(model.uid);
        busy = true;
        await localAccess;
        if (!client.token) {
            busy = false;
            const message = `Per aggiungere “${model.name}” inserisci il tuo token in Accesso ai download, poi premi Riprova. Nessun oggetto è stato aggiunto.`;
            errors.set(model.uid, message); render(); status(message);
            $('details').open = true; $('[data-retry]').hidden = false; $('[name=token]').focus(); $('[name=token]').scrollIntoView({block:'center'}); return;
        }
        busy = true; render(); status(`Download e importazione di “${model.name}”…`);
        const onPick = callback;
        try {
            const url = await client.download(model.uid);
            if (onPick) await onPick(url, { uid: model.uid, name: model.name, author: model.user?.displayName || model.user?.username || '', license: model.license?.label || '', licenseUrl: safeURL(model.license?.url), source: safeURL(model.viewerUrl) });
            else { const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.click(); }
            dialog.close();
        } catch (error) {
            const message = `“${model.name}”: ${error.message}`; errors.set(model.uid, message); status(message);
            $('[data-retry]').hidden = false;
            if (/token|account/i.test(error.message)) { $('details').open = true; $('[name=token]').focus(); }
        }
        finally { busy = false; render(); }
    }
    $('.asset-search').onsubmit = e => { e.preventDefault(); search(); };
    $('[name=source]').onchange = e => {controller?.abort();generation++;switchSource(e.target.value);};
    if(!fabClient)$('[name=source]').querySelector('[value=fab]').disabled=true;
    $('[name=query]').addEventListener('input',()=>{
        const text=$('[name=query]').value;
        if(/^@fab(?:\\s|$)/i.test(text))switchSource('fab');
        else if(/^@sketchfab(?:\\s|$)/i.test(text))switchSource('sketchfab');
    });
    $('[data-fab-open]').onclick=()=>openFab();
    $('[name=fab-file]').onchange=async e=>{
        const file=e.target.files?.[0];e.target.value='';if(!file||busy)return;
        try{
            if(!fabClient)throw new Error('Fab non disponibile in questa pagina.');
            fabClient.supportedFile(file);
            if(!fabCallback)throw new Error('Apri la libreria dalla scena per importare il modello.');
            busy=true;status('Importazione di '+file.name+'…');
            await fabCallback(file,{name:file.name,author:'',license:'Fab · verifica inserzione',source:'https://www.fab.com/'});
            dialog.close();
        }catch(error){status(error.message||'Importazione non riuscita.');}
        finally{busy=false;}
    };
    $('[name=animated]').onchange = () => search();
    $('[name=faces]').onchange = () => search();
    $('[name=token]').oninput = e => client.token = e.target.value.trim();
    localAccess.then(loaded => { if (loaded) { $('[name=token]').placeholder = 'Accesso locale configurato'; $('[data-access]').textContent = 'Accesso locale ripristinato: puoi aggiungere direttamente i modelli. La configurazione resta su questo PC ed è esclusa da Git.'; } });
    $('[data-retry]').onclick = () => { if (pendingModel) pick(pendingModel); };
    $('[data-close]').onclick = () => { if (!busy) dialog.close(); };
    dialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
    dialog.addEventListener('close', () => { controller?.abort(); generation++; });
    $('[data-more]').onclick = () => search(true);
    $('[data-favorites]').onclick = () => { if (busy) return; controller?.abort(); generation++; models = [...favorites]; next = null; render(); status(`${models.length} preferiti salvati.`); };
    globalThis.picker = {
        openModelPicker(query = '', onPick = null, onFabPick = null) {
            if (busy) return;
            callback = onPick; fabCallback=onFabPick; $('[name=query]').value = query;
            switchSource(normalizedQuery(query).source);
            if (!dialog.open) dialog.showModal();
            render(); $('[name=query]').focus(); if (query.trim()) search();
        }
    };
})();
