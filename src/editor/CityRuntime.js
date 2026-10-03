import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { SurfaceLayers } from './SurfaceLayers';

const horizontalDistance = (point, bounds) => Math.hypot(Math.max(bounds[0][0] - point.x, 0, point.x - bounds[1][0]), Math.max(bounds[0][2] - point.z, 0, point.z - bounds[1][2]));

export class CityRuntime {
    constructor(world) {
        this.world = world; this.loaded = new Map(); this.pending = new Map(); this.failed = new Map(); this.textures = new Map(); this.ready = false;
        this.root = new THREE.Group(); this.root.name = 'Liberty City'; world.graphicsWorld.add(this.root);
        this.base = 'build/local-scenes/liberty-city/'; this.lastRefresh = 0;
        this.surfaces = new SurfaceLayers(this);
    }
    async initialize(report) {
        this.report = report;
        const response = await fetch(this.base + 'manifest.json');
        if (!response.ok) throw new Error('Liberty City non convertita. Esegui tools/import-liberty-city.py sul percorso della mappa.');
        this.manifest = await response.json();
        this.world.camera.far = 1800; this.world.camera.updateProjectionMatrix();
        this.world.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
        this.world.graphicsWorld.fog = new THREE.Fog(0xb8c6ce, 300, 1000);
        this.world.params.Shadows = false; this.world.renderer.shadowMap.enabled = false;
        this.world.sky.csm.lights.forEach(light => light.castShadow = false);
        this.world.respawnPosition = new CANNON.Vec3(0, 3, 0);
        this.world.isOutOfBounds = p => p.y < -80 || Math.abs(p.x) > 6000 || Math.abs(p.z) > 6000;
        await this.ensure(new THREE.Vector3(), 350);
        this.refreshPhysics(new THREE.Vector3()); this.ready = true;
    }
    focusPosition() {
        const player = this.world.editorPlayer || this.world.characters[0];
        const position = player?.controlledObject?.collision.position || player?.characterCapsule.body.position;
        return position ? new THREE.Vector3(position.x, position.y, position.z) : new THREE.Vector3();
    }
    texture(name) {
        if (!name) return null;
        if (!this.textures.has(name)) {
            const texture = new THREE.TextureLoader().load(this.base + 'textures/' + encodeURIComponent(name));
            texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = 2;
            this.textures.set(name, { texture, refs: 0 });
        }
        const record = this.textures.get(name); record.refs++; return record.texture;
    }
    async loadSector(sector) {
        if (this.loaded.has(sector.id)) return;
        if (this.pending.has(sector.id)) return this.pending.get(sector.id);
        const task = (async () => {
            const request = async name => { const response = await fetch(this.base + name); if (!response.ok) throw new Error(`Settore ${sector.id}: HTTP ${response.status}`); return response; };
            const [meta, vertices, collisions] = await Promise.all([
                request(sector.id + '.json').then(r => r.json()), request(sector.id + '.bin').then(r => r.arrayBuffer()), request(sector.id + '.collision.bin').then(r => r.arrayBuffer())
            ]);
            const group = new THREE.Group(); group.name = sector.id;
            const buffer = new THREE.InterleavedBuffer(new Float32Array(vertices), 8);
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(buffer, 3, 0));
            geometry.setAttribute('uv', new THREE.InterleavedBufferAttribute(buffer, 2, 3));
            geometry.setAttribute('color', new THREE.InterleavedBufferAttribute(buffer, 3, 5));
            const materials = meta.groups.map((part, i) => {
                geometry.addGroup(part.start, part.count, i);
                return new THREE.MeshBasicMaterial({ map: this.texture(part.texture), vertexColors: true, side: THREE.DoubleSide,
                    alphaTest: this.manifest.textures[part.texture]?.alpha ? 0.45 : 0 });
            });
            geometry.computeBoundingBox(); geometry.computeBoundingSphere();
            const mesh = new THREE.Mesh(geometry, materials); mesh.userData.citySectorId=sector.id; group.add(mesh); this.root.add(group);
            const data={meta,group,mesh,vertices:new Float32Array(vertices),collision:new Float32Array(collisions),bodies:new Map()};
            this.loaded.set(sector.id, data); this.surfaces.loadSector(sector.id,data);
            this.failed.delete(sector.id);
        })();
        this.pending.set(sector.id, task);
        try { await task; } catch (error) { this.failed.set(sector.id, performance.now()); throw error; }
        finally { this.pending.delete(sector.id); }
    }
    unload(id) {
        const data = this.loaded.get(id); if (!data) return;
        this.surfaces.removeSector(id);
        data.bodies.forEach(body => this.world.physicsWorld.removeBody(body));
        data.group.traverse(node => { node.geometry?.dispose(); if (node.material) [].concat(node.material).forEach(m => m.dispose()); });
        for (const part of data.meta.groups) {
            const record = this.textures.get(part.texture); if (record && --record.refs === 0) { record.texture.dispose(); this.textures.delete(part.texture); }
        }
        this.root.remove(data.group); this.loaded.delete(id);
    }
    async ensure(position, radius = 450) {
        const wanted = this.manifest.sectors.filter(s => horizontalDistance(position, s.bounds) < radius).sort((a, b) => horizontalDistance(position, a.bounds) - horizontalDistance(position, b.bounds));
        // Limit simultaneous conversion/upload work to avoid freezing the browser.
        for (let i = 0; i < wanted.length; i += 2) {
            this.report?.(`Liberty City · caricamento settori ${Math.min(i + 2, wanted.length)}/${wanted.length}…`);
            await Promise.all(wanted.slice(i, i + 2).map(s => this.loadSector(s)));
        }
    }
    refreshPhysics(position) {
        for (const data of this.loaded.values()) {
            data.meta.physics.forEach((part, index) => {
                const distance = horizontalDistance(position, part.bounds);
                if (distance < 130 && !data.bodies.has(index)) {
                    const vertices = data.collision.subarray(part.start * 3, (part.start + part.count) * 3);
                    const shape = new CANNON.Trimesh(vertices, Array.from({ length: part.count }, (_, i) => i));
                    const body = new CANNON.Body({ mass: 0, shape, position: new CANNON.Vec3(...part.center) });
                    this.world.physicsWorld.addBody(body); data.bodies.set(index, body);
                } else if (distance > 190 && data.bodies.has(index)) {
                    this.world.physicsWorld.removeBody(data.bodies.get(index)); data.bodies.delete(index);
                }
            });
        }
    }
    update() {
        this.surfaces.update();
        if (this.transitioning || !this.manifest || performance.now() - this.lastRefresh < 350) return;
        this.lastRefresh = performance.now();
        const position = this.focusPosition();
        const view = this.world.sceneEditor?.active ? this.world.sceneEditor.orbit?.target || position : position;
        const wanted = this.manifest.sectors.filter(s => Math.min(horizontalDistance(position, s.bounds), horizontalDistance(view, s.bounds)) < 450);
        this.ready = wanted.filter(s => horizontalDistance(position, s.bounds) < 40).every(s => this.loaded.has(s.id));
        const next = wanted.filter(s => !this.loaded.has(s.id) && !this.pending.has(s.id) && performance.now() - (this.failed.get(s.id) || -10000) > 10000)
            .sort((a, b) => horizontalDistance(position, a.bounds) - horizontalDistance(position, b.bounds));
        if (this.pending.size < 2 && next.length) this.loadSector(next[0]).catch(error => this.report?.(error.message));
        for (const [id, data] of this.loaded) if (Math.min(horizontalDistance(position, data.meta.bounds), horizontalDistance(view, data.meta.bounds)) > 800) this.unload(id);
        this.refreshPhysics(position);
        this.world.actorLayer?.update(position);
        const status = document.querySelector('[data-city-status]');
        if (status) status.textContent = this.ready ? `Liberty City · ${this.loaded.size}/${this.manifest.sectors.length} settori · ${Math.round(this.world.editorPlayer?.controlledObject?.collision.velocity.length() * 3.6 || 0)} km/h` : 'Caricamento della zona davanti a te…';
    }
    groundAt(x, z, top = 300) {
        this.root.updateMatrixWorld(true);
        const hit = new THREE.Raycaster(new THREE.Vector3(x, top, z), new THREE.Vector3(0, -1, 0)).intersectObject(this.root, true)[0];
        return hit?.point.y;
    }
}
