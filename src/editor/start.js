import { loadCatalog, createScene } from './scene-catalog.mjs';
import { sceneStorageKey, loadRevisions, saveRevision, forkScene } from './scene-revisions.mjs';

const loading = document.getElementById('loading-screen');
const query = new URLSearchParams(location.search);
const catalog = loadCatalog(localStorage);
const current = catalog.find(s => s.id === query.get('scene')) || catalog[0];
const storageKey = sceneStorageKey(current.id);
const report = message => { loading.textContent = message; };

function sceneControls(editor) {
    const manager = document.createElement('section'); manager.className = 'scene-manager';
    manager.innerHTML = '<h2>LE TUE SCENE</h2><select aria-label="Scena attiva" class="wide"></select><button class="wide" data-new-scene>Nuova scena</button><button class="wide" data-fork>Crea copia / ramo</button><h2>REVISIONI LOCALI</h2><input class="wide" aria-label="Nome revisione" maxlength="80" placeholder="Es. Prima di cambiare il prato"><button class="wide" data-checkpoint>Salva revisione</button><select class="wide" aria-label="Revisione salvata"></select><button class="wide" data-restore>Apri revisione in una copia</button><p>Originali della mappa invariati. La prima revisione resta protetta; conserviamo le ultime 19. Esporta per un backup esterno.</p>';
    const select = manager.querySelector('select');
    catalog.forEach(scene => { const option = document.createElement('option'); option.value = scene.id; option.textContent = scene.name; option.selected = scene.id === current.id; select.append(option); });
    select.onchange = () => { editor.save(); location.href = `editor.html?scene=${encodeURIComponent(select.value)}`; };
    editor.root.querySelector('.editor-library').prepend(manager);
    editor.root.querySelector('.editor-brand small').textContent = current.name;
    const dialog = document.createElement('dialog'); dialog.className = 'asset-picker scene-dialog';
    dialog.innerHTML = '<form><h2>Nuova scena</h2><label>Nome <input name="name" required maxlength="80" placeholder="Il mio quartiere"></label><label>Mappa <select name="world"><option value="liberty-city">Liberty City</option><option value="sketchbook">Sketchbook originale</option><option value="procedural-island">Isola procedurale</option></select></label><p>Gli oggetti e gli abitanti di ogni scena vengono salvati separatamente.</p><button type="submit">Crea scena</button> <button type="button" data-cancel>Annulla</button><p role="status"></p></form>';
    document.body.append(dialog);
    let source = null;
    const openDialog = state => {
        source = state; dialog.querySelector('h2').textContent = state ? 'Copia indipendente della scena' : 'Nuova scena';
        dialog.querySelector('[name=name]').value = state ? `${current.name} · copia` : '';
        dialog.querySelector('[name=world]').value = current.world; dialog.querySelector('[name=world]').disabled = !!state;
        dialog.querySelector('[role=status]').textContent = ''; dialog.showModal();
    };
    manager.querySelector('[data-new-scene]').onclick = () => openDialog(null);
    manager.querySelector('[data-fork]').onclick = () => openDialog(editor.scene());
    const revisionSelect = manager.querySelector('[aria-label="Revisione salvata"]');
    const refreshRevisions = () => {
        revisionSelect.replaceChildren();
        loadRevisions(localStorage, storageKey).slice().reverse().forEach(r => { const option = document.createElement('option'); option.value = r.id; option.textContent = `${r.label} · ${new Date(r.time).toLocaleString()}`; revisionSelect.append(option); });
    };
    if (!loadRevisions(localStorage, storageKey).length) {
        try { saveRevision(localStorage, storageKey, editor.scene(), 'Versione iniziale protetta', crypto.randomUUID()); }
        catch (error) { editor.message(`Revisione non salvata: ${error.message}`); }
    }
    refreshRevisions();
    editor.root.addEventListener('scene-revision-saved', refreshRevisions);
    manager.querySelector('[data-checkpoint]').onclick = () => editor.run(() => {
        saveRevision(localStorage, storageKey, editor.scene(), manager.querySelector('[aria-label="Nome revisione"]').value || 'Revisione', crypto.randomUUID());
        refreshRevisions(); editor.message('Revisione salvata. Puoi riaprirla in una copia senza sostituire questa scena.');
    });
    manager.querySelector('[data-restore]').onclick = () => { const record = loadRevisions(localStorage, storageKey).find(r => r.id === revisionSelect.value); if (record) openDialog(record.scene); };
    dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
    dialog.querySelector('form').onsubmit = event => {
        event.preventDefault();
        try { const name = dialog.querySelector('[name=name]').value, id = crypto.randomUUID();
            const created = source ? forkScene(localStorage, current, source, name, id) : createScene(localStorage, name, dialog.querySelector('[name=world]').value, id);
            editor.save(); location.href = `editor.html?scene=${created.id}`; }
        catch (error) { dialog.querySelector('[role=status]').textContent = error.message; }
    };
    const hud = document.createElement('div'); hud.className = 'city-hud';
    hud.innerHTML = '<strong data-city-status></strong><button data-board>In auto</button><button data-reset>Riparti</button>';
    hud.querySelector('[data-city-status]').textContent = current.name;
    hud.querySelector('[data-board]').onclick = () => {
        if (editor.active) editor.setActive(false);
        const player = world.editorPlayer;
        if (player.controlledObject) { world.renderer.domElement.focus(); return; }
        const cars = world.vehicles.filter(car => car.seats?.[0] && !car.seats[0].occupiedBy);
        cars.sort((a, b) => a.position.distanceTo(player.position) - b.position.distanceTo(player.position));
        if (!cars.length) { editor.message('Aggiungi un’Auto guidabile nell’editor, poi premi Prova.'); return; }
        player.teleportToVehicle(cars[0], cars[0].seats[0]); player.takeControl();
        const rear = new THREE.Vector3(0, 0, -1).applyQuaternion(cars[0].quaternion);
        world.cameraOperator.theta = Math.atan2(rear.x, rear.z) * 180 / Math.PI; world.cameraOperator.phi = 15;
        world.renderer.domElement.focus();
        editor.message('Sei al volante. WASD guida · Spazio frena · F esce · F2 apre l’editor.');
    };
    hud.querySelector('[data-reset]').onclick = () => { world.actorLayer.resetPlayer(); if (!editor.active) { world.actorLayer.start(editor.items); world.renderer.domElement.focus(); } };
    if (world.levelRuntime) {
        const district = document.createElement('select'); district.setAttribute('aria-label', current.world==='liberty-city' ? 'Quartiere Liberty City' : 'Punto di partenza');
        world.levelRuntime.manifest.spawns.forEach(spawn => { const option = document.createElement('option'); option.value = spawn.id; option.textContent = spawn.name; district.append(option); });
        district.value = current.spawn || world.levelRuntime.manifest.spawns[0].id;
        district.onchange = async () => {
            district.disabled = true; const spawn = world.levelRuntime.manifest.spawns.find(s => s.id === district.value);
            const wasPlaying = !editor.active; editor.setActive(true); loading.style.display = 'flex';
            world.levelRuntime.transitioning = true; world.levelRuntime.ready = false;
            try {
                await world.levelRuntime.ensure(new THREE.Vector3(...spawn.position), 350);
                const y = world.levelRuntime.groundAt(spawn.position[0], spawn.position[2], spawn.position[1] + 5) ?? spawn.position[1];
                world.actorLayer.spawn.set(spawn.position[0], y + 1.2, spawn.position[2]);
                world.respawnPosition.set(...world.actorLayer.spawn.toArray()); world.actorLayer.resetPlayer();
                world.levelRuntime.refreshPhysics(world.actorLayer.spawn); editor.setActive(!wasPlaying);
            } catch (error) { editor.message(error.message); }
            finally { world.levelRuntime.transitioning = false; world.levelRuntime.lastRefresh = 0; district.disabled = false; loading.style.display = 'none'; }
        };
        hud.prepend(district);
    }
    editor.root.append(hud);
}

