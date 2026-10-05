import {WEAPONS} from './dds-game-state.mjs';
import './dds-inventory.css';

// Original line illustrations. No artwork from the Unreal assets is embedded here.
const ICONS = {
    rifle: '<path d="M8 43h19l10-9h37l7 5h34v8H81l-9 7H49l-5 18H33l3-21H21L8 59Z"/><path d="M50 34v-8h20v8M83 38V28h4v11M95 39V29h5v10M55 55l8 13h12l-9-15M15 44v12M41 43h30"/>',
    pistol: '<path d="M24 28h76v20H69l-8 29H39l8-29H24Z"/><path d="M31 35h60M72 29v19M50 50h16M58 51l-5 18M30 29v-5h7v5M89 29v-5h7v5"/>',
    ammo: '<path d="M35 72V39l8-14 8 14v33ZM67 72V39l8-14 8 14v33ZM32 72h22M64 72h22M35 45h16M67 45h16"/><path d="M39 53v12M71 53v12"/>',
    medkit: '<rect x="24" y="31" width="76" height="48" rx="7"/><path d="M46 31v-9h32v9M55 42h14v10h10v13H69v10H55V65H45V52h10Z"/>',
    case: '<rect x="19" y="32" width="86" height="46" rx="4"/><path d="M45 32V22h34v10M19 49h86M39 44v12M83 44v12M27 71h70"/>',
    armor: '<path d="m43 22 19 8 19-8 12 16-9 13v30H40V51L31 38Z"/><path d="M43 22v20h38V22M45 53h34M45 63h34M55 43v37M69 43v37"/>',
    backpack: '<rect x="36" y="28" width="52" height="54" rx="11"/><path d="M50 28v-9h24v9M45 49h34v23H45ZM36 44H26v29h10M88 44h10v29H88M45 37h34"/>',
    shield: '<path d="m62 20 31 11v23c0 14-16 24-31 31-15-7-31-17-31-31V31Z"/><path d="m62 31 20 7v16c0 9-9 16-20 23Z"/>',
    pack: '<path d="m23 34 39-16 39 16v43L62 93 23 77ZM23 34l39 17 39-17M62 51v42M43 26l39 17v17"/>',
    person: '<circle cx="62" cy="30" r="14"/><path d="M29 85V68c0-18 15-25 33-25s33 7 33 25v17M46 52l16 15 16-15M62 67v18"/>'
};

export function inventoryIcon(name, className='') {
    return `<svg class="dds-item-icon ${className}" viewBox="0 0 124 104" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${ICONS[name] || ICONS.pack}</svg>`;
}

export const panelText = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const quantity = value => Number.isFinite(value) ? Math.max(0, value) : 0;
const number = value => quantity(value).toLocaleString('it-IT', {maximumFractionDigits:1});

