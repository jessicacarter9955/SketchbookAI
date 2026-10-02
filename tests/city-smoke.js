(async () => {
    const result = document.getElementById('test-results');
    const ok = (condition, text) => { if (!condition) throw new Error(text); result.textContent += `PASS ${text}\n`; };
    try {
        const world = new World(); // Deliberately no render loop: fixed-step, deterministic physics checks.
        const city = new CityRuntime(world); world.levelRuntime = city;
        await city.initialize(message => { result.textContent = message + '\n'; });
        ok(city.manifest.sectors.length === 42 && city.manifest.missingTextures.length === 0, 'All 42 source sectors and texture references converted');
        const floor = city.groundAt(0, 0, 5); ok(Number.isFinite(floor), 'Portland spawn has a visible ground surface');
        const actors = new ActorLayer(world); await actors.initialize(); actors.spawn.set(0, floor + 1.2, 0); const player = actors.resetPlayer();
        world.setTimeScale(1);
        // All startup sectors are loaded. Keep the test region fixed during this run.
        city.update = () => {};
        const step = async count => { for (let i = 0; i < count; i++) { world.update(1 / 60, 1 / 60); if (i % 10 === 0) await new Promise(requestAnimationFrame); } };
        await step(180);
        const groundY = player.characterCapsule.body.position.y;
        ok(Math.abs(groundY - floor) < 2 && player.rayHasHit, 'Player stands on the imported collision mesh after 3 seconds');
        const initial = player.position.clone(); player.setViewVector(new THREE.Vector3(1, 0, 0)); player.triggerAction('up', true); await step(90); player.triggerAction('up', false);
        ok(player.position.distanceTo(initial) > 0.5 && player.position.y > floor - 2, 'Walking moves the player without falling through the map');
        const carFloor = city.groundAt(3, -4, 5);
        const items = [{ prefab: 'vehicle', position: [3, carFloor, -4], rotation: [0, Math.PI / 2, 0] },
            { prefab: 'pedestrian', position: [-8, floor, 2], rotation: [0, 0, 0] }];
        actors.start(items); const car = actors.actors[0]; await step(180);
        result.textContent += `Car: ${car.wheels.length} wheels; ${car.rayCastVehicle.numWheelsOnGround} contacts; height ${car.collision.position.y - carFloor}\n`;
        ok(car.rayCastVehicle.numWheelsOnGround > 0 && car.collision.position.y > carFloor - 1, 'Driveable car rests on the city surface using raycast wheels');
        player.teleportToVehicle(car, car.seats[0]); player.takeControl();
        const canvas = world.renderer.domElement;
        const key = (code, pressed) => canvas.dispatchEvent(new KeyboardEvent(pressed ? 'keydown' : 'keyup', {code, bubbles: true}));
        const carStart = car.collision.position.clone(); key('KeyW', true);
        ok(car.actions.throttle.isPressed, 'Keyboard W reaches the occupied car through the input manager');
        await step(120); key('KeyW', false);
        result.textContent += `Driven distance: ${car.collision.position.distanceTo(carStart).toFixed(2)} m\n`;
        ok(car.collision.position.distanceTo(carStart) > 0.5 && car.collision.position.y > carFloor - 3, 'Player can enter and drive the car on imported geometry');
        const pedestrian = actors.actors[1]; ok(Number.isFinite(pedestrian.position.y) && pedestrian.behaviour, 'Inhabitant runs a walking behaviour');
        actors.stop();
        ok(!world.editorPlayer.controlledObject && actors.actors.length === 0 && world.vehicles.length === 0, 'Returning to edit safely resets a player inside a vehicle');
        ok([...city.loaded.values()].every(s => s.meta.physics.every(p => p.count < 32768)), 'Every collision batch fits Cannon signed 16-bit indices');
        world.inputManager.setPointerLock(false);
        const theta = world.cameraOperator.theta;
        canvas.dispatchEvent(new MouseEvent('mousedown', {button:2, clientX:100, clientY:100, bubbles:true}));
        document.dispatchEvent(new MouseEvent('mousemove', {clientX:200, clientY:100, bubbles:true}));
        document.dispatchEvent(new MouseEvent('mouseup', {button:2, bubbles:true}));
        ok(world.cameraOperator.theta !== theta, 'Dragging rotates character camera without pointer lock');
        const releasedTheta = world.cameraOperator.theta;
        document.dispatchEvent(new MouseEvent('mousemove', {clientX:300, clientY:100, bubbles:true}));
        ok(world.cameraOperator.theta === releasedTheta, 'Releasing drag stops camera rotation');
        key('ArrowRight', true); await step(10); key('ArrowRight', false);
        ok(world.cameraOperator.theta !== releasedTheta, 'Arrow keys rotate the camera');
        key('KeyW', true); window.dispatchEvent(new Event('blur'));
        ok(!world.editorPlayer.actions.up.isPressed, 'Losing focus releases movement keys');
        result.textContent += '\nALL CITY CHECKS PASSED'; document.title = 'PASS · Liberty City checks';
    } catch (error) { result.textContent += `\nFAIL ${error.stack}`; document.title = 'FAIL · Liberty City checks'; }
})();
