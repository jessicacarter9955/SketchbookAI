import * as THREE from 'three';
import { Character } from '../ts/characters/Character';

const RESIDENTS = [
    {id:'guide', name:'Mara', role:'guide', title:'GUIDA · E parla', color:0x64b9e8, offset:[-4,2]},
    {id:'merchant', name:'Nico', role:'merchant', title:'MERCANTE · E negozio', color:0xf4c76a, offset:[4,2]},
    {id:'dummy-1', name:'Manichino A', role:'target', title:'ADDESTRAMENTO', color:0xe8896e, offset:[-7,-3]},
    {id:'dummy-2', name:'Manichino B', role:'target', title:'ADDESTRAMENTO', color:0xe8896e, offset:[7,-3]},
    {id:'walker-1', name:'Luca', role:'pedestrian', title:'PASSANTE · E parla', color:0x8ac5a0, offset:[-4,7]},
    {id:'walker-2', name:'Ada', role:'pedestrian', title:'PASSANTE · E parla', color:0xc3a0dd, offset:[4,7]}
];
const flatDistance = (a,b) => Math.hypot(a.x-b.x,a.z-b.z);

/**
 * Passive, damageable DDS residents. DdsGame owns update(dt), reset(), and
 * dispose(); only the underlying Characters register with World. Never takes
 * input control. nearest() is read-only; pauseActor(id) holds a conversation.
 */
export class DdsPopulation {
    constructor(game) {
        this.game=game; this.world=game.world; this.actors=[]; this.paused=false;
        this.root=new THREE.Group(); this.root.name='DDS residents'; game.root.add(this.root);
        this.pathRay=new THREE.Raycaster(); this.reset();
    }

    get hitboxes() {return this.paused ? [] : this.actors.filter(npc=>!npc.dead).map(npc=>npc.hitbox);}

    occupied() {
        return [...(this.game.targets||[]),...(this.game.loot||[]),this.game.exit]
            .filter(Boolean).map(object=>({position:object.position,radius:object===this.game.exit?2.8:1.4}));
    }