/** Inventory presentation only. All item operations go through the game controller. */
export class DdsInventory {
    constructor(game, {onclose}={}) {
        this.game=game; this.onclose=onclose; this.selected='rifle';
        this.element=document.createElement('dialog'); this.dialog=this.element;
        this.element.className='dds-inventory dds-inventory-v2 dds-panel';
        this.element.setAttribute('aria-labelledby','dds-inventory-title');
        this.element.innerHTML=`
            <header class="dds-panel-header">
                <div class="dds-panel-heading">${inventoryIcon('pack')}<div><span class="dds-eyebrow">DDS / EQUIPAGGIAMENTO OPERATORE</span><h2 id="dds-inventory-title">Inventario</h2></div></div>
                <div class="dds-wallet"><span>CREDITI</span><strong data-credits>0</strong><b aria-hidden="true">₡</b></div>
                <button type="button" class="dds-close" data-action="close" aria-label="Chiudi inventario">×</button>
            </header>
            <div class="dds-inventory-toolbar"><span class="dds-tab is-active">EQUIPAGGIAMENTO &amp; ZAINO</span><button type="button" class="dds-tab" disabled title="Il deposito non è disponibile durante questa incursione">DEPOSITO <span class="dds-unavailable">NON DISPONIBILE</span></button><span class="dds-raid-tag">PORTLAND · INCURSIONE</span></div>
            <div class="dds-inventory-body">
                <section class="dds-loadout" aria-label="Equipaggiamento"><div class="dds-section-heading"><h3>Equipaggiamento</h3><span>01</span></div><div data-equipment></div><button type="button" class="dds-button dds-holster" data-action="holster">Riponi arma <kbd>3</kbd></button><div class="dds-unavailable-equipment">${[['armor','Armatura'],['backpack','Zaino aggiuntivo'],['shield','Scudo']].map(([icon,label])=>`<div class="dds-locked-slot">${inventoryIcon(icon)}<div><strong>${label}</strong><span>Non disponibile</span></div><span aria-hidden="true">—</span></div>`).join('')}</div><div class="dds-health"><div><span>CONDIZIONE</span><strong data-health></strong></div><meter data-health-meter min="0" max="100" aria-label="Salute"></meter></div></section>
                <section class="dds-carry" aria-label="Contenuto dello zaino"><div class="dds-section-heading"><h3>Zaino</h3><span data-carry-count></span></div><div class="dds-carry-grid" data-carry-grid></div><div class="dds-carry-footer"><span data-weight></span><span data-carry-label></span></div><progress data-weight-meter max="1" value="0" aria-label="Peso trasportato" hidden></progress><p class="dds-carry-hint">Seleziona un oggetto per ispezionarlo.</p></section>
                <section class="dds-item-details" aria-label="Dettagli oggetto" data-details></section>
            </div>
            <footer class="dds-panel-footer"><span><span class="dds-status-dot"></span> Equipaggiamento salvato localmente</span><span><kbd>I</kbd> / <kbd>Esc</kbd> Chiudi <i></i> <kbd>H</kbd> Cura</span></footer>`;
        document.body.append(this.element);
        this.handleClick=event=>this.click(event);
        this.handleKey=event=>{
            event.stopPropagation();
            if(event.repeat)return;
            if(['KeyI','Escape'].includes(event.code)){event.preventDefault();this.close();}
            else if(event.code==='KeyH'){event.preventDefault();if(this.game.state.health>0&&!this.game.state.extracted)this.game.heal();this.render();}
            else if(event.code==='Digit3'){event.preventDefault();this.game.equip(null);this.render();}
        };
        this.handleCancel=event=>{event.preventDefault();this.close();};
        this.handleClose=()=>{this.releaseControls();if(this.onclose)this.onclose();else this.game.focus?.();};
        this.element.addEventListener('click',this.handleClick);
        this.element.addEventListener('keydown',this.handleKey);
        this.element.addEventListener('cancel',this.handleCancel);
        this.element.addEventListener('close',this.handleClose);
        this.render();
    }
    get isOpen(){return this.element.open;}
    releaseControls(){this.game.releaseInput?.();this.game.player?.resetControls?.();this.game.world?.inputManager?.releaseInput?.();}
    open(){if(this.isOpen)return;this.releaseControls();document.exitPointerLock?.();this.render();this.element.showModal();}
    close(){if(this.isOpen)this.element.close();}
    toggle(){this.isOpen?this.close():this.open();}
    click(event){
        const button=event.target.closest('button');if(!button||button.disabled)return;
        if(button.dataset.select){this.selected=button.dataset.select;this.render();return;}
        if(button.dataset.action==='close')this.close();
        if(button.dataset.action==='holster'){this.game.equip(null);this.render();}
        if(button.dataset.action==='equip'){this.game.equip(this.selected);this.render();}
        if(button.dataset.action==='heal'){this.game.heal();this.render();}
    }
    items(){
        const s=this.game.state;
        const items=[];
        for(const id of ['rifle','pistol'])if(s.owned.includes(id))items.push({id,name:WEAPONS[id].name,kind:'Arma',icon:id,description:id==='rifle'?'Arma primaria a fuoco automatico. Indicata per gli scontri a media distanza.':'Arma secondaria semiautomatica. Compatta, pronta quando serve.',weapon:true});
        if(s.ammo.rifle.reserve>0)items.push({id:'rifle-ammo',name:'Munizioni fucile',kind:'Munizioni',icon:'ammo',count:s.ammo.rifle.reserve,description:'Riserva per il fucile. Ricarica con R dopo aver chiuso l’inventario.',ammo:'rifle'});
        if(s.ammo.pistol.reserve>0)items.push({id:'pistol-ammo',name:'Munizioni pistola',kind:'Munizioni',icon:'ammo',count:s.ammo.pistol.reserve,description:'Riserva per la pistola. Ricarica con R dopo aver chiuso l’inventario.',ammo:'pistol'});
        if(s.medkits>0)items.push({id:'medkit',name:'Kit medico',kind:'Consumabile',icon:'medkit',count:s.medkits,description:'Ripristina fino a 50 punti salute. Viene consumato soltanto se la salute è inferiore a 100.',medical:true});
        if(s.caseCollected)items.push({id:'case',name:'Valigetta recuperata',kind:'Oggetto missione',icon:'case',count:1,description:'Obiettivo recuperato. Conservala fino all’estrazione e completa gli obiettivi dell’incursione.',quest:true});
        return items;
    }
    render(){
        const s=this.game.state, items=this.items();
        const active=document.activeElement;
        const focusKey=this.element.contains(active)?{select:active.dataset.select,action:active.dataset.action}:null;
        if(!items.some(item=>item.id===this.selected))this.selected=items[0]?.id;
        this.element.querySelector('[data-credits]').textContent=number(s.credits);
        this.element.querySelector('[data-health]').textContent=`${number(s.health)} / 100`;
        this.element.querySelector('[data-health-meter]').value=s.health;
        this.element.querySelector('[data-action="holster"]').disabled=!s.equipped||!s.health||s.extracted;
        this.element.querySelector('[data-equipment]').innerHTML=['rifle','pistol'].map((id,i)=>{
            const owned=s.owned.includes(id), ammo=s.ammo[id];
            return `<button type="button" class="dds-weapon-slot ${s.equipped===id?'is-equipped':''} ${this.selected===id?'is-selected':''}" data-select="${id}" ${owned?'':'disabled'} aria-pressed="${this.selected===id}"><span class="dds-slot-label">${i?'SECONDARIA':'PRIMARIA'} <kbd>${i+1}</kbd></span>${inventoryIcon(id)}<span class="dds-weapon-name">${WEAPONS[id].name}</span><span class="dds-weapon-meta"><span>${owned?`${ammo.magazine} / ${WEAPONS[id].capacity} <small>COLPI</small>`:'Non posseduta'}</span><b>${s.equipped===id?'IN USO':owned?'RIPOSTA':'—'}</b></span></button>`;
        }).join('');
        const carry=items.filter(item=>!item.weapon);
        const capacity=Number.isFinite(s.carryCapacity)?s.carryCapacity:null;
        const used=Number.isFinite(s.usedSlots)?s.usedSlots:carry.length;
        this.element.querySelector('[data-carry-count]').textContent=capacity===null?`${carry.length} GRUPPI`:`${used} / ${capacity} SLOT`;
        this.element.querySelector('[data-carry-grid]').innerHTML=carry.map(item=>`<button type="button" class="dds-carry-slot ${item.quest?'is-quest':''} ${item.medical?'is-medical':''} ${this.selected===item.id?'is-selected':''}" data-select="${item.id}" aria-pressed="${this.selected===item.id}" aria-label="${item.name}, quantità ${item.count}"><span class="dds-item-category">${item.quest?'MISSIONE':item.medical?'CURA':item.ammo==='rifle'?'FUCILE':'PISTOLA'}</span>${inventoryIcon(item.icon)}<span class="dds-item-name">${item.name}</span><span class="dds-item-count">×${item.count}</span></button>`).join('')+Array.from({length:Math.max(0,(capacity===null?8:capacity)-carry.length)},(_,i)=>`<div class="dds-empty-slot" aria-hidden="true"><span>${String(carry.length+i+1).padStart(2,'0')}</span>+</div>`).join('');
        const weight=Number.isFinite(s.currentWeight)?s.currentWeight:null, maxWeight=Number.isFinite(s.maxWeight)?s.maxWeight:null;
        this.element.querySelector('[data-weight]').textContent=weight===null?'Peso non disponibile':`PESO ${number(weight)}${maxWeight===null?'':` / ${number(maxWeight)}`} kg`;
        this.element.querySelector('[data-carry-label]').textContent=capacity===null?'':`${Math.max(0,capacity-used)} slot liberi`;
        const weightMeter=this.element.querySelector('[data-weight-meter]');weightMeter.hidden=weight===null||maxWeight===null;weightMeter.max=maxWeight||1;weightMeter.value=weight||0;
        this.renderDetails(items.find(item=>item.id===this.selected));
        if(focusKey&&this.isOpen){const key=focusKey.select?'select':'action',value=focusKey[key];if(value)this.element.querySelector(`[data-${key}="${value}"]`)?.focus({preventScroll:true});}
    }
    renderDetails(item){
        const s=this.game.state, details=this.element.querySelector('[data-details]');
        if(!item){details.innerHTML='<div class="dds-section-heading"><h3>Dettagli</h3><span>03</span></div><p>Lo zaino è vuoto.</p>';return;}
        const rows=[];let action='';
        if(item.weapon){
            const w=WEAPONS[item.id],ammo=s.ammo[item.id];
            rows.push(['Danno',w.damage],['Caricatore',`${ammo.magazine} / ${w.capacity}`],['Riserva',`${ammo.reserve} colpi`],['Modalità',w.automatic?'Automatico':'Semiautomatico'],['Ricarica',`${w.reload} s`]);
            action=s.equipped===item.id?`<button type="button" class="dds-button dds-primary" data-action="holster" ${!s.health||s.extracted?'disabled':''}>Riponi arma</button>`:`<button type="button" class="dds-button dds-primary" data-action="equip" ${!s.health||s.extracted?'disabled':''}>Equipaggia ${item.name.toLowerCase()}</button>`;
        }else if(item.medical){
            rows.push(['Quantità',item.count],['Recupero','+50 salute'],['Salute attuale',`${s.health} / 100`]);
            action=`<button type="button" class="dds-button dds-primary" data-action="heal" ${s.health<=0||s.health>=100||!s.medkits||s.extracted?'disabled':''}>${s.health>=100?'Salute al massimo':'Usa kit medico'} <kbd>H</kbd></button>`;
        }else if(item.ammo){rows.push(['Quantità',`${item.count} colpi`],['Compatibile',WEAPONS[item.ammo].name],['Nel caricatore',s.ammo[item.ammo].magazine]);}
        else if(item.quest){rows.push(['Stato','Recuperata'],['Destinazione','Estrazione'],['Quantità',1]);}
        details.innerHTML=`<div class="dds-section-heading"><h3>Dettagli oggetto</h3><span>03</span></div><div class="dds-detail-art ${item.quest?'is-quest':''}">${inventoryIcon(item.icon)}<span>${item.weapon?'EQUIPAGGIAMENTO':item.kind.toUpperCase()}</span></div><div class="dds-detail-copy"><span class="dds-eyebrow">${item.kind}</span><h3>${item.name}</h3><p>${item.description}</p></div><dl class="dds-detail-stats">${rows.map(([label,value])=>`<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl><div class="dds-detail-action">${action}${item.quest?'<p class="dds-objective-note">OGGETTO NECESSARIO PER ESTRARRE</p>':''}</div>`;
    }
    destroy(){this.element.removeEventListener('close',this.handleClose);this.element.removeEventListener('click',this.handleClick);this.element.removeEventListener('keydown',this.handleKey);this.element.removeEventListener('cancel',this.handleCancel);this.close();this.element.remove();}
}
