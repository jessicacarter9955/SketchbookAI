'use strict';
const fs=require('fs');
const {chromium}=require('playwright');
(async()=>{
    const browser=await chromium.launch({headless:true,args:[
        '--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--no-sandbox','--disable-dev-shm-usage']});
    const page=await browser.newPage({viewport:{width:1280,height:850},deviceScaleFactor:1});
    const errors=[],failed=[];
    page.on('pageerror',e=>errors.push(e.message.slice(0,230)));
    page.on('requestfailed',req=>failed.push(req.url().slice(0,170)+' '+req.failure()?.errorText));
    const scene=process.env.SKETCHBOOK_SCENE==='sandbox' ? 'sandbox' : 'urban-photoreal';
    const target='https://my-test-site3.netlify.app/editor.html?scene='+scene+'&play=1';
    console.log('Browser test:',target);
    fs.mkdirSync('artifacts/supercars',{recursive:true});
    try {
        // Deploy and browser workflows run independently. Verify that Netlify
        // serves the revised physics code before launching a test; otherwise
        // a successful GitHub push can be tested against the previous build.
        let current=false;
        for(let attempt=0;attempt<20;attempt++){
            const response=await page.request.get(
                'https://my-test-site3.netlify.app/src/editor/ActorLayer.js?v=wheel-rig'+Date.now(),
                {timeout:12000}).catch(()=>null);
            const source=response?.ok() ? await response.text() : '';
            if(source.includes('wheel.maxSuspensionTravel=0.12;')){
                current=true; break;
            }
            await page.waitForTimeout(6500);
        }
        if(!current) throw Error('Latest wheel rig/ground fix not yet deployed on Netlify.');
        await page.goto(target,{waitUntil:'domcontentloaded',timeout:65000});
        await page.waitForFunction(()=>Boolean(globalThis.supercarsStatus) ||
            /Impossibile avviare la scena/.test(document.querySelector('#loading-screen')?.textContent||''),
            null,{timeout:220000});
        const loadState=await page.evaluate(()=>({loading:document.querySelector('#loading-screen')?.innerText?.slice(0,600),
            status:globalThis.supercarsStatus,active:!!globalThis.sceneEditor}));
        console.log('Loading status:',JSON.stringify(loadState));
        await page.waitForTimeout(2500);
        const data=await page.evaluate(()=>{
            const ed=globalThis.sceneEditor,world=globalThis.world;
            const names=ed?.items?.filter(x=>x.name?.startsWith('Sketchfab · ')).map(x=>({name:x.name,prefab:x.prefab,assetId:x.assetId,position:x.position}))||[];
            const actors=world?.vehicles?.filter(x=>x.userData?.rigStatus?.source).map(x=>({
                isCar:x.constructor?.name,position:x.position.toArray(),seats:x.seats?.length,
                branded:!!x.children?.some(c=>c.userData?.sketchfabBody),
                rig:x.userData.rigStatus||null,
                wheels:x.rayCastVehicle?.wheelInfos.map(w=>({
                    radius:w.radius,contact:w.isInContact,rotation:w.rotation,
                    height:w.worldTransform?.position?.y,
                    suspension:w.suspensionLength
                })),
                floor:x.userData.spawnGround,rideHeight:x.userData.chassisRideHeight,
                wheelVisuals:(x.userData.sketchfabWheelRig||[]).map(binding=>{
                    const wheel=x.rayCastVehicle.wheelInfos[binding.index];
                    return {physicsIndex:binding.index,originalMeshCount:binding.pivot.children.length,
                        originalAssetCenter:binding.sourceCenter.toArray(),
                        visualAnchor:binding.visualAnchor?.toArray(),
                        pivot:binding.pivot.position.toArray(),
                        trackError:Math.hypot(binding.pivot.position.x-binding.visualAnchor.x,
                            binding.pivot.position.z-binding.visualAnchor.z),
                        physicsX:wheel.chassisConnectionPointLocal.x,physicsZ:wheel.chassisConnectionPointLocal.z,
                        radius:wheel.radius,rendered:binding.pivot.children.some(node=>node.visible)
                    };
                }),
                staticWheelGroups:(x.children.find(child=>child.userData.sketchfabBody)?.children||[])
                    .flatMap(()=>[]),
                originalPrefabVisible:x.wheels.some(w=>w.wheelObject.visible)
            }))||[];
            return {ready:!!ed,status:globalThis.supercarsStatus,names,actors,player:world?.editorPlayer?.position?.toArray(),
                playing:!!ed&&!ed.active,worldReady:world?.levelRuntime?.ready,
                message:ed?.root?.querySelector('[data-status]')?.textContent||''};
        });
        console.log('Result:',JSON.stringify(data));
        const nodeNames=await page.evaluate(()=>{
            const editor=globalThis.sceneEditor;
            return (editor?.items||[]).filter(x=>x.name.startsWith('Sketchfab · ')).map(item=>{
                const template=editor.templates.get(item.assetId),matches=[];
                template?.traverse(o=>{if(/wheel|plane08|object_3[789]|object_40/i.test(o.name))matches.push(o.name);});
                return {model:item.name,matchingNodes:matches.slice(0,55)};
            });
        });
        console.log('GLTFLoader wheel node names:',JSON.stringify(nodeNames));
        const wheelVisuals=await page.evaluate(()=>{
            const world=globalThis.world;
            const THREE=world?.THREE||null;
            return world.vehicles.filter(a=>a.userData.rigStatus?.ready).map(car=>{
                const shell=car.children.find(x=>x.userData.sketchfabBody);
                const rig=car.userData.sketchfabWheelRig;
                shell.updateMatrixWorld(true);car.updateMatrixWorld(true);
                return {brand:car.userData.rigStatus.source,shellOffset:shell.position.toArray(),
                    wheelGroups:rig.map(({index,pivot})=>{
                        const meshes=[];pivot.traverse(o=>{if(o.isMesh)meshes.push(o);});
                        return {index,local:pivot.position.toArray(),meshCount:meshes.length,
                            bounds:meshes.slice(0,1).map(o=>({
                                min:o.geometry.boundingBox?.min?.toArray(),
                                max:o.geometry.boundingBox?.max?.toArray()
                            }))};
                    }),
                    sourceTargets:(car.userData.rigStatus.source==='bmw'?['Front_Wheels','Back_Wheels','Wheels_Logo']:
                        car.userData.rigStatus.source==='lamborghini'?['Plane08_3','Plane08001_4']:
                        ['Object_37','Object_38','Object_39','Object_40']).map(name=>{
                            const target=shell.getObjectByName(name);
                            return {name,exists:!!target,visible:target?.visible,position:target?.position.toArray()};
                        }),
                    prefabWheels:car.wheels.map(w=>({visible:w.wheelObject.visible,position:w.position.toArray()}))
                };
            });
        });
        console.log('Branded wheel visual alignment:',JSON.stringify(wheelVisuals));
        // Diagnostic: in the Ferrari, a tire mesh alone may hide static spoke meshes.
        const ferrariParts=await page.evaluate(()=>{
            const ferrari=globalThis.world.vehicles.find(x=>x.userData.rigStatus?.source==='ferrari');
            const shell=ferrari?.children.find(x=>x.userData.sketchfabBody);
            if(!shell)return [];
            shell.updateMatrixWorld(true);
            const inverse=shell.matrixWorld.clone().invert(), result=[];
            shell.traverse(o=>{
                if(!o.isMesh||!o.geometry?.getAttribute('position'))return;
                o.geometry.computeBoundingBox();
                const box=o.geometry.boundingBox.clone().applyMatrix4(inverse.clone().multiply(o.matrixWorld));
                const c=box.getCenter(o.position.clone()),sz=box.getSize(o.position.clone());
                const nearWheel=Math.abs(c.x)>.48 && Math.abs(c.x)<1.18 &&
                    (Math.abs(c.z-1.17)<.5 || Math.abs(c.z+1.34)<.5);
                if(nearWheel)result.push({name:o.name,parent:o.parent?.name,
                    size:sz.toArray().map(n=>+n.toFixed(3)),
                    center:c.toArray().map(n=>+n.toFixed(3)),
                    triangles:o.geometry.index?.count/3||o.geometry.getAttribute('position').count/3,
                    visible:o.visible});
            });
            return result.slice(0,90);
        });
        console.log('Ferrari nearby wheel meshes:',JSON.stringify(ferrariParts));
        console.log('Page errors:',JSON.stringify(errors.slice(0,12)));
        console.log('Failed requests:',JSON.stringify(failed.slice(0,15)));
        await page.screenshot({path:'artifacts/supercars/sketchfab-three-cars.png',fullPage:true});
        if(data.names.length!==3 || data.actors.filter(x=>x.branded&&x.seats>0).length!==3 || !data.playing)
            throw Error('3 real licensed assets must be visible as drivable cars in browser.');
        if(data.actors.some(car=>car.rig?.ready!==true||car.rig.wheelCount!==4))
            throw Error('Not all branded cars have four independent wheel rig pivots.');
        // A nearby ramp can legitimately raise one wheel through suspension travel.
        // Detect sinking BELOW the ground reference, not tires riding over an object.
        if(data.actors.some(car=>car.wheels.some(w=>w.height-w.radius < car.floor-0.11)))
            throw Error('A tire is clipping beneath the road surface.');
        if(data.actors.some(car=>car.originalPrefabVisible||
            car.wheelVisuals.length!==4 || car.wheelVisuals.some(w=>!w.rendered ||
                w.originalMeshCount===0 || w.trackError>0.13 ||
                Math.abs(w.physicsX-w.visualAnchor[0])>0.001||
                Math.abs(w.physicsZ-w.visualAnchor[2])>0.001)))
            throw Error('Static prefab wheels remained visible or the ORIGINAL Sketchfab wheels are not fitted to the arches.');
        const staticMeshState=await page.evaluate(()=>globalThis.world.vehicles.filter(a=>a.userData.rigStatus?.ready).map(car=>{
            const shell=car.children.find(c=>c.userData.sketchfabBody);
            const source=car.userData.rigStatus.source;
            const groups=source==='bmw'?['Front_Wheels','Back_Wheels','Wheels_Logo']:
                source==='ferrari'?['Object_37','Object_38','Object_39','Object_40']:
                ['Plane08_3','Plane08001_4'];
            return {source,groupVisibility:groups.map(name=>({name,visible:shell.getObjectByName(name)?.visible}))};
        }));
        console.log('Original STATIC wheel groups hidden:',JSON.stringify(staticMeshState));
        if(staticMeshState.some(car=>car.groupVisibility.some(g=>g.visible!==false)))
            throw Error('At least one ORIGINAL static Sketchfab wheel group was still rendered.');
        const entered=await page.evaluate(()=>{
            const world=globalThis.world,player=world.editorPlayer;
            const car=world.vehicles.find(x=>x.userData.editorActor&&x.children.some(c=>c.userData.sketchfabBody));
            player.teleportToVehicle(car,car.seats[0]);
            player.takeControl();
            return {occupied:car.seats[0].occupiedBy===player,control:player.controlledObject===car,
                throttle:!!car.actions?.throttle,engine:!!car.rayCastVehicle};
        });
        console.log('Vehicle driving:',JSON.stringify(entered));
        await page.locator('canvas').first().focus().catch(()=>{});
        const before=await page.evaluate(()=>{
            const car=globalThis.world.editorPlayer.controlledObject;
            return car.rayCastVehicle.wheelInfos.map(w=>w.rotation);
        });
        await page.keyboard.down('w');
        await page.keyboard.down('d');
        await page.waitForTimeout(1950);
        const animated=await page.evaluate(()=>{
            const car=globalThis.world.editorPlayer.controlledObject;
            const spins=car.rayCastVehicle.wheelInfos.map(w=>w.rotation);
            const steering=car.rayCastVehicle.wheelInfos.map(w=>w.steering);
            return {spins,steering,moved:car.collision.velocity.length(),
                throttleHeld:car.actions.throttle.isPressed,steeringHeld:car.actions.right.isPressed,
                groundCount:car.rayCastVehicle.numWheelsOnGround,
                wheelBodies:car.rayCastVehicle.wheelInfos.map(w=>Boolean(w.raycastResult.body)),
                suspension:car.rayCastVehicle.wheelInfos.map(w=>w.suspensionLength),
                appliedEngine:car.rayCastVehicle.wheelInfos.map(w=>w.engineForce),
                rigs:car.userData.sketchfabWheelRig?.length};
        });
        await page.keyboard.up('w');
        await page.keyboard.up('d');
        console.log('Wheel spin and steering physics:',JSON.stringify({before,animated}));
        if(animated.rigs!==4 || !animated.spins.some((v,i)=>Math.abs(v-before[i])>0.05) ||
           !animated.steering.some(v=>Math.abs(v)>0.01))
            throw Error('Driving physics did not animate the real wheel spin and steering transforms.');
        const physics=await page.evaluate(()=>{
            const actor=globalThis.world.vehicles.find(x=>x.userData.rigStatus?.ready);
            return actor?{name:actor.userData.rigStatus?.source,
                wheeling:actor.userData.sketchfabWheelRig?.map(w=>({index:w.index,pos:w.pivot.position.toArray(),q:w.pivot.quaternion.toArray()})),
                wheels:actor.rayCastVehicle.wheelInfos.map(w=>({contact:w.isInContact,spin:w.rotation,suspension:w.suspensionLength,radius:w.radius,
                    centerY:w.worldTransform.position.y})),ground:actor.userData.spawnGround,chassis:actor.position.y
            }:null;
        });
        console.log('Rig details:',JSON.stringify(physics));
        if(!entered.occupied || !entered.control || !entered.throttle || !entered.engine)
            throw Error('Car seat driving controls not connected.');
        // The previous green test only drove the BMW. Test Ferrari and
        // Lamborghini individually and measure real wheel-mesh pivot movement,
        // not merely the physics wheel's internal rotation counter.
        const individualDrives=[{brand:'bmw',spinDelta:Math.max(...animated.spins.map((s,i)=>Math.abs(s-before[i]))),
            velocity:animated.moved,steering:Math.max(...animated.steering.map(Math.abs)),
            wheelsOnGround:animated.groundCount}];
        for(const brand of ['ferrari','lamborghini']){
            const initial=await page.evaluate(brand=>{
                const world=globalThis.world,player=world.editorPlayer;
                player.stopControllingVehicle();
                player.leaveSeat();
                const car=world.vehicles.find(x=>x.userData.rigStatus?.source===brand);
                if(!car?.seats?.[0])throw Error('Missing driving seat '+brand);
                player.teleportToVehicle(car,car.seats[0]);
                player.takeControl();
                return {brand,spin:car.rayCastVehicle.wheelInfos.map(w=>w.rotation),
                    pivot:car.userData.sketchfabWheelRig.map(w=>w.pivot.quaternion.toArray())};
            },brand);
            await page.locator('canvas').first().focus();
            await page.keyboard.down('w');
            await page.keyboard.down('d');
            await page.waitForTimeout(1950);
            const driven=await page.evaluate(()=>{
                const car=globalThis.world.editorPlayer.controlledObject;
                return {spin:car.rayCastVehicle.wheelInfos.map(w=>w.rotation),
                    steer:car.rayCastVehicle.wheelInfos.map(w=>w.steering),
                    pivot:car.userData.sketchfabWheelRig.map(w=>w.pivot.quaternion.toArray()),
                    velocity:car.collision.velocity.length(),
                    wheelsOnGround:car.rayCastVehicle.numWheelsOnGround,
                    driving:car.actions.throttle.isPressed,
                    source:car.userData.rigStatus.source};
            });
            await page.keyboard.up('w');
            await page.keyboard.up('d');
            const delta=Math.max(...driven.spin.map((s,i)=>Math.abs(s-initial.spin[i])));
            const pivotAngle=Math.max(...driven.pivot.map((q,i)=>{
                const dot=Math.abs(q.reduce((sum,v,j)=>sum+v*initial.pivot[i][j],0));
                return 2*Math.acos(Math.min(1,dot));
            }));
            const result={brand,spinDelta:delta,pivotAngle,velocity:driven.velocity,
                steering:Math.max(...driven.steer.map(Math.abs)),wheelsOnGround:driven.wheelsOnGround};
            individualDrives.push(result);
            console.log('Individual supercar driving:',JSON.stringify(result));
            if(driven.source!==brand || !driven.driving || driven.wheelsOnGround<1 ||
                driven.velocity<0.15 || delta<0.05 || pivotAngle<0.05 ||
                result.steering<0.015){
                throw Error(brand+' has NOT passed wheel rotation, visual pivot, traction and steering test: '+JSON.stringify(result));
            }
        }
        console.log('PASS: all three branded cars independently accelerate, steer and animate their original wheel geometry.');

        await page.evaluate(()=>{
            const editor=globalThis.sceneEditor,world=globalThis.world;
            editor.setActive(true);
            const center=globalThis.supercarsStatus?.imported?.length ? editor.items.filter(x=>x.name.startsWith('Sketchfab · ')) : [];
            if(center.length) {
                const x=center.reduce((n,i)=>n+i.position[0],0)/center.length;
                const y=center.reduce((n,i)=>n+i.position[1],0)/center.length+1.1;
                const z=center.reduce((n,i)=>n+i.position[2],0)/center.length;
                editor.orbit.target.set(x,y,z);
                world.camera.position.set(x+15,y+11,z+17);
                editor.orbit.update();
            }
        });
        await page.waitForTimeout(1600);
        await page.screenshot({path:'artifacts/supercars/sketchfab-supercars-overview.png',fullPage:true});
    }catch(e){
        try {await page.screenshot({path:'artifacts/supercars/supercars-failure.png',fullPage:true});}catch{}
        console.error('Browser test failed:',e.message);
        console.error('Browser page errors:',JSON.stringify(errors.slice(0,20)));
        console.error('Browser failed requests:',JSON.stringify(failed.slice(0,20)));
        try {
            console.error('Browser DOM diagnostic:',JSON.stringify(await page.evaluate(()=>({
                title:document.title,loading:document.querySelector('#loading-screen')?.innerText?.slice(0,1100),
                status:globalThis.supercarsStatus,hasWorld:!!globalThis.world,
                hasEditor:!!globalThis.sceneEditor,body:document.body.innerText.slice(0,700)
            }))));
        }catch{}
        await browser.close();
        process.exit(1);
    }
    await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
