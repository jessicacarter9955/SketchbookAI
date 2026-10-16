import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { Character } from '../ts/characters/Character';
import { Car } from '../ts/vehicles/Car';
import { loadDdsPlayer } from './DdsAssets';
import { DdsCharacter } from './DdsCharacter';
import { fitVehicleVisual } from './supercars.mjs';

export class ActorLayer {
    constructor(world) { this.world = world; this.actors = []; this.spawn = new THREE.Vector3(0, 2, -5); }
    async initialize(profile) {
        const loader = new GLTFLoader();
        if (profile === 'dds') {
            [this.playerModel, this.car] = await Promise.all([loadDdsPlayer(), loader.loadAsync('build/assets/car.glb')]);
            this.person = this.playerModel;
        } else {
            [this.person, this.car] = await Promise.all(['boxman', 'car'].map(name => loader.loadAsync(`build/assets/${name}.glb`)));
            this.person.scene.animations = this.person.animations;
            this.playerModel = this.person;
        }
        this.playerProfile = profile;
        this.world.actorLayer = this;
    }
    preview(type) { return clone(type === 'vehicle' ? this.car.scene : this.person.scene); }
    terrainHeight(x, z, previous = 0) {
        const floor = this.world.levelRuntime?.groundAt(x, z, Math.max(previous + 4, 5));
        return Number.isFinite(floor) ? floor : previous;
    }
    resetPlayer() {
        const old = this.world.editorPlayer;
        if (old) { old.stopControllingVehicle(); old.leaveSeat(); old.removeFromParent(); this.world.remove(old); }
        const player = this.playerProfile === 'dds' ? new DdsCharacter(this.playerModel) : new Character(this.playerModel.scene);
        const floor = this.terrainHeight(this.spawn.x, this.spawn.z, this.spawn.y - player.rayCastLength);
        this.spawn.y = floor + player.rayCastLength + 0.08;
        player.setPosition(...this.spawn.toArray());
        if (player.actions?.enter?.eventCodes && !player.actions.enter.eventCodes.includes('KeyE')) player.actions.enter.eventCodes.push('KeyE');
        player.userData.playerProfile = this.playerProfile;
        if(this.playerProfile==='dds') player.setOrientation(new THREE.Vector3(0,0,-1),true);
        player.position.copy(this.spawn);
        this.world.add(player); player.takeControl(); this.world.editorPlayer = player;
        return player;
    }
    start(items) {
        this.stop(false);
        for (const item of items) {
            if (!['vehicle', 'pedestrian'].includes(item.prefab)) continue;
            let actor;
            if (item.prefab === 'vehicle') {
                actor = new Car({ ...this.car, scene: clone(this.car.scene) });
                if (item.assetId) {
                    const template = this.world.sceneEditor?.templates.get(item.assetId);
                    if (template) {
                        // Retain the original rig, wheel transforms and seats for the real
                        // driving physics. Hide only its visible body: wheel nodes move
                        // independently into World.graphicsWorld when the car is added.
                        const rigScene = actor.children[0]?.children[0];
                        rigScene?.traverse(node => {
                            if (!node.isMesh) return;
                            let parent=node, isWheel=false;
                            while (parent && parent !== rigScene) {
                                if (parent.userData?.data === 'wheel') { isWheel=true; break; }
                                parent=parent.parent;
                            }
                            if (!isWheel) node.visible=false;
                        });
                        const shell = fitVehicleVisual(template, THREE);
                        shell.traverse(node => {
                            if (!node.isMesh) return;
                            node.castShadow=true;
                            node.receiveShadow=true;
                            for (const mat of [].concat(node.material||[])) if(mat && !actor.materials.includes(mat)) actor.materials.push(mat);
                        });
                        shell.userData.sketchfabAsset=item.assetId;
                        actor.add(shell);
                    }
                }
                const ground = this.terrainHeight(item.position[0], item.position[2], item.position[1]);
                actor.setPosition(item.position[0], ground + 0.9, item.position[2]);
                actor.collision.quaternion.setFromEuler(...item.rotation);
                actor.collision.initQuaternion.copy(actor.collision.quaternion);
                // Cannon does not implement box/trimesh contacts. Rounded bumpers supply
                // sphere/trimesh wall contacts while the original raycast wheels drive.
                for (const x of [-0.55, 0.55]) for (const z of [-1.1, 0, 1.1]) actor.collision.addShape(new CANNON.Sphere(0.38), new CANNON.Vec3(x, 0.45, z));
            } else {
                actor = new Character(this.person.scene);
                if (this.playerProfile === 'dds') {
                    const walk = this.person.scene.animations.find(clip => clip.name === 'walk');
                    if (walk) actor.setAnimations(this.person.scene.animations.map(clip => {
                        if (clip.name !== 'run' && !clip.name.startsWith('start_')) return clip;
                        const alias = walk.clone(); alias.name = clip.name; return alias;
                    }));
                }
                const ground = this.terrainHeight(item.position[0], item.position[2], item.position[1]);
                actor.setPosition(item.position[0], ground + actor.rayCastLength + 0.08, item.position[2]);
                const home = new THREE.Vector3(item.position[0], ground, item.position[2]); let timer = 0, target = home.clone();
                actor.setBehaviour({ character: actor, update: dt => {
                    timer -= dt; const delta = target.clone().sub(actor.position); delta.y = 0;
                    if (timer <= 0 || delta.length() < 1) {
                        timer = 4 + Math.random() * 4;
                        target.copy(home).add(new THREE.Vector3((Math.random() - 0.5) * 14, 0, (Math.random() - 0.5) * 14));
                        const y = this.world.levelRuntime?.groundAt(target.x, target.z, home.y + 4);
                        if (y !== undefined && Math.abs(y - home.y) > 1.5) target.copy(home);
                    }
                    actor.setViewVector(delta); actor.triggerAction('up', delta.length() > 1);
                    if (actor.position.distanceTo(home) > 25) actor.setPosition(home.x, this.terrainHeight(home.x,home.z,home.y) + actor.rayCastLength + 0.08, home.z);
                } });
            }
            actor.userData.editorActor = true; actor.userData.home = [item.position[0], this.terrainHeight(item.position[0],item.position[2],item.position[1]),item.position[2]]; this.world.add(actor); this.actors.push(actor);
        }
    }
    stop(resetPlayer = true) {
        if (resetPlayer && this.actors.length) this.resetPlayer();
        this.actors.forEach(actor => { if (!actor.userData.dormant) this.world.remove(actor); }); this.actors = [];
    }
    update(position) {
        for (const actor of this.actors) {
            if (actor.controllingCharacter === this.world.editorPlayer) continue;
            const distance = Math.hypot(actor.position.x - position.x, actor.position.z - position.z);
            if (distance > 160 && !actor.userData.dormant) { this.world.remove(actor); actor.userData.dormant = true; }
            else if (distance < 100 && actor.userData.dormant) {
                const home = actor.userData.home, floor = this.terrainHeight(home[0],home[2],home[1]);
                actor.setPosition(home[0], floor + (actor.rayCastLength ?? 0.9) + 0.08, home[2]);
                this.world.add(actor); actor.userData.dormant = false;
            }
        }
    }
}
