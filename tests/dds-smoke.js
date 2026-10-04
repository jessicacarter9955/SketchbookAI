(async () => {
    const result = document.getElementById('test-results');
    const ok = (condition, text) => { if (!condition) throw new Error(text); result.textContent += `PASS ${text}\n`; };
    try {
        const world = new World(), city = new CityRuntime(world); world.levelRuntime = city;
        await city.initialize(() => {}); city.update = () => {};
        const actors = new ActorLayer(world); await actors.initialize('dds');
        const floor = city.groundAt(0, 0, 5); actors.spawn.set(0, floor + 1.2, 0);
        const player = actors.resetPlayer(); world.setTimeScale(1);
        let skin; player.traverse(object => { if (object.isSkinnedMesh) skin = object; });
        ok(skin?.skeleton.bones.length === 88, 'Real exported UEFN mannequin: 88-bone skin');
        ok(player.animations.some(a => a.name === 'sprint' && a.tracks.length > 100), 'Exported skeletal locomotion, not a static mannequin');
        const step = async count => { for (let i=0;i<count;i++) { world.update(1/60,1/60); if (i%10===0) await new Promise(requestAnimationFrame); } };
        await step(180);
        ok(player.rayHasHit && Math.abs(player.position.y-floor)<2, 'DDS player stands on GTA map collisions');
        const initial = player.position.clone(); player.setViewVector(new THREE.Vector3(1,0,0)); player.triggerAction('up',true);
        await step(70);
        const leg = skin.skeleton.bones.find(b => b.name === 'thigh_l'), pose = leg.quaternion.clone();
        await step(8);
        ok(leg.quaternion.angleTo(pose)>0.02, 'Leg pose changes while running');
        ok(player.position.distanceTo(initial)>1, 'WASD locomotion moves the mannequin on Portland');
        player.triggerAction('run',true); await step(35);
        ok(player.mixer.existingAction(player.animations.find(a => a.name === 'sprint'))?.isRunning(), 'Sprint switches to DDS sprint animation');
        player.triggerAction('run',false); player.triggerAction('up',false); await step(60);
        const beforeJump = player.position.y; player.triggerAction('jump',true); await step(25); player.triggerAction('jump',false);
        ok(player.position.y>beforeJump+0.2, 'Jump lifts the player capsule'); await step(120);
        ok(player.rayHasHit, 'Player lands back on imported city geometry');
        ok(skin.getObjectByName('root').position.length()<0.001, 'Root motion cannot move the mesh away from its capsule');
        const canvas = world.renderer.domElement, theta = world.cameraOperator.theta;
        canvas.dispatchEvent(new KeyboardEvent('keydown',{code:'ArrowRight',bubbles:true})); await step(10);
        canvas.dispatchEvent(new KeyboardEvent('keyup',{code:'ArrowRight',bubbles:true}));
        ok(theta !== world.cameraOperator.theta, 'Lateral camera control works with DDS player');
        actors.resetPlayer(); ok(world.editorPlayer.userData.playerProfile==='dds', 'Respawn preserves DDS player');
        result.textContent += '\nALL DDS CHECKS PASSED'; document.title='PASS · DDS checks';
    } catch(error) { result.textContent += '\nFAIL '+error.stack; document.title='FAIL · DDS checks'; }
})();
