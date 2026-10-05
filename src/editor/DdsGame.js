import * as THREE from 'three';
import {DdsGameState, WEAPONS} from './dds-game-state.mjs';
import {DdsPopulation} from './DdsPopulation';
import {DdsInventory} from './DdsInventory';
import {DdsInteractionPanel} from './DdsInteractionPanel';

/** Local single-player training raid with passive residents. */
export class DdsGame {
    constructor(world, {storage=localStorage, key='sketchbook.dds.portland'}={}) {
        this.world=world; this.storage=storage; this.key=key; this.updateOrder=5;
        let saved; try {saved=JSON.parse(storage.getItem(key));} catch { /* new raid */ }
        this.state=new DdsGameState(saved); this.trigger=false; this.paused=false; this.effects=[];
        this.root=new THREE.Group(); this.root.name='DDS training raid'; world.graphicsWorld.add(this.root);
        this.ray=new THREE.Raycaster(); this.targets=[]; this.loot=[]; this.buildCourse(); this.mountUI();
        this.population=new DdsPopulation(this);
        world.ddsGame=this; world.registerUpdatable(this); this.bindPlayer();
        this.onBlur=()=>this.releaseInput(); window.addEventListener('blur',this.onBlur);
        this.onVisibility=()=>{if(document.hidden)this.releaseInput();}; document.addEventListener('visibilitychange',this.onVisibility);
        this.setPaused(!!world.sceneEditor?.active); this.refreshUI();
    }
    ground(x,z) {return this.world.levelRuntime.groundAt(x,z,this.world.actorLayer.spawn.y+2);}
    findSpot(x,z,used=[]) {
        const origin=this.world.actorLayer.spawn.clone();origin.y=this.ground(origin.x,origin.z)+1;
        const candidates=[];
        for(let dx=-12;dx<=12;dx+=2)for(let dz=-12;dz<=12;dz+=2)candidates.push([x+dx,z+dz]);
        candidates.sort((a,b)=>Math.hypot(a[0]-x,a[1]-z)-Math.hypot(b[0]-x,b[1]-z));
        const ray=new THREE.Raycaster();this.world.levelRuntime.root.updateMatrixWorld(true);
        for(const [cx,cz] of candidates) {
            const y=this.ground(cx,cz);
            if(!Number.isFinite(y)||Math.abs(y-(origin.y-1))>1||Math.hypot(cx-origin.x,cz-origin.z)<3||used.some(p=>Math.hypot(p[0]-cx,p[1]-cz)<3))continue;
            const destination=new THREE.Vector3(cx,y+1,cz),delta=destination.clone().sub(origin),distance=delta.length();
            ray.set(origin,delta.normalize());ray.far=distance+0.5;
            if(ray.intersectObject(this.world.levelRuntime.root,true).length)continue;
            let walkable=true;
            for(let t=0;t<=1;t+=0.1){const p=origin.clone().lerp(destination,t),gy=this.ground(p.x,p.z);if(!Number.isFinite(gy)||Math.abs(gy-y)>1){walkable=false;break;}}
            if(walkable)return [cx,cz];
        }
        throw new Error('No reachable space for the DDS practice course near this spawn.');
    }
    box(size,color,x,z,y=0) {
        const object=new THREE.Mesh(new THREE.BoxGeometry(...size),new THREE.MeshStandardMaterial({color,roughness:0.7}));
        object.position.set(x,this.ground(x,z)+size[1]/2+y,z); this.root.add(object); return object;
    }
    label(text,object,y=1) {
        const canvas=document.createElement('canvas'); canvas.width=512;canvas.height=96;
        const ctx=canvas.getContext('2d');ctx.fillStyle='#102630df';ctx.fillRect(0,0,512,96);ctx.fillStyle='#ffffff';ctx.font='bold 32px sans-serif';ctx.textAlign='center';ctx.fillText(text,256,60);
        const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;
        const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map,depthTest:true}));sprite.scale.set(2.6,0.49,1);sprite.position.y=y;object.add(sprite);
    }
    buildCourse() {
        const used=[];
        for(const [i,desired] of [[0,-10],[3,-14],[-3,-18]].entries()) {
            const [x,z]=this.findSpot(...desired,used);used.push([x,z]);
            const target=this.box([0.85,1.5,0.18],0xef744d,x,z,0.4);target.userData.targetIndex=i;
            this.label(`BERSAGLIO ${i+1}`,target,1.05);this.targets.push(target);
        }
        for(const [kind,desiredX,desiredZ,color,text] of [['supplies',3,-3,0x59a5d8,'E · RIFORNIMENTI'],['case',-4,-7,0xf4c45e,'E · VALIGETTA']]) {
            const [x,z]=this.findSpot(desiredX,desiredZ,used);used.push([x,z]);
            const object=this.box([0.7,0.5,0.5],color,x,z);object.userData.lootKind=kind;this.label(text,object,0.9);this.loot.push(object);
        }
        this.exit=new THREE.Mesh(new THREE.RingGeometry(1.5,2,48),new THREE.MeshBasicMaterial({color:0x6effac,side:THREE.DoubleSide,transparent:true,opacity:0.8}));
        const [exitX,exitZ]=this.findSpot(10,-5,used);
        this.exit.rotation.x=-Math.PI/2;this.exit.position.set(exitX,this.ground(exitX,exitZ)+0.04,exitZ);this.root.add(this.exit);
        const sign=new THREE.Group();sign.position.copy(this.exit.position);this.root.add(sign);this.label('E · ESTRAZIONE',sign,2);
    }
    mountUI() {
        this.hud=document.createElement('section');this.hud.className='dds-hud';this.hud.setAttribute('aria-label','DDS single player');
        this.hud.innerHTML='<strong>DDS · PORTLAND RAID</strong><div data-vitals></div><div data-ammo></div><p data-objective></p><p data-message role="status"></p><button data-inventory>Inventario · I</button><button data-reload>Ricarica · R</button><button data-aim>Mira · V</button><button data-interact>Interagisci · E</button><button data-restart hidden>Nuova incursione</button><small>1/2 armi · 3 riponi · clic spara · destro mira<br>WASD · Shift sprint · Spazio salto · H cura</small>';
        document.body.append(this.hud);
        this.crosshair=document.createElement('div');this.crosshair.className='dds-crosshair';this.crosshair.textContent='+';document.body.append(this.crosshair);
        this.inventoryUI=new DdsInventory(this,{onclose:()=>this.focus()});this.inventory=this.inventoryUI.element;
        this.interactionUI=new DdsInteractionPanel(this,{onclose:()=>{this.interactingNpc=null;this.focus();}});
        this.hud.querySelector('[data-inventory]').onclick=()=>this.toggleInventory();
        this.hud.querySelector('[data-reload]').onclick=()=>this.reload();
        this.hud.querySelector('[data-aim]').onclick=()=>{if(this.canAct())this.player.aiming=!this.player.aiming;this.focus();};
        this.hud.querySelector('[data-interact]').onclick=()=>{this.interact();if(!this.interactionUI.isOpen)this.focus();};
        this.hud.querySelector('[data-restart]').onclick=()=>this.restart();
    }
    bindPlayer() {this.player=this.world.editorPlayer;this.player.equipWeapon(this.state.equipped);}
    focus() {this.world.renderer.domElement.focus();}
    save() {try{this.storage.setItem(this.key,JSON.stringify(this.state.snapshot()));}catch{this.message('Salvataggio locale non riuscito.');}}
    message(text) {this.hud.querySelector('[data-message]').textContent=text;}
    refreshUI() {
        const s=this.state,w=WEAPONS[s.equipped],ammo=s.ammo[s.equipped];
        this.hud.querySelector('[data-vitals]').textContent=`Salute ${Math.round(s.health)} · Kit ${s.medkits}`;
        this.hud.querySelector('[data-ammo]').textContent=w ? `${w.name} · ${ammo.magazine} / ${ammo.reserve}${s.reloadRemaining?' · Ricarica…':''}` : 'Arma riposta';
        this.hud.querySelector('[data-objective]').textContent=s.extracted?'ESTRAZIONE COMPLETATA':!s.health?'INCURSIONE FALLITA':`Bersagli ${s.targets.filter(h=>!h).length}/3 · Valigetta ${s.caseCollected?'✓':'da recuperare'} · poi raggiungi il cerchio verde`;
        this.hud.querySelector('[data-restart]').hidden=!!s.health&&!s.extracted;
        this.targets.forEach((target,i)=>{target.visible=s.targets[i]>0;});
        this.loot.forEach(item=>{item.visible=!(item.userData.lootKind==='case'?s.caseCollected:s.suppliesCollected);});
        this.inventoryUI.render();this.interactionUI.render();
    }
    canAct() {return !this.paused&&!this.inventory.open&&!this.interactionUI.isOpen&&!!this.state.health&&!this.state.extracted&&!this.player.controlledObject;}
    releaseInput() {this.trigger=false;if(this.player)this.player.aiming=false;}
    setPaused(paused) {this.paused=paused;this.releaseInput();this.root.visible=!paused;this.hud.hidden=paused;this.crosshair.hidden=paused;this.inventoryUI.close();this.interactionUI.close();this.population.setPaused(paused);}
    toggleInventory() {
        if(this.interactionUI.isOpen||this.paused)return;
        this.inventoryUI.toggle();
    }
    equip(id) {if(!this.state.health||this.state.extracted||!this.state.equip(id))return;this.trigger=false;this.player.equipWeapon(id);if(id)this.player.playUpper(`${id}_equip`,true);this.save();this.refreshUI();}
    heal() {if(this.state.heal()){this.player.playUpper('heal',true);this.message('Kit medico utilizzato.');this.save();this.refreshUI();}}
    reload() {
        if(!this.canAct()||!this.state.reload())return;
        const name=`${this.state.equipped}_reload`;this.player.playUpper(name,true);
        const clip=this.player.upperClips.get(name);if(clip)this.player.upperMixer.existingAction(clip).setEffectiveTimeScale(clip.duration/WEAPONS[this.state.equipped].reload);
        this.player.actionRemaining=WEAPONS[this.state.equipped].reload;this.refreshUI();this.focus();
    }
    handleKey(event,code,pressed) {
        if(this.paused)return false;
        if(this.inventory.open||this.interactionUI.isOpen)return true;
        const keys=['Digit1','Digit2','Digit3','KeyI','KeyR','KeyH','KeyE','KeyV'];
        if(!keys.includes(code))return !this.state.health||this.state.extracted;
        if(pressed&&!event.repeat) {
            if(code==='KeyI')this.toggleInventory();
            else if(this.canAct()) {
                if(code.startsWith('Digit'))this.equip(code==='Digit1'?'rifle':code==='Digit2'?'pistol':null);
                if(code==='KeyR')this.reload();if(code==='KeyH')this.heal();if(code==='KeyE')this.interact();
                if(code==='KeyV')this.player.aiming=!this.player.aiming;
            }
        }
        return true;
    }
    handleMouse(code,pressed) {
        if(!['mouse0','mouse2'].includes(code)||this.player.controlledObject)return false;
        if(code==='mouse0'){this.trigger=pressed&&this.canAct();if(this.trigger)this.shoot();}
        if(code==='mouse2')this.player.aiming=pressed&&this.canAct();
        return true;
    }
    hitTest(origin,direction,max=200) {
        this.ray.set(origin,direction);this.ray.far=max;
        const objects=[this.world.levelRuntime.root,...this.targets.filter(t=>t.visible),...this.population.hitboxes,...(this.world.sceneEditor ? [...this.world.sceneEditor.objects.values()].filter(o=>o.visible):[])];
        const meshes=[];
        for(const object of objects) {
            object.updateWorldMatrix(true,true);
            object.traverseVisible(child=>{if(child.isMesh&&!child.userData.editorSurface)meshes.push(child);});
        }
        return this.ray.intersectObjects(meshes,false)[0];
    }
    shoot() {
        if(!this.canAct())return null;
        const shot=this.state.fire();if(!shot){if(this.state.equipped&&!this.state.ammo[this.state.equipped].magazine)this.message('Caricatore vuoto · R per ricaricare');return null;}
        const camera=this.world.camera;camera.updateMatrixWorld(true);
        const direction=camera.getWorldDirection(new THREE.Vector3());
        this.player.playUpper(`${shot.weapon}_aim`);this.player.upperMixer.update(0);
        this.player.setOrientation(direction,true);this.player.rotateModel();this.player.updateMatrixWorld(true);
        const cameraHit=this.hitTest(camera.position,direction);
        const aim=cameraHit?.point || camera.position.clone().addScaledVector(direction,200);
        const muzzle=this.player.weapon.localToWorld(new THREE.Vector3(0,0.1,shot.weapon==='rifle'?0.7:0.2));
        const bulletDirection=aim.clone().sub(muzzle).normalize();
        const hit=this.hitTest(muzzle,bulletDirection,muzzle.distanceTo(aim)+0.02);
        this.lastShot={muzzle:muzzle.toArray(),aim:aim.toArray(),hit:hit?.point.toArray(),target:hit?.object.userData.targetIndex,npc:hit?.object.userData.npcId,sector:hit?.object.userData.citySectorId};
        if(hit?.object.userData.npcId) {this.population.damage(hit.object.userData.npcId,shot.damage);this.crosshair.classList.add('hit');this.hitTimer=0.18;}
        if(hit?.object.userData.targetIndex!==undefined) {
            const index=hit.object.userData.targetIndex;this.state.hitTarget(index,shot.damage);
            this.message(this.state.targets[index]?`Colpito · bersaglio ${index+1}: ${this.state.targets[index]} HP`:`Bersaglio ${index+1} eliminato`);
            this.crosshair.classList.add('hit');this.hitTimer=0.18;
        }
        const end=hit?.point||aim;
        const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([muzzle,end]),new THREE.LineBasicMaterial({color:0xffe19b,transparent:true,opacity:0.9}));
        this.world.graphicsWorld.add(line);this.effects.push({object:line,time:0.07});
        const flash=new THREE.Mesh(new THREE.SphereGeometry(0.07,6,4),new THREE.MeshBasicMaterial({color:0xffe390}));flash.position.copy(muzzle);this.world.graphicsWorld.add(flash);this.effects.push({object:flash,time:0.05});
        this.player.playUpper(`${shot.weapon}_fire`,true);this.save();this.refreshUI();return hit;
    }
    interact() {
        if(!this.canAct())return false;
        for(const item of this.loot) {
            if(item.visible&&this.player.position.distanceTo(item.position)<2.5&&this.state.collect(item.userData.lootKind)) {
                this.message(item.userData.lootKind==='case'?'Valigetta recuperata.':'Munizioni e kit raccolti.');this.save();this.refreshUI();return true;
            }
        }
        const npc=this.population.nearest(this.player.position);
        if(npc) {
            if(npc.role==='target'){this.message(`${npc.name} · ${npc.health} HP · bersaglio di addestramento`);return true;}
            this.interactingNpc=npc;this.population.pauseActor(npc.id);
            this.interactionUI.open({id:npc.id,name:npc.name,type:npc.role==='merchant'?'merchant':'guide'});return true;
        }
        if(this.player.position.distanceTo(this.exit.position)<3) {
            if(this.state.extract()){this.player.resetControls();this.message('Incursione completata. Bottino salvato.');this.save();this.refreshUI();return true;}
            this.message('Elimina i 3 bersagli e recupera la valigetta prima di estrarre.');
        }else this.message('Avvicinati a un abitante, a una cassa o al cerchio verde e premi E.');
        return false;
    }
    buy(id) {
        const npc=this.interactingNpc;
        if(this.paused||!this.interactionUI.isOpen||!npc||npc.dead||npc.role!=='merchant'||this.player.position.distanceTo(npc.actor.position)>3.2)return {ok:false,message:'Avvicinati al commerciante per acquistare.'};
        const result=this.state.buy(id);if(result.ok){this.save();this.refreshUI();}return result;
    }
    restart() {this.inventoryUI.close();this.interactionUI.close();this.interactingNpc=null;this.state=new DdsGameState();this.releaseInput();this.world.actorLayer.resetPlayer();this.bindPlayer();this.population.reset();this.save();this.refreshUI();this.message('Nuova incursione.');this.focus();}
    update(dt) {
        if(this.world.editorPlayer!==this.player)this.bindPlayer();
        if(this.interactionUI.isOpen&&this.interactingNpc)this.population.pauseActor(this.interactingNpc.id);
        this.population.update(dt);
        for(const effect of this.effects) {effect.time-=dt;if(effect.time<=0){effect.object.removeFromParent();effect.object.geometry.dispose();effect.object.material.dispose();}}
        this.effects=this.effects.filter(e=>e.time>0);
        this.hitTimer=Math.max(0,(this.hitTimer||0)-dt);if(!this.hitTimer)this.crosshair.classList.remove('hit');
        this.crosshair.hidden=!this.canAct();
        if(!this.canAct()){this.trigger=false;return;}
        if(this.state.tick(dt)){this.save();this.refreshUI();}
        if(this.trigger&&WEAPONS[this.state.equipped]?.automatic)this.shoot();
        const velocity=this.player.characterCapsule.body.velocity.y;
        if(this.player.rayHasHit&&(this.fallVelocity||0)<-9) {
            this.state.damage(Math.min(100,Math.abs(this.fallVelocity+9)*12));this.save();this.refreshUI();
            if(!this.state.health)this.player.resetControls();
        }
        this.fallVelocity=this.player.rayHasHit?0:Math.min(this.fallVelocity||0,velocity);
    }
}
