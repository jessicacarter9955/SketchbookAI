/* Real WebGL/physics integration test, isolated from the user's saved scene. */
(async () => {
    const result = document.createElement('pre'); result.id = 'test-results';
    result.style.cssText = 'position:fixed;z-index:5000;left:290px;top:90px;max-width:600px;background:#102630;color:white;padding:20px;white-space:pre-wrap';
    document.body.appendChild(result);
    const ok = (condition, message) => { if (!condition) throw new Error(message); result.textContent += `PASS ${message}\n`; };
    const canonical = value => JSON.stringify(value, (key, v) => v && v.constructor === Object ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
    try {
        const world = new World(); await world.initialize('build/assets/world.glb');
        const editor = new SceneEditor(world, { storageKey: 'sketchbook.integration-test' });
        const bodies = world.physicsWorld.bodies.length;
        editor.root.querySelector('[data-prefab=building]').click();
        await Promise.resolve();
        ok(editor.items.length === 1, 'One library click creates exactly one object');
        ok(world.physicsWorld.bodies.length === bodies + 1, 'Static collider added');
        const object = editor.objects.get(editor.selected); object.position.set(5, 2, 8); object.rotation.y = Math.PI / 4; object.scale.set(2, 3, 1); editor.capture();
        ok(object.userData.body.position.x === 5 && Math.abs(object.userData.body.quaternion.y - object.quaternion.y) < 1e-6, 'Collider follows translation and rotation');
        ok(object.userData.body.shapes[0].halfExtents.y === 18, 'Collider follows nonuniform scale');
        editor.duplicate(); ok(editor.items.length === 2 && world.physicsWorld.bodies.length === bodies + 2, 'Duplicate gets independent collider');
        editor.remove(); ok(editor.items.length === 1 && world.physicsWorld.bodies.length === bodies + 1, 'Delete removes physics body');
        editor.restore(editor.history.undo()); ok(editor.items.length === 2, 'Undo restores deleted object');
        editor.restore(editor.history.redo()); ok(editor.items.length === 1, 'Redo removes it again');
        const before = JSON.stringify(editor.scene());
        try { await editor.importPackage({ version: 1, objects: [{ ...editor.items[0], prefab: undefined, assetId: 'missing' }] }); } catch { /* expected */ }
        ok(JSON.stringify(editor.scene()) === before, 'Failed import preserves current scene');
        const bytes = await fetch('build/assets/car.glb').then(r => r.arrayBuffer());
        await editor.importBytes(bytes, { name: 'Local test car', author: 'Sketchbook' });
        const assetItem = editor.item(); const cached = await editor.store.get(assetItem.assetId);
        ok(cached.bytes.byteLength === bytes.byteLength, 'Imported GLB persisted in IndexedDB');
        const saved = editor.scene(); await editor.restoreSaved();
        ok(canonical(editor.scene()) === canonical(saved), 'Saved scene restores transforms and model');
        const portable = JSON.parse(JSON.stringify(editor.packageScene()));
        await editor.importPackage(portable);
        ok(editor.items.length === saved.objects.length && editor.items.find(i => i.assetId).assetId !== assetItem.assetId, 'Portable package restores objects with independent asset IDs');
        const imported = editor.assets.get(editor.items.find(i => i.assetId).assetId);
        ok(imported.bytes.byteLength === bytes.byteLength && imported.metadata.author === 'Sketchbook', 'Portable package preserves GLB bytes and credits');
        editor.restore(editor.history.undo());
        ok(canonical(editor.scene()) === canonical(saved), 'Undo after import restores previous scene and assets');
        const archive = await fetch('tests/fixtures/car-gltf.zip').then(r => r.arrayBuffer());
        await editor.importBytes(archive, { name: 'ZIP car', author: 'Sketchbook' });
        const zipAsset = editor.assets.get(editor.item().assetId);
        ok(new DataView(zipAsset.bytes).getUint32(0, true) === 0x46546c67 && editor.item().name === 'ZIP car', 'glTF ZIP with relative buffer converts to a persisted embedded GLB');
        const beforeBad = JSON.stringify(editor.scene());
        try { await editor.importBytes(new ArrayBuffer(32), {name:'broken'}); } catch { /* expected */ }
        ok(JSON.stringify(editor.scene()) === beforeBad, 'Invalid ZIP leaves the scene intact');
        const model = await new GLTFLoader().loadAsync('build/assets/boxman.glb'); model.scene.animations = model.animations;
        const player = new Character(model.scene); world.add(player); player.takeControl();
        editor.setActive(false); ok(!editor.active && !editor.orbit.enabled && !editor.gizmo.object, 'Play detaches editing controls');
        const y = player.characterCapsule.body.position.y; world.update(1 / 60, 1 / 60);
        ok(Number.isFinite(player.characterCapsule.body.position.y), 'Simulation runs with editor colliders');
        editor.setActive(true); const pausedY = player.characterCapsule.body.position.y; world.update(1 / 60, 1 / 60);
        ok(player.characterCapsule.body.position.y === pausedY, 'Edit pauses physics');
        result.textContent += '\nALL INTEGRATION CHECKS PASSED'; document.title = 'PASS · Editor integration checks';
    } catch (error) { result.textContent += `\nFAIL ${error.stack}`; document.title = 'FAIL · Editor integration checks'; }
})();
