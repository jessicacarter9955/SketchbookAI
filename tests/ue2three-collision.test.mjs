import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Trimesh, World, Body, Sphere } from 'cannon-es';
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

test('collision range omits inactive triangles, skips degenerates and rejects corrupt geometry',()=>{
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0, 0,0,1, 1,0,0, 3,0,0, 3,0,0, 3,0,0],3));
    const root=new THREE.Mesh(geometry);let stats;
    forEachCollisionChunk(root,(_,indices)=>assert.equal(indices.length,3),{onStats:value=>stats=value});
    assert.equal(stats.triangles,1);assert.equal(stats.degenerate_triangles,1);
    geometry.setDrawRange(0,3);forEachCollisionChunk(root,(_,indices)=>assert.equal(indices.length,3));
    geometry.setDrawRange(1,3);assert.throws(()=>forEachCollisionChunk(root,()=>{}),/triangle range/);
    geometry.setDrawRange(0,3);geometry.attributes.position.setX(0,Infinity);
    assert.throws(()=>forEachCollisionChunk(root,()=>{}),/Non-finite/);
    geometry.attributes.position.setX(0,0);geometry.setIndex([0,1,10]);
    assert.throws(()=>forEachCollisionChunk(root,()=>{}),/vertex index/);
});

test('a real Cannon sphere rests on transformed exported collision triangles',()=>{
    const floor=new THREE.Mesh(new THREE.BoxGeometry(10,0.2,10));floor.position.set(100,2,200);
    const world=new World();world.gravity.set(0,-9.81,0);
    forEachCollisionChunk(floor,(vertices,indices)=>world.addBody(new Body({mass:0,shape:new Trimesh(vertices,indices)})));
    const ball=new Body({mass:1,shape:new Sphere(0.5)});ball.position.set(100,4,200);world.addBody(ball);
    for(let i=0;i<360;i++)world.step(1/120);
    assert.ok(Math.abs(ball.position.y-2.6)<0.03,`sphere penetrated or fell through: ${ball.position.y}`);
    assert.ok(world.contacts.length>0);
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