    reset() {
        this.clear();
        const source=this.world.actorLayer.playerModel.scene, spawn=this.world.actorLayer.spawn;
        const used=this.occupied().map(({position})=>[position.x,position.z]);
        const health=this.game.state.npcHealth || (this.game.state.npcHealth={});
        try {
            for(const spec of RESIDENTS) {
                const [x,z]=this.game.findSpot(spawn.x+spec.offset[0],spawn.z+spec.offset[1],used);
                const y=this.game.ground(x,z);
                if(!Number.isFinite(y))throw new Error('No solid ground for DDS residents.');
                used.push([x,z]);
                const actor=new Character(source);
                // Character's Walk state requests "run". Keep exported walking
                // motion on these private clips without modifying the player.
                const walk=source.animations.find(clip=>clip.name==='walk');
                if(walk) actor.setAnimations(source.animations.map(clip=>{
                    if(clip.name!=='run'&&!clip.name.startsWith('start_'))return clip;
                    const alias=walk.clone(); alias.name=clip.name; return alias;
                }));
                actor.name=`DDS ${spec.name}`; actor.userData.npcId=spec.id;
                actor.userData.editorActor=true; actor.moveSpeed=1.8;
                const ownedMaterials=new Set(), materialCopies=new Map();
                actor.modelContainer.traverse(mesh=>{
                    if(!mesh.isMesh)return;
                    const tint=material=>{
                        if(!materialCopies.has(material)) {
                            const copy=material.clone(); copy.color?.setHex(spec.color);
                            materialCopies.set(material,copy); ownedMaterials.add(copy);
                        }
                        return materialCopies.get(material);
                    };
                    mesh.material=Array.isArray(mesh.material)?mesh.material.map(tint):tint(mesh.material);
                    mesh.userData.npcId=spec.id;
                });
                actor.materials=[...ownedMaterials];
                const home=new THREE.Vector3(x,y+actor.rayCastLength,z);
                actor.setPosition(...home.toArray()); actor.position.copy(home);
                actor.setOrientation(spawn.clone().sub(home).setY(0),true); actor.rotateModel();
                const hp=Number.isFinite(health[spec.id])?THREE.MathUtils.clamp(health[spec.id],0,100):100;
                health[spec.id]=hp;
                const npc={...spec,actor,home,health:hp,maxHealth:100,dead:false,registered:false,
                    ownedMaterials,route:[],routeIndex:1,wait:0,hold:0,stuck:0,lastPosition:home.clone(),deathTime:0};
                npc.hitbox=new THREE.Mesh(new THREE.BoxGeometry(0.7,1.8,0.55),
                    new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false,colorWrite:false}));
                npc.hitbox.name=`${spec.id} hitbox`; npc.hitbox.userData.npcId=spec.id;
                npc.hitbox.position.y=0.9-actor.rayCastLength; actor.add(npc.hitbox);
                this.createLabel(npc); this.actors.push(npc);
                actor.setBehaviour({character:actor,update:dt=>this.drive(npc,dt)});
                if(hp<=0)this.die(npc,true);
                else if(this.paused)this.root.add(actor);
                else this.add(npc);
            }
            for(const npc of this.actors)if(npc.role==='pedestrian')npc.route=this.makeRoute(npc);
            this.update(0);
        } catch(error) {this.clear();throw error;}
    }

    add(npc) {
        if(npc.registered||npc.dead)return;
        this.world.add(npc.actor); npc.registered=true;
    }

    remove(npc) {
        if(!npc.registered)return;
        // World.remove also unregisters the update and both Cannon callbacks.
        this.world.remove(npc.actor); npc.registered=false;
    }

    createLabel(npc) {
        const canvas=document.createElement('canvas'); canvas.width=512; canvas.height=144;
        const texture=new THREE.CanvasTexture(canvas); texture.colorSpace=THREE.SRGBColorSpace;
        npc.label=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:true,transparent:true}));
        npc.label.scale.set(2.15,0.605,1); this.root.add(npc.label); npc.canvas=canvas;
        this.drawLabel(npc);
    }

    drawLabel(npc) {
        const ctx=npc.canvas.getContext('2d'); ctx.clearRect(0,0,512,144);
        ctx.fillStyle='#102630e8'; ctx.fillRect(0,0,512,144);
        ctx.textAlign='center'; ctx.fillStyle='#ffffff'; ctx.font='bold 35px sans-serif';
        ctx.fillText(`${npc.name} · ${Math.ceil(npc.health)} HP`,256,44);
        ctx.font='24px sans-serif'; ctx.fillStyle=npc.dead?'#dbb3a6':'#d5e5eb';
        ctx.fillText(npc.dead?'A TERRA':npc.title,256,81);
        ctx.fillStyle='#41545e'; ctx.fillRect(24,106,464,15);
        ctx.fillStyle=npc.health>35?'#8ed8a2':'#f49a74'; ctx.fillRect(24,106,464*npc.health/npc.maxHealth,15);
        npc.label.material.map.needsUpdate=true;
        this.positionLabel(npc);
    }

    positionLabel(npc) {
        if(npc.dead)npc.label.position.copy(npc.corpse.position).add(new THREE.Vector3(0,0.75,0));
        else npc.label.position.copy(npc.actor.position).add(new THREE.Vector3(0,1.72,0));
    }

    safePath(from,to,npc) {
        const distance=flatDistance(from,to);
        if(distance<1||distance>5)return false;
        const floor=from.y-npc.actor.rayCastLength;
        const obstacles=this.occupied();
        for(const other of this.actors)if(other!==npc)obstacles.push({position:other.home,radius:1.2});
        const steps=Math.ceil(distance/0.4);
        for(let i=1;i<=steps;i++) {
            const p=from.clone().lerp(to,i/steps),y=this.game.ground(p.x,p.z);
            if(!Number.isFinite(y)||Math.abs(y-floor)>0.4)return false;
            if(obstacles.some(o=>flatDistance(p,o.position)<o.radius))return false;
        }
        const level=this.world.levelRuntime?.root;
        if(level) {
            level.updateWorldMatrix(true,true);
            const direction=to.clone().sub(from).setY(0).normalize();
            // Three parallel traces provide clearance for the capsule width.
            const side=new THREE.Vector3(-direction.z,0,direction.x);
            for(const offset of [-0.35,0,0.35]) {
                const origin=from.clone().addScaledVector(side,offset); origin.y=floor+0.8;
                this.pathRay.set(origin,direction); this.pathRay.far=distance+0.4;
                if(this.pathRay.intersectObject(level,true).length)return false;
            }
        }
        return true;
    }

    makeRoute(npc) {
        for(const length of [3.4,2.4,1.6])for(let i=0;i<12;i++) {
            const angle=i*Math.PI/6+(npc.id==='walker-2'?Math.PI/3:0);
            const to=npc.home.clone().add(new THREE.Vector3(Math.cos(angle)*length,0,Math.sin(angle)*length));
            if(this.safePath(npc.home,to,npc)) {
                to.y=this.game.ground(to.x,to.z)+npc.actor.rayCastLength;
                return [npc.home.clone(),to];
            }
        }
        return [npc.home.clone()];
    }

    drive(npc,dt) {
        const actor=npc.actor;
        if(this.paused||npc.dead)return;
        const floor=this.game.ground(actor.position.x,actor.position.z);
        if(!Number.isFinite(floor)||actor.position.y<npc.home.y-2||flatDistance(actor.position,npc.home)>8) {
            actor.resetVelocity(); actor.setPosition(...npc.home.toArray()); actor.position.copy(npc.home);
            npc.routeIndex=1; npc.wait=0.5;
        }
        npc.hold=Math.max(0,npc.hold-dt); npc.wait=Math.max(0,npc.wait-dt);
        if(npc.role!=='pedestrian'||npc.route.length<2||npc.hold>0||npc.wait>0) {
            actor.triggerAction('up',false); return;
        }
        const target=npc.route[npc.routeIndex],delta=target.clone().sub(actor.position).setY(0);
        if(delta.length()<0.38) {
            npc.routeIndex=(npc.routeIndex+1)%npc.route.length; npc.wait=1.2; npc.stuck=0;
            actor.triggerAction('up',false); return;
        }
        const player=this.world.editorPlayer;
        if(player&&flatDistance(actor.position,player.position)<1.1) {
            actor.triggerAction('up',false); npc.stuck=0; return;
        }
        // A blocked resident waits and reverses instead of walking off a ledge
        // or repeatedly pushing through scenery or other characters.
        const ahead=actor.position.clone().addScaledVector(delta.clone().normalize(),0.65);
        const groundAhead=this.game.ground(ahead.x,ahead.z);
        if(!Number.isFinite(groundAhead)||Math.abs(groundAhead-(npc.home.y-actor.rayCastLength))>0.5) {
            npc.routeIndex=(npc.routeIndex+1)%npc.route.length; npc.wait=1;
            actor.triggerAction('up',false); return;
        }
        npc.stuck=flatDistance(actor.position,npc.lastPosition)<dt*0.12?npc.stuck+dt:0;
        npc.lastPosition.copy(actor.position);
        if(npc.stuck>3) {
            npc.routeIndex=(npc.routeIndex+1)%npc.route.length; npc.wait=1; npc.stuck=0;
            actor.triggerAction('up',false); return;
        }
        actor.setViewVector(delta); actor.triggerAction('up',true);
    }

    nearest(position,range=2.8) {
        if(this.paused)return null;
        let nearest=null,best=range;
        for(const npc of this.actors) {
            if(npc.dead||Math.abs(position.y-npc.actor.position.y)>2)continue;
            const distance=flatDistance(position,npc.actor.position);
            if(distance<best) {nearest=npc;best=distance;}
        }
        return nearest;
    }

    pauseActor(id,seconds=5) {
        const npc=this.actors.find(n=>n.id===id&&!n.dead);
        if(!npc)return false;
        npc.hold=Math.max(npc.hold,Number.isFinite(seconds)?Math.max(0,seconds):5);
        npc.actor.triggerAction('up',false); npc.actor.resetVelocity();
        const player=this.world.editorPlayer;
        if(player)npc.actor.setOrientation(player.position.clone().sub(npc.actor.position),true);
        return true;
    }

    damage(id,amount) {
        const npc=this.actors.find(n=>n.id===id);
        if(this.paused||!npc||npc.dead||!Number.isFinite(amount)||amount<=0)return null;
        npc.health=Math.max(0,npc.health-amount);
        (this.game.state.npcHealth||(this.game.state.npcHealth={}))[id]=npc.health;
        if(!npc.health)this.die(npc);
        else {npc.hold=0.6;npc.actor.triggerAction('up',false);}
        this.drawLabel(npc);
        this.game.message?.(npc.dead?`${npc.name} a terra`:`${npc.name} · ${Math.ceil(npc.health)} HP`);
        this.game.save?.();
        return npc;
    }

    die(npc,immediate=false) {
        const actor=npc.actor;
        actor.resetControls(); actor.resetVelocity();
        this.remove(npc); npc.dead=true; npc.hitbox.visible=false;
        // This is an in-engine fall, using the already loaded mannequin.
        // Keep its final pose, remove all simulation, and retain the corpse.
        actor.mixer.update(0); actor.mixer.timeScale=0;
        const ground=this.game.ground(actor.position.x,actor.position.z);
        npc.corpse=new THREE.Group(); npc.corpse.name=`${npc.id} corpse`;
        npc.corpse.position.set(actor.position.x,Number.isFinite(ground)?ground:npc.home.y-actor.rayCastLength,actor.position.z);
        this.root.add(npc.corpse); npc.corpse.add(actor);
        actor.position.set(0,actor.rayCastLength,0);
        npc.deathTime=immediate?0.85:0; this.poseCorpse(npc);
        this.drawLabel(npc);
    }

    poseCorpse(npc) {
        const t=Math.min(1,npc.deathTime/0.85),eased=t*t*(3-2*t);
        npc.corpse.rotation.z=eased*Math.PI/2;
        // Lift the final side pose slightly clear of the collision surface.
        npc.corpse.children[0].position.x=0.16*eased;
        this.positionLabel(npc);
    }

    setPaused(paused) {
        paused=!!paused;
        if(this.paused===paused)return;
        this.paused=paused; this.root.visible=!paused;
        for(const npc of this.actors) {
            if(npc.dead)continue;
            npc.actor.resetControls(); npc.actor.resetVelocity();
            if(paused) {this.remove(npc);this.root.add(npc.actor);}
            else this.add(npc);
        }
    }

    update(dt) {
        if(this.paused||!Number.isFinite(dt)||dt<0)return;
        for(const npc of this.actors) {
            if(npc.dead) {npc.deathTime+=Math.min(dt,0.1);this.poseCorpse(npc);}
            else this.positionLabel(npc);
        }
    }

    clear() {
        for(const npc of this.actors) {
            this.remove(npc); npc.actor.removeFromParent(); npc.corpse?.removeFromParent();
            npc.actor.behaviour=undefined; npc.actor.mixer.stopAllAction();
            npc.actor.mixer.uncacheRoot(npc.actor.mixer.getRoot());
            npc.ownedMaterials.forEach(material=>{
                this.world.sky?.csm?.shaders?.delete(material);
                material.dispose();
            });
            // Skin geometry and textures belong to the shared DDS asset loader.
            npc.actor.modelContainer.traverse(mesh=>{if(mesh.isSkinnedMesh)mesh.skeleton.dispose();});
            npc.actor.raycastBox.geometry.dispose(); npc.actor.raycastBox.material.dispose();
            npc.hitbox.geometry.dispose(); npc.hitbox.material.dispose();
            npc.label.removeFromParent(); npc.label.material.map.dispose(); npc.label.material.dispose();
        }
        this.actors=[];
    }

    dispose() {this.clear();this.root.removeFromParent();}
}
