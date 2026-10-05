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
        const step = async count => { for (let i=0;i<count;i++) { world.update(1/60,1/60); if (i%10===0) await new Promise(resolve=>setTimeout(resolve,0)); } };
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
        for (const name of ['rifle','pistol']) {
            player.equipWeapon(name); player.aiming = true; await step(10);
            ok(player.weapon.parent === player.mount && player.mount.parent.name==='hand_r', `${name} model follows the right hand`);
            ok(player.upperName===`${name}_aim`, `${name} uses exported aim pose`);
            const clip = player.upperClips.get(`${name}_reload`);
            ok(clip && clip.tracks.length>30, `${name} reload has bound upper-body tracks`);
            const hand = player.hand.quaternion.clone(); player.playUpper(`${name}_reload`,true); await step(30);
            ok(player.hand.quaternion.angleTo(hand)>0.02, `${name} reload animates the hand`);
            const bounds = new THREE.Box3().setFromObject(player.weapon).getSize(new THREE.Vector3());
            ok(bounds.length()>0.1 && bounds.length()<3, `${name} is exported in meters`);
        }
        actors.resetPlayer(); ok(world.editorPlayer.userData.playerProfile==='dds', 'Respawn preserves DDS player');
        const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
        const game=new DdsGame(world,{storage,key:'dds-test'}), fighter=world.editorPlayer;
        await step(90);
        fighter.handleKeyboardEvent(new KeyboardEvent('keydown',{code:'KeyC'}),'KeyC',true);await step(5);
        ok(fighter.crouching&&fighter.moveSpeed===2&&fighter.locomotionAction.getClip().name.startsWith('crouch_idle')&&fighter.locomotionAction.isRunning(),'C toggles exported crouch animation and slower movement');
        fighter.handleKeyboardEvent(new KeyboardEvent('keydown',{code:'KeyC'}),'KeyC',true);
        const aimAt=async target=>{
            const p=target.position;fighter.setPosition(...actors.spawn.toArray());await step(60);
            fighter.aiming=true;fighter.playUpper('rifle_aim');fighter.upperMixer.update(0);fighter.updateMatrixWorld(true);
            world.camera.position.copy(fighter.position).add(new THREE.Vector3(0,0.7,0));world.camera.lookAt(p);world.camera.updateMatrixWorld(true);
        };
        await aimAt(game.targets[0]);let hit=game.shoot();
        if(hit?.object!==game.targets[0])result.textContent+='Shot diagnostic: '+JSON.stringify({shot:game.lastShot,target:game.targets[0].position.toArray(),player:fighter.position.toArray()})+'\n';
        ok(hit?.object===game.targets[0]&&game.state.targets[0]===66, 'Aimed shot hits a GTA-map target and applies weapon damage');
        const hp=game.state.targets[0];game.shoot();ok(game.state.targets[0]===hp,'Fire cooldown prevents extra damage');
        await step(12);await aimAt(game.targets[0]);
        const blocker=new THREE.Mesh(new THREE.BoxGeometry(3,4,0.25),new THREE.MeshBasicMaterial());blocker.position.copy(game.targets[0].position).lerp(fighter.position,0.5);blocker.lookAt(fighter.position);city.root.add(blocker);blocker.updateMatrixWorld(true);
        game.shoot();ok(game.state.targets[0]===hp,'Wall between muzzle and target blocks damage');blocker.removeFromParent();blocker.geometry.dispose();blocker.material.dispose();
        game.reload();ok(game.state.reloadRemaining>0,'Reload starts from gameplay control');await step(160);
        ok(game.state.ammo.rifle.magazine===30&&game.state.ammo.rifle.reserve===88,'Reload transfers exact rounds from reserve');
        for(const target of game.targets) {
            while(game.state.targets[target.userData.targetIndex]>0) {await step(12);await aimAt(target);const before=game.state.targets[target.userData.targetIndex];game.shoot();ok(game.state.targets[target.userData.targetIndex]<before,'Training target is reachable by a real shot');}
        }
        for(const item of game.loot) {
            fighter.setPosition(item.position.x,item.position.y+0.6,item.position.z);await step(5);ok(game.interact(),`${item.userData.lootKind} collected in proximity`);
        }
        game.state.damage(60);game.heal();ok(game.state.health===90&&game.state.medkits===2&&fighter.upperName==='heal','Medkit restores health, consumes inventory and plays healing animation');
        game.toggleInventory();ok(game.inventory.open&&!game.canAct(),'Inventory opens and blocks combat');game.toggleInventory();
        game.trigger=true;fighter.aiming=true;window.dispatchEvent(new Event('blur'));ok(!game.trigger&&!fighter.aiming,'Focus loss releases trigger and aim');
        game.setPaused(true);const rounds=game.state.ammo.rifle.magazine;game.shoot();ok(game.state.ammo.rifle.magazine===rounds&&!game.root.visible,'Editor pause hides raid props and blocks shooting');game.setPaused(false);
        fighter.setPosition(game.exit.position.x,game.exit.position.y+0.6,game.exit.position.z);await step(5);
        ok(game.interact()&&game.state.extracted,'Collected loot and destroyed targets allow extraction');
        ok(JSON.parse(data.get('dds-test')).extracted,'Completed raid persists independently of original scenes');
        game.restart();ok(!game.state.extracted&&game.state.targets.every(h=>h===100)&&game.player===world.editorPlayer,'New raid resets objectives, inventory and player together');
        await runDdsPopulationChecks({world,game,step,ok});
        for(const role of ['guide','merchant']) {
            const npc=game.population.actors.find(n=>n.role===role);
            game.player.setPosition(npc.home.x+0.9,npc.home.y,npc.home.z);await step(5);
            ok(game.interact()&&game.interactionUI.isOpen&&!game.canAct(),`${role} interaction opens a modal and blocks combat`);
            if(role==='merchant') {
                const credits=game.state.credits,reserve=game.state.ammo.pistol.reserve;
                game.interactionUI.element.querySelector('[data-buy="pistol-ammo"]').click();
                ok(game.state.credits===credits-30&&game.state.ammo.pistol.reserve===reserve+24,'Shop UI purchases exact ammunition using credits');
            }
            game.interactionUI.close();await step(2);
        }
        ok(!game.buy('medkit').ok,'Purchases are rejected away from a merchant interaction');
        const npc=game.population.actors.find(n=>n.id==='dummy-2');
        game.player.setPosition(npc.home.x,npc.home.y,npc.home.z+2);await step(10);
        const aim=npc.actor.position.clone();aim.y+=0.4;
        world.camera.position.copy(game.player.position).add(new THREE.Vector3(0,0.7,0));world.camera.lookAt(aim);world.camera.updateMatrixWorld(true);
        const npcHit=game.shoot();
        ok(npcHit?.object.userData.npcId===npc.id&&npc.health===66,'A real muzzle ray damages the intended mannequin');
        game.toggleInventory();
        ok(game.inventory.querySelector('[data-carry-grid]').children.length===12&&game.inventory.textContent.includes('CREDITI'),'Inventory shows equipment, backpack slots and real credits');
        game.toggleInventory();
        result.textContent += '\nALL DDS CHECKS PASSED'; document.title='PASS · DDS checks';
    } catch(error) { result.textContent += '\nFAIL '+error.stack; document.title='FAIL · DDS checks'; }
})();
