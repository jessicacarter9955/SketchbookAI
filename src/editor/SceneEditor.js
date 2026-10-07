import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils';
import { validateScene, History, SCENE_KEY } from './scene-data.mjs';
import { AssetStore, checkGLB, encodeBytes, decodeBytes, MAX_BYTES } from './asset-store.mjs';
import { modelToGLB } from './model-import';
import { SurfaceTool } from './SurfaceTool';
import { IslandTool } from './IslandTool';
import { DEFAULT_ISLAND } from './island-data.mjs';
import { UrbanTool } from './UrbanTool';
import { DEFAULT_URBAN } from './urban-data.mjs';
import { geoJSONToPrefabs } from './geojson-import.mjs';

const labels = { box: 'Blocco', building: 'Edificio', road: 'Strada', tree: 'Albero', lamp: 'Lampione', car: 'Auto statica', vehicle: 'Auto guidabile', pedestrian: 'Abitante' };
const copy = value => JSON.parse(JSON.stringify(value));
export class SceneEditor {
    constructor(world, { storageKey = SCENE_KEY, worldId = 'sketchbook' } = {}) {
        this.storageKey = storageKey;
        this.worldId = worldId;
        this.world = world; this.active = false; this.busy = false; this.items = []; this.objects = new Map(); this.templates = new Map(); this.assets = new Map(); this.logs = [];
        this.mapEdits = [];
        this.generator = worldId === 'procedural-island' ? copy(world.levelRuntime.config || DEFAULT_ISLAND) : worldId === 'procedural-city' ? copy(world.levelRuntime.config || DEFAULT_URBAN) : undefined;
        this.store = new AssetStore(); this.loader = new GLTFLoader(); this.history = new History(this.scene());
        this.group = new THREE.Group(); this.group.name = 'Editor objects'; world.graphicsWorld.add(this.group);
        this.orbit = new OrbitControls(world.camera, world.renderer.domElement); this.orbit.enabled = false; this.orbit.maxDistance = 400;
        this.gizmo = new TransformControls(world.camera, world.renderer.domElement); this.gizmo.enabled = false; world.graphicsWorld.add(this.gizmo);
        this.outline = new THREE.BoxHelper(new THREE.Object3D(), 0xadf0bc); this.outline.visible = false; world.graphicsWorld.add(this.outline);
        this.gizmo.addEventListener('dragging-changed', e => { this.orbit.enabled = this.active && !e.value; if (!e.value) this.capture(); });
        this.gizmo.addEventListener('objectChange', () => { if (this.selected) { this.outline.setFromObject(this.objects.get(this.selected)); this.inspect(); } });
        this.mount(); this.bind(); world.sceneEditor = this; this.setActive(true);
        if (world.levelRuntime?.surfaces) this.surfaceTool = new SurfaceTool(this);
        if (worldId === 'procedural-island') this.islandTool = new IslandTool(this);
        if (worldId === 'procedural-city') this.urbanTool = new UrbanTool(this);
        world.renderer.domElement.tabIndex = 0;
    }
    scene() { return { version: 1, world: this.worldId, objects: copy(this.items), ...(this.mapEdits.length ? {mapEdits:copy(this.mapEdits)} : {}), ...(this.generator ? {generator:copy(this.generator)} : {}) }; }
    log(level, text) {
        const line = `[${new Date().toLocaleTimeString()}] ${String(level).toUpperCase()} · ${String(text)}`;
        this.logs.push(line); if (this.logs.length > 200) this.logs.splice(0, this.logs.length - 200);
        const output = this.root?.querySelector('[data-log-output]'); if (output) { output.textContent = this.logs.join('\n'); output.scrollTop = output.scrollHeight; }
    }
    message(text) { this.root.querySelector('[data-status]').textContent = text; this.log('info', text); }
    diagnostics() {
        const info=this.world.renderer.info, render=info.render || {}, memory=info.memory || {};
        const bodyCount=this.world.physicsWorld?.bodies?.length ?? 0, vehicleCount=this.world.vehicles?.length ?? 0;
        this.log('diag', `objects=${this.items.length} bodies=${bodyCount} vehicles=${vehicleCount} drawCalls=${render.calls||0} triangles=${render.triangles||0} geometries=${memory.geometries||0} textures=${memory.textures||0}`);
    }
    downloadLog() {
        this.diagnostics();
        const blob=new Blob([this.logs.join('\n')],{type:'text/plain'}), url=URL.createObjectURL(blob), a=document.createElement('a');
        a.href=url; a.download='sketchbook-diagnostics.txt'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
        this.message('Log diagnostico esportato.');
    }
    async run(action) {
        if (this.busy) return; this.busy = true;
        try { await action(); } catch (error) { this.message(error.message || 'Operazione non riuscita.'); console.error(error); }
        finally { this.busy = false; }
    }
    mount() {
        this.root = document.createElement('div'); this.root.id = 'scene-editor';
        this.root.innerHTML = `<div class="editor-toolbar"><div class="editor-brand">SKETCHBOOK <small>WORLD EDITOR · PROTOTIPO URBANO</small></div>
            <button data-action="undo" title="Ctrl+Z">↶ Annulla</button><button data-action="redo" title="Ctrl+Y">↷ Ripeti</button><button data-action="export">Esporta scena</button><button data-action="import">Importa scena</button><button class="primary" data-action="play">▶ Prova</button></div>
            <aside class="editor-panel editor-library"><h2>LIBRERIA</h2><button class="wide primary" data-action="search">Cerca su Sketchfab</button><button class="wide" data-action="fab">Fab · asset gratuiti</button><button class="wide" data-action="geojson">Importa OSM / GeoJSON</button><button class="wide" data-action="glb">Importa GLB / ZIP</button><p>Modelli salvati nel browser. Esporta la scena per portarli con te.</p>
            <h2>PROTOTIPAZIONE RAPIDA</h2><div class="editor-grid">${Object.entries(labels).map(([key, label]) => `<button data-prefab="${key}">${label}</button>`).join('')}</div>
            <details class="editor-diagnostics"><summary>LOG / DIAGNOSTICA</summary><div class="editor-grid"><button data-action="diag-refresh">Metriche</button><button data-action="diag-download">Esporta log</button></div><button class="wide" data-action="diag-clear">Pulisci log</button><pre data-log-output aria-live="polite"></pre></details>
            <h2>SCENA <span data-count>0</span> / 500</h2><div class="editor-objects"></div><p>Gli oggetti aggiunti si possono spostare e scalare. ${this.worldId==='liberty-city'?'Per il terreno originale usa «Superfici della città»; gli edifici originali non sono ancora separabili.':this.worldId==='procedural-island'?'Usa il generatore per modificare terreno, ponte e cielo.':this.worldId==='procedural-city'?'Usa il generatore città per strade, isolati ed edifici.':''}</p></aside>
            <aside class="editor-panel editor-inspector"><h2>PROPRIETÀ</h2><p data-empty>Seleziona un oggetto nella mappa o nell’elenco.</p><div data-properties hidden>
            <label>Nome<input name="object-name" maxlength="120"></label><div class="editor-grid"><button data-mode="translate">Sposta · W</button><button data-mode="rotate">Ruota · E</button><button data-mode="scale">Scala · R</button><button data-action="focus">Inquadra · F</button></div>
            ${['position', 'rotation', 'scale'].map((field, i) => `<label>${['Posizione · metri', 'Rotazione · gradi', 'Scala'][i]}</label><div class="editor-vector">${['X', 'Y', 'Z'].map((axis, a) => `<input aria-label="${field} ${axis}" data-field="${field}" data-axis="${a}" type="number" step="${field === 'rotation' ? '15' : '0.1'}">`).join('')}</div>`).join('')}
            <label><input name="collider" type="checkbox"> Collisione box statica</label><div class="editor-grid"><button data-action="place">Posiziona al clic</button><button data-action="ground">Appoggia a terra</button><button data-action="duplicate">Duplica</button><button data-action="delete">Elimina</button></div><p data-credit></p></div>
            <h2>GRIGLIA</h2><label>Scatto spostamento<select name="snap"><option value="0">Libero</option><option value="0.5">0,5 metri</option><option value="1" selected>1 metro</option><option value="5">5 metri</option></select></label><p>Rotazione: 15° con scatto attivo.<br>Usa «Auto guidabile» e «Abitante» per oggetti animati in modalità Prova. I modelli Sketchfab restano scenografia.</p></aside>
            <div class="editor-help">Trascina: orbita · Tasto destro: panoramica · Rotella: zoom · Clic: seleziona</div><div class="editor-footer" role="status" aria-live="polite" data-status>Editor pronto. Aggiungi un oggetto dalla libreria.</div>
            <input type="file" data-file="glb" accept=".glb,.zip" hidden><input type="file" data-file="geojson" accept=".geojson,.json,application/geo+json" hidden><input type="file" data-file="scene" accept=".json" hidden>`;
        document.body.appendChild(this.root); this.log('info','Editor inizializzato.');
        window.addEventListener('error', e => this.log('error', e.message || 'Errore JavaScript'));
        window.addEventListener('unhandledrejection', e => this.log('error', e.reason?.message || e.reason || 'Promise rifiutata'));
        this.snap = 1; this.gizmo.setTranslationSnap(1); this.gizmo.setRotationSnap(Math.PI / 12);
    }
    bind() {
        const $ = selector => this.root.querySelector(selector);
        this.root.addEventListener('click', e => {
            const button = e.target.closest('button'); if (!button || this.busy) return;
            if (!this.active && ['undo', 'redo', 'import'].includes(button.dataset.action)) this.setActive(true);
            if (button.dataset.prefab) return this.run(() => this.add({ prefab: button.dataset.prefab, name: labels[button.dataset.prefab] }));
            if (button.dataset.mode) { this.gizmo.setMode(button.dataset.mode); return; }
            const actions = {
                undo: () => this.restore(this.history.undo()), redo: () => this.restore(this.history.redo()),
                export: () => this.exportScene(), import: () => $('[data-file=scene]').click(), glb: () => $('[data-file=glb]').click(),
                search: () => globalThis.picker.openModelPicker('', (url, metadata) => this.importURL(url, metadata)),
                fab: () => globalThis.fabPicker.open('', async (file, metadata) => this.importBytes(await file.arrayBuffer(), metadata)),
                geojson: () => $('[data-file=geojson]').click(),
                play: () => this.setActive(!this.active), focus: () => this.focus(), place: () => { this.placing = true; this.message('Fai clic su una superficie per posizionare l’oggetto. Esc annulla.'); },
                ground: () => { const o = this.objects.get(this.selected); if (o) { this.ground(o); this.capture(); } },
                duplicate: () => this.duplicate(), delete: () => this.remove(),
                'diag-refresh': () => this.diagnostics(), 'diag-download': () => this.downloadLog(), 'diag-clear': () => { this.logs=[]; const o=this.root.querySelector('[data-log-output]'); if(o)o.textContent=''; }
            };
            if (actions[button.dataset.action]) this.run(actions[button.dataset.action]);
        });
        $('[data-file=glb]').onchange = e => { const file = e.target.files[0]; e.target.value = ''; if (file) this.run(async () => { if (file.size > MAX_BYTES) throw new Error('Massimo 50 MB per modello.'); await this.importBytes(await file.arrayBuffer(), { name: file.name }); }); };
        $('[data-file=geojson]').onchange = e => { const file=e.target.files[0]; e.target.value=''; if(file) this.run(async()=>{ if(file.size>10*1024*1024) throw new Error('GeoJSON superiore a 10 MB.'); await this.importGeoJSON(JSON.parse(await file.text())); }); };
        $('[data-file=scene]').onchange = e => { const file = e.target.files[0]; e.target.value = ''; if (file) this.run(async () => { if (file.size > 75 * 1024 * 1024) throw new Error('Pacchetto scena troppo grande (massimo 75 MB).'); await this.importPackage(JSON.parse(await file.text())); }); };
        $('[name=snap]').onchange = e => { this.snap = Number(e.target.value); this.gizmo.setTranslationSnap(this.snap || null); this.gizmo.setRotationSnap(this.snap ? Math.PI / 12 : null); };
        $('[name=object-name]').onchange = e => { const item = this.item(); if (item) { item.name = e.target.value; this.commit(); } };
        $('[name=collider]').onchange = e => { const item = this.item(); if (item) { item.collider = e.target.checked; this.syncCollider(this.objects.get(item.id), item); this.commit(); } };
        this.root.querySelectorAll('[data-field]').forEach(input => input.onchange = () => {
            const object = this.objects.get(this.selected); if (!object) return;
            const value = Number(input.value); const field = input.dataset.field;
            if (!Number.isFinite(value) || Math.abs(value) > 10000 || field === 'scale' && (value < 0.01 || value > 100)) return this.inspect();
            const axis = ['x', 'y', 'z'][input.dataset.axis];
            object[field][axis] = field === 'rotation' ? value * Math.PI / 180 : value;
            this.capture();
        });
        let pointer;
        this.world.renderer.domElement.addEventListener('pointerdown', e => { pointer = { x: e.clientX, y: e.clientY, axis: this.gizmo.axis }; });
        this.world.renderer.domElement.addEventListener('pointerup', e => {
            if (!this.active || this.busy || e.button !== 0 || !pointer || pointer.axis || Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) > 4) return;
            const rect = this.world.renderer.domElement.getBoundingClientRect();
            const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), this.world.camera);
            if (this.surfaceTool?.handlePick(ray)) return;
            if (this.placing && this.selected) {
                const hit = this.surfaceHit(ray, this.objects.get(this.selected));
                if (hit) { const o = this.objects.get(this.selected); o.position.copy(hit.point); if (this.snap) { o.position.x = Math.round(o.position.x / this.snap) * this.snap; o.position.z = Math.round(o.position.z / this.snap) * this.snap; } this.placing = false; this.capture(); }
                return;
            }
            const hit = ray.intersectObjects(this.group.children, true)[0]; let object = hit?.object;
            while (object && object.parent !== this.group) object = object.parent;
            this.select(object?.userData.editorId || null);
        });
        document.addEventListener('keydown', e => {
            if (e.target.closest('input, textarea, select, dialog, [contenteditable=true]') || this.busy) return;
            if (e.code === 'F2') { e.preventDefault(); this.setActive(!this.active); return; }
            if (!this.active) return;
            if ((e.ctrlKey || e.metaKey) && ['KeyZ', 'KeyY', 'KeyD', 'KeyS'].includes(e.code)) {
                e.preventDefault(); this.run(() => e.code === 'KeyS' ? this.exportScene() : e.code === 'KeyD' ? this.duplicate() : this.restore(e.code === 'KeyY' || e.shiftKey ? this.history.redo() : this.history.undo()));
            } else if (e.code === 'Delete') this.remove();
            else if (e.code === 'KeyF') this.focus();
            else if (e.code === 'Escape') { this.placing = false; this.surfaceTool?.cancel(); }
            else if ({ KeyW: 1, KeyE: 1, KeyR: 1 }[e.code]) this.gizmo.setMode({ KeyW: 'translate', KeyE: 'rotate', KeyR: 'scale' }[e.code]);
        });
    }
    setActive(active) {
        this.world.ddsGame?.setPaused(active);
        this.surfaceTool?.cancel();
        this.world.inputManager.releaseInput();
        if (active && !this.active) this.world.actorLayer?.stop();
        if (!active && this.active) this.world.actorLayer?.start(this.items);
        this.active = active; document.exitPointerLock?.(); this.orbit.enabled = active; this.gizmo.enabled = active;
        for (const item of this.items) if (['vehicle', 'pedestrian'].includes(item.prefab)) this.objects.get(item.id).visible = active;
        this.world.inputManager.inputReceivers.forEach(receiver => Object.values(receiver.actions || {}).forEach(action => { action.isPressed = false; action.justPressed = false; action.justReleased = false; }));
        if (active) {
            const target = this.world.editorPlayer?.position || this.world.characters[0]?.position || new THREE.Vector3(); this.orbit.target.copy(target);
            this.world.camera.position.copy(target).add(new THREE.Vector3(16, 16, 20)); this.orbit.update();
            if (this.selected) this.gizmo.attach(this.objects.get(this.selected));
        } else { this.gizmo.detach(); this.outline.visible = false; this.world.renderer.domElement.focus(); }
        document.body.classList.toggle('playing', !active);
        this.root.querySelector('[data-action=play]').textContent = active ? '▶ Prova' : '▣ Editor · F2';
        this.message(active ? 'Modalità editor. La simulazione è in pausa.' : 'WASD: muovi/guida · Trascina col destro o usa le frecce: camera · F: entra/esci · F2: editor.');
    }
    update() { this.orbit.update(); if (this.selected) { this.outline.setFromObject(this.objects.get(this.selected)); this.outline.visible = true; } }
    item() { return this.items.find(item => item.id === this.selected); }
    select(id) { this.selected = id; this.gizmo.detach(); if (id && this.active) this.gizmo.attach(this.objects.get(id)); this.outline.visible = !!id && this.active; this.inspect(); this.list(); }
    inspect() {
        const item = this.item(), object = this.objects.get(this.selected);
        this.root.querySelector('[data-empty]').hidden = !!item; this.root.querySelector('[data-properties]').hidden = !item;
        if (!item) return;
        this.root.querySelector('[name=object-name]').value = item.name; this.root.querySelector('[name=collider]').checked = item.collider;
        this.root.querySelectorAll('[data-field]').forEach(input => { const field = input.dataset.field; input.disabled = ['vehicle', 'pedestrian'].includes(item.prefab) && (field === 'scale' || field === 'rotation' && input.dataset.axis !== '1'); const v = object[field][['x', 'y', 'z'][input.dataset.axis]]; input.value = (v * (field === 'rotation' ? 180 / Math.PI : 1)).toFixed(2); });
        const meta = this.assets.get(item.assetId)?.metadata;
        this.root.querySelector('[data-credit]').textContent = meta ? `${meta.name || ''} · ${meta.author || 'File locale'} · ${meta.license || 'Licenza da verificare'}` : 'Prefab incluso per la prototipazione.';
    }
    list() {
        const list = this.root.querySelector('.editor-objects'); list.replaceChildren();
        this.items.forEach(item => { const b = document.createElement('button'); b.textContent = item.name; b.classList.toggle('active', item.id === this.selected); b.onclick = () => this.select(item.id); list.appendChild(b); });
        this.root.querySelector('[data-count]').textContent = this.items.length;
        this.root.querySelector('[data-action=undo]').disabled = this.history.index === 0;
        this.root.querySelector('[data-action=redo]').disabled = this.history.index === this.history.states.length - 1;
    }
    prefab(kind) {
        if (['vehicle', 'pedestrian'].includes(kind)) {
            if (!this.world.actorLayer) throw new Error('Attori non inizializzati. Ricarica l’editor.');
            return this.world.actorLayer.preview(kind);
        }
        const group = new THREE.Group();
        const mesh = (geometry, color, x, y, z) => { const m = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 0.85 })); m.position.set(x, y, z); group.add(m); return m; };
        const box = (w, h, d, color, x = 0, y = h / 2, z = 0) => mesh(new THREE.BoxGeometry(w, h, d), color, x, y, z);
        if (kind === 'building') { box(8, 12, 8, 0x78929f); for (let y = 2; y < 12; y += 3) for (let x = -2.5; x <= 2.5; x += 2.5) box(1.3, 1.5, 0.1, 0x203c51, x, y, 4.05); }
        else if (kind === 'road') { box(8, 0.12, 16, 0x303945); for (let z = -6; z <= 6; z += 4) box(0.15, 0.02, 2, 0xe7d8a0, 0, 0.13, z); }
        else if (kind === 'tree') { mesh(new THREE.CylinderGeometry(0.25, 0.4, 3, 8), 0x745443, 0, 1.5, 0); mesh(new THREE.ConeGeometry(2.2, 5, 9), 0x468365, 0, 4.5, 0); }
        else if (kind === 'lamp') { box(0.15, 5, 0.15, 0x414e57); box(1.5, 0.15, 0.2, 0x414e57, 0.65, 5, 0); box(0.7, 0.12, 0.35, 0xffe7a0, 1.15, 4.9, 0); }
        else if (kind === 'car') { box(2, 0.9, 4.2, 0xcc765b, 0, 0.85); box(1.65, 0.8, 2, 0x304d63, 0, 1.65); for (const x of [-1, 1]) for (const z of [-1.3, 1.3]) { const wheel = mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.2, 12), 0x172027, x, 0.4, z); wheel.rotation.z = Math.PI / 2; } }
        else box(2, 2, 2, 0xc49e6f);
        return group;
    }
    create(item) {
        const object = new THREE.Group(); object.userData.editorId = item.id;
        object.add(item.assetId ? clone(this.templates.get(item.assetId)) : this.prefab(item.prefab));
        object.traverse(node => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; for (const material of [].concat(node.material)) this.world.sky.csm.setupMaterial(material); } });
        object.userData.bounds = new THREE.Box3().setFromObject(object);
        object.position.fromArray(item.position); object.rotation.set(...item.rotation); object.scale.fromArray(item.scale);
        this.group.add(object); this.objects.set(item.id, object); this.syncCollider(object, item); return object;
    }
    syncCollider(object, item) {
        if (object.userData.body) this.world.physicsWorld.removeBody(object.userData.body);
        object.userData.body = null; if (!item.collider || ['vehicle', 'pedestrian'].includes(item.prefab)) return;
        const bounds = object.userData.bounds; const size = bounds.getSize(new THREE.Vector3()).multiply(object.scale).multiplyScalar(0.5);
        const center = bounds.getCenter(new THREE.Vector3()).multiply(object.scale);
        const body = new CANNON.Body({ mass: 0 });
        body.addShape(new CANNON.Box(new CANNON.Vec3(Math.max(0.01, size.x), Math.max(0.01, size.y), Math.max(0.01, size.z))), new CANNON.Vec3(center.x, center.y, center.z));
        body.position.set(...object.position.toArray()); body.quaternion.set(...object.quaternion.toArray());
        this.world.physicsWorld.addBody(body); object.userData.body = body;
    }
    add(source) {
        if (this.items.length >= 500) throw new Error('Limite di 500 oggetti raggiunto.');
        const item = { id: crypto.randomUUID(), ...source, position: this.orbit.target.toArray(), rotation: [0, 0, 0], scale: [1, 1, 1], collider: true };
        this.items.push(item); const object = this.create(item); this.ground(object); this.select(item.id); this.capture(); this.focus();
    }
    surfaceHit(ray, exclude) {
        const candidates = [];
        this.world.graphicsWorld.traverse(o => { if (!o.isMesh || !o.visible) return; let p = o; while (p) { if (p === exclude || p === this.gizmo || p === this.outline || p === this.world.sky || p.userData.editorSurface || !p.visible) return; p = p.parent; } candidates.push(o); });
        return ray.intersectObjects(candidates, false)[0];
    }
    ground(object) {
        this.world.graphicsWorld.updateMatrixWorld(true);
        const ray = new THREE.Raycaster(new THREE.Vector3(object.position.x, 1000, object.position.z), new THREE.Vector3(0, -1, 0));
        const hit = this.surfaceHit(ray, object);
        object.updateMatrixWorld(true); const bottom = new THREE.Box3().setFromObject(object).min.y;
        object.position.y += (hit?.point.y || 0) - bottom;
    }
    capture() {
        const item = this.item(), o = this.objects.get(this.selected); if (!item || !o) return;
        o.scale.clampScalar(0.01, 100); o.position.clampScalar(-10000, 10000);
        if (['vehicle', 'pedestrian'].includes(item.prefab)) { o.scale.set(1, 1, 1); o.rotation.x = o.rotation.z = 0; }
        item.position = o.position.toArray(); item.rotation = [o.rotation.x, o.rotation.y, o.rotation.z]; item.scale = o.scale.toArray();
        this.syncCollider(o, item); this.commit(); this.inspect();
    }
    commit() { this.history.push(this.scene()); this.save(); this.list(); }
    save() { try { localStorage.setItem(this.storageKey, JSON.stringify(this.scene())); this.message('Scena salvata automaticamente in questo browser.'); } catch { this.message('Salvataggio browser non riuscito. Esporta la scena per conservarla.'); } }
    focus() { const o = this.objects.get(this.selected); if (!o) return; const box = new THREE.Box3().setFromObject(o); const size = Math.max(5, box.getSize(new THREE.Vector3()).length()); box.getCenter(this.orbit.target); this.world.camera.position.copy(this.orbit.target).add(new THREE.Vector3(size, size * 0.8, size)); this.orbit.update(); }
    duplicate() { const item = this.item(); if (!item) return; if (this.items.length >= 500) throw new Error('Limite oggetti raggiunto.'); const next = copy(item); next.id = crypto.randomUUID(); next.name += ' copia'; next.position[0] += this.snap || 2; this.items.push(next); this.create(next); this.select(next.id); this.commit(); }
    destroyObject(id) { const object = this.objects.get(id); if (!object) return; if (object.userData.body) this.world.physicsWorld.removeBody(object.userData.body); this.group.remove(object); const item = this.items.find(i => i.id === id); if (!item?.assetId && !['vehicle', 'pedestrian'].includes(item?.prefab)) object.traverse(n => { n.geometry?.dispose(); if (n.material) n.material.dispose(); }); this.objects.delete(id); }
    remove() { if (!this.selected) return; const id = this.selected; this.select(null); this.destroyObject(id); this.items = this.items.filter(i => i.id !== id); this.commit(); }
    restore(scene) {
        if (!scene) return;
        if(this.worldId==='procedural-island') {this.world.levelRuntime.generate(scene.generator || DEFAULT_ISLAND);this.generator=copy(this.world.levelRuntime.config);this.islandTool?.refresh();}
        if(this.worldId==='procedural-city') {this.world.levelRuntime.generate(scene.generator || DEFAULT_URBAN);this.generator=copy(this.world.levelRuntime.config);this.urbanTool?.refresh();}
        this.select(null); [...this.objects.keys()].forEach(id => this.destroyObject(id)); this.items = copy(scene.objects); this.items.forEach(item => this.create(item));
        this.mapEdits=copy(scene.mapEdits || []); this.world.levelRuntime?.surfaces?.setEdits(this.mapEdits); this.surfaceTool?.refreshList(); this.list(); this.save();
    }
    async importGeoJSON(data) {
        if(this.worldId!=='procedural-city') throw new Error('Apri una scena Città procedurale prima di importare dati OSM / GeoJSON.');
        const converted=geoJSONToPrefabs(data,{maxObjects:Math.max(0,500-this.items.length)});
        if(!converted.objects.length) throw new Error('Nessun oggetto importabile.');
        for(const raw of converted.objects) {
            if(this.items.length>=500) break;
            const item={id:crypto.randomUUID(),...raw};
            this.items.push(item); this.create(item);
        }
        this.commit(); this.select(null);
        this.message(`OSM/GeoJSON importato: ${converted.objects.length} segmenti/edifici${converted.truncated?' (limite scena raggiunto)':''}.`);
        this.log('map', 'Coordinate geografiche convertite in metri locali e centrate sulla selezione.');
    }
    async prepareAsset(asset) {
        checkGLB(asset.bytes);
        const gltf = await this.loader.parseAsync(asset.bytes, '');
        const box = new THREE.Box3().setFromObject(gltf.scene); const extent = box.getSize(new THREE.Vector3());
        const size = Math.max(extent.x, extent.y, extent.z);
        if (!Number.isFinite(size) || size <= 0) throw new Error('Modello senza geometria visibile.');
        const root = new THREE.Group(); root.add(gltf.scene);
        root.scale.setScalar(4 / size); root.updateMatrixWorld(true);
        const normalized = new THREE.Box3().setFromObject(root), center = normalized.getCenter(new THREE.Vector3());
        root.position.set(-center.x, -normalized.min.y, -center.z);
        return root;
    }
    async importBytes(bytes, metadata) {
        bytes = await modelToGLB(bytes);
        const asset = { id: crypto.randomUUID(), bytes, metadata }; const template = await this.prepareAsset(asset);
        await this.store.putAll([asset]); this.assets.set(asset.id, asset); this.templates.set(asset.id, template);
        this.add({ assetId: asset.id, name: metadata.name || 'Modello' });
        this.focus(); this.message(`“${metadata.name || 'Modello'}” aggiunto e selezionato nella scena.`);
    }
    async importURL(url, metadata) {
        if (this.busy) throw new Error('Attendi il completamento dell’operazione.');
        this.busy = true;
        try { const response = await fetch(url, { signal: AbortSignal.timeout(120000) }); if (!response.ok) throw new Error(`Download: HTTP ${response.status}`); if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Modello superiore a 50 MB.'); await this.importBytes(await response.arrayBuffer(), metadata); }
        finally { this.busy = false; }
    }
    async restoreSaved() {
        const saved = localStorage.getItem(this.storageKey); if (!saved) return;
        const scene = validateScene(JSON.parse(saved));
        if (scene.world && scene.world !== this.worldId) throw new Error('La scena salvata appartiene a un’altra mappa.');
        for (const id of new Set(scene.objects.map(i => i.assetId).filter(Boolean))) { const asset = await this.store.get(id); if (!asset) throw new Error('Asset locale mancante. Reimporta il pacchetto scena esportato.'); const template = await this.prepareAsset(asset); this.assets.set(id, asset); this.templates.set(id, template); }
        this.history = new History(scene); this.restore(scene); this.message('Ultima scena ripristinata.');
    }
    packageScene() {
        const assets = []; let total = 0;
        for (const id of new Set(this.items.map(i => i.assetId).filter(Boolean))) { const asset = this.assets.get(id); total += asset.bytes.byteLength; if (total > MAX_BYTES) throw new Error('La scena supera 50 MB di modelli. Riduci o comprimi gli asset prima di esportare.'); assets.push({ id, metadata: asset.metadata, data: encodeBytes(asset.bytes) }); }
        return { ...this.scene(), assets };
    }
    async exportScene() {
        const blob = new Blob([JSON.stringify(this.packageScene(), null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'sketchbook-scene.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        this.message('Scena esportata con modelli e crediti. Conserva il file JSON come backup.');
    }
    async importPackage(data) {
        const scene = validateScene(data); const prepared = [], templates = new Map(); let total = 0;
        if ((scene.world || 'sketchbook') !== this.worldId) throw new Error(`Apri prima una scena con mappa ${scene.world || 'sketchbook'}, poi importa questo file.`);
        const referenced = new Set(scene.objects.map(i => i.assetId).filter(Boolean));
        if (data.assets !== undefined && !Array.isArray(data.assets)) throw new Error('Elenco asset non valido.');
        for (const id of referenced) {
            const raw = data.assets?.find(a => a.id === id); if (!raw) throw new Error('Pacchetto incompleto: manca un modello GLB.');
            const bytes = decodeBytes(raw.data); total += bytes.byteLength; if (total > MAX_BYTES) throw new Error('Massimo 50 MB complessivi di modelli.');
            // Remap IDs so importing another scene cannot overwrite assets used by undo.
            const newId = crypto.randomUUID(); const metadata = {};
            for (const key of ['name', 'author', 'license', 'licenseUrl', 'source', 'uid']) metadata[key] = String(raw.metadata?.[key] || '').slice(0, 1000);
            const asset = { id: newId, metadata, bytes }; templates.set(newId, await this.prepareAsset(asset)); prepared.push(asset);
            scene.objects.filter(i => i.assetId === id).forEach(i => i.assetId = newId);
        }
        await this.store.putAll(prepared); prepared.forEach(asset => this.assets.set(asset.id, asset)); templates.forEach((template, id) => this.templates.set(id, template));
        this.restore(scene); this.commit(); this.message('Scena importata. Puoi annullare per recuperare la precedente.');
    }
}
