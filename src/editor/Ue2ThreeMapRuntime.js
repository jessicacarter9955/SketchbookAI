import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { forEachCollisionChunk } from './ue2three-collision.mjs';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

const MAP_PREFIX = 'build/local-scenes/ue2three/projects/';

function safeMapURL(value) {
    const path = String(value || '').replace(/\\/g, '/');
    if (!path.startsWith(MAP_PREFIX) || !path.includes('/maps/') || path.includes('..') || !path.toLowerCase().endsWith('.glb')) {
        throw new Error('Percorso mappa Unreal non valido. Riapri il livello esportato dal Migration Manager.');
    }
    return path;
}

export class Ue2ThreeMapRuntime {
    constructor(world, mapPath) {
        this.world = world;
        this.mapPath = safeMapURL(mapPath);
        this.ready = false;
        this.root = new THREE.Group();
        this.root.name = 'Livello Unreal migrato';
        world.graphicsWorld.add(this.root);
        this.manifest = { spawns: [] };
    }

    async initialize(report) {
        report?.('Carico il livello Unreal esportato…');
        const gltf = await new GLTFLoader().loadAsync('/' + this.mapPath);
        // Unreal levels can export transient editor-only and baked scene lights
        // with incomplete glTF light metadata. The world renderer already owns
        // a directional CSM rig; keep the source meshes/materials and let it light them.
        gltf.scene.traverse(node => { if (node.isLight) node.removeFromParent(); });
        this.root.add(gltf.scene);
        this.root.updateMatrixWorld(true);
        this.bounds = new THREE.Box3().setFromObject(this.root);
        const candidates = [];
        this.root.traverse(node => {
            if (!/BP_PlayerSpawnPoint/i.test(node.name)) return;
            node.getWorldPosition(_position);
            node.getWorldQuaternion(_rotation);
            candidates.push({ id: node.name, name: node.name.replace(/^BP_PlayerSpawnPoint/i, 'Spawn giocatore') || 'Spawn giocatore',
                position: _position.toArray(), quaternion: _rotation.toArray() });
        });
        this.manifest.spawns = candidates.length ? candidates : [{
            id: 'map-center', name: 'Centro del livello',
            position: this.bounds.getCenter(new THREE.Vector3()).toArray(), quaternion: [0, 0, 0, 1]
        }];
        this.world.camera.far = Math.max(1200, this.bounds.getSize(_size).length() * 2);
        this.world.camera.updateProjectionMatrix();
        this.world.params.Shadows = false;
        this.world.renderer.shadowMap.enabled = false;
        this.world.sky.csm.lights.forEach(light => light.castShadow = false);
        this.world.isOutOfBounds = p => p.y < this.bounds.min.y - 100 ||
            Math.abs(p.x - this.bounds.getCenter(_center).x) > Math.max(500, _size.x * 2) ||
            Math.abs(p.z - _center.z) > Math.max(500, _size.z * 2);
        report?.('Preparo le collisioni statiche del livello…');
        this.addStaticCollision();
        this.world.respawnPosition = new CANNON.Vec3(...this.manifest.spawns[0].position);
        this.ready = true;
        report?.('Livello Unreal pronto.');
    }

    addStaticCollision() {
        this.collisionBodies = [];
        forEachCollisionChunk(this.root, (vertices, indices) => {
            const body = new CANNON.Body({ mass: 0, shape: new CANNON.Trimesh(vertices, indices) });
            body.collisionFilterGroup = 1;
            this.world.physicsWorld.addBody(body);
            this.collisionBodies.push(body);
        });
        if (!this.collisionBodies.length) throw new Error('Il livello Unreal esportato non contiene superfici utilizzabili come collisioni.');
    }

    async ensure() { this.ready = true; }
    refreshPhysics() {}
    update() {
        const status = document.querySelector('[data-city-status]');
        if (status) status.textContent = `Unreal · ${this.mapPath.split('/').pop()?.replace(/\.glb$/i, '')}`;
    }
    groundAt(x, z, top = 300) {
        this.root.updateMatrixWorld(true);
        const hit = new THREE.Raycaster(new THREE.Vector3(x, top, z), new THREE.Vector3(0, -1, 0))
            .intersectObject(this.root, true).find(result => result.object.isMesh);
        return hit?.point.y;
    }
}

const _position = new THREE.Vector3();
const _rotation = new THREE.Quaternion();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();
