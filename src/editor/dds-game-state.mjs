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
// Damage and vitality can be fractional: rounding them on load adds unintended damage.
const boundedHealth = (value, fallback, max) => Number.isFinite(value) ? Math.max(0,Math.min(max,value)) : fallback;
export class DdsGameState {
    constructor(saved) {
        const data = saved?.version===1 ? saved : {};
        this.health=boundedHealth(data.health,100,100); this.medkits=bounded(data.medkits,2,10);
        this.ammo=Object.fromEntries(Object.entries(WEAPONS).map(([id,w])=>[id,{
            magazine:bounded(data.ammo?.[id]?.magazine,w.capacity,w.capacity),
            reserve:bounded(data.ammo?.[id]?.reserve,w.reserve,999)
        }]));
        this.owned=Array.isArray(data.owned) ? [...new Set(data.owned.filter(id=>typeof id==='string' && Object.hasOwn(WEAPONS,id)))] : ['rifle','pistol'];
        this.equipped=this.owned.includes(data.equipped) ? data.equipped : (data.equipped===null ? null : this.owned[0]??null);
        this.caseCollected=data.caseCollected===true; this.suppliesCollected=data.suppliesCollected===true;
        this.targets=Array.from({length:3},(_,i)=>boundedHealth(data.targets?.[i],100,100));
        this.extracted=data.extracted===true; this.cooldown=0; this.reloadRemaining=0;
        this.credits=bounded(data.credits,250,999999);this.carryCapacity=12;this.maxWeight=18;
        this.npcHealth=Object.fromEntries(['guide','merchant','dummy-1','dummy-2','walker-1','walker-2'].map(id=>[id,boundedHealth(data.npcHealth?.[id],100,100)]));
    }
    snapshot() { return {version:1,health:this.health,medkits:this.medkits,ammo:structuredClone(this.ammo),owned:[...this.owned],equipped:this.equipped,caseCollected:this.caseCollected,suppliesCollected:this.suppliesCollected,targets:[...this.targets],extracted:this.extracted,credits:this.credits,npcHealth:{...this.npcHealth}}; }
    get usedSlots(){return Number(this.medkits>0)+Number(this.caseCollected)+Object.values(this.ammo).filter(a=>a.reserve>0).length;}
    get currentWeight(){return this.owned.reduce((sum,id)=>sum+(id==='rifle'?3.6:0.9),0)+(this.ammo.rifle.magazine+this.ammo.rifle.reserve)*0.012+(this.ammo.pistol.magazine+this.ammo.pistol.reserve)*0.01+this.medkits*0.4+(this.caseCollected?2:0);}
    // Read-only purchase eligibility, shared by the merchant UI and the transaction.
    canBuy(id) {
        if(!this.health||this.extracted)return {ok:false,message:'Incursione conclusa.'};
        const offer=Object.hasOwn(SHOP_OFFERS,id) ? SHOP_OFFERS[id] : null;
        if(!offer)return {ok:false,message:'Articolo non disponibile.'};
        if(this.credits<offer.price)return {ok:false,message:'Crediti insufficienti.'};
        const current=offer.weapon?this.ammo[offer.weapon].reserve:this.medkits, limit=offer.weapon?999:10;
        const addedWeight=offer.quantity*(offer.weapon?(offer.weapon==='rifle'?0.012:0.01):0.4);
        if(current+offer.quantity>limit||this.currentWeight+addedWeight>this.maxWeight||(!current&&this.usedSlots>=this.carryCapacity))return {ok:false,message:'Spazio o capacità insufficienti.'};
        return {ok:true,message:''};
    }
    buy(id) {
        const eligibility=this.canBuy(id);
        if(!eligibility.ok)return eligibility;
        const offer=SHOP_OFFERS[id];
        if(offer.weapon)this.ammo[offer.weapon].reserve+=offer.quantity;else this.medkits+=offer.quantity;
        this.credits-=offer.price;return {ok:true,message:`Acquistato: ${offer.name}`};
    }
    equip(id) { if (!this.health || this.extracted || (id!==null && (typeof id!=='string' || !this.owned.includes(id)))) return false; this.equipped=id; this.reloadRemaining=0; return true; }
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
    heal() { if (!this.health || this.extracted || this.health===100 || !this.medkits) return false; this.medkits--; this.health=Math.min(100,this.health+50); return true; }
    damage(amount) { if (this.extracted || !this.health || !Number.isFinite(amount) || amount<=0) return; this.health=Math.max(0,this.health-amount); if (!this.health) this.reloadRemaining=0; }
    hitTarget(index,damage) { if (!this.health || this.extracted || !Number.isInteger(index) || index<0 || index>2 || !Number.isFinite(damage) || damage<=0 || !this.targets[index]) return false; this.targets[index]=Math.max(0,this.targets[index]-damage); return true; }
    // Preview pickup eligibility without changing the raid state.
    // Apply the same slot and weight constraints used by merchant purchases.
    canCollect(kind) {
        if (!this.health || this.extracted) return {ok:false,message:'Incursione conclusa.'};
        if (kind==='case') {
            if (this.caseCollected) return {ok:false,message:'Valigetta già recuperata.'};
            if (this.usedSlots+1>this.carryCapacity || this.currentWeight+2>this.maxWeight+1e-9)
                return {ok:false,message:'Spazio o capacità insufficienti per la valigetta.'};
            return {ok:true,message:''};
        }
        if (kind==='supplies') {
            if (this.suppliesCollected) return {ok:false,message:'Rifornimenti già raccolti.'};
            const medkits=Math.max(0,Math.min(1,10-this.medkits));
            const rifle=Math.max(0,Math.min(WEAPONS.rifle.capacity*2,999-this.ammo.rifle.reserve));
            const pistol=Math.max(0,Math.min(WEAPONS.pistol.capacity*2,999-this.ammo.pistol.reserve));
            if (!medkits && !rifle && !pistol)
                return {ok:false,message:'Rifornimenti già al massimo.'};
            const newSlots=Number(medkits>0 && this.medkits===0)
                +Number(rifle>0 && this.ammo.rifle.reserve===0)
                +Number(pistol>0 && this.ammo.pistol.reserve===0);
            const addedWeight=medkits*0.4+rifle*0.012+pistol*0.01;
            if (this.usedSlots+newSlots>this.carryCapacity || this.currentWeight+addedWeight>this.maxWeight+1e-9)
                return {ok:false,message:'Spazio o capacità insufficienti per i rifornimenti.'};
            return {ok:true,message:''};
        }
        return {ok:false,message:'Bottino non riconosciuto.'};
    }
    collect(kind) {
        if (!this.canCollect(kind).ok) return false;
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
