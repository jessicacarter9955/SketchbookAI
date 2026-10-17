import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { Character } from '../ts/characters/Character';
import { Car } from '../ts/vehicles/Car';
import { loadDdsPlayer } from './DdsAssets';
import { DdsCharacter } from './DdsCharacter';
import { fitVehicleVisual, SUPERCARS } from './supercars.mjs';
import { rigImportedWheels, chassisHeightForGround } from './wheel-rig.mjs';

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
    physicsGround(x,z,fallback) {
        const physics=this.world.physicsWorld;
        if (!physics?.raycastClosest) return fallback;
        const from=new CANNON.Vec3(x,Math.max(fallback+8,9),z);
        const to=new CANNON.Vec3(x,fallback-25,z);
        const hit=new CANNON.RaycastResult();
        try {
            if(physics.raycastClosest(from,to,{skipBackfaces:true},hit) &&
                hit.hasHit && hit.body?.mass===0 && Math.abs(hit.hitPointWorld.y-fallback)<12)
                return hit.hitPointWorld.y;
        } catch { /* Fall back to streamed terrain elevation. */ }
        return fallback;
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
                    // RaycastVehicle only tests suspensionRestLength + tire radius.
                    // A 0.35m ray at previous spawn height left the tires airborne:
                    // wheels rendered correctly but did not produce any traction.
                    for (const wheel of actor.rayCastVehicle.wheelInfos) {
                        wheel.suspensionRestLength=0.52;
                        wheel.suspensionStiffness=28;
                        wheel.dampingCompression=4;
                        wheel.dampingRelaxation=2.8;
                        wheel.maxSuspensionTravel=0.40;
                        wheel.rollInfluence=0.18;
                        wheel.frictionSlip=1.6;
                    }
                }
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
                        const asset = this.world.sceneEditor.assets.get(item.assetId);
                        const brand = SUPERCARS.find(car=>car.uid===asset?.metadata?.uid);
                        if (brand) {
                            const result = rigImportedWheels(shell, brand.id, actor, THREE);
                            actor.userData.rigStatus=result;
                            if(!result.ready)console.warn('[Wheel rig]',brand.name,result.reason);
                        }
                        shell.traverse(node => {
                            if (!node.isMesh) return;
                            node.castShadow=true;
                            node.receiveShadow=true;
                            for (const mat of [].concat(node.material||[])) if(mat && !actor.materials.includes(mat)) actor.materials.push(mat);
                        });
                        // Calibrate the imported body against the actual suspension
                        // geometry; the old fixed -0.84 offset buried it as springs settle.
                        // The lowest underbody contact guard is at -0.52m.
                        // Keep the visible shell slightly higher than that plane,
                        // irrespective of transient spring extension.
                        const visualBottom = new THREE.Box3().setFromObject(shell).min.y;
                        shell.position.y += -0.50 - visualBottom;
                        // The imported cars are ~4.6m long and ~2m wide, while
                        // Sketchbook's stock car has a much shorter, narrower
                        // wheelbase. Map each Cannon tire to its ACTUAL wheel
                        // arch instead of reusing the stock car coordinates.
                        for (const binding of actor.userData.sketchfabWheelRig || []) {
                            const physics = actor.rayCastVehicle.wheelInfos[binding.index];
                            const anchor = binding.sourceCenter.clone().add(shell.position);
                            binding.visualAnchor = anchor;
                            physics.radius = binding.radius;
                            physics.chassisConnectionPointLocal.set(
                                anchor.x, anchor.y + physics.suspensionRestLength, anchor.z
                            );
                        }
                        shell.userData.sketchfabAsset=item.assetId;
                        actor.add(shell);
                    }
                }
                const yaw=new THREE.Quaternion().setFromEuler(new THREE.Euler(0,item.rotation[1],0));
                const wheelInfo=actor.rayCastVehicle.wheelInfos;
                const measureSpot=(x,z)=>{
                    const estimate=this.terrainHeight(x,z,item.position[1]);
                    const center=this.physicsGround(x,z,estimate);
                    const floors=wheelInfo.map(w=>{
                        const point=new THREE.Vector3(w.chassisConnectionPointLocal.x,0,w.chassisConnectionPointLocal.z).applyQuaternion(yaw);
                        const sampleX=x+point.x,sampleZ=z+point.z;
                        return this.physicsGround(sampleX,sampleZ,this.terrainHeight(sampleX,sampleZ,center));
                    });
                    const clearance=Math.max(chassisHeightForGround(center,wheelInfo,-0.02),
                        ...wheelInfo.map((w,i)=>floors[i]-w.chassisConnectionPointLocal.y+
                            w.suspensionRestLength+w.radius-0.02));
                    return {x,z,center,floors,clearance,
                        uneven:Math.max(center,...floors)-Math.min(center,...floors)};
                };
                const x0=item.position[0],z0=item.position[2];
                let spot=null;
                for(const [dx,dz] of [[0,0],[0,4],[0,-4],[4,0],[-4,0],[4,4],[-4,4],
                    [4,-4],[-4,-4],[0,8],[-8,0],[8,0]]) {
                    const x=x0+dx,z=z0+dz;
                    if(this.actors.some(other=>other.userData.editorActor &&
                        Math.hypot(x-other.position.x,z-other.position.z)<4.5))continue;
                    const candidate=measureSpot(x,z);
                    if(candidate.uneven<=0.35){spot=candidate;break;}
                }
                // Never lift the whole car metres into the air because one wheel
                // sampled an isolated ramp or decoration rather than the road.
                if(!spot){
                    spot=measureSpot(x0,z0);
                    spot.clearance=Math.min(spot.clearance,
                        chassisHeightForGround(spot.center,wheelInfo,-0.02)+0.25);
                    console.warn('[Supercar spawn] No flat nearby ground patch; using road-level fallback.');
                }
                if(spot.x!==x0||spot.z!==z0){
                    item.position[0]=spot.x;
                    item.position[2]=spot.z;
                    const preview=this.world.sceneEditor?.objects.get(item.id);
                    if(preview)preview.position.set(spot.x,spot.center+0.04,spot.z);
                }
                const ground=spot.center;
                actor.setPosition(spot.x,spot.clearance,spot.z);
                actor.userData.spawnAdjusted=spot.x!==x0||spot.z!==z0;
                actor.userData.groundSpread=spot.uneven;
                actor.userData.spawnGround=ground;
                actor.userData.chassisRideHeight=spot.clearance-ground;
                actor.collision.quaternion.setFromEuler(...item.rotation);
                actor.collision.initQuaternion.copy(actor.collision.quaternion);
                // Spheres are required for mesh/ground chassis collisions in Cannon.
                // The former +0.45 bumper offset allowed the shell to sink ~20cm
                // through the road as the wheel springs compressed. These guards
                // keep the chassis undercarriage at ride height while the four
                // raycast tires remain independently suspended and driven.
                for (const x of [-0.48,0.48]) for (const z of [-1.02,0,1.02])
                    actor.collision.addShape(new CANNON.Sphere(0.28), new CANNON.Vec3(x,0,z));
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
                const y=actor.rayCastVehicle ? chassisHeightForGround(floor,actor.rayCastVehicle.wheelInfos,-0.02)
                    : floor+(actor.rayCastLength ?? 0.9)+0.08;
                actor.setPosition(home[0],y,home[2]);
                this.world.add(actor); actor.userData.dormant = false;
            }
        }
    }
}
