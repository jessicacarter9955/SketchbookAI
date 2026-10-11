(function () {
  'use strict';
  const overlay = document.getElementById('loading-screen');
  if (!overlay) return;
  overlay.innerHTML = '<div class="load-panel"><h2>Caricamento città</h2><p id="load-stage">Preparazione...</p><div class="load-track"><div id="load-progress"></div></div><p id="load-numbers">0% · In attesa degli asset</p><div id="load-current"></div><details open><summary>Log caricamento</summary><pre id="load-log" aria-live="polite"></pre></details><button id="load-retry" hidden type="button">Riprova caricamento</button></div>';
  const stageEl = document.getElementById('load-stage');
  const progressEl = document.getElementById('load-progress');
  const numbersEl = document.getElementById('load-numbers');
  const currentEl = document.getElementById('load-current');
  const logEl = document.getElementById('load-log');
  const retry = document.getElementById('load-retry');
  retry.onclick = () => location.reload();
  const tracked = new Map();
  let n = 0, stage = 'Preparazione', started = Date.now(), lastActivity = Date.now(), failed = false, complete = false;
  const urlLabel = url => { try { return decodeURI(new URL(String(url), location.href).pathname).split('/').slice(-3).join('/'); } catch { return String(url).slice(0,120); } };
  const category = url => {
    if (/facade|building|house|wall|urban-kits/i.test(url)) return 'Facciate ed edifici';
    if (/tree|grass|leaf|vegetation|plant|forest/i.test(url)) return 'Vegetazione';
    if (/road|street|terrain|ground/i.test(url)) return 'Terreno e strade';
    if (/character|pedestrian|people|actor|vehicle|car/i.test(url)) return 'Pedoni e veicoli';
    if (/\.(png|jpe?g|webp|ktx2?|dds)$/i.test(url)) return 'Texture';
    return 'Risorse 3D';
  };
  function log(message, level = 'info') {
    const time = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.className = 'load-' + level;
    line.textContent = '[' + time + '] ' + message;
    logEl.append(line);
    while (logEl.children.length > 90) logEl.firstChild.remove();
    logEl.scrollTop = logEl.scrollHeight;
    if (level === 'error') console.error('[Caricamento città]', message);
    else console.debug('[Caricamento città]', message);
  }
  function paint() {
    const resources = [...tracked.values()];
    const done = resources.filter(r => r.state === 'done').length;
    const pending = resources.filter(r => r.state === 'pending');
    const partial = pending.reduce((sum, r) => sum + (r.total ? Math.min(.99, r.loaded / r.total) : 0), 0);
    const count = resources.length;
    // Not a fake byte progress: count completed files plus known partial transfers.
    const pct = complete ? 100 : count ? Math.min(95, Math.floor((done + partial) / Math.max(count, done + pending.length + 1) * 100)) : 0;
    progressEl.style.width = pct + '%';
    progressEl.setAttribute('aria-valuenow', String(pct));
    numbersEl.textContent = (complete ? '100%' : pct + '% stimato') + ' · ' + done + '/' + count + ' risorse completate' + (pending.length ? ' · ' + pending.length + ' in corso' : '');
    currentEl.textContent = pending.length ? 'Caricamento: ' + category(pending[pending.length - 1].url) + ' — ' + urlLabel(pending[pending.length - 1].url) : failed ? 'Caricamento interrotto' : 'Preparazione della scena…';
  }
  function begin(url) {
    const id = ++n;
    const record = {url: String(url), loaded: 0, total: 0, state: 'pending'};
    tracked.set(id, record); lastActivity = Date.now();
    log('↓ ' + category(record.url) + ': ' + urlLabel(record.url));
    paint(); return id;
  }
  function update(id, loaded, total) { const r = tracked.get(id); if (!r) return; r.loaded = loaded || 0; r.total = total || 0; lastActivity = Date.now(); paint(); }
  function end(id, ok, reason) {
    const r = tracked.get(id); if (!r || r.state !== 'pending') return;
    r.state = ok ? 'done' : 'error'; lastActivity = Date.now();
    log((ok ? '✓ ' : '✗ ') + urlLabel(r.url) + (reason ? ' — ' + reason : ''), ok ? 'ok' : 'error');
    if (!ok) { failed = true; retry.hidden = false; stageEl.textContent = 'Errore caricamento: ' + category(r.url); }
    paint();
  }
  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) { this.__loadUrl = url; return nativeOpen.call(this, method, url, ...rest); };
  XMLHttpRequest.prototype.send = function (...args) {
    const url = this.__loadUrl;
    if (url && !/^(data:|blob:)/i.test(String(url))) {
      const id = begin(url);
      this.addEventListener('progress', e => update(id, e.loaded, e.lengthComputable ? e.total : 0));
      this.addEventListener('load', () => end(id, this.status === 0 || this.status >= 200 && this.status < 400, 'HTTP ' + this.status));
      this.addEventListener('error', () => end(id, false, 'errore rete'));
      this.addEventListener('abort', () => end(id, false, 'richiesta annullata'));
      this.addEventListener('timeout', () => end(id, false, 'timeout'));
    }
    return nativeSend.apply(this, args);
  };
  const originalFetch = globalThis.fetch;
  if (originalFetch) globalThis.fetch = function(input, init) {
    const url = typeof input === 'string' ? input : input?.url;
    if (!url || /^(data:|blob:)/i.test(String(url))) return originalFetch.apply(this, arguments);
    const id = begin(url);
    return originalFetch.apply(this, arguments).then(response => {
      end(id, response.ok, response.ok ? '' : 'HTTP ' + response.status);
      return response;
    }, error => { end(id, false, error?.message || 'errore rete'); throw error; });
  };
  const api = {
    stage(message) { stage = message; if (!failed) stageEl.textContent = message; log('FASE: ' + message); paint(); },
    done() { complete = true; paint(); log('Scena pronta.', 'ok'); },
    error(error) { failed = true; stageEl.textContent = 'Impossibile avviare la scena'; retry.hidden = false; log(error?.stack || error?.message || String(error), 'error'); paint(); },
    show() { overlay.style.display = 'flex'; retry.hidden = true; failed = false; complete = false; started = Date.now(); this.stage('Caricamento scena'); },
    hide() { overlay.style.display = 'none'; }
  };
  globalThis.cityLoading = api;
  setInterval(() => {
    if (overlay.style.display === 'none' || complete || failed) return;
    if (Date.now() - lastActivity > 12000 && Date.now() - started > 12000) {
      currentEl.textContent = 'Nessun progresso da ' + Math.floor((Date.now() - lastActivity) / 1000) + ' s: ' + ([...tracked.values()].filter(r => r.state === 'pending').map(r => urlLabel(r.url)).slice(-2).join(', ') || stage);
      if (!overlay.dataset.stalled) { overlay.dataset.stalled = '1'; log('ATTENZIONE: nessuna attività di rete da 12 secondi. Verifica file mancanti, connessione e console.', 'error'); retry.hidden = false; }
    } else overlay.dataset.stalled = '';
  }, 2000);
  addEventListener('unhandledrejection', e => { api.error(e.reason || 'Promise non gestita'); });
  addEventListener('error', e => { if (e.target === window && e.error) api.error(e.error); }, true);
  log('Monitor risorse attivo.');
})();
