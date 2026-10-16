import * as THREE from 'three';
import {clone} from 'three/examples/jsm/utils/SkeletonUtils';
import {StreetLabCrimeState,LAB_WEAPONS,findSanAndreasPursuitPath} from './streetlab-crime-state.mjs';
import {createSanAndreasSpatialIndex,nodesNear} from './sa-agent-navigation.mjs';

// GTA-like sandbox prototype: money pickups, inventory/ammunition, reactive
// wanted stars and police using actual SA pedestrian graph nodes.
export class StreetLabCrime{
 constructor(world,editor,key){
  this.world=world;this.editor=editor;this.key=key+'.law';this.count=0;this.last=performance.now();
  let saved;try{saved=JSON.parse(localStorage.getItem(this.key)||'null');}catch{}
  this.state=new StreetLabCrimeState(saved||{});
  this.group=new THREE.Group();this.group.name='StreetLab police and money';
  world.graphicsWorld.add(this.group);
  this.cops=[];this.pickups=[];this.policeIndex=createSanAndreasSpatialIndex(world.levelRuntime.navigation?.pedestrian);
  this.lastPatrol=0;this.lastDamage=0;this.lastHud=0;
  this.createUI();this.makePickups();this.listeners();this.run();
 }
 createUI(){
  const hud=document.createElement('section');hud.className='sa-streetlab-law';
  hud.style.cssText='position:fixed;left:12px;bottom:82px;z-index:21;background:rgba(5,12,24,.85);color:#fff;padding:10px;border:1px solid #73a5b5;border-radius:9px;max-width:340px;font:13px system-ui';
  hud.innerHTML='<strong>STREETLAB · OPEN WORLD</strong><div data-lab-vitals></div><div data-lab-weapon></div>'+
   '<div data-lab-status role="status"></div>'+
   '<button type="button" data-lab-inventory>🎒 Inventario I</button>'+
   '<button type="button" data-lab-shoot>🔫 Spara</button>'+
   '<button type="button" data-lab-reload>↻ Ricarica</button>'+
   '<button type="button" data-lab-cash>💵 Raccogli E</button>'+
   '<div data-lab-bag hidden style="padding-top:8px;border-top:1px solid #70899b"><div data-lab-items></div>'+
   '<button data-lab-buy-pistol type="button">Munizioni pistola $35</button>'+
   '<button data-lab-buy-rifle type="button">Munizioni fucile $90</button>'+
   '<button data-lab-close type="button">Chiudi</button></div>';
  document.body.append(hud);this.hud=hud;this.bag=hud.querySelector('[data-lab-bag]');
  hud.querySelector('[data-lab-inventory]').onclick=()=>{this.bag.hidden=!this.bag.hidden;this.draw();};
  hud.querySelector('[data-lab-close]').onclick=()=>{this.bag.hidden=true;};
  hud.querySelector('[data-lab-shoot]').onclick=()=>this.shoot();
  hud.querySelector('[data-lab-reload]').onclick=()=>{if(this.state.reload())this.message('Arma ricaricata.');this.save();this.draw();};
  hud.querySelector('[data-lab-cash]').onclick=()=>this.collect();
  for(const id of ['pistol','rifle'])hud.querySelector('[data-lab-buy-'+id+']').onclick=()=>{
   this.message(this.state.buyAmmo(id)?'Munizioni acquistate.':'Crediti insufficienti.');
   this.save();this.draw();
  };
  this.draw();
 }
 message(text){this.hud.querySelector('[data-lab-status]').textContent=text;}
 save(){try{localStorage.setItem(this.key,JSON.stringify(this.state.snapshot()));}catch{}}
 draw(){
  const s=this.state,w=LAB_WEAPONS[s.weapon],a=s.ammo[s.weapon];
  this.hud.querySelector('[data-lab-vitals]').textContent='💵 $'+s.cash+' · ❤️ '+s.health+' · '+'★'.repeat(s.wanted)+'☆'.repeat(5-s.wanted);
  this.hud.querySelector('[data-lab-weapon]').textContent=w?w.name+': '+a.magazine+'/'+a.reserve:'Disarmato';
  this.hud.querySelector('[data-lab-items]').textContent='1 Pistola · 2 Fucile · 3 Disarmato · R ricarica · Click spara · E raccogli denaro. La grafica delle armi richiede i GLB DDS.';
 }
 makePickups(){
  const sp=this.world.levelRuntime.manifest.spawns[0].position;
  const placements=[[8,8],[-8,9],[14,-5],[-13,-8],[21,10],[-18,18]];
  const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#102a1a';ctx.beginPath();ctx.arc(64,64,52,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#b3e79a';ctx.lineWidth=6;ctx.stroke();
  ctx.fillStyle='#d7ff86';ctx.font='bold 66px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('$',64,68);
  const material=new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),transparent:true,depthWrite:false});
  for(let i=0;i<placements.length;i++){
   const x=sp[0]+placements[i][0],z=sp[2]+placements[i][1];
   const y=this.world.levelRuntime.groundAt(x,z,sp[1]+5);
   if(y===undefined)continue;
   const obj=new THREE.Sprite(material);obj.position.set(x,y+1.25,z);obj.scale.set(1.2,1.2,1);
   obj.visible=!this.state.loot.includes(i);this.group.add(obj);this.pickups.push({id:i,obj});
  }
 }
 collect(){
  const p=this.world.editorPlayer?.position;if(!p||this.editor.active)return;
  const nearby=this.pickups.find(x=>x.obj.visible&&x.obj.position.distanceTo(p)<3);
  if(nearby&&this.state.collect(nearby.id)){
   nearby.obj.visible=false;this.message('Raccolti $100.');this.save();this.draw();
  }else this.message('Avvicinati al simbolo del denaro per raccoglierlo.');
 }
 canShoot(){return !this.editor.active&&!this.bag.hidden===false&&!this.world.editorPlayer?.controlledObject;}
 shoot(){
  if(this.editor.active||!this.bag.hidden||this.world.editorPlayer?.controlledObject)return;
  const w=this.state.fire();if(!w){this.message('Nessun colpo. Premi R per ricaricare.');return;}
  const ray=new THREE.Raycaster(this.world.camera.position,
    this.world.camera.getWorldDirection(new THREE.Vector3()),0,110);
  let target=null;
  const hit=ray.intersectObjects(this.cops.filter(c=>c.alive).map(c=>c.object),true)[0];
  if(hit){
   const cop=this.cops.find(c=>{let node=hit.object;while(node){if(node===c.object)return true;node=node.parent;}return false;});
   if(cop){
    cop.health-=w.damage;target=cop;
    if(cop.health<=0){cop.alive=false;cop.object.visible=false;this.state.escalate(2);}
    else this.state.escalate(1);
   }
  }
  this.message(target?'Colpito agente. Ricercato '+this.state.wanted+' stelle.':'Sparo segnalato. Ricercato '+this.state.wanted+' stelle.');
  this.save();this.draw();
 }
 listeners(){
  document.addEventListener('keydown',e=>{
   if(this.editor.active||e.repeat||e.target.closest?.('input,textarea,select,dialog,[contenteditable=true]'))return;
   if(e.code==='KeyI'){e.preventDefault();this.bag.hidden=!this.bag.hidden;this.draw();}
   if(e.code==='Digit1'||e.code==='Digit2'||e.code==='Digit3'){
    this.state.weapon=e.code==='Digit1'?'pistol':e.code==='Digit2'?'rifle':null;this.save();this.draw();
   }
   if(e.code==='KeyR'&&this.state.reload()){this.save();this.draw();}
   if(e.code==='KeyE')this.collect();
  },true);
  this.world.renderer.domElement.addEventListener('pointerdown',e=>{
   if(e.button===0&&e.pointerType!=='touch'&&!this.editor.active&&this.bag.hidden)this.shoot();
  });
 }
 createCop(index,focus){
  const graph=this.world.levelRuntime.navigation?.pedestrian;
  if(!graph?.nodes.length)return;
  const far=nodesNear(this.policeIndex,focus.x,focus.z,95,120)
   .filter(n=>Math.hypot(n.x-focus.x,n.z-focus.z)>25);
  if(!far.length)return;
  const node=far[(index*17+Math.floor(this.count/3))%far.length];
  const model=clone(this.world.actorLayer.person.scene);
  model.traverse(o=>{if(o.isMesh){const mats=[].concat(o.material).map(m=>{
   const cloneMat=m?.clone?.()||new THREE.MeshStandardMaterial();cloneMat.color?.set(0x304a92);return cloneMat;});
   o.material=Array.isArray(o.material)?mats:mats[0];}});
  const obj=new THREE.Group();obj.name='Police pursuit prototype';
  obj.position.set(node.x,node.y+.15,node.z);obj.add(model);this.group.add(obj);
  let mixer=null;const clip=this.world.actorLayer.person.animations?.find(c=>/walk|run/i.test(c.name));
  if(clip){mixer=new THREE.AnimationMixer(model);mixer.clipAction(clip).play();}
  this.cops.push({object:obj,health:100,alive:true,speed:2.5+index*.2,index,
   path:[],pathIndex:0,lastRoute:0,mixer,nodeKey:node.key});
 }
 chase(c,focus,dt,now){
  const graph=this.world.levelRuntime.navigation?.pedestrian;
  if(now-c.lastRoute>1500||!c.path.length){
   c.lastRoute=now;
   const here=nodesNear(this.policeIndex,c.object.position.x,c.object.position.z,30,1)[0];
   const there=nodesNear(this.policeIndex,focus.x,focus.z,32,1)[0];
   if(here&&there){
    c.path=findSanAndreasPursuitPath(graph,here.key,there.key,1800);
    c.pathIndex=1;
   }
  }
  const next=c.path[c.pathIndex]||focus,dx=next.x-c.object.position.x,dz=next.z-c.object.position.z;
  const distance=Math.hypot(dx,dz);
  if(distance<1){c.pathIndex++;return;}
  const step=Math.min(distance,c.speed*dt);
  c.object.position.x+=dx/distance*step;c.object.position.z+=dz/distance*step;
  if(next.y!==undefined)c.object.position.y=next.y+.15;
  c.object.rotation.y=Math.atan2(dx,dz);
  if(c.object.visible&&distance<80)c.mixer?.update(dt);
 }
 run(){
  const loop=now=>{
   const dt=Math.max(0,Math.min(.1,(now-this.last)/1000));this.last=now;
   const player=this.world.editorPlayer;
   if(!this.editor.active&&player&&!this.world.levelRuntime.transitioning){
    const focus=player?.controlledObject?.position||player?.position;
    this.count+=dt;
    const near=this.cops.some(c=>c.alive&&c.object.position.distanceTo(focus)<45);
    const before=this.state.wanted;
    this.state.tick(dt,near);
    if(this.state.wanted&&now-this.lastPatrol>2500){
      this.lastPatrol=now;
      const alive=this.cops.filter(c=>c.alive);
      if(alive.length<Math.min(5,1+this.state.wanted)){
       this.createCop(this.cops.length,focus);
      }
    }
    for(const cop of this.cops){
      if(!cop.alive){if(now-(cop.removedAt||now)>8000)cop.object.visible=false;continue;}
      cop.object.visible=!!this.state.wanted;
      if(this.state.wanted)this.chase(cop,focus,dt,now);
      if(this.state.wanted&&cop.object.position.distanceTo(focus)<2.6&&now-this.lastDamage>2000){
       this.lastDamage=now;this.state.health=Math.max(0,this.state.health-10);
       if(!this.state.health){
        this.state.arrest();this.world.actorLayer.resetPlayer();this.message('Arrestato: -$100. Ricercato azzerato.');
       }else this.message('Polizia: -10 salute. Allontanati o disattiva le stelle.');
       this.save();this.draw();
      }
    }
    if(before!==this.state.wanted){this.message(this.state.wanted?'Ricercato '+this.state.wanted+' stelle':'Polizia seminata.');this.save();this.draw();}
   }
   if(now-this.lastHud>1200){this.lastHud=now;this.draw();}
   requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
 }
}
