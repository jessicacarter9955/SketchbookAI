/* Shared by the AI sandbox and the scene editor. No bundled credentials. */
(function () {
    const client = new SketchfabClient();
    const localAccess = client.loadLocalToken();
    const dialog = document.createElement('dialog');
    dialog.className = 'asset-picker';
    dialog.setAttribute('aria-label', 'Libreria Sketchfab');
    dialog.innerHTML = `<header><div><small>LIBRERIA MODELLI</small><h2>Sketchfab</h2></div><button type="button" data-close aria-label="Chiudi libreria">×</button></header>
        <form class="asset-search"><input name="query" aria-label="Cerca modelli" placeholder="Alberi, auto, edifici…" maxlength="200"><button>Cerca</button></form>
        <div class="asset-filters"><label><input type="checkbox" name="animated"> Animati</label><label>Geometria <select name="faces"><option value="">Tutti</option><option value="10000">≤ 10.000 facce</option><option value="50000">≤ 50.000 facce</option></select></label><button type="button" data-favorites>Preferiti</button></div>
        <details><summary>Accesso ai download</summary><label>API token Sketchfab <input type="password" name="token" autocomplete="off" placeholder="Solo per questa sessione"></label><p data-access>La ricerca è pubblica. Puoi usare la configurazione locale oppure inserire un token valido qui, solo per questa sessione. <a href="https://sketchfab.com/settings/password" target="_blank" rel="noopener noreferrer">Impostazioni Sketchfab ↗</a></p><button type="button" data-retry hidden>Riprova modello selezionato</button></details>
        <p role="status" aria-live="polite" data-status>Cerca un modello scaricabile o apri i preferiti.</p><div class="asset-results"></div><button type="button" data-more hidden>Altri risultati</button>`;
    document.body.appendChild(dialog);
    const $ = selector => dialog.querySelector(selector);
    let models = [], next = null, controller, generation = 0, callback = null, busy = false, pendingModel = null;
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
        const query = $('[name=query]').value.trim(); if (!query) return status('Scrivi cosa vuoi cercare.');
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
        openModelPicker(query = '', onPick = null) {
            if (busy) return;
            callback = onPick; $('[name=query]').value = query;
            if (!dialog.open) dialog.showModal();
            render(); $('[name=query]').focus(); if (query.trim()) search();
        }
    };
})();
