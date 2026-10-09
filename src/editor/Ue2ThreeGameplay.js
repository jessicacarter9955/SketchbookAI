import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils';

// Source: CBP_Fixers_Mover_ABP's "Weapon Poses" LayeredBoneBlend branches.
const WEAPON_POSE_BRANCHES = ['spine_01', 'clavicle_l', 'clavicle_r'];
const LOCOMOTION_CLIPS = new Set([
    'walk', 'run', 'sprint', 'crouch_idle', 'crouch_walk', 'start_forward', 'start_left',
    'start_right', 'start_back_left', 'start_back_right', 'stop', 'jump_idle',
    'jump_running', 'falling', 'drop_idle', 'drop_running', 'drop_running_roll',
    'rotate_left', 'rotate_right'
]);

export class Ue2ThreeGameplay {
    constructor(world) {
        this.world = world;
        this.weapon = 'rifle';
        this.aiming = false;
        this.player = null;
        this.updateOrder = 5;
        this.canvas = world.renderer.domElement;
        this.keydown = event => this.onKeyDown(event);
        this.pointerDown = event => this.onPointerDown(event);
        this.pointerUp = event => this.onPointerUp(event);
        this.contextMenu = event => event.preventDefault();
        window.addEventListener('keydown', this.keydown);
        this.canvas.addEventListener('pointerdown', this.pointerDown);
        window.addEventListener('pointerup', this.pointerUp);
        this.canvas.addEventListener('contextmenu', this.contextMenu);
        this.installHint();
        this.syncPlayer();
        world.registerUpdatable(this);
    }

    installHint() {
        const hint = document.createElement('div');
        hint.className = 'ue2three-game-hint';
        hint.textContent = 'WASD muovi · Shift corri · Spazio salta · 1 fucile · 2 pistola · tasto destro mira · clic sinistro spara · R ricarica';
        document.body.append(hint);
        this.hint = hint;
    }

    syncPlayer() {
        const active = this.world.editorPlayer;
        if (this.player === active) return;
        this.cancelAction();
        if (this.player && this.originalSetAnimation) this.player.setAnimation = this.originalSetAnimation;
        this.weaponRoot?.removeFromParent();
        this.weaponMixer?.stopAllAction();
        if (this.weaponMixerRoot) this.weaponMixer?.uncacheRoot(this.weaponMixerRoot);
        this.weaponMixer = null;
        this.weaponMixerRoot = null;
        this.weaponPoseClips = new Map();
        this.weaponPoseAction = null;
        this.locomotionName = null;
        this.player = active;
        this.aiming = false;
        if (!active) return;
        this.world.cameraOperator.setRadius(3.2, true);
        this.originalSetAnimation = active.setAnimation;
        const original = this.originalSetAnimation;
        active.setAnimation = (name, ...args) => {
            const weaponPose = `${this.weapon}_${this.aiming ? 'aim' : 'ready'}`;
            if (LOCOMOTION_CLIPS.has(name) && !active.importantAction?.isRunning()) {
                this.locomotionName = name;
                const duration = original.call(active, name, ...args);
                this.setWeaponPoseLayer(weaponPose);
                return duration;
            }
            this.locomotionName = null;
            this.stopWeaponPoseLayer();
            return original.call(active, name === 'idle' ? weaponPose : name, ...args);
        };
        this.equip(this.weapon)
            .then(() => this.animate(`${this.weapon}_ready`, true))
            .catch(error => this.world.sceneEditor?.message(error.message));
    }

    enabled() {
        this.syncPlayer();
        return !!this.player && !this.world.sceneEditor?.active && this.player === this.world.editorPlayer;
    }

    update(timeStep = 0) {
        this.syncPlayer();
        this.weaponMixer?.update(timeStep);
    }

    cancelAction() {
        if (this.finished && this.player) this.player.mixer.removeEventListener('finished', this.finished);
        this.finished = null;
        if (this.player?.importantAction) {
            this.player.importantAction.stop();
            this.player.importantAction = undefined;
        }
        this.stopWeaponPoseLayer();
    }

