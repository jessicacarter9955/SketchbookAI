export const WEAPONS = Object.freeze({
    rifle: {name:'Fucile', capacity:30, reserve:90, damage:34, interval:0.12, reload:2.4, automatic:true},
    pistol: {name:'Pistola', capacity:12, reserve:48, damage:25, interval:0.28, reload:1.7, automatic:false}
});
export const SHOP_OFFERS=Object.freeze({
    'rifle-ammo':{name:'60 munizioni fucile',weapon:'rifle',quantity:60,price:60},
    'pistol-ammo':{name:'24 munizioni pistola',weapon:'pistol',quantity:24,price:30},
    medkit:{name:'Kit medico',quantity:1,price:45}
});
const bounded = (value, fallback, max) => Number.isFinite(value) ? Math.max(0,Math.min(max,Math.floor(value))) : fallback;
export class DdsGameState {
    constructor(saved) {
        const data = saved?.version===1 ? saved : {};
        this.health=bounded(data.health,100,100); this.medkits=bounded(data.medkits,2,10);
        this.ammo=Object.fromEntries(Object.entries(WEAPONS).map(([id,w])=>[id,{
            magazine:bounded(data.ammo?.[id]?.magazine,w.capacity,w.capacity),
            reserve:bounded(data.ammo?.[id]?.reserve,w.reserve,999)
        }]));
        this.owned=Array.isArray(data.owned) ? [...new Set(data.owned.filter(id=>WEAPONS[id]))] : ['rifle','pistol'];
        this.equipped=this.owned.includes(data.equipped) ? data.equipped : (data.equipped===null ? null : this.owned[0]??null);
        this.caseCollected=data.caseCollected===true; this.suppliesCollected=data.suppliesCollected===true;
        this.targets=Array.from({length:3},(_,i)=>bounded(data.targets?.[i],100,100));
        this.extracted=data.extracted===true; this.cooldown=0; this.reloadRemaining=0;
        this.credits=bounded(data.credits,250,999999);this.carryCapacity=12;this.maxWeight=18;
        this.npcHealth=Object.fromEntries(['guide','merchant','dummy-1','dummy-2','walker-1','walker-2'].map(id=>[id,bounded(data.npcHealth?.[id],100,100)]));
    }
    snapshot() { return {version:1,health:this.health,medkits:this.medkits,ammo:structuredClone(this.ammo),owned:[...this.owned],equipped:this.equipped,caseCollected:this.caseCollected,suppliesCollected:this.suppliesCollected,targets:[...this.targets],extracted:this.extracted,credits:this.credits,npcHealth:{...this.npcHealth}}; }
    get usedSlots(){return Number(this.medkits>0)+Number(this.caseCollected)+Object.values(this.ammo).filter(a=>a.reserve>0).length;}
    get currentWeight(){return this.owned.reduce((sum,id)=>sum+(id==='rifle'?3.6:0.9),0)+(this.ammo.rifle.magazine+this.ammo.rifle.reserve)*0.012+(this.ammo.pistol.magazine+this.ammo.pistol.reserve)*0.01+this.medkits*0.4+(this.caseCollected?2:0);}
    buy(id) {
        if(!this.health||this.extracted)return {ok:false,message:'Incursione conclusa.'};
        const offer=SHOP_OFFERS[id];if(!offer)return {ok:false,message:'Articolo non disponibile.'};
        if(this.credits<offer.price)return {ok:false,message:'Crediti insufficienti.'};
        const current=offer.weapon?this.ammo[offer.weapon].reserve:this.medkits, limit=offer.weapon?999:10;
        const addedWeight=offer.quantity*(offer.weapon?(offer.weapon==='rifle'?0.012:0.01):0.4);
        if(current+offer.quantity>limit||this.currentWeight+addedWeight>this.maxWeight||(!current&&this.usedSlots>=this.carryCapacity))return {ok:false,message:'Spazio o capacità insufficienti.'};
        if(offer.weapon)this.ammo[offer.weapon].reserve+=offer.quantity;else this.medkits+=offer.quantity;
        this.credits-=offer.price;return {ok:true,message:`Acquistato: ${offer.name}`};
    }
    equip(id) { if (id!==null && !this.owned.includes(id)) return false; this.equipped=id; this.reloadRemaining=0; return true; }
    fire() {
        const w=WEAPONS[this.equipped], ammo=this.ammo[this.equipped];
        if (!w || !this.health || this.extracted || this.reloadRemaining>0 || this.cooldown>0 || !ammo.magazine) return null;
        ammo.magazine--; this.cooldown=w.interval;
        return {weapon:this.equipped,damage:w.damage};
    }
    reload() {
        const w=WEAPONS[this.equipped], ammo=this.ammo[this.equipped];
        if (!w || !this.health || this.extracted || this.reloadRemaining || !ammo.reserve || ammo.magazine===w.capacity) return false;
        this.reloadRemaining=w.reload; return true;
    }
    tick(dt) {
        if (!Number.isFinite(dt) || dt<0) return false;
        this.cooldown=Math.max(0,this.cooldown-dt);
        if (!this.reloadRemaining) return false;
        this.reloadRemaining=Math.max(0,this.reloadRemaining-dt);
        if (this.reloadRemaining) return false;
        const ammo=this.ammo[this.equipped], capacity=WEAPONS[this.equipped].capacity;
        const amount=Math.min(capacity-ammo.magazine,ammo.reserve); ammo.magazine+=amount; ammo.reserve-=amount; return true;
    }
    heal() { if (!this.health || this.health===100 || !this.medkits) return false; this.medkits--; this.health=Math.min(100,this.health+50); return true; }
    damage(amount) { if (!Number.isFinite(amount) || amount<=0) return; this.health=Math.max(0,this.health-amount); if (!this.health) this.reloadRemaining=0; }
    hitTarget(index,damage) { if (!Number.isInteger(index) || index<0 || index>2 || !Number.isFinite(damage) || damage<=0) return false; this.targets[index]=Math.max(0,this.targets[index]-damage); return true; }
    collect(kind) {
        if (!this.health || this.extracted) return false;
        if (kind==='case' && !this.caseCollected) {this.caseCollected=true;return true;}
        if (kind==='supplies' && !this.suppliesCollected) {
            this.suppliesCollected=true; this.medkits=Math.min(10,this.medkits+1);
            for(const [id,w] of Object.entries(WEAPONS)) this.ammo[id].reserve=Math.min(999,this.ammo[id].reserve+w.capacity*2);
            return true;
        }
        return false;
    }
    extract() { if (!this.health || !this.caseCollected || this.targets.some(hp=>hp>0) || this.extracted) return false; this.extracted=true;this.reloadRemaining=0;return true; }
}
