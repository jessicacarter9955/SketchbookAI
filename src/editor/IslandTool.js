import * as THREE from 'three';
import { validateIsland } from './island-data.mjs';
import { saveRevision } from './scene-revisions.mjs';

export class IslandTool {
    constructor(editor) {
        this.editor=editor;this.runtime=editor.world.levelRuntime;
        this.root=document.createElement('details');this.root.open=true;
        this.root.innerHTML='<summary>ISOLA, PONTE E CIELO</summary><p>Due isole collegate da una strada percorribile. Ogni rigenerazione salva una revisione; puoi anche annullarla.</p><label>Seed<input data-seed type="number" min="0" max="2147483647" step="1"></label><label>Raggio isola · m<input data-radius type="number" min="45" max="110"></label><label>Distanza fra isole · m<input data-gap type="number" min="30" max="140"></label><label>Cielo<select data-sky><option value="day">Giorno</option><option value="sunset">Tramonto</option><option value="haze">Foschia</option></select></label><button class="wide" data-generate>Rigenera isole e ponte</button><button class="wide" data-view-island>Inquadra isole</button><p>Gli oggetti aggiunti conservano le coordinate: dopo una modifica del terreno puoi usare «Appoggia a terra». L’acqua è visiva; nuoto e galleggiamento non sono ancora disponibili.</p>';
        editor.root.querySelector('.editor-inspector').prepend(this.root);
        this.root.querySelector('[data-generate]').onclick=()=>editor.run(()=>{
            const config=validateIsland(Object.fromEntries(['seed','radius','gap','sky'].map(key=>[key,key==='sky'?this.root.querySelector(`[data-${key}]`).value:Number(this.root.querySelector(`[data-${key}]`).value)])));
            if(JSON.stringify(config)===JSON.stringify(editor.generator)) return editor.message('Questi parametri sono già applicati.');
            saveRevision(localStorage,editor.storageKey,editor.scene(),'Prima di rigenerare l’isola',crypto.randomUUID());
            editor.restore({...editor.scene(),generator:config});editor.commit();
            editor.root.dispatchEvent(new Event('scene-revision-saved'));
            this.focus();editor.message('Isola rigenerata. Revisione precedente salvata; Ctrl+Z per annullare.');
        });
        this.root.querySelector('[data-view-island]').onclick=()=>this.focus();this.refresh();
    }
    refresh() {for(const key of ['seed','radius','gap','sky']) this.root.querySelector(`[data-${key}]`).value=this.editor.generator[key];}
    focus() {
        const config=this.editor.generator, center=config.radius+config.gap/2;
        this.editor.orbit.maxDistance=900;this.editor.orbit.target.set(center,2,0);
        this.editor.world.camera.position.set(center+60,140,210);this.editor.orbit.update();
    }
}
