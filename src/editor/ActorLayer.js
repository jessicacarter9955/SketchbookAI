import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { Character } from '../ts/characters/Character';
import { Car } from '../ts/vehicles/Car';
import { loadDdsPlayer } from './DdsAssets';
import { DdsCharacter } from './DdsCharacter';
import { UrbanPopulation } from './UrbanPopulation.js';
import {fitVehicleVisual,SUPERCARS} from './supercars.mjs';
import {rigImportedWheels,chassisHeightForGround} from './wheel-rig.mjs';

export class ActorLayer {
    constructor(world) { this.world = world; this.actors = []; this.spawn = new THREE.Vector3(0, 2, -5); }
    async initialize(profile) {
        [this.person, this.car] = await Promise.all(['boxman', 'car'].map(name => new GLTFLoader().loadAsync(`build/assets/${name}.glb`)));
        this.person.scene.animations = this.person.animations;
        if(profile === 'dds') this.playerModel = await loadDdsPlayer();
        else if(profile === 'mannequin') {
            const scene = clone(this.person.scene);
            scene.animations = this.person.animations;
            scene.traverse(object => {
                if (!object.isMesh) return;
                const source = Array.isArray(object.material) ? object.material : [object.material];
                const materials = source.map(material => {
                    const next = material?.clone?.() || new THREE.MeshStandardMaterial();
                    next.color?.set(0xbfc6c9); next.roughness = 0.48; next.metalness = 0.12;
                    return next;
                });
                object.material = Array.isArray(object.material) ? materials : materials[0];
                object.castShadow = true; object.receiveShadow = true;
            });
            this.playerModel = { ...this.person, scene };
        } else this.playerModel = this.person;
        this.playerProfile = profile;
        this.world.actorLayer = this;
    }
    preview(type) { return clone(type === 'vehicle' ? this.car.scene : (this.playerProfile==='dds'?this.playerModel.scene:this.person.scene)); }
    ground(x,z,previous=0) {const h=this.world.levelRuntime?.groundAt(x,z,previous+4);return Number.isFinite(h)?h:previous;}
    resetPlayer() {
        const old = this.world.editorPlayer;
        if (old) { old.stopControllingVehicle(); old.leaveSeat(); old.removeFromParent(); this.world.remove(old); }
        const player = this.playerProfile === 'dds' ? new DdsCharacter(this.playerModel) : new Character(this.playerModel.scene);
        this.spawn.y=this.ground(this.spawn.x,this.spawn.z,this.spawn.y-player.rayCastLength)+player.rayCastLength+0.08;
        player.setPosition(...this.spawn.toArray());
        player.userData.playerProfile = this.playerProfile;
        if(this.playerProfile==='dds') player.setOrientation(new THREE.Vector3(0,0,-1),true);
        player.position.copy(this.spawn);
        this.world.add(player); player.takeControl(); this.world.editorPlayer = player;
        return player;
    }

