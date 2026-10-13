import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { applyAttachmentSocket } from '/src/editor/ue2three-attachment.mjs';

export async function auditCharacter(model, manifest, loader, base, log = () => {}) {
    const root = clone(model.scene);
    const mixer = new THREE.AnimationMixer(root);
    const bones = [];
    root.traverse(node => { if (node.isBone) bones.push(node); });
    if (!bones.length) throw new Error('Nessun bone nella mesh esportata');
    const clips = [], sockets = [];
    let mounted;
    try {
        for (const clip of model.animations) {
            if (!(clip.duration > 0) || !Number.isFinite(clip.duration) || !clip.tracks.length)
                throw new Error(`Clip senza durata o tracce: ${clip.name}`);
            for (const track of clip.tracks) {
                if (!track.times.length || track.values.some(value => !Number.isFinite(value))
                    || track.times.some(value => !Number.isFinite(value)) || !THREE.PropertyBinding.findNode(root, THREE.PropertyBinding.parseTrackName(track.name).nodeName))
                    throw new Error(`Traccia non valida o bone assente: ${clip.name} / ${track.name}`);
                for (let i = 1; i < track.times.length; i++)
                    if (track.times[i] < track.times[i - 1]) throw new Error(`Tempi fuori ordine: ${clip.name}`);
            }
            mixer.stopAllAction();
            const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
            action.clampWhenFinished = true;
            action.reset().play();
            for (let frame = 0; frame <= 60; frame++) {
                action.time = clip.duration * frame / 60;
                mixer.update(0);
                root.updateMatrixWorld(true);
                if (bones.some(bone => bone.matrixWorld.elements.some(v => !Number.isFinite(v))))
                    throw new Error(`Trasformazione non finita: ${clip.name}, frame ${frame}`);
            }
            clips.push({name: clip.name, tracks: clip.tracks.length, samples: 61, status: 'passed'});
            log(`Animazioni: ${clips.length}/${model.animations.length} · ${clip.name}`);
            await new Promise(requestAnimationFrame);
        }
        mixer.stopAllAction();
        for (const [name, definition] of Object.entries(manifest.attachment_assets || {})) {
            if (!definition.socket_transform) throw new Error(`Trasformazione socket sorgente assente: ${name}`);
            const hand = root.getObjectByName(definition.bone);
            if (!hand) throw new Error(`Bone socket assente: ${name}`);
            mounted = applyAttachmentSocket(new THREE.Group(), definition);
            hand.add(mounted);
            const asset = await loader.loadAsync(base + definition.file);
            const weapon = asset.scene;
            weapon.position.fromArray(definition.transform?.position || [0, 0, 0]);
            weapon.rotation.set(...(definition.transform?.rotation || [0, 0, 0]), 'XYZ');
            weapon.scale.fromArray(definition.transform?.scale || [1, 1, 1]);
            mounted.add(weapon);
            let samples = 0;
            for (const clip of model.animations) {
                mixer.stopAllAction();
                const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
                action.clampWhenFinished = true;
                action.reset().play();
                for (let frame = 0; frame <= 12; frame++) {
                    action.time = clip.duration * frame / 12;
                    mixer.update(0); root.updateMatrixWorld(true);
                    const expected = new THREE.Matrix4().compose(
                        new THREE.Vector3().fromArray(definition.socket_transform.position),
                        new THREE.Quaternion().fromArray(definition.socket_transform.quaternion),
                        new THREE.Vector3().fromArray(definition.socket_transform.scale));
                    expected.premultiply(hand.matrixWorld);
                    if (mounted.matrixWorld.elements.some((value, i) => !Number.isFinite(value) || Math.abs(value - expected.elements[i]) > 1e-8))
                        throw new Error(`Socket differente dal sorgente: ${name} / ${clip.name}`);
                    if (weapon.matrixWorld.elements.some(value => !Number.isFinite(value)))
                        throw new Error(`Trasformazione arma non finita: ${name}`);
                    samples++;
                }
                await new Promise(requestAnimationFrame);
            }
            sockets.push({name, bone: definition.bone, samples, status: 'passed'});
            mounted.removeFromParent(); mounted = null;
            log(`Socket originale: ${name} · ${samples} campioni verificati`);
        }
        return {schema_version: 1, fingerprint: manifest.fingerprint, clips, sockets,
                fidelity_1_to_1: false,
                scope: 'Track binding, finite pose samples and authored socket matrices; excludes source animation curves, notifies, gameplay and visual grip equivalence'};
    } finally {
        mounted?.removeFromParent(); mixer.stopAllAction(); mixer.uncacheRoot(root);
    }
}
