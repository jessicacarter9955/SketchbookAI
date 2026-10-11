// Load before the application bundle to capture all asset requests and their stalls.
(function(){
  'use strict';
  const pending=new Map(),stages=new Map(),history=[];let sequence=0,lastTick=performance.now();
  let started=performance.now(),lastActivity=started,lastStage='Avvio JavaScript',lastCompleted='nessuno';
  const label=url=>{
    try {const u=new URL(url,location.href);return decodeURI(u.pathname).split('/').slice(-4).join('/').slice(-135);}
    catch {return String(url).slice(0,135);}
  };
  const now=()=>Math.round(performance.now()/1000);
  const panel=document.getElementById('loading-screen');
  const details=document.createElement('details');
  details.className='city-telemetry';details.open=true;
  details.innerHTML='<summary>Diagnostica in tempo reale · ogni 2,5 secondi</summary><div id="city-debug-summary">Preparazione monitor…</div><pre id="city-debug-log" aria-live="off"></pre>';
  panel?.querySelector('.city-loading-panel')?.append(details);
  const summary=details.querySelector('#city-debug-summary'),logEl=details.querySelector('#city-debug-log');
  function line(s,type='',activity=true){
    const txt='['+new Date().toLocaleTimeString()+'] '+s;
    history.push(txt);if(history.length>100)history.shift();
    if(logEl){const span=document.createElement('div');span.textContent=txt;if(type)span.className='log-'+type;logEl.append(span);
      while(logEl.children.length>100)logEl.firstChild.remove();logEl.scrollTop=logEl.scrollHeight;}
    if(type==='error')console.error('[CITY DIAG]',txt);else console.info('[CITY DIAG]',txt);
    if(activity)lastActivity=performance.now();
  }
  const api={
    stage(name,state='running'){
      const prior=stages.get(name);
      if(prior?.state===state)return;
      const start=prior?.start||performance.now();
      stages.set(name,{start,state});lastStage=name;
      line((state==='done'?'OK ':state==='error'?'ERRORE ':'FASE ')+name+(state==='done'?' · '+Math.round((performance.now()-start)/1000)+'s':''),
        state==='error'?'error':'');
    },
    activity(msg){line(msg);},
    problem(err,area='Errore JS'){line(area+': '+String(err?.message||err),'error');},
    snapshot(){return {elapsed:now(),stages:[...stages],pending:[...pending.values()].map(v=>({url:v.url,seconds:Math.round((performance.now()-v.start)/1000),loaded:v.loaded,total:v.total})),recent:history.slice(-25)};}
  };
  globalThis.cityDiagnostics=api;
  function register(url,kind){
    const id=++sequence;const name=label(url);
    pending.set(id,{id,url:name,kind,start:performance.now(),loaded:0,total:0});
    if(/assets|\.gltf|\.bin|\.glb|\.hdr|\.jpg|\.png|\.webp|\.ktx/i.test(name))line(kind+' ↑ '+name);
    return id;
  }
  function finish(id,error){
    const entry=pending.get(id);if(!entry)return;
    lastActivity=performance.now();
    pending.delete(id);const duration=((performance.now()-entry.start)/1000).toFixed(1);
    lastCompleted=entry.url+' ('+duration+'s)';
    if(error)line(entry.kind+' FALLITO '+entry.url+' · '+error,'error');
    else if(duration>0.3)line(entry.kind+' OK '+entry.url+' · '+duration+'s');
  }
  const originalOpen=XMLHttpRequest.prototype.open;
  const originalSend=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open=function(method,url,...args){this.__cityUrl=url;return originalOpen.call(this,method,url,...args);};
  XMLHttpRequest.prototype.send=function(...args){
    const url=this.__cityUrl;
    if(url&&!/^(data:|blob:)/i.test(String(url))){
      const id=register(url,'XHR');let failed='';
      this.addEventListener('progress',e=>{const entry=pending.get(id);if(entry){entry.loaded=e.loaded;entry.total=e.lengthComputable?e.total:0;lastActivity=performance.now();}});
      this.addEventListener('error',()=>{failed='errore rete';});
      this.addEventListener('timeout',()=>{failed='timeout';});
      this.addEventListener('abort',()=>{failed='annullato';});
      this.addEventListener('loadend',()=>finish(id,failed||(this.status>=400?'HTTP '+this.status:'')));
    }
    return originalSend.apply(this,args);
  };
  const originalFetch=globalThis.fetch;
  if(originalFetch)globalThis.fetch=function(input,init){
    const url=typeof input==='string'?input:input?.url;
    if(!url||/^(data:|blob:)/i.test(String(url)))return originalFetch.apply(this,arguments);
    const id=register(url,'FETCH');
    return originalFetch.apply(this,arguments).then(response=>{
      // Preserve original response. Body download still may be outstanding:
      // fetch() completion only means its headers arrived.
      finish(id,!response.ok?'HTTP '+response.status:'');
      return response;
    },err=>{finish(id,err?.message||String(err));throw err;});
  };
  function heartbeat(){
    const nowMs=performance.now(),gap=Math.round(nowMs-lastTick);lastTick=nowMs;
    const active=[...pending.values()].sort((a,b)=>a.start-b.start);
    const most=active.slice(0,3).map(v=>v.url+' '+Math.round((nowMs-v.start)/1000)+'s'+(v.total?' '+Math.round(100*v.loaded/v.total)+'%':'')).join(' | ');
    const waiting=[...stages.entries()].filter(([_,v])=>v.state==='running').map(([k,v])=>k+' ('+Math.round((nowMs-v.start)/1000)+'s)');
    const world=globalThis.world,renderer=world?.renderer;
    const render=renderer?.info?.render;
    const perf=render?('drawcalls '+render.calls+', triangoli '+render.triangles+', texture '+renderer.info.memory.textures):'renderer non ancora pronto';
    const blocked=gap>4800?' · JS bloccato '+Math.round(gap/1000)+'s':'';
    const slow=active.filter(v=>nowMs-v.start>10000);
    const status='Tempo '+now()+'s · '+(waiting.join('; ')||lastStage)+
      '\nIn rete '+active.length+': '+(most||'nessun download attivo; possibile attesa JS/promise')+
      '\nUltimo completato: '+lastCompleted+' · '+perf+blocked;
    if(summary)summary.textContent=status;
    line('CHECK '+now()+'s | '+(waiting.at(-1)||lastStage)+' | '+perf+' | pendenti '+active.length+(most?' | '+most:'')+blocked,'',false);
    if(slow.length)line('DOWNLOAD LENTO: '+slow.map(x=>x.url+' '+Math.round((nowMs-x.start)/1000)+'s').join(' | '),'warn',false);
    if(!active.length&&waiting.length&&nowMs-lastActivity>12000)
      line('NESSUN DOWNLOAD ATTIVO da '+Math.round((nowMs-lastActivity)/1000)+'s; fase ancora incompleta: '+waiting.join(' | '),'warn',false);
  }
  setInterval(heartbeat,2500);
  addEventListener('unhandledrejection',e=>api.problem(e.reason,'Promise non gestita'));
  addEventListener('error',e=>{if(e.error)api.problem(e.error,'Eccezione');},true);
  addEventListener('keydown',e=>{if(e.code==='F8'){e.preventDefault();details.open=!details.open;document.body.classList.toggle('city-debug-always',details.open);}});
  if(new URLSearchParams(location.search).get('debug')==='1')document.body.classList.add('city-debug-always');
  api.stage('Avvio editor e caricamento motore');
})();
