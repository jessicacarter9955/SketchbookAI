import * as THREE from 'three';
import {findHumanoidJoint,inspectHumanoidRig} from './humanoid-rig.mjs';

const STORY={
  intro:{speaker:'Abitante del quartiere',text:'Ehi, non ti ho mai visto qui. Cerchi qualcuno o stai dando un’occhiata alla città?',choices:[
    ['Sto esplorando il quartiere.','explore'],['Ho notato il traffico. Cosa succede?','traffic'],['Come ti chiami?','name'],['Devo andare.','goodbye']]},
  explore:{speaker:'Abitante del quartiere',text:'Benvenuto! Al mattino è tranquillo. Più tardi, agli incroci, troverai parecchio movimento.',choices:[
    ['E i pedoni?','pedestrians'],['Parlami del traffico.','traffic'],['Grazie, a presto.','goodbye']]},
  traffic:{speaker:'Abitante del quartiere',text:'Le auto passano spesso qui. Io aspetto sulle strisce e guardo in entrambe le direzioni prima di attraversare.',choices:[
    ['E i pedoni?','pedestrians'],['Hai visto qualcosa di strano?','rumor'],['Grazie per l’informazione.','goodbye']]},
  name:{speaker:'Alex · Residente',text:'Mi chiamo Alex. Vivo in questa zona da anni. Se vuoi sapere qualcosa, chiedi pure.',choices:[
    ['Cosa sai del traffico?','traffic'],['Com’è vivere qui?','explore'],['Ci vediamo, Alex.','goodbye']]},
  pedestrians:{speaker:'Alex · Residente',text:'Qui la gente si ferma spesso a chiacchierare. Sui marciapiedi c’è spazio, ma gli attraversamenti richiedono attenzione.',choices:[
    ['Hai sentito qualche notizia?','rumor'],['Grazie!','goodbye'],['Un’altra domanda.','intro']]},
  rumor:{speaker:'Alex · Residente',text:'Dicono che qualcuno passi sempre di fretta a quest’ora. Non so chi sia, ma al semaforo lo notano tutti.',choices:[
    ['Indagherò.','goodbye'],['Parliamo d’altro.','intro']]},
  goodbye:{speaker:'Alex · Residente',text:'È stato un piacere parlare con te. Ci vediamo in giro!',choices:[['Arrivederci.','close']]}
};

