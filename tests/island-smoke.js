(async()=>{
    const result=document.getElementById('test-results'), key='sketchbook.test.island';
    const ok=(condition,label)=>{if(!condition)throw new Error(label);result.textContent+=`PASS ${label}\n`;};
    try {
        const world=new World(), runtime=new IslandRuntime(world);world.levelRuntime=runtime;runtime.initialize();
        runtime.ready=false;await runtime.ensure();ok(runtime.ready,'Changing spawn resumes the generated world');
        ok(Math.abs(runtime.groundAt(100,2)-4.35)<.001,'Bridge has a continuous visible deck over water');
        const actors=new ActorLayer(world);await actors.initialize();actors.spawn.set(30,5.6,2);const player=actors.resetPlayer();world.setTimeScale(1);
        const step=async count=>{for(let i=0;i<count;i++){world.update(1/60,1/60);if(i%10===0)await new Promise(requestAnimationFrame);}};
        await step(120);ok(player.rayHasHit && Math.abs(player.position.y-4.35)<2,'Player stands on the generated road');
        const hill=runtime.groundAt(-20,20);player.setPosition(-20,hill+1.2,20);await step(180);
        ok(player.rayHasHit && Math.abs(player.position.y-runtime.groundAt(player.position.x,player.position.z))<2,'Generated hillside collision matches its visible surface');
        player.setPosition(30,5.6,2);await step(60);
        const items=[{prefab:'vehicle',position:[30,4.35,-2],rotation:[0,Math.PI/2,0]}];actors.start(items);await step(180);
        const car=actors.actors[0];ok(car.rayCastVehicle.numWheelsOnGround===4,'All four wheels contact the generated road');
        player.teleportToVehicle(car,car.seats[0]);player.takeControl();car.triggerAction('throttle',true);
        for(let i=0;i<90 && car.collision.position.x<175;i++)await step(10);
        car.triggerAction('throttle',false);
        result.textContent+=`Car end: ${car.collision.position.x.toFixed(1)}, ${car.collision.position.y.toFixed(1)}, ${car.collision.position.z.toFixed(1)}\n`;
        ok(car.collision.position.x>175 && car.collision.position.y>4,'Driveable car crosses the bridge to the second island');actors.stop();
        const editor=new SceneEditor(world,{storageKey:key,worldId:'procedural-island'}), oldBodies=[...runtime.bodies];
        const before=editor.scene(), changed={...before,generator:{...before.generator,seed:91,radius:85,gap:90,sky:'sunset'}};
        editor.restore(changed);editor.commit();
        ok(oldBodies.every(b=>!world.physicsWorld.bodies.includes(b)),'Regeneration removes every old terrain and road collider');
        const count=world.physicsWorld.bodies.length;
        editor.restore(editor.history.undo());ok(runtime.config.seed===42 && runtime.config.sky==='day','Undo restores terrain and sky');
        editor.restore(editor.history.redo());ok(runtime.config.seed===91 && world.physicsWorld.bodies.length===count,'Redo rebuilds terrain without accumulating colliders');
        const packet=editor.packageScene();await editor.importPackage(packet);
        ok(editor.generator.seed===91 && editor.generator.radius===85,'Portable scene restores generator settings');
        const ray=new THREE.Raycaster(new THREE.Vector3(0,100,300),new THREE.Vector3(0,-1,0));ok(!editor.surfaceHit(ray),'Water is excluded from object placement surfaces');
        editor.islandTool.focus();world.sky.update(0);runtime.update();world.renderer.render(world.graphicsWorld,world.camera);
        ok(world.renderer.info.programs.every(p=>p.diagnostics?.runnable!==false),'Water reflection and terrain shaders compile');
        ok(runtime.water.material.uniforms.time.value>0 && world.sky.sunPosition.y>0,'Animated water and sun direction are configured');
        result.textContent+='\nALL ISLAND CHECKS PASSED';document.title='PASS · Island checks';
    } catch(error) {result.textContent+=`\nFAIL ${error.stack}`;document.title='FAIL · Island checks';}
    finally {localStorage.removeItem(key);localStorage.removeItem(key+'.revisions');}
})();
