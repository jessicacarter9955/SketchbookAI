import { validateUrban } from './urban-data.mjs';
import { saveRevision } from './scene-revisions.mjs';

export class UrbanTool {
  constructor(editor){
    this.editor=editor; this.runtime=editor.world.levelRuntime;
    this.root=document.createElement('details'); this.root.open=true;
    this.root.innerHTML='<summary>CITTÀ PROCEDURALE</summary><p>Genera una rete urbana editabile e guidabile. La rigenerazione salva una revisione.</p>'+
      '<label>Seed<input data-seed type="number" min="0" max="2147483647"></label>'+
      '<div class="editor-grid"><label>Isolati X<input data-blocks-x type="number" min="2" max="18"></label><label>Isolati Z<input data-blocks-z type="number" min="2" max="18"></label></div>'+
      '<label>Dimensione isolato · m<input data-block-size type="number" min="24" max="100"></label>'+
      '<div class="editor-grid"><label>Strada · m<input data-road-width type="number" min="6" max="30"></label><label>Marciapiede · m<input data-sidewalk-width type="number" min="0" max="8" step=".5"></label></div>'+
      '<div class="editor-grid"><label>Piani min<input data-min-floors type="number" min="1" max="25"></label><label>Piani max<input data-max-floors type="number" min="1" max="40"></label></div>'+
      '<label>Densità edifici<input data-building-density type="range" min=".15" max="1" step=".05"></label>'+
      '<label>Terreno<select data-terrain><option value="flat">Piatto</option><option value="rolling">Ondulato</option></select></label>'+
      '<label>Cielo<select data-sky><option value="day">Giorno</option><option value="sunset">Tramonto</option><option value="haze">Foschia</option></select></label>'+
      '<button class="wide primary" data-generate>Rigenera città</button><button class="wide" data-focus>Inquadra città</button>'+
      '<p>Road grid, edifici, marciapiedi e collisioni vengono ricostruiti dal seed. Veicoli e oggetti della scena restano indipendenti.</p>';
    editor.root.querySelector('.editor-inspector').prepend(this.root);
    this.root.querySelector('[data-generate]').onclick=()=>editor.run(()=>this.generate());
    this.root.querySelector('[data-focus]').onclick=()=>this.focus();
    this.refresh();
  }
  value(key){const el=this.root.querySelector(`[data-${key}]`);return ['terrain','sky'].includes(key)?el.value:Number(el.value);}
  generate(){
    const config=validateUrban({
      seed:this.value('seed'), blocksX:this.value('blocks-x'), blocksZ:this.value('blocks-z'), blockSize:this.value('block-size'),
      roadWidth:this.value('road-width'), sidewalkWidth:this.value('sidewalk-width'), minFloors:this.value('min-floors'),
      maxFloors:this.value('max-floors'), buildingDensity:this.value('building-density'), terrain:this.value('terrain'), sky:this.value('sky')
    });
    if(JSON.stringify(config)===JSON.stringify(this.editor.generator)) return this.editor.message('Questi parametri urbani sono già applicati.');
    saveRevision(localStorage,this.editor.storageKey,this.editor.scene(),'Prima di rigenerare la città',crypto.randomUUID());
    this.editor.restore({...this.editor.scene(),generator:config}); this.editor.commit();
    this.editor.root.dispatchEvent(new Event('scene-revision-saved')); this.focus();
    this.editor.message(`Città rigenerata: ${this.runtime.plan.buildings.length} edifici, ${this.runtime.plan.roads.length} strade.`);
  }
  refresh(){
    const c=this.editor.generator;
    for(const [key,value] of Object.entries({seed:c.seed,'blocks-x':c.blocksX,'blocks-z':c.blocksZ,'block-size':c.blockSize,'road-width':c.roadWidth,'sidewalk-width':c.sidewalkWidth,'min-floors':c.minFloors,'max-floors':c.maxFloors,'building-density':c.buildingDensity,terrain:c.terrain,sky:c.sky})) this.root.querySelector(`[data-${key}]`).value=value;
  }
  focus(){
    const p=this.runtime.plan; if(!p)return;
    const size=Math.max(p.bounds.maxX-p.bounds.minX,p.bounds.maxZ-p.bounds.minZ);
    this.editor.orbit.maxDistance=Math.max(600,size*2.5); this.editor.orbit.target.set(0,0,0);
    this.editor.world.camera.position.set(size*.65,size*.7,size*.85); this.editor.orbit.update();
  }
}
