import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils';
import { Character } from '../ts/characters/Character';

/** DDS presentation over the existing city-safe capsule controller. */
export class DdsCharacter extends Character {
    constructor(model) {
        super(model.scene);
        this.ddsModel = this.modelContainer.children[0];
        // A single mixer owns every bone. Independent mixers cache static poses
        // and otherwise let locomotion overwrite an aim pose on alternate frames.
        this.upperMixer = this.mixer;
        this.weaponLibrary = model.weapons;
        this.weaponName = null; this.aiming = false; this.actionRemaining = 0;
        this.hand = this.ddsModel.getObjectByName('hand_r');
        this.mount = new THREE.Group(); this.mount.name = 'DDS weapon grip'; this.hand.add(this.mount);
        this.upperClips = new Map();
        const upperBones = this.upperBones = new Set();
        this.ddsModel.getObjectByName('spine_01').traverse(bone => upperBones.add(bone.name));
        for (const clip of this.animations) {
            if (!/^(rifle|pistol)_/.test(clip.name) && clip.name!=='heal') continue;
            const upper = clip.clone();
            upper.tracks = upper.tracks.filter(track => upperBones.has(track.name.split('.')[0]));
            if (upper.tracks.length) this.upperClips.set(clip.name, upper);
        }
        this.maskedClips=new Map();this.recoilClips=new Map();
        this.mixer.stopAllAction();this.setAnimation('idle',0);
    }
    equipWeapon(name) {
        this.mount.clear(); this.weaponName = name; this.actionRemaining = 0;
        this.upperAction?.stop();this.recoilAction?.stop();this.upperName = null;
        this.setAnimation(this.baseName||'idle',0.12);
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
        this.weaponMixer=new THREE.AnimationMixer(this.weapon);
        this.mount.position.set(0, 0, 0);
        this.playUpper(`${name}_ready`);
        mixer.stopAllAction(); mixer.uncacheRoot(reference);
    }
    playUpper(name, once = false) {
        const clip = this.upperClips.get(name); if (!clip) return false;
        if(name.endsWith('_fire')) {
            let recoil=this.recoilClips.get(name);
            if(!recoil) {
                recoil=THREE.AnimationUtils.subclip(clip,`${name}_recoil`,0,Math.max(2,Math.min(clip.duration,0.3)*30),30);
                THREE.AnimationUtils.makeClipAdditive(recoil,0,clip,30);this.recoilClips.set(name,recoil);
            }
            this.recoilAction?.stop();this.recoilAction=this.mixer.clipAction(recoil).reset();
            this.recoilAction.setLoop(THREE.LoopOnce,1).setEffectiveWeight(0.6).play();
            const weaponClip=this.weapon?.animations?.[0];
            if(weaponClip){this.weaponMixer.stopAllAction();this.weaponMixer.clipAction(weaponClip).reset().setLoop(THREE.LoopOnce,1).play();}
            return true;
        }
        if (this.upperName === name && !once && this.upperAction?.isRunning()) return true;
        this.upperAction?.stop();
        const action = this.upperMixer.clipAction(clip); action.reset(); action.setEffectiveTimeScale(1);
        action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
        action.clampWhenFinished = once; action.play(); this.upperName = name;
        this.upperAction=action;
        this.actionRemaining = once ? clip.duration : 0;
        this.setAnimation(this.baseName||'idle',0.08);
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
            const forward=this.world.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
            const right=forward.clone().cross(new THREE.Vector3(0,1,0));
            this.world.cameraOperator.target.addScaledVector(right,this.aiming?0.55:0.35);
            this.world.cameraOperator.setRadius(this.aiming ? 2.3 : 3.2);
            if (this.aiming) {this.viewVector.copy(forward);this.setOrientation(forward, true);}
        }
    }
    handleKeyboardEvent(event, code, pressed) {
        if (this.world?.ddsGame?.handleKey(event, code, pressed)) return;
        if(code==='KeyC' && !event.shiftKey && !this.controlledObject) {
            if(pressed&&!event.repeat) {
                this.crouching=!this.crouching;this.moveSpeed=this.crouching?2:4;
                this.setAnimation(this.velocity.length()>0.1?'run':'idle',0.1);
            }
            return;
        }
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
    setAnimation(name, fadeIn, loop=true, important=false) {
        if(!this.maskedClips)return super.setAnimation(name,fadeIn,loop,important);
        if(this.crouching) {
            if(['idle','stop','rotate_left','rotate_right'].includes(name))name='crouch_idle';
            if(['run','sprint','walk'].includes(name)||name.startsWith('start_'))name='crouch_walk';
        }
        this.baseName=name;
        let clip=this.animations.find(c=>c.name===name)||this.animations.find(c=>c.name===this.animationsMapping[name]);
        if(!clip)return 0;
        if((this.weaponName||this.actionRemaining>0)&&!this.controlledObject) {
            if(!this.maskedClips.has(clip.name)) {
                const lower=clip.clone();lower.name=`${clip.name}__lower`;
                lower.tracks=lower.tracks.filter(t=>!this.upperBones.has(t.name.split('.')[0]));this.maskedClips.set(clip.name,lower);
            }
            clip=this.maskedClips.get(clip.name);
        }
        const action=this.mixer.clipAction(clip);
        if(this.locomotionAction!==action) {
            this.locomotionAction?.stop();action.reset().setLoop(loop?THREE.LoopRepeat:THREE.LoopOnce,loop?Infinity:1).play();
            this.locomotionAction=action;
        }
        return clip.duration;
    }
    setCameraRelativeOrientationTarget() {
        if(this.aiming) {
            this.setOrientation(this.viewVector,true);
            const move=this.getLocalMovementDirection();this.setArcadeVelocityTarget(move.z*0.8,move.x*0.8);
        }
        else super.setCameraRelativeOrientationTarget();
    }
    update(dt) {
        if(this.pitchBone&&this.beforePitch)this.pitchBone.quaternion.copy(this.beforePitch);
        this.actionRemaining = Math.max(0, this.actionRemaining - dt);
        if (!this.actionRemaining&&!this.controlledObject) {
            if(this.weaponName)this.playUpper(`${this.weaponName}_${this.aiming ? 'aim' : 'ready'}`);
            else {this.upperAction?.stop();this.upperName=null;this.setAnimation(this.baseName||'idle',0.1);}
        }
        if(this.controlledObject)this.upperAction?.stop();
        super.update(dt);
        this.mount.visible = !this.controlledObject && this.upperName!=='heal';
        this.weaponMixer?.update(dt);
        this.pitchBone=this.ddsModel.getObjectByName('spine_03');
        this.beforePitch=this.pitchBone.quaternion.clone();
        if(this.aiming&&this.weaponName&&!this.actionRemaining&&!this.controlledObject) {
            const direction=this.world.camera.getWorldDirection(new THREE.Vector3());
            const right=direction.clone().cross(new THREE.Vector3(0,1,0)).normalize();
            const axis=right.applyQuaternion(this.pitchBone.getWorldQuaternion(new THREE.Quaternion()).invert());
            this.pitchBone.rotateOnAxis(axis,THREE.MathUtils.clamp(Math.asin(direction.y),-0.9,0.9));
        }
        this.updateMatrixWorld(true);
    }
}
