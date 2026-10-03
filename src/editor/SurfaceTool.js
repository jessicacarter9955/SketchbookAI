import * as THREE from 'three';
import { validateSurfaceEdits, SURFACE_STYLES, collectSurface, triangleArea } from './surface-data.mjs';

export class SurfaceTool {
    constructor(editor) {
        this.editor=editor; this.runtime=editor.world.levelRuntime;
        this.root=document.createElement('details'); this.root.open=true;
        this.root.innerHTML=`<summary>SUPERFICI DELLA CITTÀ</summary><p>Campiona un materiale, poi delimita l’area. Le modifiche sono reversibili e non cambiano le collisioni.</p>
            <button class="wide" data-sample>Scegli superficie nella mappa</button><button class="wide" data-area>Disegna area · 2 clic</button>
            <p data-source>Nessuna superficie selezionata.</p><label>Aspetto<select data-style>${Object.entries(SURFACE_STYLES).map(([id,name])=>`<option value="${id}">${name}</option>`).join('')}</select></label>
            <label>Larghezza · m<input data-width type="number" min="1" max="200" value="20"></label><label>Profondità · m<input data-depth type="number" min="1" max="200" value="20"></label>
            <label>Fascia verticale · m<input data-band type="number" min="0.1" max="20" step="0.1" value="2"></label>
            <label>Altezza erba · m<input data-height type="number" min="0.1" max="1.5" step="0.1" value="0.5"></label>
            <label>Fili d’erba / m²<input data-density type="number" min="1" max="40" value="25"></label>
            <div class="editor-grid"><button data-preview>Anteprima area</button><button data-focus>Inquadra area</button><button data-apply disabled>Applica superficie</button><button data-cancel>Annulla selezione</button></div>
            <p data-result role="status"></p><label>Interventi salvati<select data-layers><option value="">Nessuno</option></select></label><button class="wide" data-remove>Rimuovi intervento selezionato</button>`;
        editor.root.querySelector('.editor-inspector').prepend(this.root);
        this.$=s=>this.root.querySelector(s);
        this.$('[data-sample]').onclick=()=>this.begin('sample'); this.$('[data-area]').onclick=()=>this.begin('first');
        this.$('[data-preview]').onclick=()=>this.preview(); this.$('[data-focus]').onclick=()=>this.focus();
        this.$('[data-cancel]').onclick=()=>this.cancel();
        this.$('[data-apply]').onclick=()=>editor.run(()=>this.apply());
        this.$('[data-remove]').onclick=()=>editor.run(()=>{
            const id=this.$('[data-layers]').value; if(!id) return;
            editor.mapEdits=editor.mapEdits.filter(e=>e.id!==id); this.runtime.surfaces.setEdits(editor.mapEdits); this.cancel(); editor.commit(); this.refreshList();
        });
        this.$('[data-layers]').onchange=()=>{
            const edit=editor.mapEdits.find(e=>e.id===this.$('[data-layers]').value); if(!edit) return;
            this.texture=edit.texture; this.center=[0,1,2].map(i=>(edit.bounds[i]+edit.bounds[i+3])/2);
            for(const [key,value] of Object.entries({width:edit.bounds[3]-edit.bounds[0],depth:edit.bounds[5]-edit.bounds[2],band:edit.bounds[4]-edit.bounds[1],height:edit.height,density:edit.density,style:edit.style})) this.$(`[data-${key}]`).value=value;
            this.preview(); this.focus();
        };
        this.root.querySelectorAll('input,[data-style]').forEach(input=>input.onchange=()=>this.preview());
        this.refreshList();
    }
    begin(mode) { this.mode=mode; this.editor.placing=false; this.editor.select(null); this.editor.message(mode==='sample'?'Clicca sul prato o sulla strada da modificare.':'Clicca il primo angolo dell’area, poi quello opposto. Il materiale del primo clic sarà il bersaglio.'); }
    handlePick(ray) {
        if(!this.mode) return false;
        this.editor.world.graphicsWorld.updateMatrixWorld(true);
        const hit=ray.intersectObjects([...this.runtime.loaded.values()].map(d=>d.mesh),false)[0];
        if(!hit) { this.editor.message('Clicca una superficie della città caricata.'); return true; }
        const data=this.runtime.loaded.get(hit.object.userData.citySectorId);
        if(this.mode==='second') {
            const width=Math.abs(hit.point.x-this.corner.x), depth=Math.abs(hit.point.z-this.corner.z);
            if(width<1 || depth<1 || width>200 || depth>200) { this.editor.message('Scegli un’area fra 1 e 200 metri per lato.'); return true; }
            this.center=[(hit.point.x+this.corner.x)/2,this.corner.y,(hit.point.z+this.corner.z)/2];
            this.$('[data-width]').value=width.toFixed(2); this.$('[data-depth]').value=depth.toFixed(2); this.mode=null; this.preview();
        } else {
            this.texture=data.meta.groups[hit.face.materialIndex]?.texture || ''; this.center=hit.point.toArray();
            if(this.mode==='first') { this.corner=hit.point.clone(); this.mode='second'; this.editor.message('Ora clicca l’angolo opposto.'); }
            else { this.mode=null; this.preview(); }
        }
        return true;
    }
    draft() {
        if(!this.center) throw new Error('Prima scegli una superficie nella mappa.');
        const n=key=>Number(this.$(`[data-${key}]`).value), half=[n('width')/2,n('band')/2,n('depth')/2];
        return validateSurfaceEdits([{id:'preview',name:SURFACE_STYLES[this.$('[data-style]').value],texture:this.texture,style:this.$('[data-style]').value,bounds:[...this.center.map((v,i)=>v-half[i]),...this.center.map((v,i)=>v+half[i])],density:n('density'),height:n('height'),seed:42}])[0];
    }
    preview() {
        this.$('[data-apply]').disabled=true;
        try { const draft=this.draft(), result=this.runtime.surfaces.showPreview(draft);
            this.$('[data-source]').textContent=`Materiale: ${this.texture || 'senza texture'}`;
            this.$('[data-result]').textContent=`${result.area.toFixed(1)} m² del materiale selezionato nell’area caricata.`;
            this.$('[data-apply]').disabled=result.area<=0;
        } catch(error) { this.runtime.surfaces.clearPreview(); this.$('[data-result]').textContent=error.message; }
    }
    apply() {
        const draft=this.draft(); draft.id=crypto.randomUUID();
        const edits=validateSurfaceEdits([...this.editor.mapEdits,draft]);
        const result=this.runtime.surfaces.showPreview(draft); if(!result.area) throw new Error('Nessuna superficie corrispondente nell’area caricata.');
        this.editor.mapEdits=edits; this.runtime.surfaces.setEdits(edits); this.cancel(); this.editor.commit(); this.refreshList();
        this.$('[data-layers]').value=draft.id; this.editor.message(`${draft.name}: ${result.area.toFixed(1)} m² applicati. Ctrl+Z per annullare.`);
    }
    focus() {
        if(!this.center) return;
        let center=this.center, size=Math.max(Number(this.$('[data-width]').value),Number(this.$('[data-depth]').value),10);
        try {
            const draft=this.draft(); let largest=null, area=0;
            for(const data of this.runtime.loaded.values()) for(const triangle of collectSurface(data.vertices,data.meta.groups,draft).triangles) {
                const candidate=triangleArea(triangle); if(candidate>area) {largest=triangle;area=candidate;}
            }
            // The rectangle center can be inside a building; frame an actual selected surface.
            if(largest) {center=[0,1,2].map(i=>largest.reduce((sum,p)=>sum+p[i]/3,0));size=Math.min(size,12);}
        } catch { return; }
        this.editor.orbit.target.fromArray(center); this.editor.world.camera.position.fromArray(center).add(new THREE.Vector3(0,size*1.4,size*.15)); this.editor.orbit.update();
    }
    cancel() { this.mode=null; this.runtime.surfaces.clearPreview(); this.$('[data-apply]').disabled=true; }
    refreshList() {
        this.cancel(); const select=this.$('[data-layers]'); select.replaceChildren(new Option('Seleziona un intervento',''));
        for(const edit of this.editor.mapEdits) select.add(new Option(`${edit.name} · ${edit.texture}`,edit.id));
    }
}
