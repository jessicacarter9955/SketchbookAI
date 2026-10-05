(async () => {
    const result = document.getElementById('test-results');
    const ok = (condition, text) => { if (!condition) throw new Error(text); result.textContent += `PASS ${text}\n`; };
    try {
        const params = new URLSearchParams(location.search);
        const base = params.get('character') || 'build/local-scenes/ue2three/current/';
        const world = new World(), city = new CityRuntime(world); world.levelRuntime = city;
        await city.initialize(() => {}); city.update = () => {};
        const actors = new ActorLayer(world); await actors.initialize('ue2three', {characterBase: base});
        const floor = city.groundAt(0, 0, 5); actors.spawn.set(0, floor + 1.2, 0);
        const player = actors.resetPlayer(); world.setTimeScale(1);

        ok(player.userData.playerProfile === 'ue2three', 'Generic ue2three player profile instantiated');
        ok(player.userData.ue2three?.kind === 'character', 'Migration manifest attached to runtime player');
        let skin; player.traverse(object => { if (object.isSkinnedMesh && !skin) skin = object; });
        ok(!!skin && skin.skeleton.bones.length > 1, 'Migrated GLB contains a skinned skeleton');
        const required = player.userData.ue2three.runtime?.required_bones || [];
        ok(required.every(name => !!player.getObjectByName(name)), 'All required recipe bones exist in runtime clone');
        const attachmentNames = Object.keys(player.userData.ue2three.attachment_assets || {});
        ok(attachmentNames.every(name => !!player.getObjectByName(`ue2three_attachment_${name}`)),
            'Configured generic attachment assets mount on their declared character sockets');
        ok(player.animations.some(clip => clip.name === 'idle'), 'Canonical idle animation is loaded');
        ok(player.animations.some(clip => clip.name === 'run'), 'Canonical run animation is loaded');

        const step = async count => {
            for (let i=0;i<count;i++) {
                world.update(1/60,1/60);
                if (i%10===0) await new Promise(resolve=>setTimeout(resolve,0));
            }
        };
        await step(90);
        ok(player.rayHasHit, 'Migrated character stands on existing Three.js/Cannon world');

        const bones = [];
        player.traverse(object => { if (object.isBone) bones.push(object); });
        const pose = () => bones.flatMap(bone => [bone.position.x,bone.position.y,bone.position.z,
            bone.quaternion.x,bone.quaternion.y,bone.quaternion.z,bone.quaternion.w]);
        const beforePose = pose();
        player.setAnimation('run',0);
        await step(90);
        const afterPose = pose();
        ok(afterPose.every(Number.isFinite), 'Animation playback keeps every sampled bone transform finite');
        ok(afterPose.some((value,index) => Math.abs(value-beforePose[index])>1e-3),
            'Migrated run animation advances the character skeleton over sustained playback');

        const initial = player.position.clone();
        player.setViewVector(new THREE.Vector3(1,0,0)); player.triggerAction('up',true);
        await step(70); player.triggerAction('up',false);
        ok(player.position.distanceTo(initial)>1, 'Migrated character uses reusable Sketchbook locomotion');

        const rootName = player.userData.ue2three.runtime?.root_bone || 'root';
        const root = player.getObjectByName(rootName);
        if (player.userData.ue2three.runtime?.root_motion !== 'preserve' && root)
            ok(root.position.length()<0.01, 'Root-motion policy keeps visual root near its capsule');

        const beforeJump = player.position.y;
        player.triggerAction('jump',true); await step(25); player.triggerAction('jump',false);
        ok(player.position.y>beforeJump+0.2, 'Migrated character can jump using the existing game controller');

        result.textContent += '\nALL UE2THREE CHARACTER CHECKS PASSED';
        document.title='PASS · ue2three character';
    } catch(error) {
        result.textContent += '\nFAIL '+error.stack;
        document.title='FAIL · ue2three character';
    }
})();
