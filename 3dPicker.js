/* Shared by the AI sandbox and the scene editor. No bundled credentials. */
(function () {
    const client = new SketchfabClient();
    const fab = new FabClient();
    // Load both trusted localhost configuration and this device's opt-in IndexedDB store.
    const localAccess = Promise.all([client.loadLocalToken(), client.loadSavedTokens().catch(() => false)]);
    const accessReady = localAccess.then(([local, saved]) => local || saved);
    const dialog = document.createElement('dialog');
    dialog.className = 'asset-picker';
    dialog.setAttribute('aria-label', 'Libreria modelli Sketchfab e Fab');
    dialog.innerHTML = `<header><div><small>LIBRERIA MODELLI</small><h2>Sketchfab + Fab</h2></div><button type="button" data-close aria-label="Chiudi libreria">×</button></header>
        <nav class="asset-sources" aria-label="Catalogo modelli"><button type="button" data-source="sketchfab" aria-pressed="true">Sketchfab</button><button type="button" data-source="fab" aria-pressed="false">Fab</button></nav>
        <form class="asset-search"><input name="query" aria-label="Cerca modelli" placeholder="Alberi, auto, edifici…" maxlength="200"><button>Cerca</button></form>
        <div class="asset-filters"><label><input type="checkbox" name="animated"> Animati</label><label>Geometria <select name="faces"><option value="">Tutti</option><option value="10000">≤ 10.000 facce</option><option value="50000">≤ 50.000 facce</option></select></label><button type="button" data-favorites>Preferiti</button></div>
        <details><summary>Accesso ai download</summary><label>Token Sketchfab per questa sessione <input type="password" name="token" autocomplete="off" placeholder="Incolla un token, oppure salvalo qui sotto"></label><p data-access>Su localhost si legge automaticamente /.local/sketchfab.json. Su questo dispositivo puoi salvare l'accesso una sola volta e riutilizzarlo dopo ogni riavvio. <a href="https://sketchfab.com/settings/password" target="_blank" rel="noopener noreferrer">Impostazioni Sketchfab ↗</a></p><label>Configurazione una tantum (token singolo, più token oppure JSON)<textarea name="tokens-json" rows="3" spellcheck="false" autocomplete="off" placeholder='{"tokens":["TOKEN_1","TOKEN_2"]}'></textarea></label><div class="asset-credential-actions"><button type="button" data-save-tokens>Salva su questo dispositivo</button><button type="button" data-forget-tokens>Elimina accesso salvato</button></div><small>Le credenziali vengono salvate in IndexedDB, solo per questo browser/origine. Non caricarle su un dispositivo condiviso: gli script della pagina possono accedere all'archivio locale.</small><button type="button" data-retry hidden>Riprova modello selezionato</button></details>
        <p role="status" aria-live="polite" data-status>Cerca un modello scaricabile o apri i preferiti.</p><div class="asset-results"></div><button type="button" data-more hidden>Altri risultati</button>`;
    document.body.appendChild(dialog);
    const $ = selector => dialog.querySelector(selector);
    let models = [], next = null, controller, generation = 0, callback = null, busy = false, pendingModel = null, source = 'sketchfab';
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
            const provider = model.provider || 'sketchfab';
            const favoriteId = value => (value.provider || 'sketchfab') + ':' + value.uid;
            const isFavorite = favorites.some(f => favoriteId(f) === favoriteId(model));
            const img = document.createElement('img'); img.alt = ''; img.loading = 'lazy';
            const thumbnail = model.thumbnails?.images?.find(i => i.width >= 320) || model.thumbnails?.images?.[0];
            if (safeURL(thumbnail?.url)) img.src = safeURL(thumbnail.url);
            const title = document.createElement('h3'); title.textContent = model.name;
            const info = document.createElement('p'); info.textContent = `${model.user?.displayName || model.user?.username || 'Autore sconosciuto'} · ${model.license?.label || 'Verifica licenza'} · ${(model.faceCount || 0).toLocaleString()} facce`;
            const link = document.createElement('a'); link.textContent = 'Modello e licenza ↗'; link.href = safeURL(model.viewerUrl) || `https://sketchfab.com/models/${encodeURIComponent(model.uid)}`; link.target = '_blank'; link.rel = 'noopener noreferrer';
            const requiresFabPage = provider === 'fab' && (model.importAvailable === false || (model.ownershipKnown && !model.owned));
            const add = document.createElement('button');
            add.textContent = requiresFabPage ? 'Apri su Fab ↗' : callback ? 'Importa' : 'Scarica modello';
            add.disabled = busy;
            add.onclick = () => requiresFabPage ? window.open(link.href, '_blank', 'noopener,noreferrer') : pick(model);
            const star = document.createElement('button'); star.textContent = isFavorite ? '★ Salvato' : '☆ Preferito';
            star.onclick = () => { favorites = isFavorite ? favorites.filter(f => favoriteId(f) !== favoriteId(model)) : [...favorites, model];
                try { localStorage.setItem('sketchbook.favorites', JSON.stringify(favorites)); } catch { status('Spazio preferiti esaurito.'); } render(); };
            const feedback = document.createElement('p'); feedback.className = 'asset-feedback'; feedback.setAttribute('role', 'alert'); feedback.textContent = errors.get(provider + ':' + model.uid) || '';
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
            const data = await (source === 'fab' ? fab : client).search(query, { animated: $('[name=animated]').checked, maxFaces: $('[name=faces]').value, next: more ? next : null, signal: controller.signal });
            if (request !== generation) return;
            const results = (data.results || []).map(model => ({ ...model, provider: source })).sort((a, b) => (b.animationCount || 0) - (a.animationCount || 0));
            models = more ? [...models, ...results] : results; next = data.next || null;
            render(); status(models.length ? `${models.length} modelli ${source === 'fab' ? 'Fab' : 'Sketchfab'}. ${source === 'fab' && fab.catalogOnly ? 'La ricerca è online; per scaricare serve ancora Epic autenticato.' : 'Controlla autore e licenza prima dell’uso.'}` : 'Nessun risultato. Prova anche termini inglesi: tree, car, building.');
        } catch (error) { if (request === generation && error.name !== 'AbortError') status(error.message); }
    }
    async function pick(model) {
        if (busy) return;
        const provider = model.provider || 'sketchfab';
        const key = provider + ':' + model.uid;
        pendingModel = model; errors.delete(key);
        busy = true;
        await accessReady;
        if (provider === 'sketchfab' && !client.token) {
            busy = false;
            const message = `Per aggiungere “${model.name}” inserisci il tuo token in Accesso ai download, poi premi Riprova. Nessun oggetto è stato aggiunto.`;
            errors.set(key, message); render(); status(message);
            $('details').open = true; $('[data-retry]').hidden = false; $('[name=token]').focus(); $('[name=token]').scrollIntoView({block:'center'}); return;
        }
        busy = true; render(); status(`Download e importazione di “${model.name}”…`);
        const onPick = callback;
        try {
            const url = await (provider === 'fab' ? fab : client).download(model.uid);
            if (onPick) await onPick(url, { uid: model.uid, name: model.name, author: model.user?.displayName || model.user?.username || '', license: model.license?.label || '', licenseUrl: safeURL(model.license?.url), source: safeURL(model.viewerUrl), provider });
            else { const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.click(); }
            dialog.close();
        } catch (error) {
            const message = `“${model.name}”: ${error.message}`; errors.set(key, message); status(message);
            $('[data-retry]').hidden = false;
            if (provider === 'sketchfab' && /token|account/i.test(error.message)) { $('details').open = true; $('[name=token]').focus(); }
        }
        finally { busy = false; render(); }
    }
    $('.asset-search').onsubmit = e => { e.preventDefault(); search(); };
    dialog.querySelectorAll('[data-source]').forEach(button => button.onclick = () => {
        if (busy || button.dataset.source === source) return;
        source = button.dataset.source;
        controller?.abort(); generation++; models = []; next = null; pendingModel = null;
        dialog.querySelectorAll('[data-source]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.source === source)));
        $('details').hidden = source === 'fab';
        $('[name=animated]').closest('label').hidden = source === 'fab';
        $('[name=faces]').closest('label').hidden = source === 'fab';
        render();
        status(source === 'fab' ? (fab.catalogOnly ? 'Catalogo Fab online: cerca e visualizza i modelli. Per importarli direttamente serve il collegamento autenticato Epic.' : 'FabCLI locale: cerca gli asset del tuo account Epic e importa quelli disponibili in glTF/GLB.') : 'Cerca un modello Sketchfab scaricabile.');
        if ($('[name=query]').value.trim()) search();
    });
    $('[name=animated]').onchange = () => search();
    $('[name=faces]').onchange = () => search();
    $('[name=token]').oninput = e => client.token = e.target.value.trim();
    accessReady.then(loaded => {
        if (!loaded) return;
        $('[name=token]').placeholder = 'Accesso Sketchfab già disponibile';
        $('[data-access]').textContent = `Accesso automatico attivo: ${client.credentialCount} credenziale/i disponibile/i (${client.hasSavedTokens ? 'salvataggio nel browser' : 'file locale'}). Non serve ricaricare il JSON.`;
    });
    $('[data-save-tokens]').onclick = async () => {
        const value = $('[name=tokens-json]').value.trim() || $('[name=token]').value.trim();
        try {
            const count = await client.saveSavedTokens(value);
            $('[name=tokens-json]').value = '';
            $('[name=token]').value = '';
            $('[name=token]').placeholder = 'Accesso Sketchfab già disponibile';
            $('[data-access]').textContent = `Salvati ${count} token in questo browser. Il caricamento sarà automatico ai prossimi avvii.`;
            status(`Accesso Sketchfab salvato per i prossimi avvii (${count} token).`);
        } catch (error) { status(error.message); }
    };
    $('[data-forget-tokens]').onclick = async () => {
        try {
            await client.clearSavedTokens();
            $('[name=token]').value = '';
            $('[name=tokens-json]').value = '';
            $('[data-access]').textContent = client.token ? 'Credenziali locali disponibili; quelle memorizzate nel browser sono state eliminate.' : 'Accesso memorizzato eliminato. Per scaricare, inserisci un token o configura il file locale.';
            status('Credenziali Sketchfab memorizzate eliminate da questo browser.');
        } catch (error) { status(error.message); }
    };
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
