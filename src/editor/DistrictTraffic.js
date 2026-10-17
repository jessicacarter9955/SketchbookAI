import * as THREE from 'three';
import {clone} from 'three/examples/jsm/utils/SkeletonUtils.js';
import {districtGround,districtDeckHeight,districtIsLand} from './district-data.mjs';

const SAY={
 ny:{hello:'Benvenuto a Downtown. Qui le avenue sono larghe e i palazzi sono altissimi.',
  about:'Grattacieli e isolati fitti: il traffico usa le carreggiate, i pedoni i marciapiedi.',
  where:'A sud trovi la costa tropicale, a est le colline di San Francisco.'},
 sf:{hello:'Queste salite sono perfette per provare sospensioni, freni e tenuta.',
  about:'Case colorate, strade ripide, vegetazione meno tropicale e vista sulla baia.',
  where:'Vai verso sud per arrivare alla spiaggia di Miami o al grande viadotto.'},
 rio:{hello:'Questo quartiere mette insieme colline verdi, terrazze e costa.',
  about:'Una passeggiata tra palme, edifici terrazzati e strade panoramiche.',
  where:'Per raggiungere Miami, attraversa il viadotto che passa sopra l’insenatura.'},
 miami:{hello:'Benvenuto sul lungomare: palme, alberghi, case pastello e oceano.',
  about:'Qui i boulevard costieri attraversano la zona balneare.',
  where:'Il ponte collega questo quartiere a Rio; più a nord ci sono le colline.'}
};
export function districtDialogue(id,kind='hello'){
 return (SAY[id]||SAY.ny)[kind]||SAY.ny.hello;
}
function length(a,b){return Math.hypot(b[0]-a[0],b[1]-a[1]);}
function samplePath(points,distance){
 const path=points.filter(Boolean),lengths=path.map((a,i)=>length(a,path[(i+1)%path.length]));
 const total=lengths.reduce((a,b)=>a+b,0);
 if(total<=0)return {x:path[0]?.[0]||0,z:path[0]?.[1]||0,dx:0,dz:1};
 let t=((distance%total)+total)%total;
 for(let i=0;i<path.length;i++){
  const len=lengths[i];if(t>len){t-=len;continue;}
  const a=path[i],b=path[(i+1)%path.length],u=t/Math.max(1e-5,len);
  const dx=(b[0]-a[0])/Math.max(1e-5,len),dz=(b[1]-a[1])/Math.max(1e-5,len);
  return {x:a[0]+(b[0]-a[0])*u,z:a[1]+(b[1]-a[1])*u,dx,dz};
 }
 return {x:path[0][0],z:path[0][1],dx:0,dz:1};
}
export class DistrictTraffic {
 constructor(world){
  this.world=world;this.plan=world.levelRuntime.plan;this.time=0;this.cars=[];this.people=[];
  this.group=new THREE.Group();this.group.name='Four-district autonomous traffic and pedestrians';world.graphicsWorld.add(this.group);
  this.makeAgents();this.mountDialogue();this.keydown=e=>this.onKey(e);
  window.addEventListener('keydown',this.keydown,true);
  world.registerUpdatable(this);
 }
 makeAgents(){
  const sourceCar=this.world.actorLayer.car.scene,person=this.world.actorLayer.person.scene;
  for(const route of this.plan.routes){
   if(route.points.length<3)continue;
   const total=route.points.reduce((n,p,i)=>n+length(p,route.points[(i+1)%route.points.length]),0);
   const amount=route.district==='bridge'?4:5;
   for(let i=0;i<amount;i++){
    const car=clone(sourceCar);car.scale.setScalar(.82);
    car.traverse(n=>{if(n.isMesh){n.castShadow=false;n.receiveShadow=true;}});
    car.userData.ambientTraffic=true;
    this.group.add(car);
    this.cars.push({object:car,route:route.points,distance:total*i/amount+6,
      speed:route.district==='bridge'?13:route.district==='sf'?7:9.5,
      id:route.district,offset:route.district==='bridge'?i%2===0?2:-2:1.35});
   }
  }
  // One local sidewalk loop per neighborhood plus fixed guides next to the spawn points.
  for(const route of this.plan.pedRoutes.slice(0,18)){
   if(route.length<4)continue;
   const centerX=route.reduce((n,p)=>n+p[0],0)/route.length;
   const zone=this.plan.zones.find(d=>Math.abs(d.center[0]-centerX)<160)||
     this.plan.zones[0],count=2;
   const perimeter=route.reduce((n,p,i)=>n+length(p,route[(i+1)%route.length]),0);
   for(let j=0;j<count;j++){
    const npc=clone(person);npc.scale.setScalar(.96);this.group.add(npc);
    npc.traverse(n=>{if(n.isMesh)n.castShadow=false;});
    this.people.push({object:npc,route,progress:perimeter*(j+.4)/count,
      speed:.95+j*.16,id:zone.id,paused:false});
   }
  }
  for(const d of this.plan.zones){
   const spawn=this.plan.spawns.find(s=>s.id==='district-'+d.id),pos=spawn.position;
   const npc=clone(person);this.group.add(npc);npc.scale.setScalar(.98);
   this.people.push({object:npc,route:[[pos[0]+2,pos[2]+4],[pos[0]+2,pos[2]+6],
      [pos[0]+3,pos[2]+6],[pos[0]+3,pos[2]+4]],progress:0,speed:.4,id:d.id,paused:false});
  }
 }
 mountDialogue(){
  const ui=document.createElement('section');ui.id='district-dialogue';
  ui.setAttribute('aria-label','Dialogo abitanti dei quartieri');
  ui.style.cssText='position:fixed;z-index:10010;bottom:90px;left:50%;transform:translateX(-50%);'+
    'width:min(440px,93vw);background:#10222ce9;color:#fff;border:1px solid #a5c0c9;border-radius:12px;'+
    'font:14px/1.5 system-ui;padding:12px;box-shadow:0 12px 42px #0008;display:none';
  ui.innerHTML='<b data-zone>Quartiere</b><p data-line></p><div style="display:flex;gap:6px;flex-wrap:wrap">'+
    '<button data-answer="about">Parlami del quartiere</button><button data-answer="where">Dove porta la strada?</button>'+
    '<button data-answer="close">Chiudi</button></div>';
  document.body.append(ui);this.dialogue=ui;this.activeNpc=null;
  ui.querySelectorAll('[data-answer]').forEach(btn=>btn.addEventListener('click',()=>{
   if(btn.dataset.answer==='close')this.closeDialogue();
   else this.dialogue.querySelector('[data-line]').textContent=districtDialogue(this.activeNpc?.id,btn.dataset.answer);
  }));
  const talk=document.createElement('button');talk.textContent='💬 Parla con abitante · E/T';
  talk.id='district-talk';talk.style.cssText='position:fixed;z-index:10008;bottom:18px;left:12px;'+
   'border:1px solid #91bdc0;background:#102831df;color:#fff;border-radius:9px;padding:9px 13px;'+
   'font:600 12px system-ui';
  talk.onclick=()=>this.interact();document.body.append(talk);this.talk=talk;
 }
 nearest(){
  const player=this.world.editorPlayer;
  if(!player||player.controlledObject)return null;
  let best=null,dist=Infinity;
  for(const npc of this.people){
   const d=Math.hypot(npc.object.position.x-player.position.x,npc.object.position.z-player.position.z);
   if(d<dist){best=npc;dist=d;}
  }
  return dist<5?best:null;
 }
 interact(){
  if(this.activeNpc){this.closeDialogue();return;}
  if(this.world.sceneEditor?.active)return;
  const npc=this.nearest();if(!npc)return;
  this.activeNpc=npc;npc.paused=true;
  this.dialogue.querySelector('[data-zone]').textContent=this.plan.zones.find(d=>d.id===npc.id)?.name||'Abitante';
  this.dialogue.querySelector('[data-line]').textContent=districtDialogue(npc.id);
  this.dialogue.style.display='block';
  // RPG-style camera emphasis without changing the navigation system or teleporting.
  const player=this.world.editorPlayer,delta=npc.object.position.clone().sub(player.position);
  if(this.world.cameraOperator){this.world.cameraOperator.theta=Math.atan2(delta.x,delta.z)*180/Math.PI;
    this.world.cameraOperator.phi=13;}
 }
 closeDialogue(){
  if(this.activeNpc)this.activeNpc.paused=false;
  this.activeNpc=null;this.dialogue.style.display='none';
 }
 onKey(e){
  if(e.repeat||!['KeyE','KeyT','Escape'].includes(e.code))return;
  if(e.code==='Escape'&&this.activeNpc){this.closeDialogue();e.stopPropagation();return;}
  if(e.code==='KeyT'||e.code==='KeyE'&&(this.activeNpc||this.nearest())){
   if(!this.world.sceneEditor?.active){this.interact();e.preventDefault();e.stopImmediatePropagation();}
  }
 }
 update(dt){
  const editorActive=this.world.sceneEditor?.active;
  this.group.visible=!editorActive;this.talk.hidden=editorActive;
  if(editorActive&&this.activeNpc)this.closeDialogue();
  if(editorActive)return;
  const step=Math.max(0,Math.min(Number(dt)||0,.06));this.time+=step;
  const player=this.world.editorPlayer;
  const camera=this.world.camera.position;
  const near=(x,z,max=190)=>Math.hypot(camera.x-x,camera.z-z)<max||
    player&&Math.hypot(player.position.x-x,player.position.z-z)<max;
  for(const car of this.cars){
   car.distance+=car.speed*step;
   const p=samplePath(car.route,car.distance);
   const x=p.x-p.dz*car.offset,z=p.z+p.dx*car.offset;
   const bridge=car.id==='bridge',gy=bridge?districtDeckHeight(x,z):null;
   car.object.position.set(x,(gy??districtGround(x,z))+.25,z);
   car.object.rotation.y=Math.atan2(p.dx,p.dz);
   car.object.visible=near(x,z,195);
  }
  for(const npc of this.people){
   if(!npc.paused)npc.progress+=npc.speed*step;
   const p=samplePath(npc.route,npc.progress);
   npc.object.position.set(p.x,districtGround(p.x,p.z)+.08,p.z);
   npc.object.rotation.y=Math.atan2(p.dx,p.dz);
   npc.object.visible=near(p.x,p.z,120);
  }
 }
 dispose(){
  window.removeEventListener('keydown',this.keydown,true);
  this.closeDialogue();this.dialogue.remove();this.talk.remove();this.group.removeFromParent();
 }
}
