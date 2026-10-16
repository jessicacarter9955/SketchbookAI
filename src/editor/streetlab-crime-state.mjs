// Small independent GTA-style sandbox progression. Not the full GTA police AI.
export const LAB_WEAPONS=Object.freeze({
 pistol:{name:'Pistola',magazine:12,reserve:60,interval:.3,damage:38,ammoPrice:35},
 rifle:{name:'Fucile',magazine:30,reserve:120,interval:.14,damage:25,ammoPrice:90}
});
const num=(n,f,max)=>Number.isFinite(n)?Math.max(0,Math.min(max,Math.floor(n))):f;
export class StreetLabCrimeState{
 constructor(save={}){
  this.cash=num(save.cash,450,9999999);
  this.health=num(save.health,100,100);
  this.wanted=num(save.wanted,0,5);
  this.weapon=['pistol','rifle',null].includes(save.weapon)?save.weapon:'pistol';
  this.ammo={};for(const [id,w] of Object.entries(LAB_WEAPONS)){
   const record=save.ammo?.[id]||{};
   this.ammo[id]={magazine:num(record.magazine,w.magazine,w.magazine),reserve:num(record.reserve,w.reserve,9999)};
  }
  this.loot=Array.isArray(save.loot)?save.loot.filter(id=>Number.isInteger(id)&&id>=0&&id<6):[];
  this.shotCooldown=0;this.quietFor=0;
 }
 snapshot(){return {version:1,cash:this.cash,health:this.health,wanted:this.wanted,
  weapon:this.weapon,ammo:structuredClone(this.ammo),loot:[...this.loot]};}
 tick(dt,policeNear=false){
  dt=Math.max(0,Math.min(.25,dt||0));
  this.shotCooldown=Math.max(0,this.shotCooldown-dt);
  if(this.wanted){
   this.quietFor=policeNear?0:this.quietFor+dt;
   if(this.quietFor>28){this.wanted--;this.quietFor=0;}
  }
 }
 fire(){
  const w=LAB_WEAPONS[this.weapon],a=this.ammo[this.weapon];
  if(!w||!a||!a.magazine||this.shotCooldown||!this.health)return null;
  a.magazine--;this.shotCooldown=w.interval;this.quietFor=0;
  this.wanted=Math.min(5,Math.max(1,this.wanted));
  return w;
 }
 escalate(stars=1){this.wanted=Math.min(5,Math.max(this.wanted+stars,1));this.quietFor=0;}
 reload(){
  const w=LAB_WEAPONS[this.weapon],a=this.ammo[this.weapon];
  if(!w||!a||!a.reserve)return false;
  const amount=Math.min(w.magazine-a.magazine,a.reserve);
  a.magazine+=amount;a.reserve-=amount;return amount>0;
 }
 buyAmmo(id){
  const w=LAB_WEAPONS[id];if(!w||this.cash<w.ammoPrice)return false;
  this.cash-=w.ammoPrice;this.ammo[id].reserve+=w.magazine*2;return true;
 }
 collect(index){
  if(this.loot.includes(index)||!Number.isInteger(index)||index<0||index>=6)return false;
  this.loot.push(index);this.cash+=100;return true;
 }
 arrest(){
  this.cash=Math.max(0,this.cash-100);this.health=100;this.wanted=0;this.quietFor=0;
 }
}
export function findSanAndreasPursuitPath(network,fromKey,toKey,maxVisited=2500){
 if(!network?.byKey?.has(fromKey)||!network.byKey.has(toKey))return [];
 const queue=[fromKey],prev=new Map([[fromKey,null]]);
 for(let i=0;i<queue.length&&i<maxVisited;i++){
  const id=queue[i];if(id===toKey)break;
  for(const e of network.byKey.get(id).edges||[])if(network.byKey.has(e.to)&&!prev.has(e.to)&&!network.byKey.get(e.to).roadBlock){
   prev.set(e.to,id);queue.push(e.to);
  }
 }
 if(!prev.has(toKey))return [];
 const path=[];for(let key=toKey;key!==null;key=prev.get(key))path.push(network.byKey.get(key));
 return path.reverse();
}