// Player-to-NPC RPG conversation in the real 3D world: E to interact,
// numbered/arrow choices, cinematic camera, gesture pose and stateful replies.
export class UrbanDialogue {
  constructor(world,editor){
    this.world=world;this.editor=editor;this.active=false;this.tick=0;
    this.root=document.createElement('section');this.root.className='urban-rpg-dialogue';
    this.root.hidden=true;this.root.setAttribute('aria-label','Conversazione RPG');
    this.root.innerHTML='<div class="urban-rpg-body"><div class="urban-rpg-name"></div><div class="urban-rpg-line"></div></div><div class="urban-rpg-options" role="group" aria-label="Risposte"></div><button class="urban-rpg-close" type="button" aria-label="Chiudi dialogo">×</button>';
    document.body.append(this.root);
    this.hint=document.createElement('div');this.hint.className='urban-dialogue-hint';this.hint.hidden=true;
    this.hint.textContent='E · Parla con un abitante';document.body.append(this.hint);
    this.root.querySelector('.urban-rpg-close').onclick=()=>this.close();
    this.listener=e=>{
      if(this.editor.active||e.target.closest?.('input,textarea,select,[contenteditable=true]'))return;
      if(this.active){
        if(['KeyE','Escape','KeyF'].includes(e.code)){e.preventDefault();e.stopImmediatePropagation();this.close();return;}
        if(['ArrowDown','ArrowUp'].includes(e.code)){
          e.preventDefault();e.stopImmediatePropagation();this.selected=(this.selected+(e.code==='ArrowDown'?1:-1)+this.choices.length)%this.choices.length;this.draw();return;
        }
        if(e.code==='Enter'||e.code==='Space'){
          e.preventDefault();e.stopImmediatePropagation();this.choose(this.selected);return;
        }
        if(/^Digit[1-9]$/.test(e.code)){
          const index=Number(e.code.slice(-1))-1;
          if(index<this.choices.length){e.preventDefault();e.stopImmediatePropagation();this.choose(index);}
        }
      }else if(e.code==='KeyE'&&!e.repeat&&!this.world.editorPlayer?.controlledObject){
        const npc=this.nearest();
        if(npc){e.preventDefault();e.stopImmediatePropagation();this.open(npc);}
      }
    };
    document.addEventListener('keydown',this.listener,true);
  }
  nearest(radius=5){
    const pop=this.world.actorLayer?.urbanPopulation,player=this.world.editorPlayer;
    if(!pop||!player||this.editor.active)return null;
    let nearest=null,distance=radius;
    for(const p of pop.pedestrians){
      const d=Math.hypot(p.x-player.position.x,p.z-player.position.z);
      if(d<distance){distance=d;nearest=p;}
    }
    return nearest;
  }
  open(npc){
    if(!npc)return false;
    this.npc=npc;this.rigReport=inspectHumanoidRig(npc.object);this.active=true;this.previous={position:this.world.camera.position.clone(),quaternion:this.world.camera.quaternion.clone(),fov:this.world.camera.fov};
    npc.dialoguePaused=true;
    this.world.editorPlayer?.resetVelocity?.();
    this.root.hidden=false;this.hint.hidden=true;
    this.go('intro');this.frameCamera();
    document.exitPointerLock?.();
    return true;
  }
  go(id){this.node=id;this.selected=0;this.choices=STORY[id]?.choices||[];this.draw();}
  choose(index){
    const next=this.choices[index]?.[1];if(!next)return;
    if(next==='close'){this.close();return;}
    this.go(next);
  }
  draw(){
    const state=STORY[this.node];
    this.root.querySelector('.urban-rpg-name').textContent=state.speaker;
    this.root.querySelector('.urban-rpg-line').textContent=state.text;
    const holder=this.root.querySelector('.urban-rpg-options');holder.replaceChildren();
    this.choices.forEach(([title],i)=>{
      const button=document.createElement('button');button.type='button';button.className='urban-rpg-choice'+(i===this.selected?' selected':'');
      button.textContent=`${i+1}.  ${title}`;
      button.onclick=()=>this.choose(i);button.onmouseenter=()=>{this.selected=i;this.draw();};
      holder.append(button);
    });
  }
  frameCamera(){
    if(!this.active)return;
    const player=this.world.editorPlayer,npc=this.npc,cam=this.world.camera;
    if(!player||!npc)return this.close();
    const a=player.position,b=npc.object.position,dir=b.clone().sub(a).setY(0);
    if(dir.lengthSq()<.001)dir.set(0,0,1);
    dir.normalize();const side=new THREE.Vector3(-dir.z,0,dir.x);
    const target=a.clone().lerp(b,.57).add(new THREE.Vector3(0,1.13,0));
    const desired=a.clone().addScaledVector(dir,-2.1).addScaledVector(side,1.7);
    desired.y=this.world.levelRuntime.groundAt(desired.x,desired.z)+2.05;
    cam.position.lerp(desired,.24);cam.fov=49;cam.updateProjectionMatrix();
    cam.lookAt(target);cam.updateMatrixWorld(true);
    npc.object.rotation.y=Math.atan2(a.x-b.x,a.z-b.z);
    const toward=b.clone().sub(a).setY(0);
    if(toward.lengthSq()>.01)player.setOrientation?.(toward,true);
    this.poseNPC();
  }
  poseNPC(){
    const obj=this.npc?.object;if(!obj)return;
    // Animated gesture of the REAL glTF model. Use named arm joints if available,
    // otherwise a small arm-like pointer pivot anchored to the model.
    if(!this.gesture){
      const arm=findHumanoidJoint(obj,'rightArm');
      this.gesture=arm||null;
      if(arm)this.armRest=arm.rotation.z;
    }
    if(this.gesture){
      this.gesture.rotation.z=this.armRest+Math.sin(this.tick*2.6)*.25-.33;
      return;
    }
    // Boxman may lack separately named skeletal arms. In that case attach a
    // small procedural gesturing arm, so the dialogue still visibly animates.
    if(!this.fallbackArm){
      const pivot=new THREE.Group();pivot.name='Dialogue gesture joint';
      // Emergency stand-in on unrigged boxman: NOT inferred from geometry.
      pivot.position.set(.28,1.15,0);
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(.16,.48,.18),new THREE.MeshStandardMaterial({color:0xe7e9ea,roughness:.85}));
      mesh.position.y=-.23;pivot.add(mesh);obj.add(pivot);this.fallbackArm=pivot;
    }
    this.fallbackArm.rotation.z=-.55+Math.sin(this.tick*2.6)*.22;
  }
  update(dt=1/60){
    this.tick+=dt;
    if(this.editor.active&&this.active)this.close();
    if(this.active){this.frameCamera();return;}
    const npc=this.nearest();this.hint.hidden=!npc;
  }
  close(){
    if(!this.active)return;
    this.active=false;this.root.hidden=true;
    if(this.npc)this.npc.dialoguePaused=false;
    if(this.gesture)this.gesture.rotation.z=this.armRest;
    this.fallbackArm?.removeFromParent();this.fallbackArm=null;this.gesture=null;
    this.world.camera.fov=this.previous.fov;this.world.camera.updateProjectionMatrix();
    this.world.renderer.domElement.focus();
  }
}
