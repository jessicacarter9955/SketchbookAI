import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { forEachCollisionChunk } from './ue2three-collision.mjs';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { installMapOutputPass } from './ue2three-output.mjs';
import { safeMapPath, mapAssetURL, applyMapPresentation } from '../../tools/ue2three/map-presentation.mjs';

export class Ue2ThreeMapRuntime {
    constructor(world, mapPath) {
        this.world = world;
        this.mapPath = safeMapPath(mapPath);
        this.ready = false;
        this.root = new THREE.Group();
        this.root.name = 'Livello Unreal migrato';
        world.graphicsWorld.add(this.root);
        this.manifest = { spawns: [] };
    }

    async initialize(report) {
        report?.('Carico il livello Unreal esportato…');
        const assetURL = await mapAssetURL(this.mapPath);
        const gltf = await new GLTFLoader().loadAsync(assetURL);
        this.assetURL = assetURL;
        // Keep KHR_lights_punctual lights from the source map. The UE exporter
        // has already flattened these to portable light nodes; removing them
        // discards authored map lighting and leaves the migrated PBR textures flat.
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
        report?.('Preparo luci e materiali del livello…');
        // The playground sky owns ambient and CSM lights outside its Object3D.
        // Hide those lights as well as the sky sphere; keep the map's own lights.
        const sourceLights = new Set();
        this.root.traverse(node => { if (node.isLight) sourceLights.add(node); });
        this.world.graphicsWorld.traverse(node => {
            if (node.isLight && !sourceLights.has(node)) node.visible = false;
        });
        this.world.sky.visible = false;
        this.presentation = applyMapPresentation(this.world.renderer, this.world.graphicsWorld, this.root);
        this.outputPass = installMapOutputPass(this.world.composer);
        this.world.params.Shadows = true;
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
