/* Load after sketchbook.min.js, then call from an initialized DDS smoke scene:
 * await runDdsPopulationChecks({world, game, population:game.population, step, ok});
 * step(frames) advances world.update(1/60,1/60); ok(condition,description) asserts.
 */
globalThis.runDdsPopulationChecks=async ({world,game,population=game.population,step,ok})=>{
    const player=world.editorPlayer,inputReceivers=[...world.inputManager.inputReceivers];
    const savedHealth={...game.state.npcHealth};
    const counts=()=>({characters:world.characters.length,bodies:world.physicsWorld.bodies.length,
        updates:world.updatables.length,pre:world.physicsWorld._listeners?.preStep?.length,
        post:world.physicsWorld._listeners?.postStep?.length,csm:world.sky.csm.shaders.size});
    const baseline=counts();
    ok(population.actors.length===6,'Six DDS residents spawn near the player');
    for(const npc of population.actors) {
        let skin;npc.actor.traverse(object=>{if(object.isSkinnedMesh)skin=object;});
        ok(skin?.skeleton.bones.length===88,`${npc.name} uses the real 88-bone mannequin`);
        ok(npc.registered&&world.characters.includes(npc.actor)&&world.physicsWorld.bodies.includes(npc.actor.characterCapsule.body),`${npc.name} has world and physics registration`);
        ok(npc.hitbox.userData.npcId===npc.id&&population.hitboxes.includes(npc.hitbox),`${npc.name} has a damage ray hitbox`);
        ok(Number.isFinite(game.ground(npc.home.x,npc.home.z)),`${npc.name} spawns on finite ground`);
    }
    const walkers=population.actors.filter(npc=>npc.role==='pedestrian');
    ok(walkers.every(npc=>npc.route.length>=2),'Both pedestrians have verified short routes');
    const starts=walkers.map(npc=>npc.actor.position.clone());
    await step(100);
    ok(walkers.every((npc,i)=>npc.actor.position.distanceTo(starts[i])>0.4),'Both pedestrians physically walk their routes');
    ok(world.editorPlayer===player&&inputReceivers.every((receiver,i)=>world.inputManager.inputReceivers[i]===receiver),'Residents never take over player input');
    const walker=walkers[0];population.pauseActor(walker.id,5);
    await step(30);const held=walker.actor.position.clone();await step(30);
    ok(walker.actor.position.distanceTo(held)<0.08,'A conversation holds its pedestrian in place');
    const dummy=population.actors.find(npc=>npc.role==='target');
    const oldActor=dummy.actor,oldBody=oldActor.characterCapsule.body;
    ok(population.damage(dummy.id,34)?.health===66,'A hit removes exact NPC health');
    ok(population.damage(dummy.id,NaN)===null&&dummy.health===66,'Invalid NPC damage is ignored');
    population.damage(dummy.id,80);await step(65);
    ok(dummy.dead&&dummy.health===0&&game.state.npcHealth[dummy.id]===0,'Lethal damage persists NPC death');
    ok(!population.hitboxes.includes(dummy.hitbox)&&population.nearest(dummy.home,0.5)===null,'Dead residents cannot be shot or interacted with');
    ok(!world.characters.includes(oldActor)&&!world.physicsWorld.bodies.includes(oldBody)&&!world.updatables.includes(oldActor),'Death removes character physics and update registration');
    ok(dummy.corpse.parent===population.root&&dummy.corpse.rotation.z>1.5,'The fallen mannequin remains visibly in the scene');
    ok(population.damage(dummy.id,30)===null,'A corpse cannot receive extra damage');
    const beforePause=counts();population.setPaused(true);
    const paused=counts();
    ok(population.hitboxes.length===0&&!population.root.visible,'Editor pause hides residents and hitboxes');
    ok(paused.characters===beforePause.characters-5&&paused.bodies===beforePause.bodies-5&&paused.updates===beforePause.updates-5,'Pause unregisters every living resident');
    population.setPaused(false);
    ok(JSON.stringify(counts())===JSON.stringify(beforePause),'Resume restores registrations without duplicates');
    game.state.npcHealth={...savedHealth};population.reset();
    ok(population.actors.every(npc=>!npc.dead&&npc.health===100),'New raid restores all residents');
    ok(JSON.stringify(counts())===JSON.stringify(baseline),'Restart leaves no extra bodies, callbacks, updates, or shadow materials');
    ok(!oldActor.parent&&!world.updatables.includes(oldActor),'Restart disposes the old corpse');
    population.reset();
    ok(JSON.stringify(counts())===JSON.stringify(baseline),'Repeated restart has stable registration counts');
    game.save();
};
