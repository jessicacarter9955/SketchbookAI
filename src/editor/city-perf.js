/* City Player performance instrumentation. Only active with ?perf=1. */
(()=>{
  const qs=new URLSearchParams(location.search);
  if(qs.get('perf')!=='1')return;
  const buffer=[],capacity=360;
  let previous=0,lastNotice=0;
  const stats={
    samples:0,fps:0,frameP50Ms:0,frameP95Ms:0,
    updateMeanMs:0,physicsMeanMs:0,actorsMeanMs:0,renderMeanMs:0,
    drawCalls:0,triangles:0,geometries:0,textures:0,pixelRatio:0,
    hardware:{userAgent:navigator.userAgent,cores:navigator.hardwareConcurrency||null}
  };
  function percentile(values,percent){
    if(!values.length)return 0;
    const ordered=values.slice().sort((a,b)=>a-b);
    return ordered[Math.min(ordered.length-1,Math.ceil(ordered.length*percent)-1)];
  }
  function round(value,decimals=1){const multiplier=10**decimals;return Math.round(value*multiplier)/multiplier;}
  const panel=document.createElement('aside');
  panel.setAttribute('aria-label','City FPS profiler');
  panel.style.cssText='position:fixed;right:9px;top:9px;z-index:100000;max-width:min(420px,95vw);padding:10px 12px;background:#0c1721eb;color:#edffff;border:1px solid #368b9d;border-radius:8px;font:12px/1.5 ui-monospace,Consolas,monospace;white-space:pre-line;pointer-events:auto';
  const label=document.createElement('div');label.textContent='FPS · avvio misurazione…';
  const button=document.createElement('button');button.textContent='Copia report FPS';
  button.style.cssText='font:inherit;margin-top:6px;padding:4px 8px;background:#19566b;color:#fff;border:1px solid #4590a4;border-radius:4px';
  panel.append(label,button);
  const snapshot=()=>({timestamp:new Date().toISOString(),url:location.href,metrics:{...stats},recentFrames:buffer.slice(-180)});
  button.onclick=()=>{
    const text=JSON.stringify(snapshot(),null,2);
    navigator.clipboard?.writeText(text).then(()=>{button.textContent='Copiato';},()=>{console.info('CITY_FPS_REPORT',text);button.textContent='Report in console';});
  };
  document.addEventListener('DOMContentLoaded',()=>document.body.append(panel),{once:true});
  globalThis.cityPerfMonitor={
    record(sample){
      const time=performance.now();
      if(previous){
        const frame=time-previous;
        if(frame>0&&frame<1500){
          buffer.push({frameMs:frame,updateMs:sample.updateMs,physicsMs:sample.physicsMs,actorsMs:sample.actorsMs,renderMs:sample.renderMs});
          if(buffer.length>capacity)buffer.shift();
        }
      }
      previous=time;
      // renderer.info is reset by Three.js on some postprocessing passes.
      // Render counters are therefore a directional indicator, not a GPU timer.
      stats.drawCalls=sample.calls??0;stats.triangles=sample.triangles??0;
      stats.geometries=sample.geometries??0;stats.textures=sample.textures??0;stats.pixelRatio=sample.pixelRatio??0;
      if(time-lastNotice<2500||buffer.length<5)return;
      lastNotice=time;
      const avg=key=>buffer.reduce((sum,f)=>sum+f[key],0)/buffer.length;
      const frameMean=avg('frameMs');
      stats.samples=buffer.length;
      stats.fps=round(1000/frameMean);
      stats.frameP50Ms=round(percentile(buffer.map(f=>f.frameMs),.5));
      stats.frameP95Ms=round(percentile(buffer.map(f=>f.frameMs),.95));
      stats.updateMeanMs=round(avg('updateMs'),2);
      stats.physicsMeanMs=round(avg('physicsMs'),2);
      stats.actorsMeanMs=round(avg('actorsMs'),2);
      stats.renderMeanMs=round(avg('renderMs'),2);
      const hint=stats.frameP95Ms>16.7?'frame P95 oltre 16.7 ms':'frame P95 entro 16.7 ms';
      label.textContent='FPS '+stats.fps+' · frame P50 '+stats.frameP50Ms+' ms · P95 '+stats.frameP95Ms+' ms\n'+
        'CPU update '+stats.updateMeanMs+' ms (fisica '+stats.physicsMeanMs+' / attori '+stats.actorsMeanMs+')\n'+
        'Render submit '+stats.renderMeanMs+' ms · pixel ratio '+stats.pixelRatio+'\n'+
        'Draw calls '+stats.drawCalls+' · triangoli '+stats.triangles+' · geometrie '+stats.geometries+' · texture '+stats.textures+'\n'+hint;
      console.info('[CITY FPS]',JSON.stringify(stats));
    },
    snapshot,
    metrics:stats
  };
})();
