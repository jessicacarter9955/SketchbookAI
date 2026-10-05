(async()=>{
    const result=document.getElementById('test-results'),ok=(yes,label)=>{if(!yes)throw Error(label);result.textContent+=`PASS ${label}\n`;};
    try {
        const world=new World(),city=new CityRuntime(world);world.levelRuntime=city;await city.initialize(()=>{});city.update=()=>{};
        const actors=new ActorLayer(world);await actors.initialize('dds');actors.spawn.set(0,city.groundAt(0,0,5)+1.2,0);actors.resetPlayer();world.setTimeScale(1);
        const game=new DdsGame(world,{storage:{getItem:()=>null,setItem:()=>{}},key:'aim-test'}),player=world.editorPlayer;
        const step=async count=>{for(let i=0;i<count;i++){world.update(1/60,1/60);if(count>1&&i%60===0)await new Promise(resolve=>setTimeout(resolve,0));}};
        const canvas=world.renderer.domElement;world.inputManager.setPointerLock(false);await step(120);
        canvas.dispatchEvent(new MouseEvent('mousedown',{button:2,clientX:100,clientY:100,bubbles:true}));await step(15);
        const pose=player.hand.quaternion.clone();let maxDrift=0;
        player.triggerAction('up',true);
        for(let i=0;i<120;i++){await step(1);maxDrift=Math.max(maxDrift,player.hand.quaternion.angleTo(pose));}
        player.triggerAction('up',false);
        ok(player.aiming&&player.upperName==='rifle_aim','Holding RMB keeps aim active throughout locomotion');
        ok(maxDrift<0.005,`Aim hand pose stays stable for 120 frames (drift ${maxDrift.toFixed(5)})`);
        ok(player.mixer===player.upperMixer&&player.locomotionAction.getClip().tracks.every(t=>!player.upperBones.has(t.name.split('.')[0])),'Locomotion and aiming never compete for the same bones');
        const theta=world.cameraOperator.theta;
        canvas.dispatchEvent(new MouseEvent('mousedown',{button:0,clientX:100,clientY:100,bubbles:true}));
        document.dispatchEvent(new MouseEvent('mouseup',{button:0,bubbles:true}));
        document.dispatchEvent(new MouseEvent('mousemove',{clientX:160,clientY:100,bubbles:true}));await step(20);
        ok(world.cameraOperator.theta!==theta&&player.aiming,'Releasing LMB while holding RMB preserves camera drag and aim');
        game.equip('pistol');await step(Math.ceil(player.actionRemaining*60)+15);
        const firstPose=player.hand.quaternion.clone();
        canvas.dispatchEvent(new MouseEvent('mousedown',{button:0,clientX:160,clientY:100,bubbles:true}));document.dispatchEvent(new MouseEvent('mouseup',{button:0,bubbles:true}));
        const first=game.lastShot.aim,firstDirection=world.camera.getWorldDirection(new THREE.Vector3());await step(7);
        ok(player.hand.quaternion.angleTo(firstPose)>0.001&&player.upperName==='pistol_aim','Pistol recoil overlays the persistent aim pose');
        ok(player.weapon.animations.length>0&&player.weaponMixer.existingAction(player.weapon.animations[0]),'Pistol slide uses its exported weapon animation');
        await step(20);document.dispatchEvent(new MouseEvent('mousemove',{clientX:240,clientY:135,bubbles:true}));await step(2);
        canvas.dispatchEvent(new MouseEvent('mousedown',{button:0,clientX:240,clientY:135,bubbles:true}));document.dispatchEvent(new MouseEvent('mouseup',{button:0,bubbles:true}));
        const aimDistance=new THREE.Vector3(...first).distanceTo(new THREE.Vector3(...game.lastShot.aim));
        const aimAngle=firstDirection.angleTo(world.camera.getWorldDirection(new THREE.Vector3()));
        result.textContent+=`Aim diagnostic: angle ${aimAngle.toFixed(4)} rad, endpoint displacement ${aimDistance.toFixed(3)} m\n`;
        ok(aimDistance>0.05&&aimAngle>0.03,'Mouse aim changes the bullet destination in yaw and pitch');
        await step(30);ok(player.upperName==='pistol_aim'&&player.aiming,'Aim remains held after repeated pistol shots');
        document.dispatchEvent(new MouseEvent('mouseup',{button:2,bubbles:true}));await step(3);ok(!player.aiming&&player.upperName==='pistol_ready','Releasing RMB returns to ready pose');
        result.textContent+='\nALL SUSTAINED AIM CHECKS PASSED';document.title='PASS · DDS sustained aim';
    }catch(error){result.textContent+='\nFAIL '+error.stack;document.title='FAIL · DDS sustained aim';}
})();
