import {SHOP_OFFERS} from './dds-game-state.mjs';
import {inventoryIcon, panelText} from './DdsInventory.js';

/** NPC dialogue/shop view; purchases are validated and persisted by game.buy(). */
export class DdsInteractionPanel {
    constructor(game,{onclose}={}) {
        this.game=game;this.onclose=onclose;this.npc=null;this.topic='mission';this.status='';
        this.element=document.createElement('dialog');this.dialog=this.element;
        this.element.className='dds-interaction-panel dds-panel';
        this.element.setAttribute('aria-labelledby','dds-interaction-title');
        this.element.innerHTML=`<header class="dds-panel-header"><div class="dds-panel-heading">${inventoryIcon('person')}<div><span class="dds-eyebrow" data-role></span><h2 id="dds-interaction-title" data-name></h2></div></div><div class="dds-wallet"><span>CREDITI</span><strong data-credits></strong><b aria-hidden="true">₡</b></div><button type="button" class="dds-close" data-action="close" aria-label="Chiudi conversazione">×</button></header><div class="dds-interaction-content" data-content></div><footer class="dds-panel-footer"><span><span class="dds-status-dot"></span><span data-footer></span></span><span><kbd>E</kbd> / <kbd>Esc</kbd> Torna all’incursione</span></footer>`;
        document.body.append(this.element);
        this.handleClick=event=>{
            const button=event.target.closest('button');if(!button||button.disabled)return;
            if(button.dataset.action==='close'){this.close();return;}
            if(button.dataset.topic){this.topic=button.dataset.topic;this.render();return;}
            if(button.dataset.buy){const result=this.game.buy(button.dataset.buy);this.status=result?.message||'Acquisto non disponibile.';this.render();}
        };
        this.handleKey=event=>{event.stopPropagation();if(!event.repeat&&['Escape','KeyE'].includes(event.code)){event.preventDefault();this.close();}};
        this.handleCancel=event=>{event.preventDefault();this.close();};
        this.handleClose=()=>{const npc=this.npc;this.npc=null;this.releaseControls();if(this.onclose)this.onclose(npc);else this.game.focus?.();};
        this.element.addEventListener('click',this.handleClick);
        this.element.addEventListener('keydown',this.handleKey);
        this.element.addEventListener('cancel',this.handleCancel);
        this.element.addEventListener('close',this.handleClose);
    }
    get isOpen(){return this.element.open;}
    releaseControls(){this.game.releaseInput?.();this.game.player?.resetControls?.();this.game.world?.inputManager?.releaseInput?.();}
    open(npc){if(!npc)return;this.npc=npc;this.topic='mission';this.status='';this.releaseControls();document.exitPointerLock?.();this.render();if(!this.isOpen)this.element.showModal();}
    close(){if(this.isOpen)this.element.close();}
    render(){
        if(!this.npc)return;
        const s=this.game.state,merchant=this.npc.type==='merchant';
        const active=document.activeElement,focusKey=this.element.contains(active)?{buy:active.dataset.buy,topic:active.dataset.topic}:null;
        this.element.querySelector('[data-role]').textContent=merchant?'DDS / RIFORNIMENTI SUL CAMPO':'DDS / CONTATTO LOCALE';
        this.element.querySelector('[data-name]').textContent=this.npc.name||(merchant?'Commerciante':'Guida');
        this.element.querySelector('[data-credits]').textContent=(s.credits||0).toLocaleString('it-IT');
        this.element.querySelector('[data-footer]').textContent=merchant?'Acquisti aggiunti subito allo zaino':'Conversazione in corso';
        const intro=merchant?'Hai bisogno di rifornimenti? Munizioni e kit medici sono pronti. Controlla il peso dello zaino prima di ripartire.':'Benvenuto a Portland. Recupera la valigetta, completa gli obiettivi e raggiungi il punto di estrazione. Ti aiuto a prepararti.';
        this.element.querySelector('[data-content]').innerHTML=`<div class="dds-npc-intro"><div class="dds-npc-portrait">${inventoryIcon('person')}</div><div><h3>${panelText(this.npc.name||(merchant?'Commerciante':'Guida'))}</h3><p>${intro}</p></div></div>${merchant?this.shop(s):this.guide(s)}`;
        if(focusKey&&this.isOpen){const key=focusKey.buy?'buy':'topic',value=focusKey[key];if(value)this.element.querySelector(`[data-${key}="${value}"]`)?.focus({preventScroll:true});}
    }
    shop(s){
        return `<div class="dds-section-heading"><h3>Rifornimenti disponibili</h3><span>${s.currentWeight.toFixed(1)} / ${s.maxWeight} kg</span></div><div class="dds-shop-offers">${Object.entries(SHOP_OFFERS).map(([id,offer])=>{
            const owned=offer.weapon?s.ammo[offer.weapon].reserve:s.medkits,unaffordable=s.credits<offer.price;
            return `<article class="dds-shop-offer">${inventoryIcon(offer.weapon?'ammo':'medkit')}<h3>${offer.weapon?(offer.weapon==='rifle'?'Munizioni fucile':'Munizioni pistola'):'Kit medico'}</h3><p>${offer.weapon?`${offer.quantity} colpi in riserva`:'1 kit · ripristina 50 salute'}</p><button type="button" class="dds-button dds-primary" data-buy="${id}" ${unaffordable||!s.health||s.extracted?'disabled':''} aria-label="Acquista ${offer.name} per ${offer.price} crediti">${unaffordable?'Crediti insufficienti':`Acquista · ${offer.price} ₡`}</button><span class="dds-shop-owned">${owned} ${offer.weapon?'colpi':'kit'} nello zaino</span></article>`;
        }).join('')}</div><p class="dds-interaction-status" role="status" aria-live="polite">${panelText(this.status)}</p>`;
    }
    guide(s){
        const done=s.targets.filter(health=>health<=0).length;
        const answers={
            mission:`${s.extracted?'Hai completato l’incursione.':`Hai eliminato ${done} bersagli su ${s.targets.length}. ${s.caseCollected?'La valigetta è già nello zaino.':'Recupera la valigetta contrassegnata nell’area.'} Quando entrambi gli obiettivi sono completati, raggiungi l’anello verde e premi E per estrarre.`}`,
            equipment:'Premi I per aprire l’inventario. Seleziona un’arma e usa Equipaggia; 1 e 2 cambiano arma, 3 la ripone. R ricarica, H consuma un kit medico quando sei ferito. Il commerciante vende rifornimenti usando i tuoi crediti.',
            movement:'WASD per muoverti, Shift per correre e Spazio per saltare. Il tasto destro del mouse attiva la mira; il clic sinistro spara. Avvicinati ai contatti, al bottino o all’estrazione e premi E per interagire.'
        };
        return `<div class="dds-guide-topics">${[['mission','Qual è il mio obiettivo?'],['equipment','Armi e rifornimenti'],['movement','Come mi muovo?']].map(([id,label])=>`<button type="button" class="dds-topic" data-topic="${id}" aria-pressed="${this.topic===id}">${label}</button>`).join('')}</div><p class="dds-guide-answer" aria-live="polite">${answers[this.topic]||answers.mission}</p><ul class="dds-guide-objectives" aria-label="Stato obiettivi"><li class="${done===s.targets.length?'is-complete':''}">Bersagli ${done} / ${s.targets.length}</li><li class="${s.caseCollected?'is-complete':''}">Valigetta ${s.caseCollected?'recuperata':'da recuperare'}</li><li class="${s.extracted?'is-complete':''}">Estrazione ${s.extracted?'completata':'in attesa'}</li></ul>`;
    }
    destroy(){this.element.removeEventListener('close',this.handleClose);this.element.removeEventListener('click',this.handleClick);this.element.removeEventListener('keydown',this.handleKey);this.element.removeEventListener('cancel',this.handleCancel);this.close();this.element.remove();}
}
