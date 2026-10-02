/* Shared by the AI sandbox and the scene editor. No bundled credentials. */
(function () {
    const client = new SketchfabClient();
    const dialog = document.createElement('dialog');
    dialog.className = 'asset-picker';
    dialog.setAttribute('aria-label', 'Libreria Sketchfab');
    dialog.innerHTML = `<header><div><small>LIBRERIA MODELLI</small><h2>Sketchfab</h2></div><button type="button" data-close aria-label="Chiudi libreria">×</button></header>
        <form class="asset-search"><input name="query" aria-label="Cerca modelli" placeholder="Alberi, auto, edifici…" maxlength="200"><button>Cerca</button></form>
        <div class="asset-filters"><label><input type="checkbox" name="animated"> Animati</label><label>Geometria <select name="faces"><option value="">Tutti</option><option value="10000">≤ 10.000 facce</option><option value="50000">≤ 50.000 facce</option></select></label><button type="button" data-favorites>Preferiti</button></div>
        <details><summary>Accesso ai download</summary><label>Il tuo API token Sketchfab <input type="password" name="token" autocomplete="off" placeholder="Solo per questa sessione"></label><p>Usa il token del tuo account. Non viene salvato né incluso nella scena. <a href="https://sketchfab.com/settings/password" target="_blank" rel="noopener noreferrer">Impostazioni Sketchfab ↗</a></p></details>
        <p role="status" aria-live="polite" data-status>Cerca un modello scaricabile o apri i preferiti.</p><div class="asset-results"></div><button type="button" data-more hidden>Altri risultati</button>`;
    document.body.appendChild(dialog);
    const $ = selector => dialog.querySelector(selector);
    let models = [], next = null, controller, generation = 0, callback = null, busy = false;
    let favorites;
    try { favorites = JSON.parse(localStorage.getItem('sketchbook.favorites') || '[]'); if (!Array.isArray(favorites)) favorites = []; } catch { favorites = []; }
    const status = message => $('[data-status]').textContent = message;
    const safeURL = value => { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };
    function render() {
        const container = $('.asset-results'); container.replaceChildren();
        for (const model of models) {
            const card = document.createElement('article');
            const img = document.createElement('img'); img.alt = ''; img.loading = 'lazy';
            const thumbnail = model.thumbnails?.images?.find(i => i.width >= 320) || model.thumbnails?.images?.[0];
            if (safeURL(thumbnail?.url)) img.src = safeURL(thumbnail.url);
            const title = document.createElement('h3'); title.textContent = model.name;
            const info = document.createElement('p'); info.textContent = `${model.user?.displayName || model.user?.username || 'Autore sconosciuto'} · ${model.license?.label || 'Verifica licenza'} · ${(model.faceCount || 0).toLocaleString()} facce`;
            const link = document.createElement('a'); link.textContent = 'Modello e licenza ↗'; link.href = safeURL(model.viewerUrl) || `https://sketchfab.com/models/${encodeURIComponent(model.uid)}`; link.target = '_blank'; link.rel = 'noopener noreferrer';
            const add = document.createElement('button'); add.textContent = callback ? 'Aggiungi alla scena' : 'Scarica GLB'; add.disabled = busy;
            add.onclick = () => pick(model);
            const star = document.createElement('button'); star.textContent = favorites.some(f => f.uid === model.uid) ? '★ Salvato' : '☆ Preferito';
            star.onclick = () => { favorites = favorites.some(f => f.uid === model.uid) ? favorites.filter(f => f.uid !== model.uid) : [...favorites, model];
                try { localStorage.setItem('sketchbook.favorites', JSON.stringify(favorites)); } catch { status('Spazio preferiti esaurito.'); } render(); };
            card.append(img, title, info, link, add, star); container.append(card);
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
        if (busy) return; busy = true; render(); status('Download del modello…');
        const onPick = callback;
        try {
            const url = await client.download(model.uid);
            if (onPick) await onPick(url, { uid: model.uid, name: model.name, author: model.user?.displayName || model.user?.username || '', license: model.license?.label || '', licenseUrl: safeURL(model.license?.url), source: safeURL(model.viewerUrl) });
            else { const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.click(); }
            dialog.close();
        } catch (error) { status(error.message); }
        finally { busy = false; render(); }
    }
    $('.asset-search').onsubmit = e => { e.preventDefault(); search(); };
    $('[name=animated]').onchange = () => search();
    $('[name=faces]').onchange = () => search();
    $('[name=token]').oninput = e => client.token = e.target.value.trim();
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
