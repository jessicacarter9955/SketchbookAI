/* Extra controls for TruthLab Pair live — script can be removed independently.
   Local Qwen inference uses open model weights in the browser and NEVER uses
   scraped keys. Free inference runs ONLY while this browser tab is open. */
(()=>{
"use strict";
const $=id=>document.getElementById(id);
const token=()=>sessionStorage.getItem("truthlab_token")||"";
let worker=null, workerReady=null, pending=null, live=false, stopping=false, urgent=false, nextTick=0;
let busy=false;
const TRAITS={cooperation:"cooperation",criticality:"criticality",reliability:"reliability",
speed:"speed",quality:"quality",warmth:"warmth"};
function notify(msg){const x=$("message");if(x){x.textContent=msg;x.style.display="block";setTimeout(()=>x.style.display="none",6500)}}
async function request(method,action,data={}){
  const res=await fetch(method==="GET"?"/api/state":"/api/control",{method,headers:{
    "Authorization":"Bearer "+token(),"Content-Type":"application/json"},
    ...(method==="POST"?{body:JSON.stringify({action,...data})}:{})});
  let json=await res.json(); if(!res.ok)throw new Error(json.error||("HTTP "+res.status));
  return json;
}
function makeButton(txt,fun){const b=document.createElement("button");b.type="button";b.textContent=txt;b.onclick=fun;return b}
const engineLine=document.createElement("div");engineLine.className="note";
engineLine.textContent="Free browser model: Qwen2.5 0.5B, WebGPU required; model loads locally. Keep tab open. AI activity is NOT independently verified.";
let localStart=makeButton("▶ Start free Qwen",()=>start());
let localStop=makeButton("■ Stop Qwen",()=>stop());
let localStatus=document.createElement("span");localStatus.className="sub";localStatus.textContent="Browser AI not started";
let root=document.createElement("div");
root.style.cssText="display:flex;align-items:center;flex-wrap:wrap;gap:9px;margin-top:9px";
root.append(localStart,localStop,localStatus);
document.querySelector(".actions")?.append(root);
document.querySelector(".intro")?.insertAdjacentElement("afterend",engineLine);
const individual={};
document.querySelectorAll(".agent").forEach((el,i)=>{
  const name=i===0?"Ari":"Noor";
  const wrap=document.createElement("div");
  wrap.style.cssText="margin-top:11px;display:flex;align-items:center;gap:8px;flex-wrap:wrap";
  let state=document.createElement("span");state.className="sub";state.textContent="Loading...";
  const button=makeButton("Pause",async()=>{
    try{const s=await request("GET");const next=!s.config.agents_enabled[name];
      await request("POST","set_agent",{agent:name,enabled:next});
      await refresh();
    }catch(e){notify(e.message)}
  });
  button.style.cssText="font-size:11px;padding:6px 8px";
  wrap.append(button,state);el.append(wrap);individual[name]={button,state};
});
const mainCard=document.querySelector(".grid > section.card");
let composer=document.createElement("div");
composer.style.cssText="border-top:1px solid var(--line);padding-top:15px;margin-top:18px";
composer.innerHTML='<h2>Operator chat</h2><p class="sub">Message one or both agents. Replies arrive during the next real or local Qwen cycle. No simulated replies are presented as real.</p>';
const form=document.createElement("form");form.style.cssText="display:flex;gap:9px;flex-wrap:wrap;align-items:end";
const selector=document.createElement("select");selector.style.cssText="border-radius:9px;padding:9px;color:#eff;background:#1a2943;border:1px solid #41506d";
["Both","Ari","Noor"].forEach(x=>{const o=document.createElement("option");o.value=o.textContent=x;selector.append(o)});
const input=document.createElement("textarea");input.placeholder="Ask Ari and/or Noor something, or change their direction...";input.maxLength=1800;input.style.cssText="flex:1;min-width:190px;min-height:62px";
const send=makeButton("Send to agents",()=>{});send.className="primary";send.type="submit";
form.append(selector,input,send);composer.append(form);mainCard?.append(composer);
form.onsubmit=async(e)=>{
 e.preventDefault();const t=input.value.trim();if(!t)return;
 try{await request("POST","message",{target:selector.value,text:t});input.value="";urgent=true;nextTick=0;notify("Message saved for "+selector.value+". Reply depends on the active inference engine.");}
 catch(err){notify(err.message)}
};
async function refresh(){
 if(!token())return;
 try{
  const s=await request("GET");for(const [a,ui] of Object.entries(individual)){
    const enabled=s.config.agents_enabled[a];
    ui.button.textContent=enabled?"Ⅱ Pause "+a:"▶ Resume "+a;
    ui.state.textContent=enabled?"Enabled":"Paused";
    ui.state.style.color=enabled?"var(--mint)":"var(--yellow)";
  }
  localStop.disabled=!live && !worker;
  localStart.disabled=busy||live||!s.config.agents_enabled.Ari&&!s.config.agents_enabled.Noor;
  if(!live && s.config.engine==="browser" && s.config.status==="active" && !s.browser_active){
    localStatus.textContent="Browser worker inactive (open tab & click Start)";
  }
 }catch(e){localStatus.textContent="Sign in to control agents";}
}
function waitWorker(){
 return new Promise((resolve,reject)=>{
  workerReady={resolve,reject};worker=new Worker("/browser-worker.js",{type:"module"});
  worker.onmessage=(e)=>{
   const d=e.data||{};
   if(d.type==="progress")localStatus.textContent=d.text;
   if(d.type==="ready"&&workerReady){workerReady.resolve();workerReady=null;}
   if(d.type==="result"&&pending&&d.id===pending.id){pending.resolve(d.text);pending=null;}
   if(d.type==="error"){localStatus.textContent="Qwen error: "+d.text;
     if(workerReady){workerReady.reject(new Error(d.text));workerReady=null;}
     if(pending){pending.reject(new Error(d.text));pending=null;}
   }
  };
  worker.onerror=e=>{
    if(workerReady){workerReady.reject(new Error(e.message||"Worker failed"));workerReady=null;}
    if(pending){pending.reject(new Error(e.message||"Worker failed"));pending=null;}
  };
  worker.postMessage({type:"init"});
 });
}
function reply(system,prompt){
 return new Promise((resolve,reject)=>{
  const id=Math.random().toString(36).slice(2);
  pending={id,resolve,reject};
  worker.postMessage({type:"generate",id,system,prompt});
 });
}
async function singleCycle(){
 let completed=0;
 for(const agent of ["Ari","Noor","Ari","Noor"]){
  if(stopping)break;
  const s=await request("GET");
  if(s.config.status!=="active" || s.config.engine!=="browser" || !s.config.agents_enabled[agent])continue;
  const char=s.config.charter; const t=s.config.traits; const name=agent;
  const persona=name==="Ari"?"Creative strategist and builder.":"Evidence-oriented collaborator, constructive critic and co-builder.";
  const system=char+"\nYour name is "+name+". You are an explicitly AI agent, not a human. "+persona+
    "\nCollaborative shared goal: "+s.config.goal+
    "\nRelationship attributes (0-100): "+JSON.stringify(t)+
    "\nFollow the goal with high quality and speed; verify uncertain claims, avoid dismissive comments. "+
    "You cannot browse, email, use wallets, spend, or post publicly. Never claim to have performed those actions. "+
    "Provide one concrete measurable next step. Reply in 50-110 words.";
  const history=s.messages.filter(x=>x.mode!=="demo").slice(-12).map(x=>x.speaker+": "+x.body).join("\n");
  localStatus.textContent="Qwen generating "+agent+"…";
  const answer=await reply(system, "Recent conversation:\n"+history+
   "\nYou are "+agent+". Respond to the other agent or to an Operator request addressed to you.");
  if(stopping)break;
  await request("POST","browser_message",{speaker:agent,text:answer});
  completed++;
 }
 if(completed>0){
   await request("POST","browser_report");
   localStatus.textContent="Conversation recorded · Next cycle hourly";
 }
}
async function loop(){
  while(live&&!stopping){
    try{
      const s=await request("GET");
      if(s.config.status!=="active"||s.config.engine!=="browser")break;
      await request("POST","browser_ping");
      if(Date.now()>=nextTick||urgent){
        urgent=false;await singleCycle();nextTick=Date.now()+3600000;
      }else{await new Promise(r=>setTimeout(r,4000))}
    }catch(e){notify("Qwen stopped: "+e.message);break}
  }
  live=false;busy=false;localStatus.textContent="Qwen stopped";localStop.disabled=true;
}
async function start(){
 if(live||busy)return;
 busy=true;stopping=false;localStart.disabled=true;
 try{
   if(!navigator.gpu)throw new Error("WebGPU unavailable in this browser. Try current Chrome/Edge on a GPU-enabled device.");
   await waitWorker();
   await request("POST","browser_start");
   live=true;busy=false;urgent=true;nextTick=0;localStatus.textContent="Local Qwen ready";
   loop();
 }catch(e){
   busy=false;live=false;stopping=true;
   worker?.terminate();worker=null;
   localStatus.textContent="Unable to initialize local Qwen";
   notify(e.message);
   await request("POST","pause").catch(()=>{});
 }
 await refresh();
}
async function stop(){
 stopping=true;live=false;urgent=false;
 try{await request("POST","pause")}catch(e){notify(e.message)}
 if(pending){pending.reject(new Error("Operator stopped local model"));pending=null;}
 worker?.terminate();worker=null;
 localStatus.textContent="Qwen stopped by operator";
 refresh();
}
setInterval(refresh,6500);
refresh();
})();