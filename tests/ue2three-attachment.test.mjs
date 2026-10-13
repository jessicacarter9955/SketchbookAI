import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyAttachmentSocket } from '../src/editor/ue2three-attachment.mjs';

test('authored socket matrices follow an animated parent without pose compensation', () => {
    const hand = new THREE.Bone(); const root = new THREE.Group(); hand.add(root);
    const socket = {position: [-0.07, -0.01, 0.017], quaternion: [0, Math.sin(0.4), 0, Math.cos(0.4)], scale: [1, 1, 1]};
    applyAttachmentSocket(root, {socket_transform: socket});
    for (let frame = 0; frame < 60; frame++) {
        hand.rotation.set(frame / 17, frame / 23, frame / 31); hand.updateMatrixWorld(true);
        const expected = new THREE.Matrix4().compose(new THREE.Vector3().fromArray(socket.position),
            new THREE.Quaternion().fromArray(socket.quaternion), new THREE.Vector3().fromArray(socket.scale)).premultiply(hand.matrixWorld);
        root.matrixWorld.elements.forEach((value, i) => assert.ok(Math.abs(value - expected.elements[i]) < 1e-10));
    }
});
test('runtime and manifest naming use the same socket transform', () => {
    const socket = {position: [1, 2, 3], quaternion: [0, 0, 0, 1], scale: [1, 1, 1]};
    const a = applyAttachmentSocket(new THREE.Group(), {socket_transform: socket});
    const b = applyAttachmentSocket(new THREE.Group(), {socketTransform: socket});
    assert.deepEqual(a.matrix.elements, b.matrix.elements);
    assert.throws(() => applyAttachmentSocket(a, {socket_transform: {...socket, quaternion: [0, 0, 0, 0]}}), /Invalid source/);
});
