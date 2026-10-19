import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Trimesh } from 'cannon-es';
import { forEachCollisionChunk } from '../src/editor/ue2three-collision.mjs';

test('large levels keep collision indices inside cannon signed 16-bit range', () => {
    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array(40002 * 3);
    for (let i = 0; i < vertices.length; i += 9) vertices.set([0,0,0, 1,0,0, 0,0,1], i);
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    const root = new THREE.Mesh(geometry);
    root.position.set(5,2,3); root.updateMatrixWorld(true);
    let triangles = 0;
    const count = forEachCollisionChunk(root, (points, indices) => {
        assert.ok(indices.length <= 30000);
        const shape = new Trimesh(points, indices);
        assert.ok(shape.indices.every(index => index >= 0 && index < points.length / 3));
        assert.deepEqual(points.slice(0,3), [5,2,3]);
        triangles += indices.length / 3;
    });
    assert.equal(count,2);
    assert.equal(triangles,13334);
});

test('mirrored instances preserve outward collision winding and instance transforms', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 1,0,0, 0,0,1],3));
    geometry.setIndex([0,1,2]);
    const root = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(),2);
    root.setMatrixAt(0,new THREE.Matrix4());
    root.setMatrixAt(1,new THREE.Matrix4().makeScale(-1,1,1).setPosition(4,0,0));
    root.updateMatrixWorld(true);
    forEachCollisionChunk(root,(points,indices) => {
        assert.equal(indices.length,6);
        assert.deepEqual(points.slice(9),[4,0,0, 4,0,1, 3,0,0]);
    });
});

test('DDS collision import updates nested transforms and discards degenerate or nonfinite faces', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        0,0,0, 1,0,0, 0,0,1,
        0,0,0, 0,0,0, 0,0,0,
        0,0,0, NaN,0,0, 0,0,1
    ], 3));
    const root = new THREE.Group();
    root.position.set(5,2,3);
    const child = new THREE.Mesh(geometry);
    child.position.x = 1;
    root.add(child);
    // Deliberately do not call updateMatrixWorld before importing collision.
    let triangles = 0;
    const chunks = forEachCollisionChunk(root, (points, indices) => {
        assert.deepEqual(points, [6,2,3, 7,2,3, 6,2,4]);
        const shape = new Trimesh(points, indices);
        assert.ok(shape.vertices.every(Number.isFinite));
        triangles += indices.length / 3;
    });
    assert.equal(chunks, 1);
    assert.equal(triangles, 1);
});

test('DDS collision import skips invalid indexed triangles without losing valid ones', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 1,0,0, 0,0,1], 3));
    geometry.setIndex([0,1,2, 0,1,99]);
    const mesh = new THREE.Mesh(geometry);
    let faces = 0;
    forEachCollisionChunk(mesh, (points, indices) => {
        assert.equal(indices.length, 3);
        assert.ok(points.every(Number.isFinite));
        faces += indices.length / 3;
    });
    assert.equal(faces, 1);
});
