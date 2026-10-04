import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils';
import { Character } from '../ts/characters/Character';

/** DDS presentation over the existing city-safe capsule controller. */
export class DdsCharacter extends Character {
    constructor(model) {
        super(model.scene);
        this.ddsModel = this.modelContainer.children[0];
        this.upperMixer = new THREE.AnimationMixer(this.ddsModel);
        this.weaponLibrary = model.weapons;
        this.weaponName = null; this.aiming = false; this.actionRemaining = 0;
        this.hand = this.ddsModel.getObjectByName('hand_r');
        this.mount = new THREE.Group(); this.mount.name = 'DDS weapon grip'; this.hand.add(this.mount);
        this.upperClips = new Map();
        const upperBones = new Set();
        this.ddsModel.getObjectByName('spine_01').traverse(bone => upperBones.add(bone.name));
        for (const clip of this.animations) {
            if (!/^(rifle|pistol)_/.test(clip.name)) continue;
            const upper = clip.clone();
            upper.tracks = upper.tracks.filter(track => upperBones.has(track.name.split('.')[0]));
            if (upper.tracks.length) this.upperClips.set(clip.name, upper);
        }
    }
    equipWeapon(name) {
        this.mount.clear(); this.weaponName = name; this.actionRemaining = 0;
        this.upperMixer.stopAllAction(); this.upperName = null;
        if (!name) return;
        if (!this.weaponLibrary[name]) throw new Error(`DDS weapon not exported: ${name}`);
        // Calibrate grip against the exported aim pose in model space. During reload
        // the weapon then follows the animated hand, including its rotation.
        const reference = clone(this.ddsModel), mixer = new THREE.AnimationMixer(reference);
        const clip = this.upperClips.get(`${name}_aim`);
        if (clip) { mixer.clipAction(clip).play(); mixer.update(0); }
        reference.updateMatrixWorld(true);
        const handRotation = reference.getObjectByName('hand_r').getWorldQuaternion(new THREE.Quaternion());
        this.mount.quaternion.copy(handRotation.invert());
        this.weapon = clone(this.weaponLibrary[name]); this.mount.add(this.weapon);
        this.mount.position.set(0, 0, 0);
        this.playUpper(`${name}_ready`);
        mixer.stopAllAction(); mixer.uncacheRoot(reference);
    }
    playUpper(name, once = false) {
        const clip = this.upperClips.get(name); if (!clip) return false;
        if (this.upperName === name && !once) return true;
        this.upperMixer.stopAllAction();
        const action = this.upperMixer.clipAction(clip); action.reset();
        action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
        action.clampWhenFinished = once; action.play(); this.upperName = name;
        if (once) this.actionRemaining = clip.duration;
        return true;
    }
    inputReceiverInit() {
        super.inputReceiverInit();
        if (!this.controlledObject) this.world.cameraOperator.setRadius(3.2, true);
    }
    inputReceiverUpdate(dt) {
        super.inputReceiverUpdate(dt);
        if (!this.controlledObject) {
            this.world.cameraOperator.target.y += 0.65;
            this.world.cameraOperator.setRadius(this.aiming ? 2.3 : 3.2);
            if (this.aiming) this.setOrientation(this.viewVector, true);
        }
    }
    handleKeyboardEvent(event, code, pressed) {
        if (this.world?.ddsGame?.handleKey(event, code, pressed)) return;
        if (!this.controlledObject && pressed && !event.repeat && !this.world?.ddsGame) {
            if (code === 'Digit1') this.equipWeapon('rifle');
            if (code === 'Digit2') this.equipWeapon('pistol');
            if (code === 'Digit3') this.equipWeapon(null);
            if (code === 'KeyR' && this.weaponName) this.playUpper(`${this.weaponName}_reload`, true);
        }
        super.handleKeyboardEvent(event, code, pressed);
    }
    handleMouseButton(event, code, pressed) {
        if (this.world?.ddsGame?.handleMouse(code, pressed)) return;
        if (code === 'mouse2' && !this.controlledObject) this.aiming = pressed;
        super.handleMouseButton(event, code, pressed);
    }
    resetControls() {
        super.resetControls(); this.aiming = false;
        this.world?.ddsGame?.releaseInput();
    }
    update(dt) {
        super.update(dt);
        this.mount.visible = !this.controlledObject;
        if (!this.weaponName || this.controlledObject) return;
        this.actionRemaining = Math.max(0, this.actionRemaining - dt);
        if (!this.actionRemaining) this.playUpper(`${this.weaponName}_${this.aiming ? 'aim' : 'ready'}`);
        this.upperMixer.update(dt); this.updateMatrixWorld(true);
    }
}