    weaponPoseClip(name) {
        const source = this.player?.animations.find(clip => clip.name === name);
        if (!source) return null;
        if (this.weaponPoseClips.has(name)) return this.weaponPoseClips.get(name);

        const skeletonRoot = this.player.mixer.getRoot();
        const selectedBones = new Set();
        for (const branch of WEAPON_POSE_BRANCHES) {
            skeletonRoot.getObjectByName(branch)?.traverse(child => {
                if (child.isBone) selectedBones.add(child.name);
            });
        }
        const tracks = source.tracks.filter(track => {
            const match = /\.bones\[([^\]]+)\]/.exec(track.name) || /^([^.[\]]+)/.exec(track.name);
            return match && selectedBones.has(match[1]);
        }).map(track => track.clone());
        const clip = tracks.length
            ? new THREE.AnimationClip(`ue2three-${name}-weapon-pose`, source.duration, tracks, source.blendMode)
            : null;
        this.weaponPoseClips.set(name, clip);
        return clip;
    }

    setWeaponPoseLayer(name) {
        const skeletonRoot = this.player?.mixer.getRoot();
        if (!skeletonRoot) return;
        if (!this.weaponMixer || this.weaponMixerRoot !== skeletonRoot) {
            this.weaponMixer?.stopAllAction();
            if (this.weaponMixerRoot) this.weaponMixer?.uncacheRoot(this.weaponMixerRoot);
            this.weaponMixer = new THREE.AnimationMixer(skeletonRoot);
            this.weaponMixerRoot = skeletonRoot;
            this.weaponPoseClips = new Map();
        }
        const clip = this.weaponPoseClip(name);
        if (!clip) return;
        const next = this.weaponMixer.clipAction(clip);
        if (next === this.weaponPoseAction && next.isRunning()) return;
        next.reset().setLoop(THREE.LoopRepeat, Infinity).setEffectiveWeight(1).play();
        if (this.weaponPoseAction?.isRunning()) this.weaponPoseAction.crossFadeTo(next, 0.12, false);
        else next.fadeIn(0.08);
        this.weaponPoseAction = next;
    }

    stopWeaponPoseLayer() {
        if (!this.weaponPoseAction?.isRunning()) return;
        this.weaponPoseAction.fadeOut(0.08);
        this.weaponPoseAction = null;
    }

    onKeyDown(event) {
        if (!this.enabled() || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
        const key = event.key.toLowerCase();
        if (key === '1' || key === '2') {
            const resumeLocomotion = this.locomotionName;
            this.cancelAction();
            this.weapon = key === '1' ? 'rifle' : 'pistol';
            this.equip(this.weapon).then(() => {
                if (resumeLocomotion) this.player.setAnimation(resumeLocomotion, 0.12, true);
                else this.animate(this.aiming ? `${this.weapon}_aim` : `${this.weapon}_ready`, true);
            }).catch(error => this.world.sceneEditor?.message(error.message));
        } else if (key === 'r') this.playOnce(`${this.weapon}_reload`, `${this.weapon}_ready`);
    }

    onPointerDown(event) {
        if (!this.enabled()) return;
        if (event.button === 2) {
            this.aiming = true;
            this.animate(`${this.weapon}_aim`, true);
        } else if (event.button === 0) {
            this.canvas.focus();
            this.playOnce(`${this.weapon}_fire`, this.aiming ? `${this.weapon}_aim` : `${this.weapon}_ready`);
            this.showShotTrace();
        }
    }

    onPointerUp(event) {
        if (event.button !== 2 || !this.aiming) return;
        this.aiming = false;
        if (this.enabled()) this.animate(`${this.weapon}_ready`, true);
    }

    async equip(name) {
        const definition = this.world.actorLayer.playerModel.attachmentAssets?.[name];
        if (!definition) throw new Error(`L’arma ${name} non è presente nell’esportazione Unreal.`);
        const hand = this.player.getObjectByName(definition.bone);
        if (!hand) throw new Error(`Socket Unreal mancante: ${definition.bone}`);
        this.weaponRoot?.removeFromParent();
        this.weaponRoot = new THREE.Group();
        this.weaponRoot.name = `arma Unreal ${name}`;
        // Socket transforms come from the source skeleton, converted by ue2three.
        // Pose-dependent calibration would discard Unreal's authored attachment.
        const socket = definition.socketTransform;
        if (socket) {
            this.weaponRoot.position.fromArray(socket.position);
            this.weaponRoot.quaternion.fromArray(socket.quaternion);
            this.weaponRoot.scale.fromArray(socket.scale);
        }
        hand.add(this.weaponRoot);
        const asset = clone(definition.asset);
        const transform = definition.transform || {};
        asset.position.fromArray(transform.position || [0, 0, 0]);
        asset.rotation.set(...(transform.rotation || [0, 0, 0]), 'XYZ');
        asset.scale.fromArray(transform.scale || [1, 1, 1]);
        this.weaponRoot.add(asset);
    }

    animate(name, loop = false) {
        if (this.locomotionName && name.startsWith(`${this.weapon}_`)
            && (name.endsWith('_ready') || name.endsWith('_aim'))) {
            this.setWeaponPoseLayer(name);
            return;
        }
        if (this.player.animations.some(clip => clip.name === name)) this.player.setAnimation(name, 0.12, loop);
    }

    playOnce(name, resume) {
        const resumeLocomotion = this.locomotionName;
        if (!this.player.animations.some(clip => clip.name === name)) return;
        const action = this.player.mixer.clipAction(THREE.AnimationClip.findByName(this.player.animations, name));
        if (action.isRunning()) return;
        const duration = this.player.setAnimation(name, 0.08, false, true);
        if (!duration) return;
        const player = this.player;
        const finished = event => {
            if (event.action !== action) return;
            player.mixer.removeEventListener('finished', finished);
            this.finished = null;
            player.importantAction = undefined;
            if (player === this.player) {
                if (resumeLocomotion) player.setAnimation(resumeLocomotion, 0.12, true);
                else this.animate(this.aiming ? `${this.weapon}_aim` : resume, true);
            }
        };
        this.finished = finished;
        this.player.mixer.addEventListener('finished', finished);
    }

    showShotTrace() {
        const ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2(0, 0), this.world.camera);
        const hit = this.world.levelRuntime?.root
            ? ray.intersectObject(this.world.levelRuntime.root, true).find(item => item.object.isMesh)
            : null;
        const start = ray.ray.origin.clone();
        const end = hit?.point || ray.ray.origin.clone().addScaledVector(ray.ray.direction, 70);
        const trace = new THREE.Line(new THREE.BufferGeometry().setFromPoints([start, end]),
            new THREE.LineBasicMaterial({ color: 0xffd589, transparent: true, opacity: 0.9 }));
        trace.frustumCulled = false;
        this.world.graphicsWorld.add(trace);
        window.setTimeout(() => { trace.removeFromParent(); trace.geometry.dispose(); trace.material.dispose(); }, 90);
    }
}
