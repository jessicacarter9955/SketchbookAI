import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { Character } from '../ts/characters/Character';
import { Car } from '../ts/vehicles/Car';
import { loadDdsPlayer } from './DdsAssets';

export class ActorLayer {
    constructor(world) { this.world = world; this.actors = []; this.spawn = new THREE.Vector3(0, 2, -5); }
    async initialize(profile) {
        [this.person, this.car] = await Promise.all(['boxman', 'car'].map(name => new GLTFLoader().loadAsync(`build/assets/${name}.glb`)));
        this.person.scene.animations = this.person.animations;
        this.playerModel = profile === 'dds' ? await loadDdsPlayer() : this.person;
        this.playerProfile = profile;
        this.world.actorLayer = this;
    }
    preview(type) { return clone(type === 'vehicle' ? this.car.scene : this.person.scene); }
    resetPlayer() {
        const old = this.world.editorPlayer;
        if (old) { old.stopControllingVehicle(); old.leaveSeat(); old.removeFromParent(); this.world.remove(old); }
        const player = new Character(this.playerModel.scene); player.setPosition(...this.spawn.toArray());
        player.userData.playerProfile = this.playerProfile;
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
                actor.setPosition(item.position[0], item.position[1] + 0.6, item.position[2]);
                actor.collision.quaternion.setFromEuler(...item.rotation);
                actor.collision.initQuaternion.copy(actor.collision.quaternion);
                // Cannon does not implement box/trimesh contacts. Rounded bumpers supply
                // sphere/trimesh wall contacts while the original raycast wheels drive.
                for (const x of [-0.55, 0.55]) for (const z of [-1.1, 0, 1.1]) actor.collision.addShape(new CANNON.Sphere(0.38), new CANNON.Vec3(x, 0.45, z));
            } else {
                actor = new Character(this.person.scene);
                actor.setPosition(item.position[0], item.position[1] + 0.65, item.position[2]);
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
                    if (actor.position.distanceTo(home) > 25) actor.setPosition(home.x, home.y + 1, home.z);
                } });
            }
            actor.userData.editorActor = true; actor.userData.home = [...item.position]; this.world.add(actor); this.actors.push(actor);
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
                const home = actor.userData.home; actor.setPosition(home[0], home[1] + 0.65, home[2]);
                this.world.add(actor); actor.userData.dormant = false;
            }
        }
    }
}