try {
    globalThis.world = new World();
    if (current.world === 'liberty-city') {
        world.levelRuntime = new CityRuntime(world);
        await world.initialize(undefined, false); loading.style.display = 'flex';
        await world.levelRuntime.initialize(report);
    } else if(current.world === 'procedural-island') {
        world.levelRuntime = new IslandRuntime(world);
        await world.initialize(undefined, false); loading.style.display = 'flex';
        await world.levelRuntime.initialize();
    } else await world.initialize('build/assets/world.glb');
    const actors = new ActorLayer(world);
    await actors.initialize(current.playerProfile, {
        characterBase: query.get('character') || (current.playerProfile === 'ue2three' ? 'build/local-scenes/ue2three/current/' : undefined)
    });
    if (world.levelRuntime) {
        const spawn = world.levelRuntime.manifest.spawns.find(s => s.id === current.spawn)?.position || [0,0,0];
        world.levelRuntime.transitioning = true;
        try { await world.levelRuntime.ensure(new THREE.Vector3(...spawn), 350);
            actors.spawn.set(spawn[0], (world.levelRuntime.groundAt(spawn[0], spawn[2], spawn[1]+5) ?? spawn[1]) + 1.2, spawn[2]);
            world.respawnPosition.set(...actors.spawn.toArray()); world.levelRuntime.refreshPhysics(actors.spawn);
        } finally { world.levelRuntime.transitioning = false; world.levelRuntime.lastRefresh = 0; }
    }
    actors.resetPlayer();
    if (world.levelRuntime) { world.cameraOperator.theta = current.playerProfile==='dds'?0:180; world.cameraOperator.phi = 12; }
    globalThis.sceneEditor = new SceneEditor(world, { storageKey, worldId: current.world });
    const hadSaved = localStorage.getItem(storageKey) !== null;
    await sceneEditor.run(() => sceneEditor.restoreSaved());
    if (!hadSaved && current.id === 'portland-lab') {
        const original = localStorage.getItem(sceneStorageKey('liberty-city'));
        if (original) {
            localStorage.setItem(storageKey, original);
            await sceneEditor.run(() => sceneEditor.restoreSaved());
        }
    }
    if (!hadSaved && current.id === 'liberty-city') {
        const objects = [];
        const add = (prefab, name, x, z, rotation = 0) => {
            const y = world.levelRuntime.groundAt(x, z, 5);
            if (y !== undefined) objects.push({ id: crypto.randomUUID(), prefab, name, position: [x, y + 0.04, z], rotation: [0, rotation, 0], scale: [1, 1, 1], collider: false });
        };
        add('vehicle', 'Auto di partenza', 3, -4, Math.PI / 2);
        add('vehicle', 'Auto parcheggiata', -5, 12, Math.PI / 2);
        for (const [index, point] of [[-8, 2], [-10, 8], [7, 8], [12, 4]].entries()) add('pedestrian', `Abitante ${index + 1}`, ...point);
        sceneEditor.restore({ version: 1, world: current.world, objects }); sceneEditor.commit();
    }
    if (!hadSaved && current.id === 'portland-grass') {
        sceneEditor.restore({version:1,world:'liberty-city',objects:[],mapEdits:[{
            id:'portland-grass-demo',name:'Prato di Portland',texture:'Grass_128HV.PNG',style:'grass',
            bounds:[-15,-6,-60,15,-2,-30],seed:42,density:30,height:0.5
        }]}); sceneEditor.commit();
    }
    if (!hadSaved && current.world === 'procedural-island') {
        const objects=[];
        const add=(prefab,name,x,z,rotation=0)=>objects.push({id:crypto.randomUUID(),prefab,name,position:[x,world.levelRuntime.groundAt(x,z,50)+.04,z],rotation:[0,rotation,0],scale:[1,1,1],collider:prefab==='lamp'});
        add('vehicle','Auto per attraversare il ponte',4,-2,Math.PI/2);
        add('vehicle','Auto sull’isola est',205,2,-Math.PI/2);
        for(const x of [-20,0,20,185,205,225]) add('lamp','Lampione',x,7);
        for(const x of [-12,12]) add('pedestrian','Abitante',x,-12);
        sceneEditor.restore({version:1,world:current.world,objects,generator:{...sceneEditor.generator,sky:current.id==='island-sunset'?'sunset':'day'}});sceneEditor.commit();
    }
    sceneControls(sceneEditor);
    if(current.playerProfile==='dds') new DdsGame(world,{key:`${storageKey}.dds-game`});
    loading.style.display = 'none';
    if(current.id === 'portland-grass' && sceneEditor.mapEdits.length) {
        const select=sceneEditor.surfaceTool.$('[data-layers]'); select.value=sceneEditor.mapEdits[0].id;
        select.dispatchEvent(new Event('change')); sceneEditor.surfaceTool.cancel();
    }
    sceneEditor.islandTool?.focus();
    if (query.get('play') === '1') sceneEditor.setActive(false);
    document.title = `${current.name} · Sketchbook`;
} catch (error) {
    loading.style.display = 'flex'; loading.textContent = `Impossibile avviare la scena: ${error.message}`; console.error(error);
}
