import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { SurfaceLayers } from './SurfaceLayers';
import { distanceToSector, selectCitySectors, CITY_STREAM } from './city-streaming.mjs';

const horizontalDistance = distanceToSector;

export class CityRuntime {
    constructor(world) {
        this.world = world; this.loaded = new Map(); this.pending = new Map(); this.failed = new Map(); this.textures = new Map(); this.ready = false;
        this.root = new THREE.Group(); this.root.name = 'Liberty City'; world.graphicsWorld.add(this.root);
        this.base = 'build/local-scenes/liberty-city/'; this.lastRefresh = 0;
        this.surfaces = new SurfaceLayers(this);
        this.groundRay = new THREE.Raycaster(); this.fps = 0; this.resolutionScale = 1;
        this.setupAdaptiveResolution();
    }
    async initialize(report, spawnId) {
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
        const selectedSpawn = this.manifest.spawns?.find(s => s.id === spawnId) || this.manifest.spawns?.[0];
        const start = new THREE.Vector3(...(selectedSpawn?.position || [0,0,0]));
        await this.ensure(start, CITY_STREAM.collisionBubble);
        this.refreshPhysics(start); this.ready = true;
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
            const request = async name => {
                let lastError;
                for (let attempt = 0; attempt < 2; attempt++) {
                    try {
                        const url = this.base + name;
                        const response = await fetch(url, { cache: attempt ? 'reload' : 'default', signal: AbortSignal.timeout(30000) });
                        if (!response.ok) throw new Error(`HTTP ${response.status}`);
                        return response;
                    } catch (error) {
                        lastError = error;
                        if (!attempt) await new Promise(resolve => setTimeout(resolve, 350));
                    }
                }
                throw new Error(`Settore ${sector.id} · ${name}: ${lastError?.message || 'errore rete'}`);
            };
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
            const results = await Promise.allSettled(wanted.slice(i, i + 2).map(s => this.loadSector(s)));
            for (const result of results) if (result.status === 'rejected') this.report?.(`Settore non disponibile: ${result.reason.message}`);
        }
    }
    refreshPhysics(position) {
        for (const data of this.loaded.values()) {
            data.meta.physics.forEach((part, index) => {
                const distance = horizontalDistance(position, part.bounds);
                if (distance < CITY_STREAM.physicsEnable && !data.bodies.has(index)) {
                    const vertices = data.collision.subarray(part.start * 3, (part.start + part.count) * 3);
                    const shape = new CANNON.Trimesh(vertices, Array.from({ length: part.count }, (_, i) => i));
                    const body = new CANNON.Body({ mass: 0, shape, position: new CANNON.Vec3(...part.center) });
                    this.world.physicsWorld.addBody(body); data.bodies.set(index, body);
                } else if (distance > CITY_STREAM.physicsDisable && data.bodies.has(index)) {
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
        this.world.camera.updateMatrixWorld(true);
        const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(this.world.camera.projectionMatrix, this.world.camera.matrixWorldInverse));
        const visible = sector => frustum.intersectsBox(new THREE.Box3(new THREE.Vector3(...sector.bounds[0]), new THREE.Vector3(...sector.bounds[1])));
        const wanted = selectCitySectors(this.manifest.sectors, position, view, visible);
        this.ready = wanted.filter(s => horizontalDistance(position, s.bounds) < 40).every(s => this.loaded.has(s.id));
        const next = wanted.filter(s => !this.loaded.has(s.id) && !this.pending.has(s.id) && performance.now() - (this.failed.get(s.id) || -10000) > 10000);
        if (this.pending.size < 2 && next.length) this.loadSector(next[0]).catch(error => this.report?.(error.message));
        const retained = new Set(selectCitySectors(this.manifest.sectors, position, view, visible, {retain:true}).map(s => s.id));
        for (const [id] of this.loaded) if (!retained.has(id)) this.unload(id);
        this.refreshPhysics(position);
        this.world.actorLayer?.update(position);
        const status = document.querySelector('[data-city-status]');
        if (status) status.textContent = this.ready ? `Liberty City · ${this.loaded.size}/${this.manifest.sectors.length} settori · ${this.fps || '…'} FPS · ${Math.round(this.world.editorPlayer?.controlledObject?.collision.velocity.length() * 3.6 || 0)} km/h` : 'Caricamento della zona davanti a te…';
    }
    /** Raycast only geometries covering the XY map tile, not all buildings in the city. */
    groundAt(x, z, top = 300) {
        const candidates = [];
        for (const [id, data] of this.loaded) {
            const b = data.meta.bounds;
            if (x < b[0][0] - 0.1 || x > b[1][0] + 0.1 || z < b[0][2] - 0.1 || z > b[1][2] + 0.1) continue;
            candidates.push(data.mesh);
            const overlays = this.surfaces.sectors.get(id);
            if (overlays) for (const mesh of overlays.children) if (mesh.isMesh && !mesh.isInstancedMesh) candidates.push(mesh);
        }
        if (!candidates.length) return undefined;
        this.groundRay.set(new THREE.Vector3(x, top, z), new THREE.Vector3(0,-1,0));
        this.groundRay.far = Math.max(1,top + 200);
        const hit = this.groundRay.intersectObjects(candidates, false)[0];
        return hit?.point.y;
    }
    /** Dynamically adjust internal pixel density, never geometry, textures or draw distance. */
    setupAdaptiveResolution() {
        if (typeof window === 'undefined' || !window.requestAnimationFrame) return;
        let frames = 0, previous = performance.now(), lastChange = previous;
        const sample = now => {
            frames++;
            if (now - previous >= 2000) {
                this.fps = Math.round(frames * 1000 / (now - previous));
                const max = Math.min(window.devicePixelRatio || 1, 1.25);
                if (now - lastChange > 5000 && this.ready && !this.transitioning && new URLSearchParams(location.search).get('adaptive') !== '0') {
                    const current = this.world.renderer.getPixelRatio();
                    const target = this.fps < 38 ? Math.max(0.8, current - 0.1) : this.fps > 56 ? Math.min(max, current + 0.05) : current;
                    if (Math.abs(target - current) > 0.01) { this.world.renderer.setPixelRatio(target); lastChange = now; this.resolutionScale = target; }
                }
                frames = 0; previous = now;
            }
            requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
    }
}