    // Imported GLBs are body skins around the existing raycast-based Car rig;
    // this retains functioning seats, steering, suspension and F to enter.
    createVehicleActor(item) {
        const actor=new Car({...this.car,scene:clone(this.car.scene)});
        const template=item.assetId&&this.world.sceneEditor?.templates.get(item.assetId);
        if(item.assetId&&!template)throw Error('GLB guidabile assente dal catalogo: '+item.assetId);
        if(template){
            const sourceScene=actor.children[0]?.children[0];
            sourceScene?.traverse(node=>{
                if(!node.isMesh)return;
                let ancestor=node,isWheel=false;
                while(ancestor&&ancestor!==sourceScene){
                    if(ancestor.userData?.data==='wheel'){isWheel=true;break;}
                    ancestor=ancestor.parent;
                }
                if(!isWheel)node.visible=false;
            });
            const shell=fitVehicleVisual(template,THREE);
            const model=this.world.sceneEditor?.assets.get(item.assetId);
            const brand=SUPERCARS.find(car=>car.uid===model?.metadata?.uid);
            if(brand){
                const rig=rigImportedWheels(shell,brand.id,actor,THREE);
                actor.userData.rigStatus=rig;
                if(!rig.ready)globalThis.cityDiagnostics?.activity?.(
                    'AUTO '+brand.name+': ruote originali non identificabili: '+rig.reason);
            } else actor.userData.rigStatus={
                ready:false,reason:'Ruote reali non riconosciute; usa il telaio fisico Sketchbook.'
            };
            const lowest=new THREE.Box3().setFromObject(shell).min.y;
            shell.position.y+=-0.50-lowest;
            if(actor.userData.sketchfabWheelRig?.length===4){
                for(const binding of actor.userData.sketchfabWheelRig){
                    const wheel=actor.rayCastVehicle.wheelInfos[binding.index];
                    const anchor=binding.sourceCenter.clone().add(shell.position);
                    wheel.radius=binding.radius;
                    wheel.suspensionRestLength=0.52;
                    wheel.maxSuspensionTravel=0.12;
                    wheel.suspensionStiffness=32;
                    wheel.dampingCompression=4.8;
                    wheel.dampingRelaxation=3.6;
                    wheel.frictionSlip=1.6;
                    wheel.chassisConnectionPointLocal.set(anchor.x,
                        anchor.y+wheel.suspensionRestLength,anchor.z);
                }
            }
            shell.userData.sketchfabAsset=item.assetId;
            shell.traverse(node=>{
                if(!node.isMesh)return;
                node.castShadow=true;node.receiveShadow=true;
                for(const mat of [].concat(node.material||[]))
                    if(mat&&!actor.materials.includes(mat))actor.materials.push(mat);
            });
            actor.add(shell);
            actor.userData.importedModel=item.assetId;
        }
        const floor=this.ground(item.position[0],item.position[2],item.position[1]);
        const y=template?chassisHeightForGround(floor,actor.rayCastVehicle.wheelInfos,0.06):floor+0.9;
        actor.setPosition(item.position[0],y,item.position[2]);
        actor.collision.quaternion.setFromEuler(...item.rotation);
        actor.collision.initQuaternion.copy(actor.collision.quaternion);
        for(const x of [-0.55,0.55])for(const z of [-1.1,0,1.1])
            actor.collision.addShape(new CANNON.Sphere(0.33),new CANNON.Vec3(x,0.26,z));
        return actor;
    }
    spawnImportedVehicle(item) {
        if(item.prefab!=='vehicle'||!item.assetId)return null;
        const existing=this.actors.find(a=>a.userData.editorItemId===item.id);
        if(existing)return existing;
        const actor=this.createVehicleActor(item);
        actor.userData.editorActor=true;
        actor.userData.editorItemId=item.id;
        actor.userData.home=[...item.position];
        this.world.add(actor);
        this.actors.push(actor);
        globalThis.cityDiagnostics?.activity?.('AUTO GUIDABILE: '+item.name+
            ' · F per entrare · fisica Cannon attiva.');
        return actor;
    }
    start(items) {
        this.stop(false);
        const urban=Boolean(this.world.levelRuntime?.plan?.roads);
        if(urban)this.urbanPopulation=new UrbanPopulation(this.world,this.playerProfile==='dds'?this.playerModel.scene:this.person.scene,this.car.scene);
        for (const item of items) {
            if(urban && item.prefab==='pedestrian')continue;
            if (!['vehicle', 'pedestrian'].includes(item.prefab)) continue;
            let actor;
            if (item.prefab === 'vehicle') {
                actor=this.createVehicleActor(item);
            } else {
                actor = new Character(this.person.scene);
                actor.setPosition(item.position[0], this.ground(item.position[0],item.position[2],item.position[1])+actor.rayCastLength+0.08, item.position[2]);
                const home = new THREE.Vector3(...item.position); let timer = 0, target = home.clone();
                actor.setBehaviour({ character: actor, update: dt => {
                    timer -= dt; const delta = target.clone().sub(actor.position); delta.y = 0;
                    if (timer <= 0 || delta.length() < 1) {
                        timer = 4 + Math.random() * 4;
                        target.copy(home).add(new THREE.Vector3((Math.random() - 0.5) * 14, 0, (Math.random() - 0.5) * 14));
                        const y = this.world.levelRuntime?.groundAt(target.x, target.z, home.y + 4);
                        if (y !== undefined && Math.abs(y - home.y) > 1.5) target.copy(home);
                    }
                    actor.setViewVector(delta); actor.triggerAction('up', delta.length() > 1);
                    if (actor.position.distanceTo(home) > 25) actor.setPosition(home.x, this.ground(home.x,home.z,home.y)+actor.rayCastLength+0.08, home.z);
                } });
            }
            actor.userData.editorActor = true; actor.userData.editorItemId=item.id; actor.userData.home = [...item.position]; this.world.add(actor); this.actors.push(actor);
        }
    }
    stop(resetPlayer = true) {
        this.urbanPopulation?.destroy();this.urbanPopulation=null;
        if (resetPlayer && this.actors.length) this.resetPlayer();
        this.actors.forEach(actor => { if (!actor.userData.dormant) this.world.remove(actor); }); this.actors = [];
    }
    update(position) {
        if(this.urbanPopulation&&!this.world.sceneEditor?.active)this.urbanPopulation.update(this.world.requestDelta||1/60);
        for (const actor of this.actors) {
            if (actor.controllingCharacter === this.world.editorPlayer) continue;
            const distance = Math.hypot(actor.position.x - position.x, actor.position.z - position.z);
            if (distance > 160 && !actor.userData.dormant) { this.world.remove(actor); actor.userData.dormant = true; }
            else if (distance < 100 && actor.userData.dormant) {
                const home = actor.userData.home; actor.setPosition(home[0], this.ground(home[0],home[2],home[1])+(actor.rayCastLength??0.9)+0.08, home[2]);
                this.world.add(actor); actor.userData.dormant = false;
            }
        }
    }
}
